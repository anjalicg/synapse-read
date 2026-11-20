import React from 'react';

const APP_ABOUT = {
    name: 'Synapse-Read',
    version: '1.0.0',
    tagline: 'A private, local-first research assistant and reading synthesizer inside Chrome.',
    description:
        'Synapse-Read captures articles locally, generates on-device digests and 384-dimension semantic embeddings, and synthesizes date-range briefings with cross-archive connections—without sending your reading history to any external server.',
    author: 'Built by Anjali C.G.',
};

export function AboutPanel({ articleCount, briefingCount, nanoStatus, onClose }) {
    return (
        <div
            className="sr-card"
            style={{
                '--accent': 'var(--plum)',
                fontSize: '12px',
                lineHeight: 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px dashed var(--line)',
                    paddingBottom: '6px',
                }}
            >
                <div>
                    <strong style={{ fontSize: '14px', color: 'var(--ink)' }}>{APP_ABOUT.name}</strong>{' '}
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--ink-muted)' }}>
            v{APP_ABOUT.version}
          </span>
                </div>
                <button onClick={onClose} className="sr-pill">
                    Back
                </button>
            </div>

            <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>{APP_ABOUT.tagline}</p>
            <p style={{ margin: 0, color: 'var(--ink-muted)' }}>{APP_ABOUT.description}</p>

            {/* Local Storage & Runtime Diagnostics */}
            <div
                style={{
                    padding: '8px 10px',
                    background: 'var(--paper)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                }}
            >
        <span className="sr-node-tag" style={{ '--accent': 'var(--sage)' }}>
          <i className="sr-node-dot" /> local archive &amp; engine
        </span>
                <div>
                    • <strong>Storage:</strong> {articleCount} article(s), {briefingCount} briefing(s) in IndexedDB
                </div>
                <div>
                    • <strong>Summarizer API:</strong> {nanoStatus.summarizer}
                </div>
                <div>
                    • <strong>Prompt API (Gemini Nano):</strong> {nanoStatus.prompt}
                </div>
                <div>
                    • <strong>Embeddings:</strong> Xenova/all-MiniLM-L6-v2 (384-dim ONNX WASM)
                </div>
            </div>

            {/* Setup Reference */}
            <div style={{ fontSize: '11px', color: 'var(--ink-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span className="sr-node-tag" style={{ '--accent': 'var(--ochre)' }}>
          <i className="sr-node-dot" /> chrome on-device ai flags
        </span>
                <div>• <code>chrome://flags/#optimization-guide-on-device-model</code></div>
                <div>• <code>chrome://flags/#prompt-api-for-gemini-nano</code></div>
                <div>• <code>chrome://flags/#summarization-api-for-gemini-nano</code></div>
            </div>

            <div
                style={{
                    borderTop: '1px dashed var(--line)',
                    paddingTop: '6px',
                    fontFamily: 'monospace',
                    fontSize: '10.5px',
                    color: 'var(--ink-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                }}
            >
                <span>{APP_ABOUT.author}</span>
                <span>100% Local · Zero Telemetry</span>
            </div>
        </div>
    );
}