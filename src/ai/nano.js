const MAX_SUMMARY_INPUT_CHARS = 14000;
const MAX_BRIEFING_PROMPT_CHARS = 12000;

function normalizeAvailability(raw) {
  if (!raw) return 'unavailable';
  if (raw === 'readily' || raw === 'available') return 'available';
  if (raw === 'after-download' || raw === 'downloadable') return 'downloadable';
  if (raw === 'downloading') return 'downloading';
  return 'unavailable';
}

async function getSummarizerAvailability() {
  try {
    if ('Summarizer' in self && typeof self.Summarizer.availability === 'function') {
      const avail = await self.Summarizer.availability();
      return normalizeAvailability(avail);
    }
    if (self.ai?.summarizer?.capabilities) {
      const caps = await self.ai.summarizer.capabilities();
      return normalizeAvailability(caps?.available);
    }
  } catch {
    // Ignore flag/hardware errors
  }
  return 'unavailable';
}

async function getPromptAvailability() {
  try {
    if ('LanguageModel' in self && typeof self.LanguageModel.availability === 'function') {
      const avail = await self.LanguageModel.availability({
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      return normalizeAvailability(avail);
    }
    if (self.ai?.languageModel?.capabilities) {
      const caps = await self.ai.languageModel.capabilities();
      return normalizeAvailability(caps?.available);
    }
  } catch {
    // Ignore flag/hardware errors
  }
  return 'unavailable';
}

export async function checkNanoStatus() {
  const [summarizer, prompt] = await Promise.all([
    getSummarizerAvailability(),
    getPromptAvailability(),
  ]);
  return { summarizer, prompt };
}

function attachProgressMonitor(onStatus, label) {
  return (m) => {
    m.addEventListener('downloadprogress', (e) => {
      const pct =
        typeof e.loaded === 'number' && typeof e.total === 'number' && e.total > 0
          ? Math.round((e.loaded / e.total) * 100)
          : typeof e.loaded === 'number' && e.loaded <= 1
            ? Math.round(e.loaded * 100)
            : null;
      onStatus?.(
        pct !== null
          ? `Downloading ${label} (${pct}%)...`
          : `Downloading ${label}...`
      );
    });
  };
}

export async function warmupNanoModel(onStatus) {
  const status = await checkNanoStatus();

  if (status.prompt !== 'unavailable') {
    onStatus?.('Initializing Gemini Nano Prompt API...');
    let session = null;
    try {
      if ('LanguageModel' in self) {
        session = await self.LanguageModel.create({
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          monitor: attachProgressMonitor(onStatus, 'Gemini Nano'),
        });
      } else if (self.ai?.languageModel?.create) {
        session = await self.ai.languageModel.create({
          monitor: attachProgressMonitor(onStatus, 'Gemini Nano'),
        });
      }
    } finally {
      session?.destroy?.();
    }
  }

  if (status.summarizer !== 'unavailable') {
    onStatus?.('Initializing Summarizer model...');
    let summarizer = null;
    try {
      if ('Summarizer' in self) {
        summarizer = await self.Summarizer.create({
          type: 'tldr',
          format: 'plain-text',
          length: 'medium',
          expectedInputLanguages: ['en'],
          outputLanguage: 'en',
          monitor: attachProgressMonitor(onStatus, 'Summarizer'),
        });
      } else if (self.ai?.summarizer?.create) {
        summarizer = await self.ai.summarizer.create({
          type: 'tl;dr',
          format: 'plain-text',
          length: 'medium',
          monitor: attachProgressMonitor(onStatus, 'Summarizer'),
        });
      }
    } finally {
      summarizer?.destroy?.();
    }
  }
}

export async function summarizeArticle(content) {
  const cleanText = (content || '').trim().slice(0, MAX_SUMMARY_INPUT_CHARS);
  if (!cleanText) {
    throw new Error('No article text available to summarize.');
  }

  const status = await checkNanoStatus();

  if (status.summarizer !== 'unavailable') {
    let summarizer = null;
    try {
      if ('Summarizer' in self) {
        summarizer = await self.Summarizer.create({
          type: 'tldr',
          format: 'plain-text',
          length: 'medium',
          expectedInputLanguages: ['en'],
          outputLanguage: 'en',
        });
      } else if (self.ai?.summarizer?.create) {
        summarizer = await self.ai.summarizer.create({
          type: 'tl;dr',
          format: 'plain-text',
          length: 'medium',
        });
      }

      if (summarizer) {
        const result = await summarizer.summarize(cleanText);
        return (result || '').trim();
      }
    } finally {
      summarizer?.destroy?.();
    }
  }

  if (status.prompt !== 'unavailable') {
    let session = null;
    try {
      session =
        'LanguageModel' in self
          ? await self.LanguageModel.create({
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
            })
          : await self.ai.languageModel.create();

      const prompt = `Summarize the following article in 2 to 3 crisp, informative sentences without filler:\n\n${cleanText}`;
      const result = await session.prompt(prompt);
      return (result || '').trim();
    } finally {
      session?.destroy?.();
    }
  }

  throw new Error('Chrome Built-in AI is unavailable on this device.');
}

export function buildBriefingPrompt(articles, dateRangeLabel) {
  const perItemBudget = Math.max(
    280,
    Math.floor((MAX_BRIEFING_PROMPT_CHARS - 900) / Math.max(1, articles.length))
  );

  const itemsBlock = articles
    .map((art, idx) => {
      const body = (art.digest || art.content || 'Saved link (no extracted text)')
        .trim()
        .slice(0, perItemBudget);
      return `${idx + 1}. Title: ${art.title}\n   URL: ${art.url}\n   Notes/Digest: ${body}`;
    })
    .join('\n\n');

  return [
    `You are a sharp research assistant synthesizing a 2-minute reading briefing for ${dateRangeLabel}.`,
    `Using ONLY the saved items below, write a well-structured Markdown briefing with:`,
    `1. **Key Takeaways** — bullet points citing sources inline as [Article Title](URL).`,
    `2. **Emerging Themes** — 2 to 3 patterns or connections across these reads.`,
    `Keep it concise, concrete, and under 350 words.`,
    ``,
    `Saved Reading (${articles.length} item(s)):`,
    itemsBlock,
  ].join('\n');
}

export async function synthesizeBriefing(articles, dateRangeLabel) {
  const status = await getPromptAvailability();
  if (status === 'unavailable') {
    throw new Error('Prompt API (Gemini Nano) is unavailable. Use Copy Prompt instead.');
  }

  const prompt = buildBriefingPrompt(articles, dateRangeLabel);
  let session = null;

  try {
    session =
      'LanguageModel' in self
        ? await self.LanguageModel.create({
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
          })
        : await self.ai.languageModel.create();

    const response = await session.prompt(prompt);
    return (response || '').trim();
  } finally {
    session?.destroy?.();
  }
}

export const generateBriefing = synthesizeBriefing;
