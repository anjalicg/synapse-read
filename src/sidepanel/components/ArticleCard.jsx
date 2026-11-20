import React from 'react';

export function ArticleCard({
                                item,
                                isFetching,
                                relatedArticles,
                                onFetchAndDigest,
                                onToggleRelated,
                                onDelete,
                            }) {
    return (
        <div
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

            <div style={{ fontSize: '11px', color: '#666', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span>
          {item.status} · {new Date(item.savedAt).toLocaleDateString()}
            {item.source === 'chrome-reading-list' ? ' · Reading List' : ''}
        </span>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    {!item.content && (
                        <button
                            onClick={() => onFetchAndDigest(item)}
                            disabled={isFetching}
                            style={{ border: 'none', background: 'none', color: '#0a7', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                        >
                            {isFetching ? 'Fetching...' : 'Fetch & Digest'}
                        </button>
                    )}
                    <button
                        onClick={() => onToggleRelated(item)}
                        style={{ border: 'none', background: 'none', color: '#0b57d0', cursor: 'pointer', fontSize: '11px' }}
                    >
                        {relatedArticles ? 'Hide Related' : 'Related'}
                    </button>
                    <button
                        onClick={() => onDelete(item.id)}
                        style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: '11px' }}
                    >
                        Remove
                    </button>
                </div>
            </div>

            {relatedArticles && (
                <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #e0e0e0', fontSize: '11px' }}>
                    {relatedArticles.length === 0 ? (
                        <span style={{ color: '#888' }}>No strong connections found yet.</span>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <strong style={{ color: '#444' }}>Related Articles:</strong>
                            {relatedArticles.map((rel) => (
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
                    {new Date(rel.savedAt).toLocaleDateString()} · {Math.round(rel.score * 100)}%
                  </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}