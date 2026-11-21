# ==============================================================================
# 1. Wire live ~Xs left ETA into src/ai/nano.js, useArticles.js & useBriefings.js
# ==============================================================================

cat << 'EOF' > src/ai/nano.js
const MAX_SUMMARY_INPUT_CHARS = 14000;
const MAX_BRIEFING_PROMPT_CHARS = 12000;
const SUMMARY_SPEED_KEY = 'afterword:nanoSummaryCharsPerSec';
const BRIEFING_SPEED_KEY = 'afterword:nanoBriefingCharsPerSec';

export function formatEtaSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
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

async function runWithStreamingOrTimer({
  streamFn,
  batchFn,
  expectedChars,
  speedStorageKey,
  defaultCharsPerSec,
  label,
  onProgress,
}) {
  const savedSpeed = Number(localStorage.getItem(speedStorageKey)) || defaultCharsPerSec;
  const startedAt = Date.now();
  const initialEta = formatEtaSeconds(Math.max(2, expectedChars / savedSpeed));
  onProgress?.({ pct: 5, etaText: initialEta, message: `${label}... (${initialEta})` });

  if (typeof streamFn === 'function') {
    const stream = await streamFn();
    let fullText = '';
    for await (const chunk of stream) {
      if (typeof chunk === 'string') {
        fullText = chunk.startsWith(fullText) && chunk.length >= fullText.length
          ? chunk
          : fullText + chunk;
      }
      const elapsedSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
      const liveSpeed = Math.max(15, fullText.length / elapsedSec);
      const blendedSpeed = savedSpeed * 0.35 + liveSpeed * 0.65;
      const pct = Math.min(96, Math.max(8, Math.round((fullText.length / expectedChars) * 100)));
      const remainingChars = Math.max(0, expectedChars - fullText.length);
      const etaText = formatEtaSeconds(remainingChars / blendedSpeed);
      onProgress?.({
        pct,
        etaText,
        message: `${label}... ${pct}%${etaText ? ` (${etaText})` : ''}`,
      });
    }

    const totalSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
    if (fullText.length > 40) {
      localStorage.setItem(speedStorageKey, String(Math.round(fullText.length / totalSec)));
    }
    return fullText.trim();
  }

  // Fallback calibrated countdown when streaming isn't exposed
  const estTotalSec = Math.max(3, expectedChars / savedSpeed);
  const timer = setInterval(() => {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const pct = Math.min(92, Math.max(8, Math.round((elapsedSec / estTotalSec) * 100)));
    const etaText = formatEtaSeconds(Math.max(1, estTotalSec - elapsedSec));
    onProgress?.({
      pct,
      etaText,
      message: `${label}... ${pct}% (${etaText})`,
    });
  }, 450);

  try {
    const result = (await batchFn()) || '';
    const totalSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
    if (result.length > 40) {
      localStorage.setItem(speedStorageKey, String(Math.round(result.length / totalSec)));
    }
    return result.trim();
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
        return await runWithStreamingOrTimer({
          streamFn: typeof summarizer.summarizeStreaming === 'function'
            ? () => summarizer.summarizeStreaming(cleanText)
            : null,
          batchFn: () => summarizer.summarize(cleanText),
          expectedChars: 420,
          speedStorageKey: SUMMARY_SPEED_KEY,
          defaultCharsPerSec: 95,
          label: 'Generating TL;DR digest',
          onProgress,
        });
      }
    } finally {
      summarizer?.destroy?.();
    }
  }

  if (status.prompt === 'available') {
    let session = null;
    try {
      session =
        'LanguageModel' in self
          ? await self.LanguageModel.create({
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
            })
          : await self.ai.languageModel.create();

      const prompt = `Summarize the following article in 2 to 3 crisp, informative sentences without filler:\n\n${cleanText}`;
      return await runWithStreamingOrTimer({
        streamFn: typeof session.promptStreaming === 'function'
          ? () => session.promptStreaming(prompt)
          : null,
        batchFn: () => session.prompt(prompt),
        expectedChars: 420,
        speedStorageKey: SUMMARY_SPEED_KEY,
        defaultCharsPerSec: 85,
        label: 'Generating TL;DR digest',
        onProgress,
      });
    } finally {
      session?.destroy?.();
    }
  }

  if (status.summarizer === 'downloadable' || status.summarizer === 'downloading' ||
      status.prompt === 'downloadable' || status.prompt === 'downloading') {
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
  let session = null;

  try {
    session =
      'LanguageModel' in self
        ? await self.LanguageModel.create({
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
          })
        : await self.ai.languageModel.create();

    return await runWithStreamingOrTimer({
      streamFn: typeof session.promptStreaming === 'function'
        ? () => session.promptStreaming(prompt)
        : null,
      batchFn: () => session.prompt(prompt),
      expectedChars: 1350,
      speedStorageKey: BRIEFING_SPEED_KEY,
      defaultCharsPerSec: 85,
      label: `Synthesizing ${articles.length} post(s)`,
      onProgress,
    });
  } finally {
    session?.destroy?.();
  }
}

