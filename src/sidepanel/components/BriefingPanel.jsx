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
                    style={{
                        color: 'var(--periwinkle)',
                        fontWeight: 600,
                        textDecoration: 'underline',
                        textUnderlineOffset: '2px',
                    }}
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
                        <h4 key={idx} style={{ margin: '6px 0 2px', fontSize: '13px', color: 'var(--ink)' }}>
                            {renderInlineMarkdown(line.slice(4))}
                        </h4>
                    );
                }

                if (line.startsWith('## ')) {
                    return (
                        <h3 key={idx} style={{ margin: '4px 0 2px', fontSize: '14px', color: 'var(--ink)' }}>
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

export function BriefingPanel({ nanoReady, statusMsg, briefingsHook, speech, isMinimized = false, onToggleMinimize }) {
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
            {/* Date Window & Synthesis Node */}
            <div
                className="sr-card"
                style={{
                    '--accent': 'var(--periwinkle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="sr-node-tag">
            <i className="sr-node-dot" /> node:synthesize
          </span>
                    <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'var(--ink-muted)' }}>
            window
          </span>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    {[
                        ['7D', 7],
                        ['14D', 14],
                        ['30D', 30],
                    ].map(([label, days]) => {
                        const isSelected = preset === label;
                          if (isMinimized) {
    return (
      <div
        className="sr-card"
        style={{
          '--accent': 'var(--periwinkle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span className="sr-node-tag" style={{ flexShrink: 0 }}>
              <i className="sr-node-dot" /> briefing
            </span>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '10.5px',
                color: 'var(--ink-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {briefingsHook.briefing
                ? `${briefingsHook.startDate} → ${briefingsHook.endDate}`
                : 'collapsed'}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleMinimize}
            className="sr-pill"
            style={{ flexShrink: 0 }}
          >
            Expand
          </button>
        </div>
        {statusMsg && (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--sage)',
              fontFamily: 'monospace',
            }}
          >
            {statusMsg}
          </div>
        )}
      </div>
    );
  }

return (
                            <button
                                key={label}
                                onClick={() => applyPreset(label, days)}
                                style={{
                                    flex: 1,
                                    padding: '4px',
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    background: isSelected ? 'var(--ink)' : 'var(--paper)',
                                    color: isSelected ? 'var(--card)' : 'var(--ink)',
                                    border: '1.25px solid var(--ink)',
                                    borderRadius: '6px',
                                }}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px' }}>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => updateCustomDate('start', e.target.value)}
                        className="sr-input"
                        style={{ flex: 1, minWidth: 0, fontSize: '11px', padding: '3px 5px' }}
                    />
                    <span style={{ fontFamily: 'monospace', color: 'var(--ink-muted)' }}>&rarr;</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => updateCustomDate('end', e.target.value)}
                        className="sr-input"
                        style={{ flex: 1, minWidth: 0, fontSize: '11px', padding: '3px 5px' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                        onClick={generateNewBriefing}
                        disabled={isGenerating || !nanoReady}
                        className="sr-btn"
                        style={{
                            flex: 2,
                            background: 'var(--periwinkle)',
                            color: '#FFFDF9',
                        }}
                    >
                        {isGenerating ? 'Synthesizing...' : 'Generate Briefing'}
                    </button>
                    <button
                        onClick={copyPromptFallback}
                        title="Copy prompt for ChatGPT / Claude / Gemini"
                        className="sr-btn sr-btn-secondary"
                        style={{ flex: 1, fontSize: '11px' }}
                    >
                        Copy Prompt
                    </button>
                </div>
            </div>

            {statusMsg && <div className="sr-status-banner">{statusMsg}</div>}

            {/* Past Briefings Selector */}
            {briefings.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                    <label
                        htmlFor="briefing-select"
                        style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            color: 'var(--ink-muted)',
                            fontWeight: 700,
                        }}
                    >
                        briefing:
                    </label>
                    <select
                        id="briefing-select"
                        value={activeBriefingId || ''}
                        onChange={(e) => selectBriefingById(e.target.value)}
                        className="sr-select"
                        style={{ flex: 1, fontSize: '11px', padding: '4px 6px' }}
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
                    className="sr-card"
                    style={{
                        '--accent': 'var(--plum)',
                        fontSize: '12px',
                        lineHeight: 1.55,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                    }}
                >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span className="sr-node-tag">
          <i className="sr-node-dot" /> briefing window
        </span>
        <button
          type="button"
          onClick={onToggleMinimize}
          className="sr-pill"
          title="Minimize briefing to view saved articles"
        >
          Minimize
        </button>
      </div>
                    {/* Audio & Export Action Bar */}
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            borderBottom: '1px dashed var(--line)',
                            paddingBottom: '8px',
                            gap: '6px',
                        }}
                    >
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => speech.playPause(briefing)}
                                className="sr-pill"
                                style={{
                                    background: speech.speechState === 'playing' ? 'var(--sage)' : 'var(--paper)',
                                    color: speech.speechState === 'playing' ? '#FFFDF9' : 'var(--ink)',
                                }}
                            >
                                {speech.speechState === 'playing'
                                    ? 'Pause'
                                    : speech.speechState === 'paused'
                                        ? 'Resume'
                                        : 'Listen'}
                            </button>
                            {speech.speechState !== 'idle' && (
                                <button onClick={speech.stop} className="sr-pill">
                                    Stop
                                </button>
                            )}
                            {speech.voices.length > 0 && (
                                <select
                                    value={speech.selectedVoiceURI}
                                    onChange={(e) => speech.changeVoice(e.target.value)}
                                    className="sr-select"
                                    style={{ maxWidth: '120px', fontSize: '10.5px', padding: '2px 4px' }}
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
                            className="sr-pill"
                            style={{ flexShrink: 0 }}
                        >
                            Export .md
                        </button>
                    </div>

                    <BriefingMarkdown content={briefing} />

                    {activeBriefingId && (
                        <div
                            style={{
                                borderTop: '1px dashed var(--line)',
                                paddingTop: '10px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="sr-node-tag">
                  <i className="sr-node-dot" /> node:reflections
                </span>
                                <span
                                    style={{
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                        fontSize: '10px',
                                        color: noteWordCount >= MAX_NOTE_WORDS ? 'var(--terracotta)' : 'var(--ink-muted)',
                                    }}
                                >
                  {noteWordCount}/{MAX_NOTE_WORDS}w {notesStatus ? `· ${notesStatus}` : ''}
                </span>
                            </div>
                            <textarea
                                value={userNotes}
                                onChange={(e) => handleNotesChange(e.target.value)}
                                onBlur={flushNotes}
                                placeholder="Add your thoughts, takeaways, or follow-up questions (up to 1,000 words)..."
                                rows={4}
                                className="sr-textarea"
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    lineHeight: 1.45,
                                    resize: 'vertical',
                                }}
                            />
                        </div>
                    )}
                </div>
            )}
        </>
    );
}