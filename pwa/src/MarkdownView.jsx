import React from 'react';

function renderInline(text) {
  const parts = [];
  const tokenRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      parts.push(
        <a
          key={key++}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--periwinkle)', textDecoration: 'underline', fontWeight: 500 }}
        >
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      parts.push(<strong key={key++}>{match[4]}</strong>);
    } else if (match[5]) {
      parts.push(<em key={key++}>{match[5]}</em>);
    } else if (match[6]) {
      parts.push(
        <code
          key={key++}
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.88em',
            background: 'var(--paper)',
            padding: '1px 4px',
            borderRadius: '4px',
          }}
        >
          {match[6]}
        </code>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export default function MarkdownView({ markdown }) {
  const normalized = (markdown || '')
    .replace(/\[([^\]]+)\]\s*\((https?:\/\/[^)]+)\)/g, (_, label, url) => `[${label.replace(/\s+/g, ' ').trim()}](${url.trim()})`);

  const lines = normalized.split('\n');
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul
          key={`ul-${blocks.length}`}
          style={{ margin: '6px 0 10px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const headingMatch = line.match(/^#{1,4}\s+(.*)$/);
    if (headingMatch) {
      flushList();
      blocks.push(
        <h4
          key={`h-${blocks.length}`}
          className="serif-title"
          style={{ margin: '12px 0 4px', fontSize: '15.5px', fontWeight: 700 }}
        >
          {renderInline(headingMatch[1])}
        </h4>
      );
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`} style={{ margin: '6px 0' }}>
        {renderInline(line)}
      </p>
    );
  }

  flushList();

  return (
    <div style={{ fontSize: '14.5px', lineHeight: 1.65, color: 'var(--ink)' }}>
      {blocks}
    </div>
  );
}