export const generateBriefing = synthesizeBriefing;
EOF

# 2. Wire live ~Xs left progress into useArticles.js and useBriefings.js
node --input-type=module << 'EOF'
import fs from 'node:fs';

// Patch useArticles.js
let ua = fs.readFileSync('src/sidepanel/hooks/useArticles.js', 'utf8');
ua = ua.replace(
  'async function runBackgroundDigest(id, title, content, userNotes = \'\') {',
  'async function runBackgroundDigest(id, title, content, userNotes = \'\', batchPrefix = \'\') {'
);
ua = ua.replace(
  "setBackgroundStatus('Generating local TL;DR digest...');\n      const digest = await summarizeArticle(content);",
  "setBackgroundStatus(`${batchPrefix}Generating TL;DR digest...`);\n      const digest = await summarizeArticle(content, ({ message }) => {\n        setBackgroundStatus(`${batchPrefix}${message}`);\n      });\n      setBackgroundStatus(`${batchPrefix}Indexing semantic vector (~1s left)...`);"
);
ua = ua.replace(
  `    for (const item of pending) {
      const fullRecord = await db.articles.get(item.id);
      if (fullRecord?.content?.trim()) {
        await runBackgroundDigest(
          fullRecord.id,
          fullRecord.title,
          fullRecord.content,
          fullRecord.userNotes || ''
        );
      }
    }`,
  `    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const prefix = pending.length > 1 ? \`[\${i + 1}/\${pending.length}] \` : '';
      const fullRecord = await db.articles.get(item.id);
      if (fullRecord?.content?.trim()) {
        await runBackgroundDigest(
          fullRecord.id,
          fullRecord.title,
          fullRecord.content,
          fullRecord.userNotes || '',
          prefix
        );
      }
    }`
);
fs.writeFileSync('src/sidepanel/hooks/useArticles.js', ua, 'utf8');
console.log('Wired ~Xs left digest progress in useArticles.js');

// Patch useBriefings.js
let ub = fs.readFileSync('src/sidepanel/hooks/useBriefings.js', 'utf8');
ub = ub.replace(
  'let summaryMarkdown = await synthesizeBriefing(enriched, `${startDate} to ${endDate}`);',
  'let summaryMarkdown = await synthesizeBriefing(enriched, `${startDate} to ${endDate}`, ({ message }) => {\n        setStatusMsg(message);\n      });'
);
fs.writeFileSync('src/sidepanel/hooks/useBriefings.js', ub, 'utf8');
console.log('Wired ~Xs left synthesis progress in useBriefings.js');
EOF

# ==============================================================================
# 2. Update ArchitectureDetails.jsx & AboutPanel.jsx (Nano vs Non-Nano, Local vs Network)
# ==============================================================================

cat << 'EOF' > pwa/src/ArchitectureDetails.jsx
import React from 'react';

