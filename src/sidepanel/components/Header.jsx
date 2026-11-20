import React, { useRef } from 'react';

const pillBtnStyle = {
    border: '1px solid #ddd',
    background: '#fff',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '10px',
    cursor: 'pointer',
};

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <h2 style={{ margin: 0, fontSize: '17px' }}>Synapse-Read</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button onClick={onSyncList} title="Sync Chrome Reading List" style={pillBtnStyle}>
                    Sync List
                </button>
                <button onClick={onBackup} title="Export full JSON backup" style={pillBtnStyle}>
                    Backup
                </button>
                <button onClick={() => fileInputRef.current?.click()} title="Import JSON backup" style={pillBtnStyle}>
                    Restore
                </button>
                <button
                    onClick={onToggleAbout}
                    title="About Synapse-Read"
                    style={{
                        ...pillBtnStyle,
                        background: showAbout ? '#111' : '#fff',
                        color: showAbout ? '#fff' : '#111',
                        borderColor: showAbout ? '#111' : '#ddd',
                    }}
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
                <span style={{ fontSize: '11px', color: nanoReady ? '#0a7' : '#b50' }}>
          {nanoReady ? 'Nano: Ready' : 'Nano: Fallback'}
        </span>
            </div>
        </div>
    );
}