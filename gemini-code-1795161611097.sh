# 1. src/db.js — Cursor metadata streaming (10k+ posts), per-post notes schema, & seamless JSON merge
cat << 'EOF' > src/db.js
import Dexie from 'dexie';

export const db = new Dexie('SynapseReadDB');

db.version(1).stores({
  articles: '++id, &url, savedAt, status',
  briefings: '++id, createdAt, startDate, endDate',
});

db.version(2).stores({
  articles: '++id, &url, savedAt, status, source',
  briefings: '++id, createdAt, startDate, endDate',
});

db.version(3)
  .stores({
    articles: '++id, &url, savedAt, status, source',
    briefings: '++id, createdAt, startDate, endDate',
  })
  .upgrade((tx) =>
    tx
      .table('articles')
      .toCollection()
      .modify((article) => {
        if (typeof article.userNotes !== 'string') {
          article.userNotes = '';
        }
      })
  );

export async function ensurePersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    console.log(`Synapse-Read persistent storage: ${isPersisted}`);
  }
}

export async function loadArticleMetadataList() {
  const list = [];
  await db.articles
    .orderBy('savedAt')
    .reverse()
    .each((row) => {
      list.push({
        id: row.id,
        url: row.url,
        title: row.title,
        digest: row.digest || '',
        userNotes: row.userNotes || '',
        embedding: row.embedding || null,
        savedAt: row.savedAt,
        status: row.status,
        source: row.source,
        hasContent: Boolean(row.content && row.content.trim()),
      });
    });
  return list;
}

export async function getArticlesInDateRange(startDateStr, endDateStr) {
  const startTs = new Date(`${startDateStr}T00:00:00`).getTime();
  const endTs = new Date(`${endDateStr}T23:59:59.999`).getTime();
  return db.articles
    .where('savedAt')
    .between(startTs, endTs, true, true)
    .reverse()
    .toArray();
}

export async function updateArticleNotes(id, userNotes, embedding = undefined) {
  const patch = { userNotes };
  if (embedding !== undefined) {
    patch.embedding = embedding;
  }
  await db.articles.update(id, patch);
}

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return (rawUrl || '').trim();
  }
}

