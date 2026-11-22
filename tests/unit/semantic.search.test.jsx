import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.hoisted(() => {
  globalThis.chrome = {
    runtime: {
      getURL: vi.fn(() => 'chrome-extension://test/'),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    readingList: {
      query: vi.fn(async () => []),
      onEntryAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onEntryUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onEntryRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
});

vi.mock('@huggingface/transformers', () => ({
  env: {
    allowLocalModels: false,
    useBrowserCache: true,
    backends: { onnx: { wasm: {} } },
  },
  pipeline: vi.fn(async () => async (text) => {
    const isAnthropic = String(text).toLowerCase().includes('anthropic');
    const vec = new Float32Array(384).fill(isAnthropic ? 0.05 : -0.05);
    return { data: vec };
  }),
}));

import { semanticSearch } from '../../src/ai/embeddings.js';
import { db } from '../../src/db.js';
import App from '../../src/sidepanel/App.jsx';

describe('Semantic Search & Side Panel Search UI', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.articles.clear();
    if (db.briefings) await db.briefings.clear();
  });

  it('safely handles undefined input and ranks matching articles by keyword + vector score', async () => {
    expect(await semanticSearch('anthropic', undefined)).toEqual([]);

    const articles = [
      {
        id: 1,
        title: 'Anthropic IPO and AI Market Shifts',
        digest: 'Analysis of enterprise AI valuations.',
        embedding: new Array(384).fill(0.05),
      },
      {
        id: 2,
        title: 'Sourdough Baking Basics',
        digest: 'Fermentation times and hydration ratios.',
        embedding: new Array(384).fill(-0.05),
      },
    ];

    const results = await semanticSearch('anthropic', articles);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Anthropic IPO and AI Market Shifts');
  });

  it('filters Side Panel articles via the Search input without throwing undefined.map errors', async () => {
    const now = Date.now();
    await db.articles.bulkAdd([
      {
        url: 'https://example.com/anthropic',
        title: 'Anthropic Enterprise AI Roadmap',
        content: 'Detailed enterprise AI notes.',
        digest: 'Enterprise AI roadmap and safety milestones.',
        userNotes: '',
        embedding: null,
        savedAt: now,
        updatedAt: now,
        status: 'digested',
        source: 'extension',
      },
      {
        url: 'https://example.com/gardening',
        title: 'Raised Bed Tomato Pruning Guide',
        content: 'How to prune indeterminate tomatoes.',
        digest: 'Seasonal tomato pruning tips.',
        userNotes: '',
        embedding: null,
        savedAt: now - 1000,
        updatedAt: now - 1000,
        status: 'digested',
        source: 'extension',
      },
    ]);

    render(<App />);

    await expect(screen.findByText('Anthropic Enterprise AI Roadmap')).resolves.toBeTruthy();
    await expect(screen.findByText('Raised Bed Tomato Pruning Guide')).resolves.toBeTruthy();

    const searchInput = screen.getByPlaceholderText(/Semantic search articles/i);
    fireEvent.change(searchInput, { target: { value: 'anthropic' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Found 1 article\(s\)/i)).toBeTruthy();
    });

    expect(screen.getByText('Anthropic Enterprise AI Roadmap')).toBeTruthy();
    expect(screen.queryByText('Raised Bed Tomato Pruning Guide')).toBeNull();
  });
});
