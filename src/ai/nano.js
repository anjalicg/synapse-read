const MAX_SUMMARY_INPUT_CHARS = 3600;
const MAX_BRIEFING_PROMPT_CHARS = 7500;
const BRIEFING_BATCH_SIZE = 5;
const PREFILL_SPEED_KEY = 'afterword:nanoPrefillCharsPerSec';
const SUMMARY_SPEED_KEY = 'afterword:nanoSummaryCharsPerSec';
const BRIEFING_SPEED_KEY = 'afterword:nanoBriefingCharsPerSec';

let cachedBasePromptSession = null;
let cachedSummarizer = null;

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
      const avail = await self.Summarizer.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' });
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

async function getOrCreateWarmSummarizer(monitor) {
  if (cachedSummarizer) return { instance: cachedSummarizer, shared: true };

  let instance = null;
  if ('Summarizer' in self) {
    instance = await self.Summarizer.create({
      type: 'tldr',
      format: 'plain-text',
      length: 'medium',
      expectedInputLanguages: ['en'],
      outputLanguage: 'en',
      ...(monitor ? { monitor } : {}),
    });
  } else if (self.ai?.summarizer?.create) {
    instance = await self.ai.summarizer.create({
      type: 'tl;dr',
      format: 'plain-text',
      length: 'medium',
      ...(monitor ? { monitor } : {}),
    });
  }

  if (instance) {
    cachedSummarizer = instance;
    return { instance, shared: true };
  }
  return { instance: null, shared: false };
}

async function acquirePromptSession(monitor) {
  // Reuse warm session via .clone() when supported so system KV-cache stays hot
  if (cachedBasePromptSession && typeof cachedBasePromptSession.clone === 'function') {
    try {
      const cloned = await cachedBasePromptSession.clone();
      return { session: cloned, disposable: true };
    } catch {
      cachedBasePromptSession = null;
    }
  }

  const createOpts = {
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    ...(monitor ? { monitor } : {}),
  };

  const session =
    'LanguageModel' in self
      ? await self.LanguageModel.create(createOpts)
      : await self.ai.languageModel.create(monitor ? { monitor } : undefined);

  if (session && typeof session.clone === 'function' && !cachedBasePromptSession) {
    cachedBasePromptSession = session;
    try {
      const cloned = await session.clone();
      return { session: cloned, disposable: true };
    } catch {
      return { session, disposable: false };
    }
  }

  return { session, disposable: true };
}

export async function warmupNanoModel(onStatus) {
  const status = await checkNanoStatus();

  if (status.prompt !== 'unavailable') {
    onStatus?.('Warming up Gemini Nano Prompt API...');
    const { session, disposable } = await acquirePromptSession(
      attachProgressMonitor(onStatus, 'Gemini Nano')
    );
    if (disposable) session?.destroy?.();
  }

  if (status.summarizer !== 'unavailable') {
    onStatus?.('Warming up Summarizer model...');
    await getOrCreateWarmSummarizer(attachProgressMonitor(onStatus, 'Summarizer'));
  }
}