function mergeNotes(existingNotes, incomingNotes) {
  const a = (existingNotes || '').trim();
  const b = (incomingNotes || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b || a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n\n---\n\n${b}`;
}

function briefingFingerprint(b) {
  const summaryKey = (b.summaryMarkdown || '').trim().slice(0, 120);
  return `${b.startDate || ''}__${b.endDate || ''}__${summaryKey}`;
}

export async function exportArchiveJSON() {
  const articles = await db.articles.toArray();
  const briefings = await db.briefings.toArray();
  return JSON.stringify(
    {
      app: 'Synapse-Read',
      version: 3,
      exportedAt: new Date().toISOString(),
      articles,
      briefings,
    },
    null,
    2
  );
}

export async function importArchiveJSON(jsonText) {
  const data = JSON.parse(jsonText);
  if (!data || !Array.isArray(data.articles)) {
    throw new Error('Invalid Synapse-Read backup file.');
  }

  let addedArticles = 0;
  let mergedArticles = 0;
  let addedBriefings = 0;
  let mergedBriefings = 0;

  await db.transaction('rw', db.articles, db.briefings, async () => {
    const existingArticles = await db.articles.toArray();
    const byNormalizedUrl = new Map();
    for (const art of existingArticles) {
      byNormalizedUrl.set(normalizeUrl(art.url), art);
    }

    for (const incoming of data.articles) {
      if (!incoming?.url) continue;
      const normUrl = normalizeUrl(incoming.url);
      const existing = byNormalizedUrl.get(normUrl);

      if (!existing) {
        const cleanNew = { ...incoming };
        delete cleanNew.id;
        cleanNew.url = normUrl;
        cleanNew.userNotes = cleanNew.userNotes || '';
        cleanNew.savedAt = cleanNew.savedAt || Date.now();
        const newId = await db.articles.add(cleanNew);
        byNormalizedUrl.set(normUrl, { ...cleanNew, id: newId });
        addedArticles++;
      } else {
        const mergedNotes = mergeNotes(existing.userNotes, incoming.userNotes);
        const notesChanged = mergedNotes !== (existing.userNotes || '').trim();

        const bestContent =
          (existing.content || '').length >= (incoming.content || '').length
            ? existing.content
            : incoming.content;
        const bestDigest = existing.digest || incoming.digest || '';
        const bestStatus =
          existing.status === 'digested' || incoming.status === 'digested'
            ? 'digested'
            : existing.status || incoming.status || 'saved';

        const bestEmbedding = notesChanged
          ? null
          : existing.embedding || incoming.embedding || null;

        const updatedRecord = {
          ...existing,
          title:
            existing.title && existing.title !== existing.url
              ? existing.title
              : incoming.title || existing.title,
          content: bestContent,
          digest: bestDigest,
          userNotes: mergedNotes,
          status: bestStatus,
          savedAt: Math.min(existing.savedAt || Date.now(), incoming.savedAt || Date.now()),
          embedding: bestEmbedding,
        };

        await db.articles.put(updatedRecord);
        byNormalizedUrl.set(normUrl, updatedRecord);
        mergedArticles++;
      }
    }

    if (Array.isArray(data.briefings)) {
      const existingBriefings = await db.briefings.toArray();
      const byFingerprint = new Map();
      for (const b of existingBriefings) {
        byFingerprint.set(briefingFingerprint(b), b);
      }

      for (const incomingB of data.briefings) {
        if (!incomingB?.summaryMarkdown) continue;
        const fp = briefingFingerprint(incomingB);
        const existingB = byFingerprint.get(fp);

        if (!existingB) {
          const cleanB = { ...incomingB };
          delete cleanB.id;
          cleanB.userNotes = cleanB.userNotes || '';
          cleanB.createdAt = cleanB.createdAt || Date.now();
          const newBId = await db.briefings.add(cleanB);
          byFingerprint.set(fp, { ...cleanB, id: newBId });
          addedBriefings++;
        } else {
          const mergedNotes = mergeNotes(existingB.userNotes, incomingB.userNotes);
          const notesChanged = mergedNotes !== (existingB.userNotes || '').trim();

          const updatedB = {
            ...existingB,
            userNotes: mergedNotes,
            embedding: notesChanged
              ? null
              : existingB.embedding || incomingB.embedding || null,
          };

          await db.briefings.put(updatedB);
          byFingerprint.set(fp, updatedB);
          mergedBriefings++;
        }
      }
    }
  });

  return { addedArticles, mergedArticles, addedBriefings, mergedBriefings };
}
EOF

# 2. src/ai/nano.js — Complete Chrome Built-in AI exports
cat << 'EOF' > src/ai/nano.js
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
EOF

# 3. src/sync/readingList.js — Chrome Reading List sync & change listener
cat << 'EOF' > src/sync/readingList.js
import { db } from '../db.js';

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return (rawUrl || '').trim();
  }
}

export async function syncChromeReadingList() {
  if (!chrome?.readingList?.query) {
    return 0;
  }

  const entries = await chrome.readingList.query({});
  if (!Array.isArray(entries) || entries.length === 0) {
    return 0;
  }

  let added = 0;

  for (const entry of entries) {
    if (!entry?.url || !entry.url.startsWith('http')) continue;

    const normUrl = normalizeUrl(entry.url);
    const existing =
      (await db.articles.where('url').equals(normUrl).first()) ||
      (await db.articles.where('url').equals(entry.url).first());

    if (existing) continue;

    try {
      await db.articles.add({
        url: normUrl,
        title: entry.title?.trim() || normUrl,
        content: '',
        digest: '',
        userNotes: '',
        embedding: null,
        savedAt: entry.creationTime || Date.now(),
        status: 'saved',
        source: 'chrome-reading-list',
      });
      added++;
    } catch (err) {
      if (err?.name !== 'ConstraintError') {
        console.error('Failed to import Reading List entry:', entry.url, err);
      }
    }
  }

  return added;
}

export function subscribeReadingListChanges(onChange) {
  if (!chrome?.readingList?.onEntryAdded) {
    return () => {};
  }

  const handler = () => {
    onChange?.();
  };

  chrome.readingList.onEntryAdded.addListener(handler);
  return () => {
    chrome.readingList.onEntryAdded.removeListener(handler);
  };
}
EOF

# 4. src/sidepanel/hooks/useArticles.js — Metadata-only state & per-post note indexing
cat << 'EOF' > src/sidepanel/hooks/useArticles.js
import { useEffect, useState } from 'react';
import { Readability } from '@mozilla/readability';
import {
  db,
  loadArticleMetadataList,
  updateArticleNotes,
} from '../../db.js';
import { summarizeArticle } from '../../ai/nano.js';
import { generateEmbedding, cosineSimilarity } from '../../ai/embeddings.js';
import {
  syncChromeReadingList,
  subscribeReadingListChanges,
} from '../../sync/readingList.js';

function buildArticleEmbeddingText(item) {
  return [item.title, item.digest, item.userNotes].filter(Boolean).join('\n\n');
}

export function useArticles({ setStatusMsg, setBackgroundStatus }) {
  const [articles, setArticles] = useState([]);
  const [fetchingMap, setFetchingMap] = useState({});
  const [relatedMap, setRelatedMap] = useState({});

  async function loadArticles() {
    const metadataList = await loadArticleMetadataList();
    setArticles(metadataList);
    return metadataList;
  }

  async function syncReadingList(silent = false) {
    try {
      const added = await syncChromeReadingList();
      if (added > 0) {
        await loadArticles();
        setBackgroundStatus(`Synced ${added} new item(s) from Chrome Reading List.`);
      } else if (!silent) {
        setStatusMsg('Chrome Reading List is already up to date.');
      }
    } catch (err) {
      console.error('Reading list sync failed:', err);
      if (!silent) {
        setStatusMsg('Could not sync Reading List.');
      }
    }
  }

  useEffect(() => {
    loadArticles();
    syncReadingList(true);
    const unsubscribe = subscribeReadingListChanges(() => syncReadingList(true));
    return () => unsubscribe();
  }, []);

  async function runBackgroundDigest(id, title, content, userNotes = '') {
    try {
      setBackgroundStatus('Generating local TL;DR digest...');
      const digest = await summarizeArticle(content);
      const textToEmbed = [title, digest, userNotes].filter(Boolean).join('\n\n');
      const embedding = await generateEmbedding(textToEmbed);
      await db.articles.update(id, { digest, embedding, status: 'digested' });
      await loadArticles();
      setBackgroundStatus('Digest & semantic index ready.');
    } catch (err) {
      console.error(err);
      setBackgroundStatus('Saved article (Nano summary unavailable).');
    }
  }

  async function ensureAllEmbeddings(articleList) {
    let updated = false;
    for (const item of articleList) {
      const embedSource = buildArticleEmbeddingText(item);
      if (!item.embedding && embedSource) {
        try {
          const embedding = await generateEmbedding(embedSource);
          await db.articles.update(item.id, { embedding });
          item.embedding = embedding;
          updated = true;
        } catch (err) {
          console.error('Embedding failed for article:', item.id, err);
        }
      }
    }
    if (updated) {
      await loadArticles();
    }
  }

  async function saveActiveTab(mode) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.url.startsWith('http')) {
      setStatusMsg('Cannot capture internal browser pages.');
      return;
    }

    const existing = await db.articles.where('url').equals(tab.url).first();
    if (existing) {
      setStatusMsg('Already saved in Synapse-Read.');
      return;
    }

    let title = tab.title || tab.url;
    let content = '';

    if (mode === 'content') {
      try {
        const [{ result: html }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.documentElement.outerHTML,
        });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const parsed = new Readability(doc).parse();
        if (parsed) {
          title = parsed.title || title;
          content = parsed.textContent.trim();
        }
      } catch (err) {
        console.error('Extraction failed, falling back to link-only:', err);
      }
    }

    const id = await db.articles.add({
      url: tab.url,
      title,
      content,
      digest: '',
      userNotes: '',
      embedding: null,
      savedAt: Date.now(),
      status: mode === 'content' && content ? 'digesting' : 'saved',
      source: 'extension',
    });

    await loadArticles();

    if (mode === 'content' && content) {
      runBackgroundDigest(id, title, content, '');
    } else {
      setStatusMsg('Bookmark saved.');
    }
  }

  async function saveArticleNotes(item, rawNotes) {
    const trimmed = (rawNotes || '').trim();
    if (trimmed === (item.userNotes || '').trim()) return;

    await updateArticleNotes(item.id, trimmed);
    const updatedItem = { ...item, userNotes: trimmed };
    const embedSource = buildArticleEmbeddingText(updatedItem);

    if (embedSource) {
      try {
        const embedding = await generateEmbedding(embedSource);
        await updateArticleNotes(item.id, trimmed, embedding);
      } catch (err) {
        console.error('Failed to update article note embedding:', err);
      }
    }

    await loadArticles();
    setBackgroundStatus('Post note saved.');
  }

  async function fetchAndDigest(item) {
    setFetchingMap((prev) => ({ ...prev, [item.id]: true }));
    setStatusMsg(`Fetching "${item.title}"...`);

    try {
      const response = await fetch(item.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const parsed = new Readability(doc).parse();

      if (!parsed || !parsed.textContent?.trim()) {
        throw new Error('Could not extract readable text from page.');
      }

      const title = parsed.title || item.title;
      const content = parsed.textContent.trim();

      await db.articles.update(item.id, {
        title,
        content,
        status: 'digesting',
      });
      await loadArticles();

      await runBackgroundDigest(item.id, title, content, item.userNotes || '');
    } catch (err) {
      console.error('Fetch & Digest failed:', err);
      setStatusMsg(`Could not fetch "${item.title}" (${err.message}).`);
    } finally {
      setFetchingMap((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function toggleRelated(targetItem) {
    if (relatedMap[targetItem.id]) {
      setRelatedMap((prev) => {
        const next = { ...prev };
        delete next[targetItem.id];
        return next;
      });
      return;
    }

    setStatusMsg('Finding related articles...');
    const allMeta = await loadArticleMetadataList();
    await ensureAllEmbeddings(allMeta);

    const refreshedMeta = await loadArticleMetadataList();
    const target = refreshedMeta.find((a) => a.id === targetItem.id);

    if (!target?.embedding) {
      setStatusMsg('Digest or add a note to this post first to find related reads.');
      return;
    }

    const matches = refreshedMeta
      .filter((a) => a.id !== target.id && Array.isArray(a.embedding))
      .map((a) => ({
        ...a,
        score: cosineSimilarity(target.embedding, a.embedding),
      }))
      .filter((a) => a.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    setRelatedMap((prev) => ({ ...prev, [target.id]: matches }));
    setStatusMsg('');
  }

  async function deleteArticle(id) {
    await db.articles.delete(id);
    setRelatedMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await loadArticles();
  }

  return {
    articles,
    fetchingMap,
    relatedMap,
    loadArticles,
    syncReadingList,
    ensureAllEmbeddings,
    saveActiveTab,
    saveArticleNotes,
    fetchAndDigest,
    toggleRelated,
    deleteArticle,
  };
}
EOF

# 5. src/sidepanel/hooks/useBriefings.js — Post notes in Export .md + windowed queries
cat << 'EOF' > src/sidepanel/hooks/useBriefings.js
import { useEffect, useRef, useState } from 'react';
import { db, getArticlesInDateRange, loadArticleMetadataList } from '../../db.js';
import { synthesizeBriefing, buildBriefingPrompt } from '../../ai/nano.js';
import { generateEmbedding, cosineSimilarity } from '../../ai/embeddings.js';
import { formatDateInput, truncateToMaxWords } from '../utils/formatters.js';

function averageVectors(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += vec[i];
  }
  const norm = Math.sqrt(sum.reduce((acc, v) => acc + v * v, 0)) || 1;
  return sum.map((v) => v / norm);
}

export function useBriefings({
  setStatusMsg,
  isGeneratingRef,
  ensureAllEmbeddings,
  loadArticles,
  onBeforeBriefingChange,
}) {
  const [preset, setPreset] = useState('7D');
  const [startDate, setStartDate] = useState(() =>
    formatDateInput(new Date(Date.now() - 7 * 86400000))
  );
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()));

  const [briefings, setBriefings] = useState([]);
  const [activeBriefingId, setActiveBriefingId] = useState(null);
  const [briefing, setBriefing] = useState('');
  const [userNotes, setUserNotes] = useState('');
  const [notesStatus, setNotesStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const saveTimerRef = useRef(null);
  const latestNotesRef = useRef({ id: null, text: '' });

  async function loadBriefings(selectLatest = false) {
    const all = await db.briefings.orderBy('createdAt').reverse().toArray();
    setBriefings(all);
    if (all.length > 0 && (selectLatest || !activeBriefingId)) {
      const target = all[0];
      setActiveBriefingId(target.id);
      setBriefing(target.summaryMarkdown || '');
      setUserNotes(target.userNotes || '');
    }
    return all;
  }

  useEffect(() => {
    loadBriefings(true);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function applyPreset(label, days) {
    setPreset(label);
    setEndDate(formatDateInput(new Date()));
    setStartDate(formatDateInput(new Date(Date.now() - days * 86400000)));
  }

  function updateCustomDate(which, value) {
    setPreset('CUSTOM');
    if (which === 'start') setStartDate(value);
    else setEndDate(value);
  }

  async function persistNotesNow(id, text, summaryMarkdown) {
    if (!id) return;
    setNotesStatus('Saving...');
    try {
      const embedSource = [summaryMarkdown, text].filter(Boolean).join('\n\n');
      const embedding = embedSource ? await generateEmbedding(embedSource) : null;
      await db.briefings.update(id, { userNotes: text, embedding });
      setBriefings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, userNotes: text, embedding } : b))
      );
      setNotesStatus('Saved');
    } catch (err) {
      console.error('Failed to save briefing notes:', err);
      await db.briefings.update(id, { userNotes: text });
      setNotesStatus('Saved');
    }
  }

  function handleNotesChange(rawText) {
    const clamped = truncateToMaxWords(rawText);
    setUserNotes(clamped);
    setNotesStatus('Unsaved...');
    latestNotesRef.current = { id: activeBriefingId, text: clamped };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persistNotesNow(activeBriefingId, clamped, briefing);
    }, 650);
  }

  async function flushNotes() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const { id, text } = latestNotesRef.current;
    if (id && id === activeBriefingId) {
      await persistNotesNow(id, text, briefing);
    }
  }

  function openBriefing(target) {
    if (!target) return;
    onBeforeBriefingChange?.();
    setActiveBriefingId(target.id);
    setBriefing(target.summaryMarkdown || '');
    setUserNotes(target.userNotes || '');
    setNotesStatus('');
    latestNotesRef.current = { id: target.id, text: target.userNotes || '' };
  }

  function selectBriefingById(idStr) {
    const target = briefings.find((b) => String(b.id) === String(idStr));
    openBriefing(target);
  }

  async function buildWindowArticlesWithArchiveLinks() {
    const windowArticles = await getArticlesInDateRange(startDate, endDate);
    const enriched = windowArticles.map((a) => ({
      ...a,
      digest: [
        a.digest || a.content?.slice(0, 600) || '',
        a.userNotes ? `User Note: ${a.userNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }));

    const allMeta = await loadArticleMetadataList();
    await ensureAllEmbeddings(allMeta);
    const refreshedMeta = await loadArticleMetadataList();

    const windowIds = new Set(windowArticles.map((a) => a.id));
    const windowVectors = refreshedMeta
      .filter((a) => windowIds.has(a.id) && Array.isArray(a.embedding))
      .map((a) => a.embedding);

    const centroid = averageVectors(windowVectors);
    let archiveConnections = [];
    if (centroid) {
      archiveConnections = refreshedMeta
        .filter((a) => !windowIds.has(a.id) && Array.isArray(a.embedding))
        .map((a) => ({
          ...a,
          score: cosineSimilarity(centroid, a.embedding),
        }))
        .filter((a) => a.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    }

    return { windowArticles, enriched, archiveConnections };
  }

  async function generateNewBriefing() {
    if (isGenerating) return;
    isGeneratingRef.current = true;
    setIsGenerating(true);
    onBeforeBriefingChange?.();

    try {
      setStatusMsg('Gathering articles and semantic connections...');
      const { windowArticles, enriched, archiveConnections } =
        await buildWindowArticlesWithArchiveLinks();

      if (windowArticles.length === 0) {
        setStatusMsg(`No saved articles found between ${startDate} and ${endDate}.`);
        return;
      }

      setStatusMsg(`Synthesizing ${windowArticles.length} post(s) with Gemini Nano...`);
      let summaryMarkdown = await synthesizeBriefing(enriched, `${startDate} to ${endDate}`);

      if (archiveConnections.length > 0) {
        const archiveLines = archiveConnections
          .map(
            (a) =>
              `- [${a.title}](${a.url}) *(${Math.round(a.score * 100)}% semantic match${
                a.userNotes ? ` — Note: ${a.userNotes.slice(0, 90)}` : ''
              })*`
          )
          .join('\n');
        summaryMarkdown += `\n\n### From Your Archive\n${archiveLines}`;
      }

      const embedding = await generateEmbedding(summaryMarkdown);
      const newId = await db.briefings.add({
        createdAt: Date.now(),
        startDate,
        endDate,
        summaryMarkdown,
        userNotes: '',
        embedding,
      });

      await loadBriefings(false);
      await loadArticles();
      setActiveBriefingId(newId);
      setBriefing(summaryMarkdown);
      setUserNotes('');
      setNotesStatus('');
      latestNotesRef.current = { id: newId, text: '' };
      setStatusMsg('Briefing ready.');
    } catch (err) {
      console.error('Briefing generation error:', err);
      setStatusMsg('Briefing error: ' + err.message);
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }

  async function copyPromptFallback() {
    const { windowArticles, enriched } = await buildWindowArticlesWithArchiveLinks();
    if (windowArticles.length === 0) {
      setStatusMsg(`No saved articles found between ${startDate} and ${endDate}.`);
      return;
    }
    const prompt = buildBriefingPrompt(enriched, `${startDate} to ${endDate}`);
    await navigator.clipboard.writeText(prompt);
    setStatusMsg(`Copied synthesis prompt for ${windowArticles.length} post(s) to clipboard.`);
  }

  async function ensureBriefingEmbeddings() {
    const all = await db.briefings.toArray();
    for (const b of all) {
      const embedSource = [b.summaryMarkdown, b.userNotes].filter(Boolean).join('\n\n');
      if (!b.embedding && embedSource) {
        try {
          const embedding = await generateEmbedding(embedSource);
          await db.briefings.update(b.id, { embedding });
        } catch (err) {
          console.error('Briefing embedding error:', err);
        }
      }
    }
  }

  async function exportMarkdown() {
    if (!briefing) return;

    const activeRecord = briefings.find((b) => b.id === activeBriefingId);
    const winStart = activeRecord?.startDate || startDate;
    const winEnd = activeRecord?.endDate || endDate;
    const windowArticles = await getArticlesInDateRange(winStart, winEnd);
    const annotatedCount = windowArticles.filter((a) => (a.userNotes || '').trim()).length;

    const frontmatter = [
      '---',
      `title: "Synapse-Read Briefing (${winStart} to ${winEnd})"`,
      `date_range: "${winStart} to ${winEnd}"`,
      `exported_at: "${new Date().toISOString()}"`,
      `articles_count: ${windowArticles.length}`,
      `annotated_posts_count: ${annotatedCount}`,
      '---',
      '',
    ].join('\n');

    const sections = [frontmatter, briefing.trim()];

    if (userNotes.trim()) {
      sections.push(`\n## My Briefing Reflections\n\n${userNotes.trim()}`);
    }

    if (windowArticles.length > 0) {
      const postLines = windowArticles.map((art) => {
        const lines = [`- **[${art.title}](${art.url})** *(${new Date(art.savedAt).toLocaleDateString()})*`];
        if (art.digest) {
          lines.push(`  - **Digest:** ${art.digest.trim()}`);
        }
        if ((art.userNotes || '').trim()) {
          const formattedNote = art.userNotes
            .trim()
            .split('\n')
            .map((l) => `  > ${l}`)
            .join('\n');
          lines.push(`  > **My Note:**\n${formattedNote}`);
        }
        return lines.join('\n');
      });

      sections.push(
        `\n## Saved Posts & Attached Notes (${winStart} to ${winEnd})\n\n${postLines.join('\n\n')}`
      );
    }

    const mdContent = sections.join('\n') + '\n';
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synapse-read-briefing-${winStart}-to-${winEnd}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Exported Markdown with post notes.');
  }

  return {
    preset,
    startDate,
    endDate,
    briefings,
    activeBriefingId,
    briefing,
    userNotes,
    notesStatus,
    isGenerating,
    loadBriefings,
    applyPreset,
    updateCustomDate,
    generateNewBriefing,
    copyPromptFallback,
    handleNotesChange,
    flushNotes,
    selectBriefingById,
    openBriefing,
    exportMarkdown,
    ensureBriefingEmbeddings,
  };
}
EOF

