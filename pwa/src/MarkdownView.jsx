import React from 'react';

function renderInline(text) {
  const tokens = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push(<strong key={key++}>{raw.slice(2, -2)}</strong>);
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push(<em key={key++}>{raw.slice(1, -1)}</em>);
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push(
        <code
          key={key++}
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.88em',
            background: '#EFECE4',
            padding: '1px 5px',
            borderRadius: '4px',
          }}
        >
          {raw.slice(1, -1)}
        </code>
      );
    } else if (raw.startsWith('[')) {
      const linkMatch = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (linkMatch) {
        tokens.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--sage)', fontWeight: 600 }}
          >
            {linkMatch[1]} ↗
          </a>
        );
      } else {
        tokens.push(raw);
      }
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

export default function MarkdownView({ markdown = '' }) {
  const lines = (markdown || '').split('\n');
  const blocks = [];
  let listItems = [];
  let listOrdered = false;

  const flushList = () => {
    if (!listItems.length) return;
    const Tag = listOrdered ? 'ol' : 'ul';
    blocks.push(
      <Tag
        key={`list-${blocks.length}`}
        style={{
          margin: '6px 0 10px',
          paddingLeft: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        {listItems.map((item, idx) => (
          <li key={idx}>{renderInline(item)}</li>
        ))}
      </Tag>
    );
    listItems = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    if (/^###\s+/.test(line)) {
      flushList();
      blocks.push(
        <h4
          key={`h3-${idx}`}
          className="serif-title"
          style={{ margin: '12px 0 4px', fontSize: '15.5px', fontWeight: 700 }}
        >
          {renderInline(line.replace(/^###\s+/, ''))}
        </h4>
      );
      return;
    }

    if (/^##\s+/.test(line)) {
      flushList();
      blocks.push(
        <h3
          key={`h2-${idx}`}
          className="serif-title"
          style={{
            margin: '14px 0 6px',
            fontSize: '17.5px',
            fontWeight: 700,
            borderBottom: '1px solid #E3DEC9',
            paddingBottom: '3px',
          }}
        >
          {renderInline(line.replace(/^##\s+/, ''))}
        </h3>
      );
      return;
    }

    if (/^#\s+/.test(line)) {
      flushList();
      blocks.push(
        <h2
          key={`h1-${idx}`}
          className="serif-title"
          style={{ margin: '14px 0 6px', fontSize: '19px', fontWeight: 700 }}
        >
          {renderInline(line.replace(/^#\s+/, ''))}
        </h2>
      );
      return;
    }

    if (/^>\s+/.test(line)) {
      flushList();
      blocks.push(
        <blockquote
          key={`bq-${idx}`}
          style={{
            margin: '8px 0',
            padding: '6px 10px',
            borderLeft: '3px solid var(--ochre)',
            background: '#FDF7E7',
            borderRadius: '0 6px 6px 0',
            fontStyle: 'italic',
          }}
        >
          {renderInline(line.replace(/^>\s+/, ''))}
        </blockquote>
      );
      return;
    }

    if (/^[-*+]\s+/.test(line)) {
      if (listItems.length && listOrdered) flushList();
      listOrdered = false;
      listItems.push(line.replace(/^[-*+]\s+/, ''));
      return;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (listItems.length && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(line.replace(/^\d+\.\s+/, ''));
      return;
    }

    flushList();
    blocks.push(
      <p key={`p-${idx}`} style={{ margin: '6px 0' }}>
        {renderInline(line)}
      </p>
    );
  });

  flushList();

  return (
    <div style={{ fontSize: '14.5px', lineHeight: 1.65, color: 'var(--ink)' }}>
      {blocks}
    </div>
  );
}
