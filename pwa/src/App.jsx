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

const CLIENT_ID_KEY = 'afterword:pwa:googleClientId';
const DEFAULT_CLIENT_ID = '355508535747-le46i085l572ehjkklebif8dfqv7eb8f.apps.googleusercontent.com';

export default function App() {
  const [clientId, setClientId] = useState(
    () => import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || DEFAULT_CLIENT_ID
  );
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('briefings');
  const [articles, setArticles] = useState([]);
  const [briefings, setBriefings] = useState([]);
  const [query, setQuery] = useState('');
  const [readerItem, setReaderItem] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [speaking, setSpeaking] = useState(false);

  const [scanDraft, setScanDraft] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const cameraInputRef = useRef(null);

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
    await db.articles.add({
      url: `afterword://book-scan/${now}`,
      title: scanDraft.title.trim() || `Book Excerpt — ${new Date().toLocaleDateString()}`,
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

  async function handleSaveNote(item) {
    await db.articles.update(item.id, {
      userNotes: noteDraft.trim(),
      updatedAt: Date.now(),
    });
    setEditingNoteId(null);
    await refreshLocal();
    if (readerItem?.id === item.id) {
      setReaderItem({ ...item, userNotes: noteDraft.trim() });
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
      <header className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '18px' }}>Afterword</strong>
          <div style={{ display: 'flex', gap: '6px' }}>
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

        {status && <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--sage)' }}>{status}</div>}
      </header>

      {scanDraft && (
        <form className="card" onSubmit={handleSaveScan} style={{ background: '#FDF7E7', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <strong>Review Scanned Book Excerpt</strong>
          <input
            className="input"
            placeholder="Book title & page # (e.g., Blindsight, p. 114)"
            value={scanDraft.title}
            onChange={(e) => setScanDraft({ ...scanDraft, title: e.target.value })}
          />
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
              Save & Sync
            </button>
            <button type="button" className="btn" onClick={() => setScanDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {readerItem ? (
        <article className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <button className="pill" onClick={() => setReaderItem(null)}>
              ← Back
            </button>
            {readerItem.url.startsWith('http') && (
              <a href={readerItem.url} target="_blank" rel="noreferrer" className="pill">
                Open Original ↗
              </a>
            )}
          </div>
          <h2 style={{ margin: 0, fontSize: '18px' }}>{readerItem.title}</h2>
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
              <div className="card">Tap <strong>Sync Drive</strong> to pull briefings from your desktop extension.</div>
            ) : (
              briefings.map((b) => (
                <div key={b.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--ink-muted)' }}>
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
                  <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--ink-muted)' }}>
                    {item.source === 'book-scan' ? 'BOOK SCAN' : 'ARTICLE'}
                  </div>
                  <div
                    onClick={() => setReaderItem(item)}
                    style={{ fontWeight: 700, fontSize: '15px', cursor: 'pointer', margin: '4px 0' }}
                  >
                    {item.title}
                  </div>
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
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <button className="pill" onClick={() => setReaderItem(item)}>
                        Read
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
        </>
      )}
    </div>
  );
}