const AI_AND_STACK_ROWS = [
  {
    component: 'Article Summarizer & Weekly Synthesizer',
    tech: 'Chrome Built-in AI — Gemini Nano (Summarizer & LanguageModel Prompt API)',
    runtime: 'On-Device (Local)',
    rationale: 'Runs Chrome’s built-in Gemini Nano weights locally in the browser for TL;DR digests and multi-article synthesis with zero API token spend.',
  },
  {
    component: 'Semantic Search & Archive Graph Links',
    tech: 'Xenova/all-MiniLM-L6-v2 via Transformers.js (ONNX Runtime WASM — NOT Gemini Nano)',
    runtime: 'On-Device (Local)',
    rationale: 'A dedicated 384-dimension sentence-transformer model compiled to WebAssembly computes cosine similarity across thousands of articles and margin notes in <50ms.',
  },
  {
    component: 'Article Extraction & Briefing Formatting',
    tech: '@mozilla/readability + Custom Deterministic Markdown Parser (No LLM)',
    runtime: 'On-Device (Local)',
    rationale: 'Strips boilerplate ads/navigation cleanly via DOM heuristics before Gemini Nano ever sees the text, keeping context windows focused and fast.',
  },
  {
    component: 'Read-Aloud Audio Reader',
    tech: 'Web Speech API (window.speechSynthesis) + Thought-Group Chunker (No LLM)',
    runtime: 'On-Device (OS Voice)',
    rationale: 'Normalizes Markdown/abbreviations and feeds ~400-char thought blocks to native OS voices with lock-screen MediaSession controls.',
  },
  {
    component: 'Local Storage & Offline Portability',
    tech: 'IndexedDB (Dexie.js) + Service Worker + JSON Snapshot Export/Merge',
    runtime: '100% Offline',
    rationale: 'All articles, embeddings, notes, and briefings live in browser IndexedDB. Users can export/restore plain JSON archives under About with zero cloud accounts.',
  },
  {
    component: 'Cross-Device Sync & Mobile Book OCR',
    tech: 'Google Drive REST API (drive.file scope) + Transient Docs OCR',
    runtime: 'Requires Internet (Optional)',
    rationale: 'Reconciles afterword-sync.json directly between desktop and mobile via the user’s own Google Drive, and converts physical book photos via temporary Drive OCR.',
  },
];

