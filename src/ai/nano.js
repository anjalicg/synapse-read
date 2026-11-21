const MAX_SUMMARY_INPUT_CHARS = 14000;
const MAX_BRIEFING_PROMPT_CHARS = 12000;
const SUMMARY_SPEED_KEY = 'afterword:nanoSummaryCharsPerSec';
const BRIEFING_SPEED_KEY = 'afterword:nanoBriefingCharsPerSec';

export function formatEtaSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '~1s left';
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s left`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `~${mins}m ${secs}s left` : `~${mins}m left`;
}

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
  const startedAt = Date.now();
  return (m) => {
    m.addEventListener('downloadprogress', (e) => {
      const ratio =
        typeof e.loaded === 'number' && typeof e.total === 'number' && e.total > 0
          ? e.loaded / e.total
          : typeof e.loaded === 'number' && e.loaded <= 1
            ? e.loaded
            : null;
      const pct = ratio !== null ? Math.min(100, Math.max(0, Math.round(ratio * 100))) : null;
      const elapsedSec = (Date.now() - startedAt) / 1000;
      let eta = '';
      if (ratio !== null && ratio > 0.03 && elapsedSec > 1.5 && pct < 100) {
        eta = ` · ${formatEtaSeconds((elapsedSec / ratio) * (1 - ratio))}`;
      }
      onStatus?.(
        pct !== null
          ? `Downloading ${label} (${pct}%${eta})...`
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

// Runs a live 250ms ETA ticker from t=0 (covering session load + inference) and refines with stream tokens
async function runTrackedGeneration({
  expectedChars,
  speedStorageKey,
  defaultCharsPerSec,
  label,
  onProgress,
  execute,
}) {
  const savedSpeed = Number(localStorage.getItem(speedStorageKey)) || defaultCharsPerSec;
  const estTotalSec = Math.max(3, expectedChars / savedSpeed);
  const startedAt = Date.now();
  let streamedChars = 0;

  const emitTick = () => {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    if (streamedChars > 20) {
      const liveSpeed = Math.max(15, streamedChars / Math.max(0.25, elapsedSec));
      const blendedSpeed = savedSpeed * 0.3 + liveSpeed * 0.7;
      const pct = Math.min(96, Math.max(15, Math.round((streamedChars / expectedChars) * 100)));
      const etaText = formatEtaSeconds(Math.max(1, (expectedChars - streamedChars) / blendedSpeed));
      onProgress?.({ pct, etaText, message: `${label}... ${pct}% (${etaText})` });
    } else {
      const pct = Math.min(88, Math.max(5, Math.round((elapsedSec / estTotalSec) * 100)));
      const etaText = formatEtaSeconds(Math.max(1, estTotalSec - elapsedSec));
      onProgress?.({ pct, etaText, message: `${label}... ${pct}% (${etaText})` });
    }
  };

  emitTick();
  const timer = setInterval(emitTick, 250);

  const reportStreamChars = async (charCount) => {
    streamedChars = charCount;
    emitTick();
    // Yield a macrotask tick so React paints intermediate progress percentages
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  try {
    const output = (await execute(reportStreamChars)) || '';
    const totalSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
    if (output.length > 40) {
      localStorage.setItem(speedStorageKey, String(Math.round(output.length / totalSec)));
    }
    return output.trim();
  } finally {
    clearInterval(timer);
  }
}

export async function summarizeArticle(content, onProgress) {
  const cleanText = (content || '').trim().slice(0, MAX_SUMMARY_INPUT_CHARS);
  if (!cleanText) {
    throw new Error('No article text available to summarize.');
  }

  const status = await checkNanoStatus();

  if (status.summarizer === 'available') {
    return await runTrackedGeneration({
      expectedChars: 420,
      speedStorageKey: SUMMARY_SPEED_KEY,
      defaultCharsPerSec: 80,
      label: 'Generating digest',
      onProgress,
      execute: async (reportStreamChars) => {
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

          if (!summarizer) return '';
          if (typeof summarizer.summarizeStreaming === 'function') {
            const stream = await summarizer.summarizeStreaming(cleanText);
            let fullText = '';
            for await (const chunk of stream) {
              if (typeof chunk === 'string') {
                fullText =
                  chunk.startsWith(fullText) && chunk.length >= fullText.length
                    ? chunk
                    : fullText + chunk;
                await reportStreamChars(fullText.length);
              }
            }
            return fullText;
          }
          return await summarizer.summarize(cleanText);
        } finally {
          summarizer?.destroy?.();
        }
      },
    });
  }

  if (status.prompt === 'available') {
    return await runTrackedGeneration({
      expectedChars: 420,
      speedStorageKey: SUMMARY_SPEED_KEY,
      defaultCharsPerSec: 75,
      label: 'Generating digest',
      onProgress,
      execute: async (reportStreamChars) => {
        let session = null;
        try {
          session =
            'LanguageModel' in self
              ? await self.LanguageModel.create({
                  expectedOutputs: [{ type: 'text', languages: ['en'] }],
                })
              : await self.ai.languageModel.create();

          const prompt = `Summarize the following article in 2 to 3 crisp, informative sentences without filler:\n\n${cleanText}`;
          if (typeof session.promptStreaming === 'function') {
            const stream = await session.promptStreaming(prompt);
            let fullText = '';
            for await (const chunk of stream) {
              if (typeof chunk === 'string') {
                fullText =
                  chunk.startsWith(fullText) && chunk.length >= fullText.length
                    ? chunk
                    : fullText + chunk;
                await reportStreamChars(fullText.length);
              }
            }
            return fullText;
          }
          return await session.prompt(prompt);
        } finally {
          session?.destroy?.();
        }
      },
    });
  }

  if (
    status.summarizer === 'downloadable' ||
    status.summarizer === 'downloading' ||
    status.prompt === 'downloadable' ||
    status.prompt === 'downloading'
  ) {
    throw new Error('Gemini Nano is still downloading — click "Download AI" in the Side Panel first.');
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

export async function synthesizeBriefing(articles, dateRangeLabel, onProgress) {
  const status = await getPromptAvailability();
  if (status === 'unavailable') {
    throw new Error('Prompt API (Gemini Nano) is unavailable. Use Copy Prompt instead.');
  }
  if (status !== 'available') {
    throw new Error('Gemini Nano is still downloading — click "Download AI" in the Side Panel first.');
  }

  const prompt = buildBriefingPrompt(articles, dateRangeLabel);

  return await runTrackedGeneration({
    expectedChars: 1350,
    speedStorageKey: BRIEFING_SPEED_KEY,
    defaultCharsPerSec: 75,
    label: `Synthesizing ${articles.length} post(s)`,
    onProgress,
    execute: async (reportStreamChars) => {
      let session = null;
      try {
        session =
          'LanguageModel' in self
            ? await self.LanguageModel.create({
                expectedOutputs: [{ type: 'text', languages: ['en'] }],
              })
            : await self.ai.languageModel.create();

        if (typeof session.promptStreaming === 'function') {
          const stream = await session.promptStreaming(prompt);
          let fullText = '';
          for await (const chunk of stream) {
            if (typeof chunk === 'string') {
              fullText =
                chunk.startsWith(fullText) && chunk.length >= fullText.length
                  ? chunk
                  : fullText + chunk;
              await reportStreamChars(fullText.length);
            }
          }
          return fullText;
        }
        return await session.prompt(prompt);
      } finally {
        session?.destroy?.();
      }
    },
  });
}

export const generateBriefing = synthesizeBriefing;
