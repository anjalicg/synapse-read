import { db } from '../db.js';

/**
 * Pulls unread/saved entries from Chrome's built-in Reading List (including mobile sync)
 * into local IndexedDB without creating duplicates.
 */
export async function syncChromeReadingList() {
    if (!chrome?.readingList?.query) return 0;

    const entries = await chrome.readingList.query({});
    let importedCount = 0;

    for (const entry of entries) {
        if (!entry.url?.startsWith('http')) continue;

        const existing = await db.articles.where('url').equals(entry.url).first();
        if (!existing) {
            await db.articles.add({
                url: entry.url,
                title: entry.title || entry.url,
                content: '',
                digest: '',
                status: entry.hasBeenRead ? 'read' : 'unread',
                savedAt: entry.creationTime || Date.now(),
                source: 'chrome-reading-list',
                tags: [],
            });
            importedCount++;
        }
    }

    return importedCount;
}