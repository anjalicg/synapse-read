import React, { useEffect, useRef, useState } from 'react';
import { Readability } from '@mozilla/readability';
import { db, ensurePersistentStorage } from '../db.js';
import {
    checkNanoStatus,
    generateDigest,
    generateBriefing,
    buildBriefingPrompt,
} from '../ai/nano.js';
import { generateEmbedding, findRelatedArticles } from '../ai/embeddings.js';

const MAX_NOTE_WORDS = 1000;

function formatDateInput(date) {
    return date.toISOString().split('T')[0];
}

function getDateDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return formatDateInput(d);
}

function countWords(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Parses inline **bold** and [Title](URL) Markdown into safe React elements.
 */
function renderInlineMarkdown(text) {
    const tokenRegex = /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*)/g;
    const parts = text.split(tokenRegex);

    return parts.map((part, i) => {
        const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        if (linkMatch) {
            return (
                <a
                    key={i}
                    href={linkMatch[2]}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#0b57d0', textDecoration: 'underline' }}
                >
                    {linkMatch[1]}
                </a>
            );
        }

        const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
        if (boldMatch) {
            return <strong key={i}>{boldMatch[1]}</strong>;
        }

        return <React.Fragment key={i}>{part}</React.Fragment>;
    });
}

function BriefingMarkdown({ content }) {
    const lines = content.split('\n');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {lines.map((rawLine, idx) => {
                const line = rawLine.trim();
                if (!line) return null;

                if (line.startsWith('### ')) {
                    return (
                        <h4 key={idx} style={{ margin: '6px 0 2px', fontSize: '13px', color: '#111' }}>
                            {renderInlineMarkdown(line.slice(4))}
                        </h4>
                    );
                }

                if (line.startsWith('## ')) {
                    return (
                        <h3 key={idx} style={{ margin: '4px 0 2px', fontSize: '14px', color: '#111' }}>
                            {renderInlineMarkdown(line.slice(3))}
                        </h3>
                    );
                }

                if (line.startsWith('- ') || line.startsWith('* ')) {
                    return (
                        <div key={idx} style={{ paddingLeft: '12px', textIndent: '-8px' }}>
                            • {renderInlineMarkdown(line.slice(2))}
                        </div>
                    );
                }

                return (
                    <p key={idx} style={{ margin: 0 }}>
                        {renderInlineMarkdown(line)}
                    </p>
                );
            })}
        </div>
    );
}