# 6. src/sidepanel/components/ArticleCard.jsx — Per-post note editor + metadata-only check
cat << 'EOF' > src/sidepanel/components/ArticleCard.jsx
import React, { useEffect, useState } from 'react';

export function ArticleCard({
  item,
  isFetching,
  relatedArticles,
  onFetchAndDigest,
  onSaveNotes,
  onToggleRelated,
  onDelete,
}) {
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.userNotes || '');

  useEffect(() => {
    setNoteDraft(item.userNotes || '');
  }, [item.userNotes]);

  const isReadingList = item.source === 'chrome-reading-list';
  const hasContent = item.hasContent ?? Boolean(item.content);
  const hasNote = Boolean((item.userNotes || '').trim());
  const nodeAccent = item.digest
    ? 'var(--sage)'
    : isReadingList
      ? 'var(--ochre)'
      : 'var(--terracotta)';

  async function commitNote() {
    await onSaveNotes(item, noteDraft);
  }

  return (
    <div
      className="sr-card"
      style={{
        '--accent': nodeAccent,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span className="sr-node-tag">
          <i className="sr-node-dot" />
          {isReadingList ? 'leaf:reading-list' : 'leaf:article'}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'var(--ink-muted)' }}>
          {new Date(item.savedAt).toLocaleDateString()}
        </span>
      </div>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        style={{
          fontWeight: 750,
          fontSize: '13px',
          color: 'var(--ink)',
          textDecoration: 'none',
          lineHeight: 1.35,
        }}
      >
        {item.title}
      </a>

      {item.digest ? (
        <p style={{ fontSize: '11.5px', color: 'var(--ink-muted)', margin: 0, lineHeight: 1.45 }}>
          {item.digest}
        </p>
      ) : hasContent ? (
        <p
          style={{
            fontSize: '11px',
            color: 'var(--ink-muted)',
            fontStyle: 'italic',
            margin: 0,
          }}
        >
          Generating digest...
        </p>
      ) : null}

      {!isEditingNote && hasNote && (
        <div
          onClick={() => setIsEditingNote(true)}
          title="Click to edit note"
          style={{
            padding: '6px 8px',
            background: '#FDF7E7',
            border: '1px solid var(--ochre)',
            borderRadius: '6px',
            fontSize: '11px',
            color: 'var(--ink)',
            lineHeight: 1.4,
            cursor: 'pointer',
            whiteSpace: 'pre-wrap',
          }}
        >
          <span
            className="sr-node-tag"
            style={{ '--accent': 'var(--ochre)', display: 'block', marginBottom: '2px' }}
          >
            <i className="sr-node-dot" /> note
          </span>
          {item.userNotes}
        </div>
      )}

      {isEditingNote && (
        <div
          style={{
            padding: '7px 8px',
            background: 'var(--paper)',
            border: '1px dashed var(--ochre)',
            borderRadius: '7px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="sr-node-tag" style={{ '--accent': 'var(--ochre)' }}>
              <i className="sr-node-dot" /> post note (searchable)
            </span>
            <button
              type="button"
              onClick={async () => {
                await commitNote();
                setIsEditingNote(false);
              }}
              className="sr-pill"
            >
              Done
            </button>
          </div>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            onKeyDown={async (e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                await commitNote();
                setIsEditingNote(false);
              }
            }}
            placeholder="Jot down why you saved this link, key quotes, or ideas..."
            rows={3}
            autoFocus
            className="sr-textarea"
            style={{ width: '100%', padding: '6px 7px', fontSize: '11.5px', resize: 'vertical' }}
          />
        </div>
      )}

      <div
        style={{
          fontSize: '10.5px',
          color: 'var(--ink-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '6px',
          paddingTop: '4px',
          borderTop: '1px dashed var(--line)',
        }}
      >
        <span style={{ fontFamily: 'monospace' }}>{item.status}</span>
        <div style={{ display: 'flex', gap: '9px', flexShrink: 0 }}>
          {!hasContent && (
            <button
              onClick={() => onFetchAndDigest(item)}
              disabled={isFetching}
              className="sr-link-btn"
              style={{ color: 'var(--sage)' }}
            >
              {isFetching ? 'Fetching...' : 'Fetch & Digest'}
            </button>
          )}
          <button
            onClick={async () => {
              if (isEditingNote) {
                await commitNote();
              }
              setIsEditingNote((prev) => !prev);
            }}
            className="sr-link-btn"
            style={{ color: 'var(--ochre)' }}
          >
            {isEditingNote ? 'Close Note' : hasNote ? 'Edit Note' : '+ Note'}
          </button>
          <button
            onClick={() => onToggleRelated(item)}
            className="sr-link-btn"
            style={{ color: 'var(--periwinkle)' }}
          >
            {relatedArticles ? 'Hide Related' : 'Related'}
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="sr-link-btn"
            style={{ color: 'var(--terracotta)' }}
          >
            Remove
          </button>
        </div>
      </div>

      {relatedArticles && (
        <div
          style={{
            marginTop: '4px',
            padding: '7px 8px',
            background: 'var(--paper)',
            border: '1px dashed var(--periwinkle)',
            borderRadius: '7px',
            fontSize: '11px',
          }}
        >
          {relatedArticles.length === 0 ? (
            <span style={{ color: 'var(--ink-muted)' }}>No strong connections found yet.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span className="sr-node-tag" style={{ '--accent': 'var(--periwinkle)' }}>
                <i className="sr-node-dot" /> connected synapses
              </span>
              {relatedArticles.map((rel) => (
                <div key={rel.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                  <a
                    href={rel.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: 'var(--ink)',
                      fontWeight: 600,
                      textDecoration: 'underline',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {rel.title}
                  </a>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      color: 'var(--sage)',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {Math.round(rel.score * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
EOF

# 7. src/sidepanel/App.jsx — Wire onSaveNotes & seamless merge status
cat << 'EOF' > src/sidepanel/App.jsx
import React, { useEffect, useRef, useState } from 'react';
import './theme.css';
import {
  ensurePersistentStorage,
  exportArchiveJSON,
  importArchiveJSON,
} from '../db.js';
import { checkNanoStatus, warmupNanoModel } from '../ai/nano.js';
import { formatDateInput } from './utils/formatters.js';
import { useSpeechBriefing } from './hooks/useSpeechBriefing.js';
import { useArticles } from './hooks/useArticles.js';
import { useBriefings } from './hooks/useBriefings.js';
import { useSemanticSearch } from './hooks/useSemanticSearch.js';
import { Header } from './components/Header.jsx';
import { AboutPanel } from './components/AboutPanel.jsx';
import { BriefingPanel } from './components/BriefingPanel.jsx';
import { SearchSection } from './components/SearchSection.jsx';
import { ArticleCard } from './components/ArticleCard.jsx';

export default function App() {
  const [statusMsg, setStatusMsg] = useState('');
  const [nanoStatus, setNanoStatus] = useState({ summarizer: 'checking', prompt: 'checking' });
  const [showAbout, setShowAbout] = useState(false);
  const isGeneratingRef = useRef(false);

  function setBackgroundStatus(msg) {
    if (!isGeneratingRef.current) {
      setStatusMsg(msg);
    }
  }

  useEffect(() => {
    ensurePersistentStorage();
    checkNanoStatus().then(setNanoStatus);
  }, []);

  const speech = useSpeechBriefing();

  const articlesHook = useArticles({
    setStatusMsg,
    setBackgroundStatus,
  });

  const briefingsHook = useBriefings({
    setStatusMsg,
    isGeneratingRef,
    ensureAllEmbeddings: articlesHook.ensureAllEmbeddings,
    loadArticles: articlesHook.loadArticles,
    onBeforeBriefingChange: speech.stop,
  });

  const search = useSemanticSearch({
    articles: articlesHook.articles,
    ensureAllEmbeddings: articlesHook.ensureAllEmbeddings,
    ensureBriefingEmbeddings: briefingsHook.ensureBriefingEmbeddings,
    setStatusMsg,
  });

  async function handleExportJSON() {
    const json = await exportArchiveJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synapse-read-backup-${formatDateInput(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Full archive backup exported.');
  }

  async function handleImportJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importArchiveJSON(text);
      await articlesHook.loadArticles();
      await briefingsHook.loadBriefings();
      setStatusMsg(
        `Archive merged: +${res.addedArticles} new, ${res.mergedArticles} merged post(s); +${res.addedBriefings} new, ${res.mergedBriefings} merged synthesis(es).`
      );
    } catch (err) {
      console.error(err);
      setStatusMsg('Import failed: ' + err.message);
    } finally {
      e.target.value = '';
    }
  }

  async function handleWarmupNano() {
    try {
      await warmupNanoModel(setStatusMsg);
      const updated = await checkNanoStatus();
      setNanoStatus(updated);
      setStatusMsg('Gemini Nano downloaded and ready for offline briefings!');
    } catch (err) {
      console.error(err);
      setStatusMsg('Model download error: ' + err.message);
    }
  }

  const nanoReady = nanoStatus.prompt !== 'unavailable';

  return (
    <div className="sr-shell">
      <Header
        nanoReady={nanoReady}
        showAbout={showAbout}
        onToggleAbout={() => setShowAbout((prev) => !prev)}
        onSyncList={() => articlesHook.syncReadingList(false)}
        onBackup={handleExportJSON}
        onRestore={handleImportJSON}
      />

      {!showAbout && nanoStatus.prompt === 'downloadable' && (
        <div
          className="sr-card"
          style={{
            '--accent': 'var(--ochre)',
            background: '#FDF7E7',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11.5px',
          }}
        >
          <div>
            <div className="sr-node-tag" style={{ marginBottom: '2px' }}>
              <i className="sr-node-dot" /> setup:warmup
            </div>
            <div style={{ color: 'var(--ink)' }}>
              Download Gemini Nano once so briefings run fast offline.
            </div>
          </div>
          <button
            onClick={handleWarmupNano}
            className="sr-btn"
            style={{ background: 'var(--ochre)', color: '#FFFDF9', flexShrink: 0, fontSize: '11px', padding: '5px 9px' }}
          >
            Download AI
          </button>
        </div>
      )}

      {showAbout ? (
        <AboutPanel
          articleCount={articlesHook.articles.length}
          briefingCount={briefingsHook.briefings.length}
          nanoStatus={nanoStatus}
          onClose={() => setShowAbout(false)}
        />
      ) : (
        <>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => articlesHook.saveActiveTab('content')}
              className="sr-btn sr-btn-primary"
              style={{ flex: 1 }}
            >
              + Save Content
            </button>
            <button
              onClick={() => articlesHook.saveActiveTab('bookmark')}
              className="sr-btn sr-btn-secondary"
              style={{ flex: 1 }}
            >
              Save Link Only
            </button>
          </div>

          <BriefingPanel
            nanoReady={nanoReady}
            statusMsg={statusMsg}
            briefingsHook={briefingsHook}
            speech={speech}
          />

          <SearchSection
            search={search}
            onOpenBriefing={briefingsHook.openBriefing}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {search.visibleArticles.map((item) => (
              <ArticleCard
                key={item.id}
                item={item}
                isFetching={!!articlesHook.fetchingMap[item.id]}
                relatedArticles={articlesHook.relatedMap[item.id]}
                onFetchAndDigest={articlesHook.fetchAndDigest}
                onSaveNotes={articlesHook.saveArticleNotes}
                onToggleRelated={articlesHook.toggleRelated}
                onDelete={articlesHook.deleteArticle}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
EOF

# 8. docs/index.html — Risograph knowledge-graph page with updated leaves
cat << 'EOF' > docs/index.html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Synapse-Read — Local-First Knowledge Graph for Chrome</title>
  <style>
    :root {
      --paper: #F6F4EF;
      --paper-dot: #D5D0C5;
      --card: #FFFDF9;
      --ink: #1E1D1A;
      --ink-muted: #5C5952;
      --line: #C7C1B5;

      --terracotta: #E05A47;
      --ochre: #D99B26;
      --sage: #3D7A5D;
      --periwinkle: #4C6EF5;
      --plum: #9C528B;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background-color: var(--paper);
      background-image: radial-gradient(var(--paper-dot) 1.15px, transparent 1.15px);
      background-size: 22px 22px;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
      line-height: 1.55;
      padding: 36px 20px 80px;
    }

    .graph-wrapper {
      position: relative;
      max-width: 960px;
      margin: 0 auto;
    }

    #graph-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }

    .edge-primary {
      fill: none;
      stroke: var(--ink);
      stroke-width: 1.6;
      stroke-opacity: 0.28;
      transition: stroke 0.25s ease, stroke-width 0.25s ease, stroke-opacity 0.25s ease;
    }

    .edge-semantic {
      fill: none;
      stroke: var(--ink-muted);
      stroke-width: 1.3;
      stroke-dasharray: 4 5;
      stroke-opacity: 0.24;
      transition: stroke 0.25s ease, stroke-width 0.25s ease, stroke-opacity 0.25s ease;
    }

    .edge-primary.active,
    .edge-semantic.active {
      stroke-opacity: 1;
      stroke-width: 2.4;
    }

    .hub-container {
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: center;
      margin-bottom: 56px;
    }

    .hub-card {
      background: var(--card);
      border: 1.75px solid var(--ink);
      border-radius: 16px;
      box-shadow: 4px 4px 0 var(--ink);
      padding: 24px 28px;
      max-width: 560px;
      width: 100%;
      text-align: center;
      position: relative;
    }

    .hub-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--ink-muted);
      background: var(--paper);
      border: 1px solid var(--ink);
      border-radius: 999px;
      padding: 2px 10px;
      margin-bottom: 10px;
    }

    .hub-title-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 6px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.025em;
    }

    .hub-tagline {
      margin: 0 auto 18px;
      max-width: 440px;
      font-size: 14.5px;
      color: var(--ink-muted);
    }

    .hub-actions {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn-download {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--terracotta);
      color: #FFFDF9;
      border: 1.5px solid var(--ink);
      box-shadow: 2.5px 2.5px 0 var(--ink);
      border-radius: 9px;
      padding: 9px 16px;
      font-size: 13.5px;
      font-weight: 700;
      text-decoration: none;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }

    .btn-download:hover {
      transform: translate(-1px, -1px);
      box-shadow: 3.5px 3.5px 0 var(--ink);
    }

    .btn-story {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--paper);
      color: var(--ink);
      border: 1.5px solid var(--ink);
      box-shadow: 2.5px 2.5px 0 var(--ink);
      border-radius: 9px;
      padding: 9px 15px;
      font-size: 13.5px;
      font-weight: 600;
      text-decoration: none;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }

    .btn-story:hover {
      transform: translate(-1px, -1px);
      box-shadow: 3.5px 3.5px 0 var(--ink);
    }

    .hub-port {
      position: absolute;
      bottom: -8px;
      left: 50%;
      transform: translateX(-50%);
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--ink);
      border: 2.5px solid var(--card);
    }

    .cluster-label {
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: center;
      margin: 12px 0 26px;
    }

    .cluster-label span {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: var(--ink-muted);
      letter-spacing: 0.04em;
    }

    .leaf-grid {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 96px;
      row-gap: 28px;
      align-items: start;
      margin-bottom: 40px;
    }

    .leaf-card {
      --accent: var(--sage);
      background: var(--card);
      border: 1.5px solid var(--ink);
      border-radius: 14px;
      box-shadow: 3px 3px 0 var(--ink);
      padding: 18px 20px;
      position: relative;
      transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.25s ease;
    }

    .leaf-card:nth-child(even) {
      margin-top: 34px;
    }

    .leaf-card:hover,
    .leaf-card.is-focused {
      transform: translate(-2px, -2px);
      box-shadow: 5px 5px 0 var(--accent);
      border-color: var(--ink);
    }

    .leaf-card.is-dimmed {
      opacity: 0.45;
    }

    .leaf-card.is-connected {
      opacity: 1;
      border-color: var(--accent);
    }

    .leaf-port {
      position: absolute;
      top: 24px;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: var(--accent);
      border: 2px solid var(--ink);
    }

    .leaf-card:nth-child(odd) .leaf-port {
      right: -7.5px;
    }

    .leaf-card:nth-child(even) .leaf-port {
      left: -7.5px;
    }

    .leaf-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
    }

    .leaf-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      color: var(--accent);
    }

    .leaf-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      display: inline-block;
    }

    .leaf-links-hint {
      color: var(--ink-muted);
      font-size: 10.5px;
    }

    .leaf-card h2 {
      margin: 0 0 8px;
      font-size: 16.5px;
      font-weight: 750;
      letter-spacing: -0.015em;
    }

    .leaf-card p {
      margin: 0;
      font-size: 13.5px;
      color: var(--ink-muted);
    }

    .leaf-list {
      margin: 6px 0 0;
      padding-left: 16px;
      font-size: 13px;
      color: var(--ink-muted);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .leaf-list li::marker {
      color: var(--accent);
    }

    .chip {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      font-weight: 600;
      background: var(--paper);
      border: 1px solid var(--ink);
      border-radius: 5px;
      padding: 0 6px;
      color: var(--ink);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 1px 5px;
      color: var(--ink);
      word-break: break-all;
    }

    .btn-copy {
      background: var(--paper);
      color: var(--ink);
      border: 1px solid var(--ink);
      border-radius: 5px;
      padding: 2px 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
    }

    .btn-copy:hover {
      background: var(--ink);
      color: var(--card);
    }

    .diag-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 6px;
      font-size: 12px;
      margin-top: 6px;
    }

    .status-ok { color: var(--sage); font-weight: 700; font-family: monospace; }
    .status-warn { color: var(--terracotta); font-weight: 700; font-family: monospace; }

    .flag-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
    }

    .drop-note {
      margin-top: 10px;
      padding: 8px 10px;
      border: 1.5px dashed var(--terracotta);
      border-radius: 8px;
      background: rgba(224, 90, 71, 0.06);
      font-size: 12px;
      color: var(--ink);
      transition: background 0.15s ease;
    }

    .drop-note.dragover {
      background: rgba(224, 90, 71, 0.18);
    }

    @media (max-width: 760px) {
      .leaf-grid {
        grid-template-columns: 1fr;
        padding-left: 26px;
        row-gap: 20px;
      }
      .leaf-card:nth-child(even) {
        margin-top: 0;
      }
      .leaf-card:nth-child(odd) .leaf-port,
      .leaf-card:nth-child(even) .leaf-port {
        left: -7.5px;
        right: auto;
      }
    }
  </style>
</head>
<body>
  <div id="graph-wrapper" class="graph-wrapper">
    <svg id="graph-svg" aria-hidden="true"></svg>

    <header class="hub-container">
      <div class="hub-card" id="hub-node">
        <div class="hub-badge">
          <span>&#9679; local-first knowledge graph</span>
          <span>&middot;</span>
          <span>mv3</span>
        </div>
        <div class="hub-title-row">
          <svg viewBox="0 0 128 128" width="36" height="36" aria-hidden="true">
            <rect x="4" y="4" width="120" height="120" rx="26" fill="#1E1D1A" />
            <g stroke="#D99B26" stroke-width="3" stroke-opacity="0.55" stroke-linecap="round">
              <line x1="34" y1="36" x2="94" y2="38" />
              <line x1="30" y1="88" x2="96" y2="86" />
              <line x1="34" y1="36" x2="96" y2="86" />
            </g>
            <g stroke="#E05A47" stroke-width="4.5" stroke-linecap="round">
              <line x1="34" y1="36" x2="64" y2="64" />
              <line x1="94" y1="38" x2="64" y2="64" />
              <line x1="30" y1="88" x2="64" y2="64" />
              <line x1="96" y1="86" x2="64" y2="64" />
            </g>
            <circle cx="34" cy="36" r="6" fill="#E05A47" />
            <circle cx="94" cy="38" r="6" fill="#D99B26" />
            <circle cx="30" cy="88" r="6" fill="#3D7A5D" />
            <circle cx="96" cy="86" r="6" fill="#4C6EF5" />
            <circle cx="64" cy="64" r="9" fill="#FFFDF9" />
          </svg>
          <h1>Synapse-Read</h1>
        </div>
        <p class="hub-tagline">
          Capture articles, attach per-post notes, and link forgotten ideas across 10,000+ reads—100% locally inside Chrome.
        </p>
        <div class="hub-actions">
          <a class="btn-download" href="./synapse-read.zip" download="synapse-read.zip">
            &#11015; Download synapse-read.zip
          </a>
          <a class="btn-story" href="./story.html">
            &#9654; 2-Min Story
          </a>
        </div>
        <div id="hub-port" class="hub-port"></div>
      </div>
    </header>

    <div class="cluster-label">
      <span>branch // 01 &mdash; setup &amp; local runtime</span>
    </div>

    <div class="leaf-grid">
      <article
        class="leaf-card"
        data-leaf="install"
        data-links="runtime,warmup"
        style="--accent: var(--terracotta);"
      >
        <div class="leaf-port"></div>
        <div class="leaf-meta">
          <span class="leaf-tag"><i class="leaf-dot"></i> node:install</span>
          <span class="leaf-links-hint">zero-build</span>
        </div>
        <h2>Drag &amp; Drop into Chrome</h2>
        <ol class="leaf-list">
          <li>Unzip <code>synapse-read.zip</code> to get the <code>synapse-read</code> folder.</li>
          <li>
            Open <code>chrome://extensions</code>
            <button class="btn-copy" data-copy="chrome://extensions">Copy</button>
            and toggle <strong>Developer mode</strong> ON.
          </li>
          <li>Drag the unzipped folder onto the <code>chrome://extensions</code> tab.</li>
        </ol>
        <div id="drop-zone" class="drop-note">
          Drop your unzipped folder onto the <strong>chrome://extensions</strong> tab (browsers block direct installs from web pages).
        </div>
      </article>

      <article
        class="leaf-card"
        data-leaf="runtime"
        data-links="install,warmup,briefings"
        style="--accent: var(--ochre);"
      >
        <div class="leaf-port"></div>
        <div class="leaf-meta">
          <span class="leaf-tag"><i class="leaf-dot"></i> node:on-device-ai</span>
          <span class="leaf-links-hint">live browser check</span>
        </div>
        <h2>Gemini Nano &amp; WASM Check</h2>
        <div class="diag-row">
          <span>Summarizer API</span>
          <span id="status-summarizer">Checking...</span>
        </div>
        <div class="diag-row">
          <span>Prompt API (Nano)</span>
          <span id="status-prompt">Checking...</span>
        </div>
        <div class="diag-row">
          <span>MiniLM-L6-v2 Embeddings</span>
          <span class="status-ok">bundled</span>
        </div>
        <p style="margin-top: 10px; font-size: 12px;">
          If either API says <em>Flags Required</em>, enable these in Desktop Chrome and relaunch:
        </p>
        <div class="flag-item">
          <code>chrome://flags/#optimization-guide-on-device-model</code>
          <button class="btn-copy" data-copy="chrome://flags/#optimization-guide-on-device-model">Copy</button>
        </div>
        <div class="flag-item">
          <code>chrome://flags/#prompt-api-for-gemini-nano</code>
          <button class="btn-copy" data-copy="chrome://flags/#prompt-api-for-gemini-nano">Copy</button>
        </div>
        <div class="flag-item">
          <code>chrome://flags/#summarization-api-for-gemini-nano</code>
          <button class="btn-copy" data-copy="chrome://flags/#summarization-api-for-gemini-nano">Copy</button>
        </div>
      </article>
    </div>

    <div class="cluster-label">
      <span>branch // 02 &mdash; reading &amp; synthesis workflow (hover any leaf to trace links)</span>
    </div>

    <div class="leaf-grid">
      <article
        class="leaf-card"
        data-leaf="warmup"
        data-links="runtime,capture"
        style="--accent: var(--ochre);"
      >
        <div class="leaf-port"></div>
        <div class="leaf-meta">
          <span class="leaf-tag"><i class="leaf-dot"></i> leaf:01 &middot; warmup</span>
          <span class="leaf-links-hint">one-time</span>
        </div>
        <h2>Cache Offline Model Weights</h2>
        <p>
          Pin <strong>Synapse-Read</strong> to your toolbar and open the Side Panel. Click <span class="chip">Download AI</span> on the setup banner once so Gemini Nano caches locally on disk—every briefing after runs completely offline.
        </p>
      </article>

      <article
        class="leaf-card"
        data-leaf="capture"
        data-links="warmup,search,briefings,export"
        style="--accent: var(--terracotta);"
      >
        <div class="leaf-port"></div>
        <div class="leaf-meta">
          <span class="leaf-tag"><i class="leaf-dot"></i> leaf:02 &middot; ingest &amp; annotate</span>
          <span class="leaf-links-hint">readability + notes</span>
        </div>
        <h2>Capture, Sync &amp; Annotate</h2>
        <ul class="leaf-list">
          <li><span class="chip">Save Content</span> extracts clean prose and auto-generates a TL;DR digest + 384-dim vector.</li>
          <li><span class="chip">Sync List</span> &amp; <span class="chip">Fetch &amp; Digest</span> import and hydrate Chrome Reading List links in the background.</li>
          <li><span class="chip">+ Note</span> attaches searchable personal annotations to any saved post or bookmark.</li>
        </ul>
      </article>

      <article
        class="leaf-card"
        data-leaf="search"
        data-links="capture,briefings,reflect"
        style="--accent: var(--sage);"
      >
        <div class="leaf-port"></div>
        <div class="leaf-meta">
          <span class="leaf-tag"><i class="leaf-dot"></i> leaf:03 &middot; graph-recall</span>
          <span class="leaf-links-hint">10,000+ post scale</span>
        </div>
        <h2>Trace Related Synapses</h2>
        <ul class="leaf-list">
          <li>Click <span class="chip">Related</span> on any card to surface conceptually similar reads—weighted by both digests and your attached post notes.</li>
          <li>Query <strong>Semantic Search</strong> across posts, post notes, and briefing reflections, or click <span class="chip">Open</span> on matching notes.</li>
        </ul>
      </article>

      <article
        class="leaf-card"
        data-leaf="briefings"
        data-links="capture,search,reflect"
        style="--accent: var(--periwinkle);"
      >
        <div class="leaf-port"></div>
        <div class="leaf-meta">
          <span class="leaf-tag"><i class="leaf-dot"></i> leaf:04 &middot; synthesize</span>
          <span class="leaf-links-hint">7D / 14D / 30D</span>
        </div>
        <h2>Generate Date-Range Briefings</h2>
        <p>
          Pick <span class="chip">7D</span>, <span class="chip">14D</span>, <span class="chip">30D</span>, or a custom range and click <span class="chip">Generate Briefing</span>. Nano distills top takeaways with inline citations and surfaces a <strong>From Your Archive</strong> bridge to older related reads.
        </p>
      </article>

      <article
        class="leaf-card"
        data-leaf="reflect"
        data-links="briefings,search,export"
        style="--accent: var(--periwinkle);"
      >
        <div class="leaf-port"></div>
        <div class="leaf-meta">
          <span class="leaf-tag"><i class="leaf-dot"></i> leaf:05 &middot; voice &amp; notes</span>
          <span class="leaf-links-hint">1,000-word limit</span>
        </div>
        <h2>Listen &amp; Write Reflections</h2>
        <ul class="leaf-list">
          <li>Click <span class="chip">Listen</span> and pick a natural system voice for offline audio narration.</li>
          <li>Jot up to <strong>1,000 words</strong> in <strong>My Notes &amp; Reflections</strong>—notes auto-save and auto-index into your semantic search graph.</li>
        </ul>
      </article>

      <article
        class="leaf-card"
        data-leaf="export"
        data-links="reflect,capture"
        style="--accent: var(--plum);"
      >
        <div class="leaf-port"></div>
        <div class="leaf-meta">
          <span class="leaf-tag"><i class="leaf-dot"></i> leaf:06 &middot; portability</span>
          <span class="leaf-links-hint">.md + merge .json</span>
        </div>
        <h2>Export Markdown &amp; Merge Backups</h2>
        <ul class="leaf-list">
          <li><span class="chip">Export .md</span> exports the briefing, your reflections, <em>and</em> all saved posts with their attached notes for that date window.</li>
          <li><span class="chip">Backup</span> &amp; <span class="chip">Restore</span> seamlessly merge <code>.json</code> archives—deduplicating URLs, keeping hydrated text, and combining distinct notes with <code>---</code>.</li>
        </ul>
      </article>
    </div>
  </div>

  <script>
    document.querySelectorAll('.btn-copy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const text = btn.getAttribute('data-copy');
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = orig; }, 1400);
      });
    });

    const dropZone = document.getElementById('drop-zone');
    ['dragover', 'drop'].forEach((evt) => {
      window.addEventListener(evt, (e) => e.preventDefault());
    });
    dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      dropZone.classList.remove('dragover');
      const name = e.dataTransfer?.files?.[0]?.name || 'your folder';
      dropZone.innerHTML = `Detected <strong>${name}</strong> — drop it onto your <code>chrome://extensions</code> tab (with Developer mode ON) to install.`;
    });

    async function checkAI() {
      const sumEl = document.getElementById('status-summarizer');
      const prmEl = document.getElementById('status-prompt');

      try {
        if ('Summarizer' in self) {
          const avail = await self.Summarizer.availability();
          sumEl.textContent = avail;
          sumEl.className = avail === 'unavailable' ? 'status-warn' : 'status-ok';
        } else {
          sumEl.textContent = 'flags required';
          sumEl.className = 'status-warn';
        }
      } catch {
        sumEl.textContent = 'flags required';
        sumEl.className = 'status-warn';
      }

      try {
        if ('LanguageModel' in self) {
          const avail = await self.LanguageModel.availability({
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
          });
          prmEl.textContent = avail;
          prmEl.className = avail === 'unavailable' ? 'status-warn' : 'status-ok';
        } else {
          prmEl.textContent = 'flags required';
          prmEl.className = 'status-warn';
        }
      } catch {
        prmEl.textContent = 'flags required';
        prmEl.className = 'status-warn';
      }
    }
    checkAI();

    const wrapper = document.getElementById('graph-wrapper');
    const svg = document.getElementById('graph-svg');
    const hubPort = document.getElementById('hub-port');
    const leafCards = Array.from(document.querySelectorAll('.leaf-card'));

    function getCenter(el, rootRect) {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - rootRect.left + r.width / 2,
        y: r.top - rootRect.top + r.height / 2,
      };
    }

    function drawGraphEdges() {
      const rootRect = wrapper.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${rootRect.width} ${rootRect.height}`);
      svg.innerHTML = '';

      const hubPt = getCenter(hubPort, rootRect);
      const isMobile = window.innerWidth <= 760;
      const spineX = isMobile ? 16 : rootRect.width / 2;

      const portMap = {};
      const accentMap = {};

      leafCards.forEach((card) => {
        const id = card.getAttribute('data-leaf');
        const port = card.querySelector('.leaf-port');
        portMap[id] = getCenter(port, rootRect);
        accentMap[id] = getComputedStyle(card).getPropertyValue('--accent').trim();
      });

      let lowestY = hubPt.y;
      leafCards.forEach((card) => {
        const id = card.getAttribute('data-leaf');
        const pt = portMap[id];
        if (pt.y > lowestY) lowestY = pt.y;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const midX = (spineX + pt.x) / 2;
        const d = `M ${spineX} ${pt.y - 26} C ${spineX} ${pt.y}, ${midX} ${pt.y}, ${pt.x} ${pt.y}`;
        path.setAttribute('d', d);
        path.setAttribute('class', 'edge-primary');
        path.setAttribute('data-from', 'hub');
        path.setAttribute('data-to', id);
        path.setAttribute('data-accent', accentMap[id]);
        svg.appendChild(path);

        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', spineX);
        dot.setAttribute('cy', pt.y - 26);
        dot.setAttribute('r', '3.5');
        dot.setAttribute('fill', '#1E1D1A');
        dot.setAttribute('fill-opacity', '0.35');
        svg.appendChild(dot);
      });

      const spine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const spineD = isMobile
        ? `M ${hubPt.x} ${hubPt.y} C ${hubPt.x} ${hubPt.y + 30}, ${spineX} ${hubPt.y + 10}, ${spineX} ${hubPt.y + 48} L ${spineX} ${lowestY - 26}`
        : `M ${hubPt.x} ${hubPt.y} L ${spineX} ${lowestY - 26}`;
      spine.setAttribute('d', spineD);
      spine.setAttribute('class', 'edge-primary');
      svg.appendChild(spine);

      const drawnPairs = new Set();
      leafCards.forEach((card) => {
        const fromId = card.getAttribute('data-leaf');
        const links = (card.getAttribute('data-links') || '').split(',').filter(Boolean);
        const p1 = portMap[fromId];

        links.forEach((toId) => {
          const pairKey = [fromId, toId].sort().join('--');
          if (drawnPairs.has(pairKey) || !portMap[toId]) return;
          drawnPairs.add(pairKey);

          const p2 = portMap[toId];
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const ctrlX = (p1.x + p2.x) / 2 + (isMobile ? 28 : 0);
          const ctrlY = (p1.y + p2.y) / 2;
          const d = `M ${p1.x} ${p1.y} Q ${ctrlX} ${ctrlY}, ${p2.x} ${p2.y}`;
          path.setAttribute('d', d);
          path.setAttribute('class', 'edge-semantic');
          path.setAttribute('data-from', fromId);
          path.setAttribute('data-to', toId);
          path.setAttribute('data-accent', accentMap[fromId]);
          svg.appendChild(path);
        });
      });
    }

    function highlightLeaf(activeId) {
      const allEdges = svg.querySelectorAll('path');
      if (!activeId) {
        leafCards.forEach((c) => c.classList.remove('is-focused', 'is-connected', 'is-dimmed'));
        allEdges.forEach((e) => {
          e.classList.remove('active');
          e.style.stroke = '';
        });
        return;
      }

      const activeCard = leafCards.find((c) => c.getAttribute('data-leaf') === activeId);
      const neighbors = new Set(
        (activeCard?.getAttribute('data-links') || '').split(',').filter(Boolean)
      );
      const activeAccent = getComputedStyle(activeCard).getPropertyValue('--accent').trim();

      leafCards.forEach((c) => {
        const id = c.getAttribute('data-leaf');
        c.classList.remove('is-focused', 'is-connected', 'is-dimmed');
        if (id === activeId) c.classList.add('is-focused');
        else if (neighbors.has(id)) c.classList.add('is-connected');
        else c.classList.add('is-dimmed');
      });

      allEdges.forEach((edge) => {
        const from = edge.getAttribute('data-from');
        const to = edge.getAttribute('data-to');
        const touches = from === activeId || to === activeId;
        edge.classList.toggle('active', touches);
        edge.style.stroke = touches ? activeAccent : '';
      });
    }

    leafCards.forEach((card) => {
      const id = card.getAttribute('data-leaf');
      card.addEventListener('mouseenter', () => highlightLeaf(id));
      card.addEventListener('mouseleave', () => highlightLeaf(null));
      card.addEventListener('click', () => {
        const already = card.classList.contains('is-focused');
        highlightLeaf(already ? null : id);
      });
    });

    window.addEventListener('resize', drawGraphEdges);
    if ('ResizeObserver' in window) {
      new ResizeObserver(drawGraphEdges).observe(wrapper);
    }
    drawGraphEdges();
  </script>
</body>
</html>
EOF

# 9. README.md — Updated with per-post notes, .md post notes export, 10k+ scaling, & merge restore
cat << 'EOF' > README.md
# Synapse-Read

A local-first, privacy-focused Chrome Side Panel extension (Manifest V3) that captures web articles, attaches per-post annotations, maps semantic connections across 10,000+ saved reads, and synthesizes date-range briefings—with zero external servers, cloud tokens, or telemetry.

---

## Core Architecture & Privacy Guardrails

* **100% Local Storage & High-Scale Cursor Streaming:** Articles, digests, per-post notes, 384-dimension vector embeddings, and briefings persist locally in IndexedDB via `Dexie.js` (`SynapseReadDB` v3) with `navigator.storage.persist()` and `unlimitedStorage` enabled. Article lists stream via a Dexie cursor (`loadArticleMetadataList`) so full article bodies are never held in React state, scaling smoothly to 10,000+ saved posts.
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

# 2. (Optional) Repackage pre-built zip for GitHub Pages (docs/synapse-read.zip)
rm -rf /tmp/synapse-read docs/synapse-read.zip && \
cp -R dist /tmp/synapse-read && \
(cd /tmp && zip -r "$OLDPWD/docs/synapse-read.zip" synapse-read)