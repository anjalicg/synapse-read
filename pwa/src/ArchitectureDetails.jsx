import React from 'react';

const STACK_ROWS = [
  {
    layer: 'Desktop Surface',
    tech: 'Chrome Extension (Manifest V3, Side Panel API, React)',
    rationale: 'Persistent reading companion alongside any webpage without context-switching tabs.',
  },
  {
    layer: 'Mobile & Web Companion',
    tech: 'Progressive Web App (Vite, React, Custom Network-First SW)',
    rationale: 'Installable iOS/Android reader with offline briefing cache and Web Speech audio.',
  },
  {
    layer: 'On-Device AI & Search',
    tech: 'Chrome Prompt API (Gemini Nano) + Local Vector Embeddings',
    rationale: 'Zero-cost article digests, weekly synthesis, and semantic similarity—100% in-browser.',
  },
  {
    layer: 'Physical Book Capture',
    tech: 'Camera Capture + Transient Google Drive OCR Pipeline',
    rationale: 'Converts book page photos to text via Drive API and immediately deletes temp files.',
  },
  {
    layer: 'Storage & Sync Engine',
    tech: 'IndexedDB (Dexie.js) + Google Drive (drive.file scope)',
    rationale: 'Local-first speed with user-owned JSON state reconciliation and tombstone deletions.',
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
          Designing Afterword: A Zero-Backend, On-Device AI Commonplace Book
        </h2>

        <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--ink)' }}>
          Most AI reading tools are thin wrappers around cloud APIs: they ship your private reading history to a vendor database, charge recurring token fees, and break offline. <strong>Afterword</strong> was engineered around the opposite premise—combining <strong>browser-native Gen-AI</strong>, <strong>local vector indexing</strong>, and <strong>user-owned Google Drive state reconciliation</strong> so intelligence runs on the edge with zero server infrastructure.
        </p>
      </section>

      {/* Visual System Topology */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', color: 'var(--ink-muted)' }}>
          01 // DISTRIBUTED TOPOLOGY (ZERO CENTRAL SERVERS)
        </div>
        <h3 className="serif-title" style={{ margin: 0, fontSize: '18px' }}>
          Dual-Surface Architecture with Asymmetric Edge Compute
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '10px',
            marginTop: '4px',
          }}
        >
          <div style={{ border: '1.5px solid var(--ink)', borderRadius: '10px', padding: '10px', background: 'var(--paper)' }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: 'var(--ochre)', fontWeight: 600 }}>
              DESKTOP (CHROME MV3)
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', margin: '4px 0' }}>Heavy Local AI &amp; Capture</div>
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12.5px', color: 'var(--ink-muted)' }}>
              <li>DOM article extraction &amp; margin notes</li>
              <li>Gemini Nano digests &amp; weekly briefings</li>
              <li>Local embeddings &amp; semantic graph links</li>
              <li>Primary IndexedDB store</li>
            </ul>
          </div>

          <div style={{ border: '1.5px solid var(--ink)', borderRadius: '10px', padding: '10px', background: '#EAF4EE' }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: 'var(--sage)', fontWeight: 600 }}>
              SYNC BUS (USER DRIVE)
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', margin: '4px 0' }}>Pull-Merge-Push Engine</div>
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12.5px', color: 'var(--ink)' }}>
              <li>Scoped solely to <code>drive.file</code></li>
              <li><code>afterword-sync.json</code> owned by user</li>
              <li><code>updatedAt</code> LWW + tombstone deletes</li>
              <li>Preserves asymmetric AI enrichments</li>
            </ul>
          </div>

          <div style={{ border: '1.5px solid var(--ink)', borderRadius: '10px', padding: '10px', background: 'var(--paper)' }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', color: 'var(--periwinkle)', fontWeight: 600 }}>
              MOBILE / WEB (PWA)
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', margin: '4px 0' }}>Field Capture &amp; Offline Reader</div>
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12.5px', color: 'var(--ink-muted)' }}>
              <li>Camera book page scan + Drive OCR</li>
              <li>Offline briefing reader + Web Speech TTS</li>
              <li>On-the-go margin note annotations</li>
              <li>Service Worker cached IndexedDB</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Core Engineering Decisions */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', color: 'var(--ink-muted)' }}>
          02 // KEY ARCHITECTURAL DECISIONS
        </div>

        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>
            1. Using Gen-AI on the Edge: Hybrid Prompt API + Local Vector Retrieval
          </h4>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--ink-muted)' }}>
            Instead of streaming full article text to external LLM endpoints, Afterword orchestrates Chrome&apos;s built-in <strong>Prompt API (Gemini Nano)</strong> for per-article distillation and multi-article weekly synthesis. For retrieval, articles and user notes are embedded locally in-browser so cosine-similarity search surfaces forgotten connections across thousands of reads with sub-50ms latency and zero API spend.
          </p>
        </div>

        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>
            2. Distributed State Reconciliation Without a Central Database
          </h4>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--ink-muted)' }}>
            Syncing across devices without a backend creates subtle failure modes—especially when one device has stronger compute than the other. Afterword implements a deterministic <strong>pull-merge-push</strong> protocol: when a book page is scanned on mobile, it syncs with an empty <code>digest</code>; when desktop pulls it, Gemini Nano generates the summary and pushes it back without mobile ever clobbering enriched fields. Editing a margin note resets <code>embedding = null</code> to trigger automatic re-indexing, while a <code>tombstones</code> map prevents deleted items from resurrecting across clients.
          </p>
        </div>

        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>
            3. Zero-Cost Mobile Book OCR via Transient Drive Conversion
          </h4>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--ink-muted)' }}>
            Physical books are first-class citizens in a commonplace book. On mobile, tapping <strong>+ Scan Page</strong> uploads the photo via multipart upload to the user&apos;s Drive with native Google Docs OCR conversion enabled, extracts the plain text into an editable card, and immediately deletes the temporary file—delivering high-accuracy OCR with zero paid vision APIs.
          </p>
        </div>

        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>
            4. Privacy-by-Construction OAuth &amp; Offline Portability
          </h4>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--ink-muted)' }}>
            Afterword uses a public OAuth 2.0 Client ID restricted strictly to <code>https://www.googleapis.com/auth/drive.file</code>. Every user authenticates directly against their own Google account; the developer never receives tokens, telemetry, or access to user files. Users who prefer zero cloud accounts can export and merge deterministic JSON snapshots anytime.
          </p>
        </div>
      </section>

      {/* Stack Breakdown */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', color: 'var(--ink-muted)' }}>
          03 // TECHNICAL STACK &amp; RATIONALE
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {STACK_ROWS.map((row) => (
            <div
              key={row.layer}
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid #DCD7CC',
                background: 'var(--paper)',
                fontSize: '13px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                <strong>{row.layer}</strong>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', color: 'var(--sage)' }}>
                  {row.tech}
                </span>
              </div>
              <div style={{ color: 'var(--ink-muted)', marginTop: '3px' }}>{row.rationale}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Built WITH Gen-AI + Hiring / Collaboration Callout */}
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
          04 // BUILT WITH GEN-AI — ENGINEERING VELOCITY
        </div>
        <h3 className="serif-title" style={{ margin: 0, fontSize: '20px', color: '#FFFDF9' }}>
          Systems Engineering Rigor × AI-Accelerated Execution
        </h3>
        <p style={{ margin: 0, fontSize: '13.5px', color: '#E5E0D5', lineHeight: 1.6 }}>
          Afterword was architected, debugged, and shipped across two runtime surfaces (Chrome Manifest V3 Extension + offline-capable Vercel PWA) using AI-assisted development workflows paired with systems-level validation discipline—covering edge-case state sync, OAuth origin isolation, service worker caching, and zero-dependency UI design.
        </p>
        <p style={{ margin: 0, fontSize: '13.5px', color: '#E5E0D5', lineHeight: 1.6 }}>
          <strong>Building products with Gen-AI or on-device AI?</strong> If you&apos;re looking for an engineer who can take AI-native applications from first-principles architecture to resilient, production-grade software, let&apos;s connect.
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
              onClick={() => onSwitchTab('briefings')}
            >
              ← Back to Live App
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
