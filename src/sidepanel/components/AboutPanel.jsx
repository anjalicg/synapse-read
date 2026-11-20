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
            style={{
                padding: '12px',
                background: '#fff',
                border: '1px solid #d0dceb',
                borderRadius: '6px',
                fontSize: '12px',
                lineHeight: 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '6px' }}>
                <div>
                    <strong style={{ fontSize: '14px', color: '#111' }}>{APP_ABOUT.name}</strong>{' '}
                    <span style={{ fontSize: '11px', color: '#666' }}>v{APP_ABOUT.version}</span>
                </div>
                <button
                    onClick={onClose}
                    style={{ border: '1px solid #ddd', background: '#f7f7f7', borderRadius: '4px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
                >
                    Back
                </button>
            </div>

            <p style={{ margin: 0, fontWeight: 600, color: '#222' }}>{APP_ABOUT.tagline}</p>
            <p style={{ margin: 0, color: '#444' }}>{APP_ABOUT.description}</p>

            {/* Local Storage & Runtime Diagnostics */}
            <div style={{ padding: '8px', background: '#f7f9fc', borderRadius: '4px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong style={{ color: '#111' }}>Local Archive & Engine Status</strong>
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
            <div style={{ fontSize: '11px', color: '#555', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <strong style={{ color: '#222' }}>Chrome On-Device AI Flags</strong>
                <div>• <code>chrome://flags/#optimization-guide-on-device-model</code></div>
                <div>• <code>chrome://flags/#prompt-api-for-gemini-nano</code></div>
                <div>• <code>chrome://flags/#summarization-api-for-gemini-nano</code></div>
            </div>

            <div style={{ borderTop: '1px solid #eee', paddingTop: '6px', fontSize: '11px', color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                <span>{APP_ABOUT.author}</span>
                <span>100% Local · Zero Telemetry</span>
            </div>
        </div>
    );
}