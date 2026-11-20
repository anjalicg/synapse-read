import React, { useRef } from 'react';

export function Header({
                           nanoReady,
                           showAbout,
                           onToggleAbout,
                           onSyncList,
                           onBackup,
                           onRestore,
                       }) {
    const fileInputRef = useRef(null);

    return (
        <div
            className="sr-card"
            style={{
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg viewBox="0 0 128 128" width="24" height="24" aria-hidden="true">
                        <rect x="4" y="4" width="120" height="120" rx="26" fill="#1E1D1A" />
                        <g stroke="#E05A47" strokeWidth="5" strokeLinecap="round">
                            <line x1="34" y1="36" x2="64" y2="64" />
                            <line x1="94" y1="38" x2="64" y2="64" />
                            <line x1="30" y1="88" x2="64" y2="64" />
                            <line x1="96" y1="86" x2="64" y2="64" />
                        </g>
                        <circle cx="34" cy="36" r="6" fill="#E05A47" />
                        <circle cx="94" cy="38" r="6" fill="#D99B26" />
                        <circle cx="30" cy="88" r="6" fill="#3D7A5D" />
                        <circle cx="96" cy="86" r="6" fill="#4C6EF5" />
                        <circle cx="64" cy="64" r="9" fill="#FFFDF9" />
                    </svg>
                    <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, letterSpacing: '-0.02em' }}>
                        Afterword
                    </h2>
                </div>

                <span
                    className="sr-node-tag"
                    style={{
                        '--accent': nanoReady ? 'var(--sage)' : 'var(--terracotta)',
                        background: 'var(--paper)',
                        border: '1px solid var(--ink)',
                        borderRadius: '999px',
                        padding: '2px 8px',
                    }}
                >
          <i className="sr-node-dot" />
                    {nanoReady ? 'nano:ready' : 'nano:fallback'}
        </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                <button onClick={onSyncList} title="Sync Chrome Reading List" className="sr-pill">
                    Sync List
                </button>
                <button onClick={onBackup} title="Export full JSON backup" className="sr-pill">
                    Backup
                </button>
                <button onClick={() => fileInputRef.current?.click()} title="Import JSON backup" className="sr-pill">
                    Restore
                </button>
                <button
                    onClick={onToggleAbout}
                    title="About Afterword"
                    className={`sr-pill ${showAbout ? 'active' : ''}`}
                    style={{ marginLeft: 'auto' }}
                >
                    {showAbout ? 'Close' : 'About'}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={onRestore}
                    style={{ display: 'none' }}
                />
            </div>
        </div>
    );
}