export default function ArchitectureDetails({ onSwitchTab }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Hero Case Study Header */}
      <section className="card" style={{ background: '#FDF7E7', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '11px',
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: '6px',
              border: '1px solid var(--ink)',
              background: 'var(--card)',
            }}
          >
            SYSTEM ARCHITECTURE &amp; ENGINEERING NOTES
          </span>
          <a
            href="https://github.com/anjalicg/synapse-read"
            target="_blank"
            rel="noreferrer"
            className="pill"
          >
            Source Code (GitHub) ↗
          </a>
        </div>

        <h2 className="serif-title" style={{ margin: 0, fontSize: '23px', lineHeight: 1.25 }}>
          Designing Afterword: A Local-First, Zero-Backend AI Commonplace Book
        </h2>

        <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--ink)' }}>
          Most AI reading apps route every highlight and summary through vendor-owned cloud backends—introducing recurring API costs, privacy exposure, and offline breakage. <strong>Afterword</strong> is engineered as a <strong>local-first, zero-backend</strong> system: all AI inference, vector indexing, and storage execute inside the user&apos;s browser, while optional cross-device sync and mobile book OCR talk directly to the user&apos;s own Google Drive with zero developer servers in the middle.
        </p>
      </section>

      {/* Local vs Internet Boundary */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', color: 'var(--ink-muted)' }}>
          01 // EXECUTION BOUNDARY — WHAT RUNS LOCALLY VS. WHAT USES THE NETWORK
        </div>
        <h3 className="serif-title" style={{ margin: 0, fontSize: '18px' }}>
          Honest Local-First Architecture (Zero Developer Servers)
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '10px',
          }}
        >
          <div style={{ border: '1.5px solid var(--ink)', borderRadius: '10px', padding: '10px', background: '#EAF4EE' }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: 'var(--sage)', fontWeight: 700 }}>
              100% LOCAL / WORKS OFFLINE
            </div>
            <ul style={{ margin: '6px 0 0', paddingLeft: '16px', fontSize: '12.5px', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li><strong>IndexedDB Archive:</strong> Articles, book scans, margin notes, and briefings stored locally via Dexie.js.</li>
              <li><strong>On-Device AI Inference:</strong> Gemini Nano summarization/synthesis and ONNX WASM vector search (once model weights are cached).</li>
              <li><strong>Offline JSON Backup &amp; Restore:</strong> Export or merge full JSON snapshots under <em>About</em>—no Google account required.</li>
              <li><strong>Offline PWA Reader &amp; Audio:</strong> Cached briefings/library + OS Web Speech narration on flights or offline.</li>
            </ul>
          </div>

          <div style={{ border: '1.5px solid var(--ink)', borderRadius: '10px', padding: '10px', background: 'var(--paper)' }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: 'var(--ochre)', fontWeight: 700 }}>
              REQUIRES INTERNET ACCESS (USER-DIRECT)
            </div>
            <ul style={{ margin: '6px 0 0', paddingLeft: '16px', fontSize: '12.5px', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li><strong>One-Time Model Downloads:</strong> Chrome downloads Gemini Nano weights (~1.7 GB) and HuggingFace/ONNX MiniLM WASM files on first setup.</li>
              <li><strong>Google Drive Sync (Optional):</strong> Pulls/pushes <code>afterword-sync.json</code> directly to the user&apos;s Drive (<code>drive.file</code> scope).</li>
              <li><strong>Mobile Book Page OCR:</strong> Uploads a transient page photo to the user&apos;s Drive for Google Docs OCR, then deletes the temp file.</li>
              <li><strong>Live Web Clipping:</strong> Fetching external article URLs or Chrome Reading List pages.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Complete Tech Stack & Nano vs Non-Nano */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', color: 'var(--ink-muted)' }}>
          02 // COMPLETE TECH STACK — GEMINI NANO VS. SPECIALIZED LOCAL MODELS
        </div>
        <h3 className="serif-title" style={{ margin: 0, fontSize: '18px' }}>
          Using the Right Tool Instead of Sending Everything to an LLM
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          {AI_AND_STACK_ROWS.map((row) => (
            <div
              key={row.component}
              style={{
                padding: '9px 11px',
                borderRadius: '8px',
                border: '1px solid #DCD7CC',
                background: 'var(--paper)',
                fontSize: '13px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                <strong>{row.component}</strong>
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '10.5px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: row.runtime.includes('Internet') ? '#FDF7E7' : '#EAF4EE',
                    border: '1px solid #C8C2B4',
                    color: 'var(--ink)',
                  }}
                >
                  {row.runtime}
                </span>
              </div>
              <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', color: 'var(--sage)', marginTop: '3px' }}>
                {row.tech}
              </div>
              <div style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>{row.rationale}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Core Engineering Decisions */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', color: 'var(--ink-muted)' }}>
          03 // KEY DISTRIBUTED SYSTEMS &amp; EDGE AI DECISIONS
        </div>

        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>
            1. Asymmetric Edge Compute Across Desktop &amp; Mobile
          </h4>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--ink-muted)' }}>
            Desktop Chrome (Manifest V3) runs heavy on-device inference—Gemini Nano digests, weekly synthesis, and 384-dim WASM embeddings. The Vercel-hosted mobile PWA acts as a lightweight field-capture and offline reader surface: scanning a physical book page on mobile syncs an unenriched item with <code>digest: &quot;&quot;</code>, which desktop automatically detects, summarizes, and indexes on next sync without clobbering mobile notes.
          </p>
        </div>

        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>
            2. Deterministic State Reconciliation Without a Central Database
          </h4>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--ink-muted)' }}>
            Afterword implements a <strong>pull-merge-push</strong> reconciliation engine over a single JSON file in Google Drive: per-record <code>updatedAt</code> timestamps resolve edits, non-empty AI enrichments (<code>digest</code>, <code>embedding</code>) are preserved across asymmetric devices, and a <code>tombstones</code> map prevents deleted articles from resurrecting across clients.
          </p>
        </div>

        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>
            3. Streaming AI Telemetry &amp; User-Activation Safeguards
          </h4>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--ink-muted)' }}>
            Chrome&apos;s Prompt API requires transient user activation to initiate the ~1.7 GB Gemini Nano download and otherwise leaves <code>LanguageModel.create()</code> pending indefinitely. Afterword gates background calls on <code>availability()</code>, exposes a click-triggered model downloader with live percentage/ETA, and uses <code>summarizeStreaming()</code> / <code>promptStreaming()</code> calibrated against device throughput to display real-time seconds-remaining estimates.
          </p>
        </div>
      </section>

      {/* Built WITH Gen-AI + Hiring Callout */}
      <section
        className="card"
        style={{
          background: '#1E1D1A',
          color: '#FFFDF9',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: '#D99B26' }}>
          04 // BUILT WITH GEN-AI — SYSTEMS RIGOR × AI VELOCITY
        </div>
        <h3 className="serif-title" style={{ margin: 0, fontSize: '20px', color: '#FFFDF9' }}>
          From First-Principles Architecture to Production Dual-Surface App
        </h3>
        <p style={{ margin: 0, fontSize: '13.5px', color: '#E5E0D5', lineHeight: 1.6 }}>
          Afterword was designed, built, and hardened across two runtime environments (Chrome Manifest V3 Extension + offline-capable PWA) using AI-assisted engineering workflows paired with systems-validation rigor—covering distributed sync edge cases, OAuth origin isolation, WASM embedding pipelines, and resilient local AI state machines.
        </p>
        <p style={{ margin: 0, fontSize: '13.5px', color: '#E5E0D5', lineHeight: 1.6 }}>
          <strong>Building products with Gen-AI or edge AI?</strong> If you&apos;re hiring engineers who can architect and ship reliable AI-native applications end to end, let&apos;s connect.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
          <a
            href="https://github.com/anjalicg"
            target="_blank"
            rel="noreferrer"
            className="btn"
            style={{ background: '#D99B26', color: '#1E1D1A', borderColor: '#FFFDF9' }}
          >
            GitHub (@anjalicg) ↗
          </a>
          <a
            href="https://github.com/anjalicg/synapse-read"
            target="_blank"
            rel="noreferrer"
            className="btn"
            style={{ background: 'transparent', color: '#FFFDF9', borderColor: '#FFFDF9' }}
          >
            Inspect Repo ↗
          </a>
          {onSwitchTab && (
            <button
              type="button"
              className="btn"
              style={{ background: 'transparent', color: '#E5E0D5', borderColor: '#625E55' }}
              onClick={() => onSwitchTab('overview')}
            >
              ← Back to Overview
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
EOF

# Update AboutPanel.jsx footer from "100% Local" to "Local-First · Zero Developer Servers"
sed -i '' 's/100% Local · Zero Telemetry/Local-First · Zero Developer Servers · Zero Telemetry/g' src/sidepanel/components/AboutPanel.jsx

# ==============================================================================
# 3. Update README.md, docs/index.html, landingContent.js & privacy.html
# ==============================================================================

node --input-type=module << 'EOF'
import fs from 'node:fs';

// Update docs/index.html & pwa/src/landingContent.js phrasing
for (const file of ['docs/index.html', 'pwa/src/landingContent.js']) {
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, 'utf8');
  text = text
    .replace(/100% locally inside Chrome/gi, 'local-first inside Chrome (with optional Google Drive sync or offline JSON backup under About)')
    .replace(/100% local/gi, 'local-first');
  fs.writeFileSync(file, text, 'utf8');
  console.log(`Updated local-first & offline backup copy in ${file}`);
}

// Document offline JSON Backup & Restore in privacy.html
for (const pFile of ['docs/privacy.html', 'pwa/public/privacy.html']) {
  if (!fs.existsSync(pFile)) continue;
  let html = fs.readFileSync(pFile, 'utf8');
  if (!html.includes('Backup JSON')) {
    const note = `<p><strong>Offline Portability Without Google Drive:</strong> Connecting Google Drive is completely optional. You can export and restore plain JSON archives locally at any time from <strong>About → Backup JSON / Restore JSON</strong> inside the Chrome extension without signing into a Google account.</p>\n`;
    html = html.replace('</body>', `${note}</body>`);
    fs.writeFileSync(pFile, html, 'utf8');
    console.log(`Added offline JSON backup note to ${pFile}`);
  }
}

// Update README.md if present
if (fs.existsSync('README.md')) {
  let readme = fs.readFileSync('README.md', 'utf8');
  readme = readme.replace(/100% local(ly)?/gi, 'local-first');
  if (!readme.includes('Backup JSON')) {
    readme += `\n## Offline Portability & Execution Model\n- **Local-First, Zero Developer Servers:** Articles, margin notes, Gemini Nano summaries, and 384-dim ONNX embeddings (`Xenova/all-MiniLM-L6-v2`) run and persist locally in IndexedDB.\n- **No Google Account Required:** Open **About** in the extension Side Panel to use **Backup JSON** and **Restore JSON** for offline portability without Google Drive.\n- **Optional Cloud Features:** Internet access is only used for initial model weight downloads, optional user-owned Google Drive sync (`drive.file`), transient mobile book-page OCR, and fetching live web pages.\n`;
  }
  fs.writeFileSync('README.md', readme, 'utf8');
  console.log('Updated README.md');
}
EOF

# ==============================================================================
# 4. Build Extension + ZIP + PWA and Push to Main
# ==============================================================================

npm run build && \
rm -rf /tmp/afterword docs/afterword.zip && \
cp -R dist /tmp/afterword && \
(cd /tmp && zip -r "$OLDPWD/docs/afterword.zip" afterword) && \
cp -f docs/afterword.zip pwa/public/afterword.zip && \
(cd pwa && npm run build) && \
git add -A && \
git commit -m "Add live ETA progress for AI digest/synthesis and update Architecture & docs for local-first model" && \
git push origin main