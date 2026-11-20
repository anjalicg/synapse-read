import React from 'react';

export function SearchSection({ search, onOpenBriefing }) {
    const {
        searchQuery,
        isSearching,
        matchingBriefings,
        updateQuery,
        runSearch,
        clearSearch,
    } = search;

    return (
        <>
            <form onSubmit={runSearch} style={{ display: 'flex', gap: '6px' }}>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => updateQuery(e.target.value)}
                    placeholder="Semantic search articles & notes..."
                    className="sr-input"
                    style={{
                        flex: 1,
                        padding: '6px 9px',
                        background: 'var(--card)',
                    }}
                />
                <button
                    type="submit"
                    disabled={isSearching}
                    className="sr-btn"
                    style={{
                        background: 'var(--sage)',
                        color: '#FFFDF9',
                        padding: '6px 11px',
                    }}
                >
                    {isSearching ? '...' : 'Search'}
                </button>
                {searchQuery && (
                    <button
                        type="button"
                        onClick={clearSearch}
                        className="sr-btn sr-btn-secondary"
                        style={{ padding: '6px 8px', fontSize: '11px' }}
                    >
                        Clear
                    </button>
                )}
            </form>

            {matchingBriefings.length > 0 && (
                <div
                    className="sr-card"
                    style={{
                        '--accent': 'var(--ochre)',
                        background: '#FDF7E7',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        fontSize: '11px',
                    }}
                >
          <span className="sr-node-tag">
            <i className="sr-node-dot" /> matching notes ({matchingBriefings.length})
          </span>
                    {matchingBriefings.map((mb) => {
                        const snippet = (mb.userNotes?.trim() || mb.summaryMarkdown || '').slice(0, 140);
                        return (
                            <div
                                key={mb.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: '8px',
                                    paddingTop: '6px',
                                    borderTop: '1px dashed var(--line)',
                                }}
                            >
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                                        {mb.startDate} → {mb.endDate}{' '}
                                        <span style={{ color: 'var(--sage)', fontFamily: 'monospace' }}>
                      ({Math.round(mb.searchScore * 100)}%)
                    </span>
                                    </div>
                                    <div
                                        style={{
                                            color: 'var(--ink-muted)',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        {snippet}...
                                    </div>
                                </div>
                                <button
                                    onClick={() => onOpenBriefing(mb)}
                                    className="sr-pill"
                                    style={{ flexShrink: 0 }}
                                >
                                    Open
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}