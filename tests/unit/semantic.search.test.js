import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  globalThis.chrome = {
    runtime: { getURL: vi.fn(() => 'chrome-extension://test/') },
  };
});

vi.mock('@huggingface/transformers', () => ({
  env: {
    allowLocalModels: false,
    useBrowserCache: true,
    backends: { onnx: { wasm: {} } },
  },
  pipeline: vi.fn(async () => async () => ({
    data: new Float32Array(384).fill(0.05),
  })),
}));

import { semanticSearch } from '../../src/ai/embeddings.js';

describe('Semantic Search & Keyword Boost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        embedding: new Array(384).fill(-0.01),
      },
    ];

    const results = await semanticSearch('anthropic', articles);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Anthropic IPO and AI Market Shifts');
  });
});
