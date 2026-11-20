import React from 'react';

export function ArticleCard({
                                item,
                                isFetching,
                                relatedArticles,
                                onFetchAndDigest,
                                onToggleRelated,
                                onDelete,
                            }) {
    const isReadingList = item.source === 'chrome-reading-list';
    const nodeAccent = item.digest
        ? 'var(--sage)'
        : isReadingList
            ? 'var(--ochre)'
            : 'var(--terracotta)';

    return (
        <div
            className="sr-card"
            style={{
                '--accent': nodeAccent,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span className="sr-node-tag">
          <i className="sr-node-dot" />
            {isReadingList ? 'leaf:reading-list' : 'leaf:article'}
        </span>
                <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'var(--ink-muted)' }}>
          {new Date(item.savedAt).toLocaleDateString()}
        </span>
            </div>

            <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                style={{
                    fontWeight: 750,
                    fontSize: '13px',
                    color: 'var(--ink)',
                    textDecoration: 'none',
                    lineHeight: 1.35,
                }}
            >
                {item.title}
            </a>

            {item.digest ? (
                <p style={{ fontSize: '11.5px', color: 'var(--ink-muted)', margin: 0, lineHeight: 1.45 }}>
                    {item.digest}
                </p>
            ) : item.content ? (
                <p
                    style={{
                        fontSize: '11px',
                        color: 'var(--ink-muted)',
                        fontStyle: 'italic',
                        margin: 0,
                    }}
                >
                    Generating digest...
                </p>
            ) : null}

            <div
                style={{
                    fontSize: '10.5px',
                    color: 'var(--ink-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '6px',
                    paddingTop: '4px',
                    borderTop: '1px dashed var(--line)',
                }}
            >
                <span style={{ fontFamily: 'monospace' }}>{item.status}</span>
                <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                    {!item.content && (
                        <button
                            onClick={() => onFetchAndDigest(item)}
                            disabled={isFetching}
                            className="sr-link-btn"
                            style={{ color: 'var(--sage)' }}
                        >
                            {isFetching ? 'Fetching...' : 'Fetch & Digest'}
                        </button>
                    )}
                    <button
                        onClick={() => onToggleRelated(item)}
                        className="sr-link-btn"
                        style={{ color: 'var(--periwinkle)' }}
                    >
                        {relatedArticles ? 'Hide Related' : 'Related'}
                    </button>
                    <button
                        onClick={() => onDelete(item.id)}
                        className="sr-link-btn"
                        style={{ color: 'var(--terracotta)' }}
                    >
                        Remove
                    </button>
                </div>
            </div>

            {relatedArticles && (
                <div
                    style={{
                        marginTop: '4px',
                        padding: '7px 8px',
                        background: 'var(--paper)',
                        border: '1px dashed var(--periwinkle)',
                        borderRadius: '7px',
                        fontSize: '11px',
                    }}
                >
                    {relatedArticles.length === 0 ? (
                        <span style={{ color: 'var(--ink-muted)' }}>No strong connections found yet.</span>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span className="sr-node-tag" style={{ '--accent': 'var(--periwinkle)' }}>
                <i className="sr-node-dot" /> connected synapses
              </span>
                            {relatedArticles.map((rel) => (
                                <div key={rel.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                                    <a
                                        href={rel.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{
                                            color: 'var(--ink)',
                                            fontWeight: 600,
                                            textDecoration: 'underline',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {rel.title}
                                    </a>
                                    <span
                                        style={{
                                            fontFamily: 'monospace',
                                            color: 'var(--sage)',
                                            fontWeight: 700,
                                            flexShrink: 0,
                                        }}
                                    >
                    {Math.round(rel.score * 100)}%
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