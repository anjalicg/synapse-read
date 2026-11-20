# Synapse-Read

A local-first, privacy-focused Chrome Side Panel extension (Manifest V3) that captures web articles, generates on-device digests, maps semantic connections across your reading archive, and synthesizes date-range briefings—with zero external servers, cloud tokens, or telemetry.

---

## Core Architecture & Privacy Guardrails

* **100% Local Storage:** Articles, digests, 384-dimension vector embeddings, briefings, and personal notes persist locally in IndexedDB via `Dexie.js` (`SynapseReadDB`) with `navigator.storage.persist()` enabled.
* **Zero Cloud API Keys or Usage Quotas:** Uses Chrome's built-in **Summarizer API** and **Prompt API (Gemini Nano)** on your local CPU/GPU, paired with a one-click **Copy Prompt** fallback when hardware requirements aren't met.
* **MV3 CSP-Compliant Semantic Search:** Runs `Xenova/all-MiniLM-L6-v2` (`q8` quantized) inside the extension via locally bundled ONNX WebAssembly (`.wasm`) and `.mjs` runtimes—requiring zero remote scripts or `unsafe-eval`.

---

## Features & User Workflow

### 1. Capture & Cross-Device Ingestion
* **Save Content / Save Link Only:** Extracts clean article prose using `@mozilla/readability` or saves lightweight bookmarks with automatic URL deduplication.
* **Chrome Reading List Sync (`Sync List`):** Imports entries from `chrome.readingList` and listens for newly added items across synced devices.
* **Background `Fetch & Digest`:** Hydrates link-only and Reading List cards in place by fetching HTML, parsing readable text, and generating digests and embeddings without opening a tab.

### 2. On-Device Digests & Date-Range Briefings
* **Background TL;DR Digests:** Automatically summarizes newly saved articles via Chrome's local `Summarizer` API.
* **Flexible Briefing Windows:** Filter saved reading by `7D`, `14D`, `30D`, or a custom date range to synthesize a structured 2-minute briefing with inline `[Title](URL)` citations and emerging themes.
* **One-Time Model Warmup (`Download AI`):** Guided setup banner to download Gemini Nano weights once for offline execution.

### 3. Semantic Memory & Knowledge Mapping
* **384-Dimension Vector Indexing:** Generates normalized embeddings for every digested article and saved briefing reflection.
* **`Related` Articles:** Surfaces top semantic matches across your entire reading history directly inside each article card.
* **From Your Archive:** Automatically cross-links older archived articles that connect to your current briefing window.
* **Hybrid Semantic Search:** Queries across both saved articles and your briefing notes using cosine similarity combined with keyword boosting.

### 4. Audio Playback & Auto-Saved Reflections
* **Offline Audio Briefings (`Listen`):** Reads briefings aloud via the Web Speech API using sentence-level chunking and enhanced local system voice selection.
* **1,000-Word Reflections (`My Notes & Reflections`):** Attach personal takeaways to any briefing; notes auto-save to IndexedDB and are automatically embedded for semantic search.

### 5. Data Portability: `Export .md` vs. `Backup` / `Restore`

Synapse-Read provides two distinct export mechanisms depending on whether you want human-readable notes or full database recovery:

| Feature | Location in UI | File Format | What It Exports & When to Use It |
| :--- | :--- | :--- | :--- |
| **`Export .md`** | Briefing card action bar (top-right of a briefing) | `.md` (Markdown + YAML frontmatter) | Exports **one specific briefing** along with your **My Notes & Reflections** section. Ideal for importing into Obsidian, Logseq, Notion, or sharing a single digest without exposing your full archive. |
| **`Backup`** | Top header bar | `.json` (Full IndexedDB snapshot) | Exports your **entire `SynapseReadDB` archive**—all saved articles, full extracted text, digests, pre-computed 384-dimension embeddings, briefings, and reflections. |
| **`Restore`** | Top header bar | `.json` (Backup archive) | Imports a `.json` backup file, merging new articles/briefings and updating existing records without losing your pre-computed embeddings. |

---

## Project Structure

```text
synapse-read/
├── docs/
│   ├── index.html                    # GitHub Pages drag-and-drop installer & user workflow guide
│   └── synapse-read.zip              # Pre-built extension bundle for zero-build installation
├── public/
│   ├── manifest.json                 # Chrome Extension Manifest V3 configuration
│   └── icons/                        # Extension icons (16, 32, 48, 128px PNG + SVG)
├── src/
│   ├── db.js                         # Dexie IndexedDB schema, persistence, JSON backup/restore
│   ├── ai/
│   │   ├── nano.js                   # Chrome Summarizer & Prompt API (Gemini Nano) wrappers
│   │   └── embeddings.js             # Transformers.js MiniLM-L6-v2 loader & cosine similarity
│   ├── sync/
│   │   └── readingList.js            # chrome.readingList synchronization
│   └── sidepanel/
│       ├── App.jsx                   # Top-level Side Panel shell
│       ├── utils/
│       │   └── formatters.js         # Date helpers, word counter, speech text chunker
│       ├── hooks/
│       │   ├── useArticles.js        # Capture, Readability parsing, Fetch & Digest, related map
│       │   ├── useBriefings.js       # Date windows, Nano synthesis, auto-saved notes, .md export
│       │   ├── useSemanticSearch.js  # Unified vector + keyword search across articles & notes
│       │   └── useSpeechBriefing.js  # Web Speech API voice selection & playback controls
│       └── components/
│           ├── Header.jsx            # Sync List, Backup, Restore, About toggle, Nano badge
│           ├── AboutPanel.jsx        # Local storage stats, AI runtime status, flag reference
│           ├── BriefingPanel.jsx     # Date filters, briefing renderer, audio bar, notes editor
│           ├── SearchSection.jsx     # Search bar & matching briefing note cards
│           └── ArticleCard.jsx       # Article digest card, Fetch & Digest, Related drawer
└── package.json
```

---

## Prerequisites & Chrome Built-in AI Setup

1. **Desktop Chrome** (version 138+ recommended) with at least **22 GB of free disk space** and a supported GPU/CPU for Gemini Nano.
2. Enable the following flags in `chrome://flags` and relaunch Chrome:
   * `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
   * `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
   * `chrome://flags/#summarization-api-for-gemini-nano` → **Enabled**
3. *(Optional)* Click **Download AI** inside the Synapse-Read Side Panel after installation to download the model weights once.

*(If Gemini Nano is unavailable on a machine, Synapse-Read automatically switches to **Nano: Fallback** mode—semantic search, local embeddings, Readability capture, and **Copy Prompt** remain fully functional.)*

---

## Installation

### Option A: Zero-Build Install (From Pre-Built Zip)
1. Download `docs/synapse-read.zip` (or use the GitHub Pages installer at `docs/index.html`) and unzip it.
2. Open `chrome://extensions` and enable **Developer mode** (top right).
3. Drag the unzipped `synapse-read` folder onto `chrome://extensions` (or click **Load unpacked** and select it).

### Option B: Build from Source
```bash
npm install
npm run build
```
Load the generated `dist/` folder via **Load unpacked** in `chrome://extensions`.