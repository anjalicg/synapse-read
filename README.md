# Afterword

A local-first, privacy-focused Chrome Side Panel extension (Manifest V3) that captures web articles, attaches per-post annotations, maps semantic connections across 10,000+ saved reads, and synthesizes date-range briefings—with zero external servers, cloud tokens, or telemetry.

---

## Core Architecture & Privacy Guardrails

* **local-first Storage & High-Scale Cursor Streaming:** Articles, digests, per-post notes, 384-dimension vector embeddings, and briefings persist locally in IndexedDB via `Dexie.js` (`SynapseReadDB` v3) with `navigator.storage.persist()` and `unlimitedStorage` enabled. Article lists stream via a Dexie cursor (`loadArticleMetadataList`) so full article bodies are never held in React state, scaling smoothly to 10,000+ saved posts.
* **Zero Cloud API Keys or Usage Quotas:** Uses Chrome's built-in **Summarizer API** and **Prompt API (Gemini Nano)** on your local CPU/GPU, paired with a one-click **Copy Prompt** fallback when hardware requirements aren't met.
* **MV3 CSP-Compliant Semantic Search:** Runs `Xenova/all-MiniLM-L6-v2` (`q8` quantized) inside the extension via locally bundled ONNX WebAssembly (`.wasm`) and `.mjs` runtimes—requiring zero remote scripts or `unsafe-eval`.

---

## Features & User Workflow

### 1. Capture, Cross-Device Sync & Per-Post Notes
* **Save Content / Save Link Only:** Extracts clean article prose using `@mozilla/readability` or saves lightweight bookmarks with automatic URL deduplication.
* **Chrome Reading List Sync (`Sync List`):** Imports entries from `chrome.readingList` and listens for newly added items across synced devices.
* **Background `Fetch & Digest`:** Hydrates link-only and Reading List cards in place by fetching HTML, parsing readable text, and generating digests and embeddings without opening a tab.
* **Per-Post Notes (`+ Note` / `Edit Note`):** Attach personal takeaways or quotes to any saved post or bookmark. Notes auto-save and are embedded alongside the title and digest so **Related** and **Semantic Search** match on your annotations.

### 2. On-Device Digests & Date-Range Briefings
* **Background TL;DR Digests:** Automatically summarizes newly saved articles via Chrome's local `Summarizer` API.
* **Flexible Briefing Windows:** Filter saved reading by `7D`, `14D`, `30D`, or a custom date range to synthesize a structured 2-minute briefing incorporating article digests and your attached post notes.
* **One-Time Model Warmup (`Download AI`):** Guided setup banner to download Gemini Nano weights once for offline execution.

### 3. Semantic Memory & Knowledge Mapping
* **384-Dimension Vector Indexing:** Generates normalized embeddings for every post (`title + digest + userNotes`) and every briefing reflection.
* **`Related` Articles:** Surfaces top semantic matches across your entire reading history directly inside each article card.
* **From Your Archive:** Automatically cross-links older archived articles that connect to your current briefing window.
* **Hybrid Semantic Search:** Queries across saved posts, post notes, and briefing reflections using cosine similarity combined with keyword boosting.

### 4. Audio Playback & Auto-Saved Reflections
* **Offline Audio Briefings (`Listen`):** Reads briefings aloud via the Web Speech API using sentence-level chunking and enhanced local system voice selection.
* **1,000-Word Reflections (`My Notes & Reflections`):** Attach personal synthesis notes to any briefing; notes auto-save to IndexedDB and are automatically embedded for semantic search.

### 5. Data Portability: `Export .md` vs. Non-Destructive `Backup` / `Restore`

| Feature | Location in UI | File Format | What It Does |
| :--- | :--- | :--- | :--- |
| **`Export .md`** | Briefing card action bar | `.md` (Markdown + YAML frontmatter) | Exports the active briefing, **My Briefing Reflections**, and a **Saved Posts & Attached Notes** index for that date window—ready for Obsidian, Logseq, or Notion. |
| **`Backup`** | Top header bar | `.json` (Full IndexedDB snapshot) | Exports your entire `SynapseReadDB` archive—all saved articles, full extracted text, digests, per-post notes, 384-dimension embeddings, briefings, and reflections. |
| **`Restore`** | Top header bar | `.json` (Backup archive) | **Seamlessly merges** an imported `.json` backup with your existing local posts and briefings—deduplicating URLs, retaining hydrated article text over empty bookmarks, and combining distinct notes with a `---` separator. |

---

## Installation & Build

```bash
# 1. Install dependencies & build dist/
npm install
npm run build

# 2. (Optional) Repackage pre-built zip for GitHub Pages (docs/afterword.zip)
rm -rf /tmp/afterword docs/afterword.zip && \
cp -R dist /tmp/afterword && \
(cd /tmp && zip -r "$OLDPWD/docs/afterword.zip" afterword)

## Offline Portability & Execution Model
- **Local-First, Zero Developer Servers:** Articles, margin notes, Gemini Nano summaries, and 384-dim ONNX embeddings (`Xenova/all-MiniLM-L6-v2`) run and persist locally in IndexedDB.
- **No Google Account Required:** Open **About** in the extension Side Panel to use **Backup JSON** and **Restore JSON** for offline portability without Google Drive.
- **Optional Cloud Features:** Internet access is only used for initial model weight downloads, optional user-owned Google Drive sync (`drive.file`), transient mobile book-page OCR, and fetching live web pages.