export default function App() {
    const [articles, setArticles] = useState([]);
    const [statusMsg, setStatusMsg] = useState('');
    const [nanoStatus, setNanoStatus] = useState({ summarizer: 'checking', prompt: 'checking' });

    // Date window state (defaults to 7D)
    const [preset, setPreset] = useState('7D');
    const [startDate, setStartDate] = useState(() => getDateDaysAgo(7));
    const [endDate, setEndDate] = useState(() => formatDateInput(new Date()));

    // Briefing + Notes state
    const [briefings, setBriefings] = useState([]);
    const [activeBriefingId, setActiveBriefingId] = useState(null);
    const [briefing, setBriefing] = useState('');
    const [userNotes, setUserNotes] = useState('');
    const [notesStatus, setNotesStatus] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const saveTimerRef = useRef(null);

    const [relatedMap, setRelatedMap] = useState({});

    async function ensureAllEmbeddings(allArticles) {
        const missing = allArticles.filter(
            (a) => !Array.isArray(a.embedding) && (a.digest || a.content)
        );

        for (let i = 0; i < missing.length; i++) {
            const item = missing[i];
            setStatusMsg(`Indexing archive (${i + 1}/${missing.length})...`);
            const emb = await generateEmbedding(`${item.title}\n${item.digest || item.content}`);
            if (emb) {
                await db.articles.update(item.id, { embedding: emb });
                item.embedding = emb;
            }
        }

        if (missing.length > 0) {
            await loadArticles();
        }
        return allArticles;
    }

    async function loadArticles() {
        const all = await db.articles.orderBy('savedAt').reverse().toArray();
        setArticles(all);
    }

    async function loadBriefings(selectId = null) {
        if (!db.briefings) return;
        const all = await db.briefings.orderBy('createdAt').reverse().toArray();
        setBriefings(all);

        const target = selectId
            ? all.find((b) => b.id === selectId)
            : all[0];

        if (target) {
            setActiveBriefingId(target.id);
            setBriefing(target.summaryMarkdown || '');
            setUserNotes(target.userNotes || '');
        }
    }

    useEffect(() => {
        ensurePersistentStorage();
        loadArticles();
        loadBriefings();
        checkNanoStatus().then(setNanoStatus);

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, []);

    function applyPreset(label, days) {
        setPreset(label);
        setStartDate(getDateDaysAgo(days));
        setEndDate(formatDateInput(new Date()));
    }

    async function getArticlesInWindow() {
        const startMs = new Date(`${startDate}T00:00:00`).getTime();
        const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
        return db.articles.where('savedAt').between(startMs, endMs, true, true).toArray();
    }

    async function persistNotes(briefingId, text) {
        if (!briefingId || !db.briefings) return;
        setNotesStatus('Saving...');
        await db.briefings.update(briefingId, { userNotes: text, updatedAt: Date.now() });
        setBriefings((prev) =>
            prev.map((b) => (b.id === briefingId ? { ...b, userNotes: text } : b))
        );
        setNotesStatus('Saved locally');
    }

    function handleNotesChange(e) {
        const nextText = e.target.value;
        if (countWords(nextText) > MAX_NOTE_WORDS) {
            setNotesStatus(`Limit reached (${MAX_NOTE_WORDS} words max)`);
            return;
        }

        setUserNotes(nextText);
        setNotesStatus('Unsaved...');

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            persistNotes(activeBriefingId, nextText);
        }, 600);
    }

    function handleSelectBriefing(e) {
        const id = Number(e.target.value);
        const chosen = briefings.find((b) => b.id === id);
        if (chosen) {
            setActiveBriefingId(chosen.id);
            setBriefing(chosen.summaryMarkdown || '');
            setUserNotes(chosen.userNotes || '');
            setNotesStatus('');
        }
    }

    async function saveActiveTab(mode) {
        setStatusMsg('Saving...');
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id || !tab.url?.startsWith('http')) {
                setStatusMsg('Open a standard web page to save.');
                return;
            }

            let title = tab.title || tab.url;
            let content = '';

            if (mode === 'content') {
                const [{ result: html }] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => document.documentElement.outerHTML,
                });

                const doc = new DOMParser().parseFromString(html, 'text/html');
                const parsed = new Readability(doc).parse();
                if (parsed) {
                    title = parsed.title || title;
                    content = parsed.textContent?.trim() || '';
                }
            }

            const existing = await db.articles.where('url').equals(tab.url).first();
            let articleId = existing?.id;

            if (existing) {
                if (mode === 'content' && content) {
                    await db.articles.update(existing.id, {
                        title,
                        content,
                        savedAt: Date.now(),
                        source: 'extension-content',
                    });
                    setStatusMsg('Saved! Generating digest in background...');
                } else {
                    setStatusMsg('Already saved in Synapse-Read.');
                    return;
                }
            } else {
                articleId = await db.articles.add({
                    url: tab.url,
                    title,
                    content,
                    digest: '',
                    status: 'unread',
                    savedAt: Date.now(),
                    source: mode === 'content' ? 'extension-content' : 'extension-bookmark',
                    tags: [],
                });
                setStatusMsg(
                    mode === 'content' && content
                        ? 'Saved! Generating digest in background...'
                        : 'Saved link!'
                );
            }

            await loadArticles();

            if (mode === 'content' && content && articleId) {
                generateDigest(content, title, setStatusMsg)
                    .then(async (digest) => {
                        if (digest) {
                            await db.articles.update(articleId, { digest });
                            await loadArticles();
                        }
                        const embedInput = `${title}\n${digest || content}`;
                        const embedding = await generateEmbedding(embedInput, setStatusMsg);
                        if (embedding) {
                            await db.articles.update(articleId, { embedding });
                            await loadArticles();
                            setStatusMsg('Digest & connections ready!');
                        }
                    })
                    .catch((err) => console.warn('Background AI error:', err));
            }
        } catch (err) {
            console.error(err);
            setStatusMsg('Error: ' + err.message);
        }
    }
    async function handleGenerateBriefing() {
        setIsGenerating(true);
        setStatusMsg('Querying articles...');
        try {
            const windowArticles = await getArticlesInWindow();
            if (windowArticles.length === 0) {
                setStatusMsg('No articles saved in this date range.');
                return;
            }

            const allArticles = await ensureAllEmbeddings(await db.articles.toArray());
            const windowIds = new Set(windowArticles.map((a) => a.id));
            const hydratedWindow = allArticles.filter((a) => windowIds.has(a.id));
            const archiveMatches = findArchiveConnections(hydratedWindow, allArticles);

            setStatusMsg(
                archiveMatches.length > 0
                    ? `Synthesizing ${hydratedWindow.length} article(s) + ${archiveMatches.length} archive match(es)...`
                    : `Synthesizing ${hydratedWindow.length} article(s) with Gemini Nano...`
            );

            const summaryMarkdown = await generateBriefing(
                hydratedWindow,
                archiveMatches,
                setStatusMsg
            );

            let newId = null;
            if (db.briefings) {
                newId = await db.briefings.add({
                    createdAt: Date.now(),
                    startDate,
                    endDate,
                    articleUrls: hydratedWindow.map((a) => a.url),
                    summaryMarkdown,
                    userNotes: '',
                });
            }

            await Promise.all(
                hydratedWindow.map((a) => db.articles.update(a.id, { status: 'summarized' }))
            );

            setBriefing(summaryMarkdown);
            setUserNotes('');
            setNotesStatus('');
            await loadBriefings(newId);
            await loadArticles();
            setStatusMsg('Briefing ready.');
        } catch (err) {
            console.error(err);
            setStatusMsg(err.message);
        } finally {
            setIsGenerating(false);
        }
    }

    async function handleCopyPromptFallback() {
        const windowArticles = await getArticlesInWindow();
        if (windowArticles.length === 0) {
            setStatusMsg('No articles in this date range to copy.');
            return;
        }
        const allArticles = await db.articles.toArray();
        const archiveMatches = findArchiveConnections(windowArticles, allArticles);
        const prompt = buildBriefingPrompt(windowArticles, archiveMatches);
        await navigator.clipboard.writeText(prompt);
        setStatusMsg('Prompt copied! Paste into ChatGPT, Claude, or Gemini.');
    }

    async function deleteArticle(id) {
        await db.articles.delete(id);
        await loadArticles();
    }
    async function handleToggleRelated(item) {
        if (relatedMap[item.id]) {
            setRelatedMap((prev) => {
                const next = { ...prev };
                delete next[item.id];
                return next;
            });
            return;
        }

        try {
            const all = await ensureAllEmbeddings(await db.articles.toArray());
            const target = all.find((a) => a.id === item.id) || item;
            const matches = findRelatedArticles(target, all);
            setRelatedMap((prev) => ({ ...prev, [target.id]: matches }));
            setStatusMsg('');
        } catch (err) {
            console.error('Related articles indexing failed:', err);
            setStatusMsg('Connection error: ' + err.message);
        }
    }

    const nanoReady = nanoStatus.prompt !== 'unavailable';
    const noteWordCount = countWords(userNotes);

    return (
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '17px' }}>Synapse-Read</h2>
                <span style={{ fontSize: '11px', color: nanoReady ? '#0a7' : '#b50' }}>
          {nanoReady ? 'Gemini Nano: Ready' : 'Nano: Unavailable (Fallback)'}
        </span>
            </div>

            {/* Capture Controls */}
            <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    onClick={() => saveActiveTab('content')}
                    style={{ flex: 1, padding: '8px', cursor: 'pointer', fontWeight: 600 }}
                >
                    Save Content
                </button>
                <button
                    onClick={() => saveActiveTab('bookmark')}
                    style={{ flex: 1, padding: '8px', cursor: 'pointer' }}
                >
                    Save Link Only
                </button>
            </div>

            {/* Date Range & Briefing Controls */}
            <div style={{ padding: '10px', background: '#fff', border: '1px solid #e5e5e5', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {[
                        ['7D', 7],
                        ['14D', 14],
                        ['30D', 30],
                    ].map(([label, days]) => (
                        <button
                            key={label}
                            onClick={() => applyPreset(label, days)}
                            style={{
                                flex: 1,
                                padding: '4px',
                                fontSize: '12px',
                                cursor: 'pointer',
                                fontWeight: preset === label ? 700 : 400,
                                background: preset === label ? '#111' : '#f3f3f3',
                                color: preset === label ? '#fff' : '#111',
                                border: 'none',
                                borderRadius: '4px',
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px' }}>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                            setPreset('custom');
                            setStartDate(e.target.value);
                        }}
                        style={{ flex: 1, fontSize: '11px' }}
                    />
                    <span>to</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => {
                            setPreset('custom');
                            setEndDate(e.target.value);
                        }}
                        style={{ flex: 1, fontSize: '11px' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                        onClick={handleGenerateBriefing}
                        disabled={isGenerating || !nanoReady}
                        style={{ flex: 2, padding: '8px', cursor: nanoReady ? 'pointer' : 'not-allowed', fontWeight: 600 }}
                    >
                        {isGenerating ? 'Generating...' : 'Generate Briefing'}
                    </button>
                    <button
                        onClick={handleCopyPromptFallback}
                        title="Copy prompt for ChatGPT / Claude / Gemini"
                        style={{ flex: 1, padding: '8px', cursor: 'pointer', fontSize: '11px' }}
                    >
                        Copy Prompt
                    </button>
                </div>
            </div>

            {statusMsg && <div style={{ fontSize: '12px', color: '#444' }}>{statusMsg}</div>}

            {/* Past Briefings Selector */}
            {briefings.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                    <label htmlFor="briefing-select" style={{ color: '#555', fontWeight: 600 }}>
                        Briefing:
                    </label>
                    <select
                        id="briefing-select"
                        value={activeBriefingId || ''}
                        onChange={handleSelectBriefing}
                        style={{ flex: 1, fontSize: '11px', padding: '4px' }}
                    >
                        {briefings.map((b) => (
                            <option key={b.id} value={b.id}>
                                {new Date(b.createdAt).toLocaleDateString()} ({b.startDate} → {b.endDate})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Formatted Briefing Output + User Notes */}
            {briefing && (
                <div
                    style={{
                        padding: '12px',
                        background: '#f7f9fc',
                        border: '1px solid #d0dceb',
                        borderRadius: '6px',
                        fontSize: '12px',
                        lineHeight: 1.5,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                    }}
                >
                    <BriefingMarkdown content={briefing} />

                    {activeBriefingId && (
                        <div style={{ borderTop: '1px solid #d0dceb', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                                <strong style={{ color: '#222' }}>My Notes & Reflections</strong>
                                <span style={{ color: noteWordCount >= MAX_NOTE_WORDS ? '#c00' : '#666' }}>
                  {noteWordCount} / {MAX_NOTE_WORDS} words {notesStatus ? `· ${notesStatus}` : ''}
                </span>
                            </div>
                            <textarea
                                value={userNotes}
                                onChange={handleNotesChange}
                                onBlur={() => persistNotes(activeBriefingId, userNotes)}
                                placeholder="Add your thoughts, takeaways, or follow-up questions (up to 1,000 words)..."
                                rows={5}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '8px',
                                    fontSize: '12px',
                                    fontFamily: 'inherit',
                                    lineHeight: 1.4,
                                    border: '1px solid #ccd6e4',
                                    borderRadius: '4px',
                                    resize: 'vertical',
                                    background: '#fff',
                                }}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Saved Articles List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {articles.map((item) => (
                    <div
                        key={item.id}
                        style={{
                            padding: '10px',
                            background: '#fff',
                            border: '1px solid #e5e5e5',
                            borderRadius: '6px',
                        }}
                    >
                        <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontWeight: 600, fontSize: '13px', color: '#111', textDecoration: 'none' }}
                        >
                            {item.title}
                        </a>
                        {item.digest ? (
                            <p style={{ fontSize: '11px', color: '#444', margin: '6px 0 4px', lineHeight: 1.4 }}>
                                {item.digest}
                            </p>
                        ) : item.content ? (
                            <p style={{ fontSize: '11px', color: '#888', fontStyle: 'italic', margin: '6px 0 4px' }}>
                                Generating digest...
                            </p>
                        ) : null}
                        <div style={{ fontSize: '11px', color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                            <span>
                                {item.status} · {new Date(item.savedAt).toLocaleDateString()}
                            </span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={() => handleToggleRelated(item)}
                                    style={{ border: 'none', background: 'none', color: '#0b57d0', cursor: 'pointer', fontSize: '11px' }}
                                >
                                    {relatedMap[item.id] ? 'Hide Related' : 'Related'}
                                </button>
                                <button
                                    onClick={() => deleteArticle(item.id)}
                                    style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: '11px' }}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>

                        {relatedMap[item.id] && (
                            <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #e0e0e0', fontSize: '11px' }}>
                                {relatedMap[item.id].length === 0 ? (
                                    <span style={{ color: '#888' }}>No strong connections found yet.</span>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <strong style={{ color: '#444' }}>Related Articles:</strong>
                                        {relatedMap[item.id].map((rel) => (
                                            <div key={rel.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                                                <a
                                                    href={rel.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    style={{ color: '#0b57d0', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                >
                                                    {rel.title}
                                                </a>
                                                <span style={{ color: '#666', flexShrink: 0 }}>
                                                    {Math.round(rel.score * 100)}%
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}