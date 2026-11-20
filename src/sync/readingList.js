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
