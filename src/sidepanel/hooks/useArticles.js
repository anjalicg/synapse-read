import { useEffect, useState } from 'react';
import { Readability } from '@mozilla/readability';
import {
  db,
  loadArticleMetadataList,
  updateArticleNotes,
  recordTombstone,
} from '../../db.js';
import { summarizeArticle, resetNanoSessions } from '../../ai/nano.js';
import { generateEmbedding, cosineSimilarity } from '../../ai/embeddings.js';
import {
  syncChromeReadingList,
  subscribeReadingListChanges,
} from '../../sync/readingList.js';

function detectPaywallOrBlockedContent(text) {
  const clean = (text || '').trim();
  if (!clean || clean.length < 220) {
    return 'Full article text was not accessible (the site may require a subscription or JavaScript login).';
  }
  const headAndTail = (clean.slice(0, 800) + ' ' + clean.slice(-800)).toLowerCase();
  const paywallSignals = [
    'subscribe to continue reading',
    'subscribe now to read',
    'already a subscriber',
    'sign in to continue reading',
    'log in to continue reading',
    'create a free account to continue',
    'reached your article limit',
    'unlock this article',
    'for unlimited access',
  ];
  if (clean.length < 1200 && paywallSignals.some((sig) => headAndTail.includes(sig))) {
    return 'Full article text appears blocked by a subscription paywall.';
  }
  return null;
}

function withTimeout(promise, ms, timeoutMessage) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timerId));
}

function buildArticleEmbeddingText(item) {
  return [item.title, item.digest, item.userNotes].filter(Boolean).join('\n\n');
}

export function useArticles({ setStatusMsg, setBackgroundStatus, onArchiveMutated }) {
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

  async function runBackgroundDigest(id, title, content, userNotes = '', batchPrefix = '') {
    const blockedReason = detectPaywallOrBlockedContent(content);
    if (blockedReason) {
      const friendlyNote = `Saved link only — ${blockedReason} Tip: paste an excerpt via + Note or use + Scan Page.`;
      await db.articles.update(id, {
        digest: friendlyNote,
        status: 'saved',
        updatedAt: Date.now(),
      });
      await loadArticles();
      setStatusMsg(friendlyNote);
      setBackgroundStatus('');
      if (onArchiveMutated) onArchiveMutated();
      return;
    }

    try {
      setBackgroundStatus(`${batchPrefix}Generating digest... 5% (~5s left)`);
      const digest = await withTimeout(
        summarizeArticle(content, ({ message }) => {
          setBackgroundStatus(`${batchPrefix}${message}`);
        }),
        25000,
        'On-device summary timed out (page may be gated or too complex).'
      );
      setBackgroundStatus(`${batchPrefix}Indexing semantic vector (~1s left)...`);
      const textToEmbed = [title, digest, userNotes].filter(Boolean).join('\n\n');
      const embedding = await generateEmbedding(textToEmbed);
      await db.articles.update(id, {
        digest,
        embedding,
        status: 'digested',
        updatedAt: Date.now(),
      });
      await loadArticles();
      setBackgroundStatus('Digest & semantic index ready.');
      if (onArchiveMutated) onArchiveMutated();
    } catch (err) {
      console.error('Background digest fallback:', err);
      resetNanoSessions();
      const fallbackDigest = `Saved post — ${err.message || 'could not summarize automatically'}. You can add highlights via + Note.`;
      try {
        const fallbackText = [title, content.slice(0, 1200), userNotes]
          .filter(Boolean)
          .join('\n\n');
        const embedding = fallbackText ? await generateEmbedding(fallbackText) : null;
        await db.articles.update(id, {
          digest: fallbackDigest,
          status: 'saved',
          updatedAt: Date.now(),
          ...(embedding ? { embedding } : {}),
        });
      } catch {
        await db.articles.update(id, {
          digest: fallbackDigest,
          status: 'saved',
          updatedAt: Date.now(),
        });
      }
      await loadArticles();
      setStatusMsg(fallbackDigest);
      setBackgroundStatus('');
      if (onArchiveMutated) onArchiveMutated();
    }
  }

  // Resumes interrupted digests AND enriches book scans / notes synced from mobile
  async function enrichPendingArticles(metadataList) {
    const pending = (metadataList || []).filter(
      (item) => item.hasContent && !item.digest && (item.status === 'digesting' || item.source === 'book-scan' || item.source === 'sync')
    );
    if (pending.length === 0) return;

    setBackgroundStatus(`Digesting ${pending.length} item(s)...`);
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const prefix = pending.length > 1 ? `[${i + 1}/${pending.length}] ` : '';
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
    }
  }

  useEffect(() => {
    loadArticles().then((list) => enrichPendingArticles(list));
    syncReadingList(true);
    const unsubscribe = subscribeReadingListChanges(() => syncReadingList(true));
    return () => unsubscribe();
  }, []);

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
      setStatusMsg('Already saved in Afterword.');
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

    const now = Date.now();
    const id = await db.articles.add({
      url: tab.url,
      title,
      content,
      digest: '',
      userNotes: '',
      embedding: null,
      savedAt: now,
      updatedAt: now,
      status: mode === 'content' && content ? 'digesting' : 'saved',
      source: 'extension',
    });

    await loadArticles();

    if (mode === 'content') {
      if (!content) {
        const msg = 'Saved bookmark — page text could not be extracted (likely paywalled or script-gated).';
        await db.articles.update(id, { digest: msg });
        await loadArticles();
        setStatusMsg(msg);
        if (onArchiveMutated) onArchiveMutated();
      } else {
        runBackgroundDigest(id, title, content, '');
      }
    } else {
      setStatusMsg('Bookmark saved.');
      if (onArchiveMutated) onArchiveMutated();
    }
  }

  async function saveScannedExcerpt({ title, content, userNotes = '' }) {
    const now = Date.now();
    const url = `afterword://book-scan/${now}`;
    const id = await db.articles.add({
      url,
      title,
      content,
      digest: '',
      userNotes,
      embedding: null,
      savedAt: now,
      updatedAt: now,
      status: 'digesting',
      source: 'book-scan',
    });

    await loadArticles();
    runBackgroundDigest(id, title, content, userNotes);
  }

  async function saveArticleNotes(item, rawNotes) {
    const trimmed = (rawNotes || '').trim();
    if (trimmed === (item.userNotes || '').trim()) return;

    await updateArticleNotes(item.id, trimmed);
    await db.articles.update(item.id, { updatedAt: Date.now() });

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
    if (onArchiveMutated) onArchiveMutated();
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
        updatedAt: Date.now(),
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
    const existing = await db.articles.get(id);
    if (existing?.url) {
      recordTombstone(existing.url);
    }
    await db.articles.delete(id);
    setRelatedMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await loadArticles();
    if (onArchiveMutated) onArchiveMutated();
  }

  return {
    articles,
    fetchingMap,
    relatedMap,
    loadArticles,
    enrichPendingArticles,
    syncReadingList,
    ensureAllEmbeddings,
    saveActiveTab,
    saveScannedExcerpt,
    saveArticleNotes,
    fetchAndDigest,
    toggleRelated,
    deleteArticle,
  };
}
