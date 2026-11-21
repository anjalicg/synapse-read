const MAX_SUMMARY_INPUT_CHARS = 10000;
const MAX_BRIEFING_PROMPT_CHARS = 7500;
const PREFILL_SPEED_KEY = 'afterword:nanoPrefillCharsPerSec';
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

// Phase 1: Honest elapsed + calibrated prefill estimate while Nano reads input.
// Phase 2: Live % and ~Xs left only once output tokens start streaming.
async function runTwoPhaseGeneration({
  inputChars,
  expectedOutputChars,
  speedStorageKey,
  defaultOutputCharsPerSec,
  label,
  onProgress,
  execute,
}) {
  const savedPrefillSpeed = Number(localStorage.getItem(PREFILL_SPEED_KEY)) || 550;
  const savedOutputSpeed = Number(localStorage.getItem(speedStorageKey)) || defaultOutputCharsPerSec;
  const estPrefillSec = Math.max(2, Math.round(inputChars / savedPrefillSpeed));

  const startedAt = Date.now();
  let firstTokenAt = null;
  let streamedChars = 0;

  const emitTick = () => {
    const now = Date.now();
    if (!firstTokenAt || streamedChars === 0) {
      const elapsedSec = Math.max(1, Math.round((now - startedAt) / 1000));
      onProgress?.({
        pct: 0,
        etaText: '',
        message: `${label} · reading input (${elapsedSec}s / ~${estPrefillSec}s)...`,
      });
      return;
    }

    const genElapsedSec = Math.max(0.25, (now - firstTokenAt) / 1000);
    const liveSpeed = Math.max(15, streamedChars / genElapsedSec);
    const blendedSpeed = savedOutputSpeed * 0.3 + liveSpeed * 0.7;
    const pct = Math.min(97, Math.max(5, Math.round((streamedChars / expectedOutputChars) * 100)));
    const remainingChars = Math.max(0, expectedOutputChars - streamedChars);
    const etaText = formatEtaSeconds(remainingChars / blendedSpeed);

    onProgress?.({
      pct,
      etaText,
      message: `${label} · ${pct}% (${etaText})`,
    });
  };

  emitTick();
  const timer = setInterval(emitTick, 350);

  const reportStreamChars = async (charCount) => {
    if (!firstTokenAt && charCount > 0) {
      firstTokenAt = Date.now();
      const prefillSec = Math.max(0.5, (firstTokenAt - startedAt) / 1000);
      if (inputChars > 300) {
        localStorage.setItem(PREFILL_SPEED_KEY, String(Math.round(inputChars / prefillSec)));
      }
    }
    streamedChars = charCount;
    emitTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  try {
    const output = (await execute(reportStreamChars)) || '';
    if (firstTokenAt && output.length > 40) {
      const genTotalSec = Math.max(0.25, (Date.now() - firstTokenAt) / 1000);
      localStorage.setItem(speedStorageKey, String(Math.round(output.length / genTotalSec)));
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
    return await runTwoPhaseGeneration({
      inputChars: cleanText.length,
      expectedOutputChars: 420,
      speedStorageKey: SUMMARY_SPEED_KEY,
      defaultOutputCharsPerSec: 80,
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
            const stream = summarizer.summarizeStreaming(cleanText);
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
    return await runTwoPhaseGeneration({
      inputChars: cleanText.length,
      expectedOutputChars: 420,
      speedStorageKey: SUMMARY_SPEED_KEY,
      defaultOutputCharsPerSec: 75,
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
            const stream = session.promptStreaming(prompt);
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

export function buildBriefingPrompt(articles, dateRangeLabel, maxChars = MAX_BRIEFING_PROMPT_CHARS) {
  const headerOverhead = 650;
  const perItemBudget = Math.max(
    60,
    Math.floor((maxChars - headerOverhead) / Math.max(1, articles.length)) - 75
  );

  const itemsBlock = articles
    .map((art, idx) => {
      const body = (art.digest || art.content || 'Saved link (no extracted text)')
        .trim()
        .slice(0, perItemBudget);
      return `${idx + 1}. Title: ${art.title}\n   URL: ${art.url}\n   Summary: ${body}`;
    })
    .join('\n\n');

  return [
    `You are a sharp research assistant synthesizing a 2-minute reading briefing for ${dateRangeLabel}.`,
    `Using ONLY the saved items below, write a structured Markdown briefing with:`,
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

  let prompt = buildBriefingPrompt(articles, dateRangeLabel, MAX_BRIEFING_PROMPT_CHARS);

  return await runTwoPhaseGeneration({
    inputChars: prompt.length,
    expectedOutputChars: 1300,
    speedStorageKey: BRIEFING_SPEED_KEY,
    defaultOutputCharsPerSec: 75,
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

        // Trim prompt automatically if the device's Gemini Nano session reports a smaller token quota
        if (typeof session.inputQuota === 'number' && session.inputQuota > 1024) {
          const safeMaxChars = Math.min(MAX_BRIEFING_PROMPT_CHARS, Math.floor((session.inputQuota - 700) * 3.2));
          if (prompt.length > safeMaxChars) {
            prompt = buildBriefingPrompt(articles, dateRangeLabel, safeMaxChars);
          }
        }

        if (typeof session.promptStreaming === 'function') {
          const stream = session.promptStreaming(prompt);
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
