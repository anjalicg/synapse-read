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
import ArchitectureDetails from './ArchitectureDetails.jsx';
import MarkdownView from './MarkdownView.jsx';
import { useSpeechPlayer } from './speechPlayer.js';

const CLIENT_ID_KEY = 'afterword:pwa:googleClientId';
const DEFAULT_CLIENT_ID = '355508535747-le46i085l572ehjkklebif8dfqv7eb8f.apps.googleusercontent.com';
const RATES = [1, 1.25, 1.5, 1.75];

function detectMobileViewport() {
  if (typeof window === 'undefined') return true;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  return uaMobile || window.innerWidth < 768;
}

const PlaySvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <polygon points="6,4 20,12 6,20" />
  </svg>
);

const PauseSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

const StopSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
);

const PrevSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="5" y="5" width="2.5" height="14" />
    <polygon points="19,5 9,12 19,19" />
  </svg>
);

const NextSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <polygon points="5,5 15,12 5,19" />
    <rect x="16.5" y="5" width="2.5" height="14" />
  </svg>
);

function AudioControlBar({ player, itemId, text, title }) {
  const isCurrent = player.activeId === itemId && player.status !== 'idle';
  const enVoices = player.voices.filter((v) => /^en(-|_)/i.test(v.lang));
  const voiceOptions = enVoices.length ? enVoices : player.voices;

  if (!isCurrent) {
    const sanitizedLandingHtml = React.useMemo(
    () =>
      (LANDING_HTML || '').replace(/\sonclick=(["'])(.*?)\1/gi, (_, _q, body) => {
        const m = body.match(/['"]([^'"]+)['"]/);
        return m ? ` data-copy="${m[1].replace(/"/g, '&quot;')}"` : '';
      }),
    []
  );

  async function handleLandingClick(e) {
    const btn = e.target.closest('button, [data-copy], .copy-btn');
    if (!btn) return;

    let textToCopy =
      btn.getAttribute('data-copy') ||
      btn.getAttribute('data-clipboard-text') ||
      btn.dataset?.text ||
      '';

    if (!textToCopy) {
      const container = btn.closest('.flag-item, .code-block, .copy-row, li, div, p');
      const codeEl = container?.querySelector('code, pre');
      if (codeEl && !codeEl.contains(btn)) {
        textToCopy = codeEl.textContent.trim();
      }
    }

    if (!textToCopy) return;
    e.preventDefault();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      const prevLabel = btn.dataset.origLabel || btn.textContent;
      btn.dataset.origLabel = prevLabel;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = btn.dataset.origLabel || 'Copy';
      }, 1500);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  }

  return (
      <button
        type="button"
        className="pill"
        aria-label="Listen"
        title="Listen"
        onClick={() => player.playItem(itemId, text, title, 0)}
      >
        <PlaySvg />
      </button>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 10px',
        borderRadius: '10px',
        border: '1.5px solid var(--ink)',
        background: '#FDF7E7',
        marginTop: '6px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="pill"
          aria-label="Previous passage"
          title="Previous passage"
          onClick={() => player.skip(-1)}
        >
          <PrevSvg />
        </button>
        <button
          type="button"
          className="pill active"
          aria-label={player.status === 'playing' ? 'Pause' : 'Resume'}
          title={player.status === 'playing' ? 'Pause' : 'Resume'}
          onClick={player.togglePause}
        >
          {player.status === 'playing' ? <PauseSvg /> : <PlaySvg />}
        </button>
        <button
          type="button"
          className="pill"
          aria-label="Next passage"
          title="Next passage"
          onClick={() => player.skip(1)}
        >
          <NextSvg />
        </button>
        <button
          type="button"
          className="pill"
          aria-label="Stop"
          title="Stop"
          onClick={player.stop}
        >
          <StopSvg />
        </button>
        <button
          type="button"
          className="pill"
          aria-label="Playback speed"
          title="Change playback speed"
          onClick={() => {
            const nextRate = RATES[(RATES.indexOf(player.rate) + 1) % RATES.length];
            player.changeRate(nextRate);
          }}
        >
          {player.rate}x
        </button>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: 'var(--ink-muted)', marginLeft: 'auto' }}>
          {player.currentIndex + 1}/{player.sentences.length}
        </span>
      </div>

      {voiceOptions.length > 1 && (
        <select
          aria-label="Voice"
          value={player.selectedVoiceURI}
          onChange={(e) => player.changeVoice(e.target.value)}
          style={{
            border: '1px solid var(--ink)',
            borderRadius: '6px',
            padding: '4px 6px',
            fontSize: '11.5px',
            background: 'var(--card)',
            color: 'var(--ink)',
          }}
        >
          {voiceOptions.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function App() {
  const [clientId] = useState(
    () => import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || DEFAULT_CLIENT_ID
  );
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('overview');
  const [articles, setArticles] = useState([]);
  const [briefings, setBriefings] = useState([]);
  const [query, setQuery] = useState('');
  const [readerItem, setReaderItem] = useState(null);

  const [editingTitleId, setEditingTitleId] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const [isMobile, setIsMobile] = useState(detectMobileViewport);
  const [scanDraft, setScanDraft] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const cameraInputRef = useRef(null);

  const player = useSpeechPlayer();

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
    return { arts, briefs };
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

      let latest = { arts: articles, briefs: briefings };
      const remote = await pullDriveSyncFile(activeToken);
      if (remote?.jsonText) {
        await mergeRemoteSyncArchive(remote.jsonText);
        latest = await refreshLocal();
      }

      const mergedJson = await exportSyncArchiveJSON();
      await pushDriveSyncFile(activeToken, mergedJson, remote?.fileId || null);
      setStatus(`Synced (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);

      if (tab === 'overview') {
        if (latest.briefs.length > 0) setTab('briefings');
        else if (latest.arts.length > 0) setTab('library');
      }
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
    if (player.activeId === `article-${item.id}`) player.stop();
    recordTombstone(item.url);
    await db.articles.delete(item.id);
    if (readerItem?.id === item.id) setReaderItem(null);
    await refreshLocal();
    if (token) await handleSync(token);
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

  const readerText = readerItem
    ? readerItem.content || readerItem.digest || 'No offline body saved for this bookmark.'
    : '';
  const readerAudioId = readerItem ? `article-${readerItem.id}` : null;
  const isReaderPlaying = readerItem && player.activeId === readerAudioId && player.status !== 'idle';

  return (
    <div className="app-shell">
      {LANDING_CSS && <style>{LANDING_CSS}</style>}

      <header className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div
            onClick={() => {
              setReaderItem(null);
              setTab('overview');
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
            title="Return to Overview"
          >
            <img src="/favicon.svg?v=2" alt="" width="28" height="28" style={{ borderRadius: '6px' }} />
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

        {isMobile && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <a href="/story.html" className="pill pill-story">
              <PlaySvg /> The Story
            </a>
            <a href="/privacy.html" className="pill">
              Privacy Policy
            </a>
          </div>
        )}

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
            <button
              className="pill"
              onClick={() => {
                player.stop();
                setReaderItem(null);
              }}
            >
              ← Back
            </button>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
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
            <h2 className="serif-title" style={{ margin: 0, fontSize: '21px' }}>{readerItem.title}</h2>
          )}

          <AudioControlBar
            player={player}
            itemId={readerAudioId}
            text={readerText}
            title={readerItem.title}
          />

          {readerItem.userNotes && (
            <div className="note-box">
              <strong>Note:</strong> {readerItem.userNotes}
            </div>
          )}

          {isReaderPlaying ? (
            <div style={{ fontSize: '15.5px', lineHeight: 1.75 }}>
              {player.sentences.map((chunk, idx) => {
                const active = idx === player.currentIndex;
                return (
                  <span
                    key={idx}
                    onClick={() => player.playItem(readerAudioId, readerText, readerItem.title, idx)}
                    title="Tap to jump to this passage"
                    style={{
                      cursor: 'pointer',
                      background: active ? '#FDE68A' : 'transparent',
                      borderRadius: '4px',
                      padding: active ? '2px 4px' : '0',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    {chunk}{' '}
                  </span>
                );
              })}
            </div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '15.5px', lineHeight: 1.7 }}>
              {readerText}
            </div>
          )}
        </article>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className={`pill ${tab === 'overview' ? 'active' : ''}`}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
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
            <button
              className={`pill ${tab === 'architecture' ? 'active' : ''}`}
              style={tab !== 'architecture' ? { background: '#FDF7E7' } : undefined}
              onClick={() => setTab('architecture')}
            >
              Architecture &amp; Design
            </button>
          </div>

          {tab === 'overview' ? (
            isMobile ? (
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
              <div className="landing-embed" onClick={handleLandingClick} dangerouslySetInnerHTML={{ __html: sanitizedLandingHtml }} />
            ) : null
          ) : tab === 'architecture' ? (
            <ArchitectureDetails onSwitchTab={setTab} />
          ) : tab === 'briefings' ? (
            briefings.length === 0 ? (
              <div className="card">
                Tap <strong>Sync Drive</strong> to pull briefings from your desktop extension—or check <strong>Overview</strong> for setup steps.
              </div>
            ) : (
              briefings.map((b) => {
                const bId = `briefing-${b.id}`;
                const bTitle = `Briefing (${b.startDate} to ${b.endDate})`;
                const isBriefingPlaying = player.activeId === bId && player.status !== 'idle';

                return (
                  <div key={b.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '12px', color: 'var(--ink-muted)' }}>
                        {b.startDate} → {b.endDate}
                      </span>
                      {!isBriefingPlaying && (
                        <AudioControlBar
                          player={player}
                          itemId={bId}
                          text={b.summaryMarkdown}
                          title={bTitle}
                        />
                      )}
                    </div>

                    {isBriefingPlaying && (
                      <div style={{ marginBottom: '10px' }}>
                        <AudioControlBar
                          player={player}
                          itemId={bId}
                          text={b.summaryMarkdown}
                          title={bTitle}
                        />
                      </div>
                    )}

                    <MarkdownView markdown={b.summaryMarkdown} />

                    {b.userNotes && (
                      <div className="note-box">
                        <strong>Reflections:</strong> {b.userNotes}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            <>
              <input
                className="input"
                placeholder="Search saved articles, book scans, and notes..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {filteredArticles.length === 0 ? (
                <div className="card">
                  No saved articles or book scans match your filter yet. Tap <strong>Sync Drive</strong> or <strong>+ Scan Page</strong> to add items.
                </div>
              ) : (
                filteredArticles.map((item) => (
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
                          aria-label="Listen"
                          title="Listen"
                          onClick={() => {
                            setReaderItem(item);
                            player.playItem(
                              `article-${item.id}`,
                              item.content || item.digest || '',
                              item.title,
                              0
                            );
                          }}
                        >
                          <PlaySvg />
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
                ))
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
