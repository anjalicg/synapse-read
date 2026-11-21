import React, { useState } from 'react';

export function ScanModal({
  isOpen,
  isExtracting,
  initialText,
  previewUrl,
  onClose,
  onSaveScan,
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState(initialText || '');
  const [note, setNote] = useState('');

  React.useEffect(() => {
    setText(initialText || '');
  }, [initialText]);

  if (!isOpen) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onSaveScan({
      title: title.trim() || `Book Excerpt — ${new Date().toLocaleDateString()}`,
      content: text.trim(),
      userNotes: note.trim(),
    });
    setTitle('');
    setText('');
    setNote('');
  }

  return (
    <div
      className="sr-card"
      style={{
        '--accent': 'var(--ochre)',
        background: '#FDF7E7',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="sr-node-tag">
          <i className="sr-node-dot" /> scan:book-ocr
        </span>
        <button type="button" onClick={onClose} className="sr-pill">
          Close
        </button>
      </div>

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Scanned page preview"
          style={{
            maxHeight: '110px',
            objectFit: 'contain',
            borderRadius: '8px',
            border: '1px solid var(--ink)',
            background: '#FFFDF9',
          }}
        />
      )}

      {isExtracting ? (
        <div style={{ fontFamily: 'monospace', fontSize: '11.5px', color: 'var(--ink)' }}>
          Running free Google Drive OCR on image...
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Book title & page # (e.g., The Black Swan, p. 42)"
            className="sr-input"
          />
          <textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Extracted passage text (edit any OCR typos here)..."
            className="sr-input"
            style={{ fontFamily: 'inherit', resize: 'vertical' }}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional margin note or reflection..."
            className="sr-input"
          />
          <button type="submit" className="sr-btn sr-btn-primary" disabled={!text.trim()}>
            Save & Digest Excerpt
          </button>
        </form>
      )}
    </div>
  );
}
