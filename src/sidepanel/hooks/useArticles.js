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
