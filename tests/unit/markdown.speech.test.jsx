import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownView from '@shared/ui/MarkdownView.jsx';
import { cleanMarkdownForSpeech, splitIntoNaturalChunks } from '@shared/tts/speechPlayer.js';

describe('Markdown Renderer & Web Speech Chunker', () => {
  it('renders multiline Markdown links emitted by Gemini Nano as clickable anchors', () => {
    const md = '### Key Takeaways\n- Read [Distributed Systems\nGuide](https://example.com/ds) for details.';
    render(<MarkdownView markdown={md} />);
    const link = screen.getByRole('link', { name: /Distributed Systems Guide/i });
    expect(link).toHaveAttribute('href', 'https://example.com/ds');
  });

  it('cleans Markdown syntax and splits long prose into <= 400 char natural chunks', () => {
    const raw = '## Heading\nCheck [this post](https://example.com) e.g. for details. ' + 'Sentence two is clear. '.repeat(35);
    const cleaned = cleanMarkdownForSpeech(raw);
    expect(cleaned).not.toContain('https://example.com');
    expect(cleaned).not.toContain('##');
    expect(cleaned).toContain('for example');

    const chunks = splitIntoNaturalChunks(cleaned, 400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(400);
    }
  });
});
