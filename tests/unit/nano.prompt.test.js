import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildBriefingPrompt, synthesizeBriefing } from '../../src/ai/nano.js';

describe('Gemini Nano Prompt Budgeting & Two-Phase Progress', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('trims 25 long articles to fit safely inside the prompt budget', () => {
    const manyArticles = Array.from({ length: 25 }, (_, i) => ({
      title: `Article ${i + 1}`,
      url: `https://example.com/${i + 1}`,
      digest: 'A'.repeat(1200),
    }));

    const prompt = buildBriefingPrompt(manyArticles, '2026-11-14 to 2026-11-21', 7500);
    expect(prompt.length).toBeLessThanOrEqual(7800);
    expect(prompt).toContain('Saved Reading (25 item(s)):');
    expect(prompt).toContain('25. Title: Article 25');
  });

  it('emits reading-input phase before streaming and percentage/ETA once chunks arrive', async () => {
    const progressMessages = [];

    self.LanguageModel = {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => ({
        inputQuota: 4096,
        promptStreaming: async function* () {
          await new Promise((r) => setTimeout(r, 20));
          yield '## Key Takeaways\n- First insight from [Post 1](https://example.com/1)\n';
          yield '## Emerging Themes\n1. Systems validation rigor.';
        },
        destroy: vi.fn(),
      })),
    };

    const result = await synthesizeBriefing(
      [{ title: 'Post 1', url: 'https://example.com/1', digest: 'Sample digest' }],
      '2026-11-14 to 2026-11-21',
      ({ message }) => progressMessages.push(message)
    );

    expect(result).toContain('Key Takeaways');
    expect(progressMessages[0]).toContain('reading input');
    expect(progressMessages.some((m) => m.includes('% (~'))).toBe(true);
  });
});