// Phase 1: Honest elapsed + calibrated estimate while Nano reads input.
// Phase 2: Live % and ~Xs left once output tokens start streaming.
async function runTwoPhaseGeneration({
  inputChars,
  expectedOutputChars,
  speedStorageKey,
  defaultOutputCharsPerSec,
  label,
  onProgress,
  execute,
}) {
  const savedPrefillSpeed = Number(localStorage.getItem(PREFILL_SPEED_KEY)) || 600;
  const savedOutputSpeed = Number(localStorage.getItem(speedStorageKey)) || defaultOutputCharsPerSec;
  const estPrefillSec = Math.max(2, Math.round(inputChars / savedPrefillSpeed));

  const startedAt = Date.now();
  let firstTokenAt = null;
  let streamedChars = 0;

  const emitTick = () => {
    const now = Date.now();
    if (!firstTokenAt || streamedChars === 0) {
      const elapsedSec = Math.max(1, Math.round((now - startedAt) / 1000));
      const prefillLabel =
        elapsedSec <= estPrefillSec
          ? `reading input (${elapsedSec}s / ~${estPrefillSec}s)`
          : `reading input (${elapsedSec}s elapsed)`;
      onProgress?.({
        pct: 0,
        etaText: '',
        message: `${label} · ${prefillLabel}...`,
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

function sliceLeadAndConclusion(rawText, maxChars = MAX_SUMMARY_INPUT_CHARS) {
  const clean = (rawText || '').trim();
  if (clean.length <= maxChars) return clean;
  const headChars = Math.floor(maxChars * 0.72);
  const tailChars = maxChars - headChars;
  return `${clean.slice(0, headChars)}\n...\n${clean.slice(-tailChars)}`;
}

export async function summarizeArticle(content, onProgress) {
  const cleanText = sliceLeadAndConclusion(content, MAX_SUMMARY_INPUT_CHARS);
  if (!cleanText) {
    throw new Error('No article text available to summarize.');
  }

  const status = await checkNanoStatus();

  if (status.summarizer === 'available') {
    return await runTwoPhaseGeneration({
      inputChars: cleanText.length,
      expectedOutputChars: 380,
      speedStorageKey: SUMMARY_SPEED_KEY,
      defaultOutputCharsPerSec: 85,
      label: 'Generating digest',
      onProgress,
      execute: async (reportStreamChars) => {
        const { instance: summarizer } = await getOrCreateWarmSummarizer();
        if (!summarizer) return '';
        try {
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
        } catch (err) {
          cachedSummarizer = null;
          throw err;
        }
      },
    });
  }

  if (status.prompt === 'available') {
    return await runTwoPhaseGeneration({
      inputChars: cleanText.length,
      expectedOutputChars: 380,
      speedStorageKey: SUMMARY_SPEED_KEY,
      defaultOutputCharsPerSec: 80,
      label: 'Generating digest',
      onProgress,
      execute: async (reportStreamChars) => {
        const { session, disposable } = await acquirePromptSession();
        try {
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
          if (disposable) session?.destroy?.();
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

async function runPromptText(prompt, reportStreamChars) {
  const { session, disposable } = await acquirePromptSession();
  try {
    if (typeof session.promptStreaming === 'function') {
      const stream = session.promptStreaming(prompt);
      let fullText = '';
      for await (const chunk of stream) {
        if (typeof chunk === 'string') {
          fullText =
            chunk.startsWith(fullText) && chunk.length >= fullText.length
              ? chunk
              : fullText + chunk;
          if (reportStreamChars) await reportStreamChars(fullText.length);
        }
      }
      return fullText;
    }
    return await session.prompt(prompt);
  } finally {
    if (disposable) session?.destroy?.();
  }
}

export async function synthesizeBriefing(articles, dateRangeLabel, onProgress) {
  const status = await getPromptAvailability();
  if (status === 'unavailable') {
    throw new Error('Prompt API (Gemini Nano) is unavailable. Use Copy Prompt instead.');
  }
  if (status !== 'available') {
    throw new Error('Gemini Nano is still downloading — click "Download AI" in the Side Panel first.');
  }

  // Single-pass for small windows (<= 6 items)
  if (articles.length <= BRIEFING_BATCH_SIZE + 1) {
    let prompt = buildBriefingPrompt(articles, dateRangeLabel, MAX_BRIEFING_PROMPT_CHARS);
    return await runTwoPhaseGeneration({
      inputChars: prompt.length,
      expectedOutputChars: 1300,
      speedStorageKey: BRIEFING_SPEED_KEY,
      defaultOutputCharsPerSec: 80,
      label: `Synthesizing ${articles.length} post(s)`,
      onProgress,
      execute: async (reportStreamChars) => {
        const { session, disposable } = await acquirePromptSession();
        try {
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
          if (disposable) session?.destroy?.();
        }
      },
    });
  }

  // Incremental Map-Reduce for larger windows (> 6 items):
  // Preserves ~280 chars per item (higher quality) while evaluating small fast chunks.
  const batches = [];
  for (let i = 0; i < articles.length; i += BRIEFING_BATCH_SIZE) {
    batches.push(articles.slice(i, i + BRIEFING_BATCH_SIZE));
  }

  const totalSteps = batches.length + 1;
  const batchBullets = [];

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const itemsText = batch
      .map((art, idx) => {
        const body = (art.digest || art.content || 'Saved link').trim().slice(0, 280);
        return `${idx + 1}. Title: ${art.title}\n   URL: ${art.url}\n   Summary: ${body}`;
      })
      .join('\n\n');

    const mapPrompt = [
      `Extract 1 crisp bullet point per item below, citing the source inline as [Article Title](URL).`,
      `No intro or outro—only the bullet list:`,
      ``,
      itemsText,
    ].join('\n');

    const chunkOut = await runTwoPhaseGeneration({
      inputChars: mapPrompt.length,
      expectedOutputChars: batch.length * 140,
      speedStorageKey: BRIEFING_SPEED_KEY,
      defaultOutputCharsPerSec: 80,
      label: `Batch ${bIdx + 1}/${batches.length} (${batch.length} posts)`,
      onProgress: (prog) => {
        const overallPct = Math.min(
          92,
          Math.round(((bIdx + (prog.pct || 0) / 100) / totalSteps) * 100)
        );
        onProgress?.({
          pct: overallPct,
          etaText: prog.etaText,
          message: `Synthesizing (${overallPct}% · batch ${bIdx + 1}/${batches.length})...`,
        });
      },
      execute: (reportStreamChars) => runPromptText(mapPrompt, reportStreamChars),
    });

    if (chunkOut) batchBullets.push(chunkOut);
  }

  const combinedBullets = batchBullets.join('\n');
  const reducePrompt = [
    `You are synthesizing a 2-minute reading briefing for ${dateRangeLabel}.`,
    `Based ONLY on the takeaways below, write a concise **Emerging Themes** section with 2 to 3 numbered patterns connecting these reads (under 140 words):`,
    ``,
    combinedBullets.slice(0, 4500),
  ].join('\n');

  const themesOut = await runTwoPhaseGeneration({
    inputChars: reducePrompt.length,
    expectedOutputChars: 550,
    speedStorageKey: BRIEFING_SPEED_KEY,
    defaultOutputCharsPerSec: 80,
    label: `Distilling themes (${totalSteps}/${totalSteps})`,
    onProgress: (prog) => {
      const overallPct = Math.min(
        99,
        Math.round(((batches.length + (prog.pct || 0) / 100) / totalSteps) * 100)
      );
      onProgress?.({
        pct: overallPct,
        etaText: prog.etaText,
        message: `Distilling themes (${overallPct}%)...`,
      });
    },
    execute: (reportStreamChars) => runPromptText(reducePrompt, reportStreamChars),
  });

  return [
    `### Key Takeaways`,
    combinedBullets,
    ``,
    `### Emerging Themes`,
    themesOut,
  ].join('\n');
}

export const generateBriefing = synthesizeBriefing;

export function resetNanoSessions() {
  try { cachedSummarizer?.destroy?.(); } catch {}
  try { cachedBasePromptSession?.destroy?.(); } catch {}
  cachedSummarizer = null;
  cachedBasePromptSession = null;
}
