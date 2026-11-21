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
