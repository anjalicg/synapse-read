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
                    placeholder="Semantic search across articles & notes..."
                    style={{ flex: 1, padding: '6px 8px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
                <button
                    type="submit"
                    disabled={isSearching}
                    style={{ padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}
                >
                    {isSearching ? '...' : 'Search'}
                </button>
                {searchQuery && (
                    <button
                        type="button"
                        onClick={clearSearch}
                        style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer' }}
                    >
                        Clear
                    </button>
                )}
            </form>

            {matchingBriefings.length > 0 && (
                <div
                    style={{
                        padding: '10px',
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: '6px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        fontSize: '11px',
                    }}
                >
                    <strong style={{ color: '#92400e' }}>
                        Matching Briefing Notes ({matchingBriefings.length})
                    </strong>
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
                                    paddingTop: '4px',
                                    borderTop: '1px dashed #fcd34d',
                                }}
                            >
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 600, color: '#111' }}>
                                        {mb.startDate} → {mb.endDate} ({Math.round(mb.searchScore * 100)}%)
                                    </div>
                                    <div
                                        style={{
                                            color: '#555',
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
                                    style={{ padding: '3px 7px', fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}
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