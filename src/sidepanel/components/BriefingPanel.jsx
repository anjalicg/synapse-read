import React from 'react';
import { MAX_NOTE_WORDS, countWords } from '../utils/formatters.js';

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

export function BriefingPanel({ nanoReady, statusMsg, briefingsHook, speech }) {
    const {
        preset,
        startDate,
        endDate,
        briefings,
        activeBriefingId,
        briefing,
        userNotes,
        notesStatus,
        isGenerating,
        applyPreset,
        updateCustomDate,
        generateNewBriefing,
        copyPromptFallback,
        handleNotesChange,
        flushNotes,
        selectBriefingById,
        exportMarkdown,
    } = briefingsHook;

    const noteWordCount = countWords(userNotes);

    return (
        <>
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
                        onChange={(e) => updateCustomDate('start', e.target.value)}
                        style={{ flex: 1, fontSize: '11px' }}
                    />
                    <span>to</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => updateCustomDate('end', e.target.value)}
                        style={{ flex: 1, fontSize: '11px' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                        onClick={generateNewBriefing}
                        disabled={isGenerating || !nanoReady}
                        style={{ flex: 2, padding: '8px', cursor: nanoReady ? 'pointer' : 'not-allowed', fontWeight: 600 }}
                    >
                        {isGenerating ? 'Generating...' : 'Generate Briefing'}
                    </button>
                    <button
                        onClick={copyPromptFallback}
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
                        onChange={(e) => selectBriefingById(e.target.value)}
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

            {/* Formatted Briefing Output + Audio + Export + User Notes */}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #d0dceb', paddingBottom: '8px', gap: '6px' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => speech.playPause(briefing)}
                                style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                            >
                                {speech.speechState === 'playing'
                                    ? 'Pause Audio'
                                    : speech.speechState === 'paused'
                                        ? 'Resume'
                                        : 'Listen'}
                            </button>
                            {speech.speechState !== 'idle' && (
                                <button
                                    onClick={speech.stop}
                                    style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                                >
                                    Stop
                                </button>
                            )}
                            {speech.voices.length > 0 && (
                                <select
                                    value={speech.selectedVoiceURI}
                                    onChange={(e) => speech.changeVoice(e.target.value)}
                                    style={{ maxWidth: '130px', fontSize: '11px', padding: '3px' }}
                                >
                                    {speech.voices.map((v) => (
                                        <option key={v.voiceURI} value={v.voiceURI}>
                                            {v.name.replace(/Microsoft |Google |Apple /, '')}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <button
                            onClick={exportMarkdown}
                            style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}
                        >
                            Export .md
                        </button>
                    </div>

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
                                onChange={(e) => handleNotesChange(e.target.value)}
                                onBlur={flushNotes}
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
        </>
    );
}