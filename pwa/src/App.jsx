import React, { useEffect, useRef, useState } from 'react';
import {
  db,
  exportSyncArchiveJSON,
  mergeRemoteSyncArchive,
  recordTombstone,
} from './db.js';
import {
  requestMobileDriveToken,
  pullDriveSyncFile,
  pushDriveSyncFile,
  extractTextViaDriveOCR,
} from './googleDrive.js';
import { LANDING_CSS, LANDING_HTML } from './landingContent.js';

const CLIENT_ID_KEY = 'afterword:pwa:googleClientId';
const DEFAULT_CLIENT_ID = '355508535747-le46i085l572ehjkklebif8dfqv7eb8f.apps.googleusercontent.com';

function detectMobileViewport() {
  if (typeof window === 'undefined') return true;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  return uaMobile || window.innerWidth < 768;
}

export default function App() {
  const [clientId] = useState(
    () => import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || DEFAULT_CLIENT_ID
  );
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('briefings');
  const [articles, setArticles] = useState([]);
  const [briefings, setBriefings] = useState([]);
  const [query, setQuery] = useState('');
  const [readerItem, setReaderItem] = useState(null);

  const [editingTitleId, setEditingTitleId] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [speaking, setSpeaking] = useState(false);

  const [isMobile, setIsMobile] = useState(detectMobileViewport);
  const [scanDraft, setScanDraft] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    const onResize = () => setIsMobile(detectMobileViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  async function refreshLocal() {
    const arts = await db.articles.orderBy('savedAt').reverse().toArray();
    const briefs = await db.briefings.orderBy('createdAt').reverse().toArray();
    setArticles(arts);
    setBriefings(briefs);
  }

  useEffect(() => {
    refreshLocal();
  }, []);

  async function handleSync(existingToken = token) {
    const activeClientId = (clientId || DEFAULT_CLIENT_ID).trim();
    localStorage.setItem(CLIENT_ID_KEY, activeClientId);
    setStatus('Syncing with Google Drive...');

    try {
      const activeToken = existingToken || (await requestMobileDriveToken(activeClientId));
      setToken(activeToken);

      const remote = await pullDriveSyncFile(activeToken);
      if (remote?.jsonText) {
        await mergeRemoteSyncArchive(remote.jsonText);
        await refreshLocal();
      }

      const mergedJson = await exportSyncArchiveJSON();
      await pushDriveSyncFile(activeToken, mergedJson, remote?.fileId || null);
      setStatus(`Synced (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
    } catch (err) {
      console.error(err);
      setStatus(`Sync error: ${err.message}`);
    }
  }

  async function handleCapturePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const activeClientId = (clientId || DEFAULT_CLIENT_ID).trim();
    setIsScanning(true);
    setStatus('Extracting book text via Drive OCR...');

    try {
      const activeToken = token || (await requestMobileDriveToken(activeClientId));
      setToken(activeToken);
      const extractedText = await extractTextViaDriveOCR(activeToken, file);
      setScanDraft({
        title: '',
        content: extractedText,
        userNotes: '',
      });
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus(`OCR failed: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  }

  async function handleSaveScan(e) {
    e.preventDefault();
    if (!scanDraft?.content?.trim()) return;

    const now = Date.now();
    const stamp = new Date(now).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    await db.articles.add({
      url: `afterword://book-scan/${now}`,
      title: scanDraft.title.trim() || `Book Scan — ${stamp}`,
      content: scanDraft.content.trim(),
      digest: '',
      userNotes: scanDraft.userNotes.trim(),
      savedAt: now,
      updatedAt: now,
      status: 'saved',
      source: 'book-scan',
    });

    setScanDraft(null);
    await refreshLocal();
    setTab('library');
    if (token) await handleSync(token);
  }

  async function handleSaveTitle(item) {
    const cleaned = titleDraft.trim();
    if (!cleaned) return;
    const now = Date.now();
    await db.articles.update(item.id, {
      title: cleaned,
      updatedAt: now,
    });
    setEditingTitleId(null);
    await refreshLocal();
    if (readerItem?.id === item.id) {
      setReaderItem({ ...readerItem, title: cleaned, updatedAt: now });
    }
    if (token) await handleSync(token);
  }

  async function handleSaveNote(item) {
    const cleaned = noteDraft.trim();
    const now = Date.now();
    await db.articles.update(item.id, {
      userNotes: cleaned,
      updatedAt: now,
    });
    setEditingNoteId(null);
    await refreshLocal();
    if (readerItem?.id === item.id) {
      setReaderItem({ ...readerItem, userNotes: cleaned, updatedAt: now });
    }
    if (token) await handleSync(token);
  }

  async function handleDeleteArticle(item) {
    recordTombstone(item.url);
    await db.articles.delete(item.id);
    if (readerItem?.id === item.id) setReaderItem(null);
    await refreshLocal();
    if (token) await handleSync(token);
  }

  function toggleSpeak(text) {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }

  const filteredArticles = articles.filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      a.title?.toLowerCase().includes(q) ||
      a.digest?.toLowerCase().includes(q) ||
      a.userNotes?.toLowerCase().includes(q) ||
      a.content?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="app-shell">
      {LANDING_CSS && <style>{LANDING_CSS}</style>}

      <header className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/favicon.svg" alt="" width="28" height="28" style={{ borderRadius: '6px' }} />
            <div>
              <strong className="serif-title" style={{ fontSize: '21px' }}>Afterword</strong>
              <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                Local-first digital commonplace book
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleCapturePhoto}
            />
            <button
              className="btn"
              disabled={isScanning}
              onClick={() => cameraInputRef.current?.click()}
            >
              {isScanning ? 'Scanning...' : '+ Scan Page'}
            </button>
            <button className="btn btn-primary" onClick={() => handleSync()}>
              Sync Drive
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <a href="/story.html" className="pill pill-story">
            <span>▶</span> The Story
          </a>
          <a href="/privacy.html" className="pill">
            Privacy Policy
          </a>
          {!isMobile && (
            <a href="/afterword.zip" download className="pill pill-download">
              Download Chrome Extension (.zip) ↓
            </a>
          )}
        </div>

        {status && (
          <div style={{ fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: 'var(--sage)' }}>
            {status}
          </div>
        )}
      </header>

      {scanDraft && (
        <form className="card" onSubmit={handleSaveScan} style={{ background: '#FDF7E7', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <strong>Review Scanned Book Excerpt</strong>
          <label style={{ fontSize: '12px', fontWeight: 600 }}>
            Book Title &amp; Page # (editable anytime later)
            <input
              autoFocus
              className="input"
              style={{ marginTop: '4px' }}
              placeholder="e.g., Blindsight — Ch. 4, p. 114"
              value={scanDraft.title}
              onChange={(e) => setScanDraft({ ...scanDraft, title: e.target.value })}
            />
          </label>
          <textarea
            className="input"
            rows={6}
            value={scanDraft.content}
            onChange={(e) => setScanDraft({ ...scanDraft, content: e.target.value })}
          />
          <input
            className="input"
            placeholder="Margin note..."
            value={scanDraft.userNotes}
            onChange={(e) => setScanDraft({ ...scanDraft, userNotes: e.target.value })}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              Save &amp; Sync
            </button>
            <button type="button" className="btn" onClick={() => setScanDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {readerItem ? (
        <article className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <button className="pill" onClick={() => setReaderItem(null)}>
              ← Back
            </button>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="pill"
                onClick={() => {
                  setEditingTitleId(readerItem.id);
                  setTitleDraft(readerItem.title || '');
                }}
              >
                Rename Title
              </button>
              {readerItem.url.startsWith('http') && (
                <a href={readerItem.url} target="_blank" rel="noreferrer" className="pill">
                  Open Original ↗
                </a>
              )}
            </div>
          </div>

          {editingTitleId === readerItem.id ? (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <input
                autoFocus
                className="input"
                style={{ flex: 1 }}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
              />
              <button className="btn btn-primary" onClick={() => handleSaveTitle(readerItem)}>
                Save Title
              </button>
              <button className="btn" onClick={() => setEditingTitleId(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <h2 className="serif-title" style={{ margin: 0, fontSize: '20px' }}>{readerItem.title}</h2>
          )}

          {readerItem.userNotes && (
            <div className="note-box">
              <strong>Note:</strong> {readerItem.userNotes}
            </div>
          )}
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '15px' }}>
            {readerItem.content || readerItem.digest || 'No offline body saved for this bookmark.'}
          </div>
        </article>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`pill ${tab === 'briefings' ? 'active' : ''}`}
              onClick={() => setTab('briefings')}
            >
              Briefings ({briefings.length})
            </button>
            <button
              className={`pill ${tab === 'library' ? 'active' : ''}`}
              onClick={() => setTab('library')}
            >
              Library ({articles.length})
            </button>
          </div>

          {tab === 'briefings' ? (
            briefings.length === 0 ? (
              <div className="card">
                Tap <strong>Sync Drive</strong> to pull briefings from your desktop extension.
              </div>
            ) : (
              briefings.map((b) => (
                <div key={b.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '12px', color: 'var(--ink-muted)' }}>
                      {b.startDate} → {b.endDate}
                    </span>
                    <button className="pill" onClick={() => toggleSpeak(b.summaryMarkdown)}>
                      {speaking ? 'Stop' : 'Listen'}
                    </button>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '14px' }}>{b.summaryMarkdown}</div>
                  {b.userNotes && (
                    <div className="note-box">
                      <strong>Reflections:</strong> {b.userNotes}
                    </div>
                  )}
                </div>
              ))
            )
          ) : (
            <>
              <input
                className="input"
                placeholder="Search saved articles, book scans, and notes..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {filteredArticles.map((item) => (
                <div key={item.id} className="card">
                  <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: 'var(--ink-muted)' }}>
                    {item.source === 'book-scan' ? 'BOOK SCAN' : 'ARTICLE'}
                  </div>

                  {editingTitleId === item.id ? (
                    <div style={{ margin: '6px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <input
                        autoFocus
                        className="input"
                        placeholder="Book title & page #"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-primary" onClick={() => handleSaveTitle(item)}>
                          Save Title
                        </button>
                        <button className="btn" onClick={() => setEditingTitleId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => setReaderItem(item)}
                      className="serif-title"
                      style={{ fontWeight: 700, fontSize: '17px', cursor: 'pointer', margin: '4px 0' }}
                    >
                      {item.title}
                    </div>
                  )}

                  {item.digest && <div style={{ fontSize: '13.5px', color: 'var(--ink-muted)' }}>{item.digest}</div>}
                  {item.userNotes && (
                    <div className="note-box">
                      <strong>Note:</strong> {item.userNotes}
                    </div>
                  )}
                  {editingNoteId === item.id ? (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <textarea
                        className="input"
                        rows={3}
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-primary" onClick={() => handleSaveNote(item)}>
                          Save Note
                        </button>
                        <button className="btn" onClick={() => setEditingNoteId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                      <button className="pill" onClick={() => setReaderItem(item)}>
                        Read
                      </button>
                      <button
                        className="pill"
                        onClick={() => {
                          setEditingTitleId(item.id);
                          setTitleDraft(item.title || '');
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="pill"
                        onClick={() => {
                          setEditingNoteId(item.id);
                          setNoteDraft(item.userNotes || '');
                        }}
                      >
                        {item.userNotes ? 'Edit Note' : '+ Note'}
                      </button>
                      <button className="pill" onClick={() => handleDeleteArticle(item)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Full guide / README displayed directly underneath by default */}
          {isMobile ? (
            <section className="card" style={{ background: '#FDF7E7', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong className="serif-title" style={{ fontSize: '17px' }}>Mobile Companion Workflows</strong>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: 'var(--ink-muted)' }}>MOBILE</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13.5px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li><strong>Read &amp; Listen:</strong> Tap <em>Sync Drive</em> to pull weekly briefings and saved digests for offline reading or audio playback.</li>
                <li><strong>Scan Book Pages:</strong> Tap <em>+ Scan Page</em> to photograph a physical book page, extract text via Drive OCR, and name the book.</li>
                <li><strong>Jot Margin Notes:</strong> Add or edit reflections on any saved item and sync back to desktop.</li>
              </ul>
              <div style={{ fontSize: '12.5px', padding: '8px 10px', background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: '8px' }}>
                <strong>Want the full experience?</strong> Open <code>afterword-notes.vercel.app</code> on <strong>desktop Chrome</strong> to download the extension for one-click web clipping, on-device Gemini Nano summaries, semantic search, and weekly synthesis briefings.
              </div>
            </section>
          ) : LANDING_HTML ? (
            <div className="landing-embed" dangerouslySetInnerHTML={{ __html: LANDING_HTML }} />
          ) : null}
        </>
      )}
    </div>
  );
}
