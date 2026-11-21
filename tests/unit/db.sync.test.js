import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  exportArchiveJSON,
  importArchiveJSON,
  exportSyncArchiveJSON,
  mergeRemoteSyncArchive,
  recordTombstone,
} from '../../src/db.js';

describe('Archive Storage, Sync Reconciliation & Tombstones', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.articles.clear();
    await db.briefings.clear();
  });

  it('merges remote articles while preserving local AI digests and newer notes', async () => {
    await db.articles.add({
      url: 'https://example.com/post-1',
      title: 'Post 1',
      content: 'Full local body text',
      digest: 'Local Gemini Nano TL;DR',
      userNotes: 'Old note',
      embedding: [0.1, 0.2, 0.3],
      savedAt: 1000,
      updatedAt: 1000,
      status: 'digested',
    });

    const remoteArchive = JSON.stringify({
      version: 1,
      articles: [
        {
          url: 'https://example.com/post-1',
          title: 'Post 1 Updated on Mobile',
          content: '',
          digest: '',
          userNotes: 'Newer mobile note',
          savedAt: 1000,
          updatedAt: 2000,
        },
        {
          url: 'afterword://book-scan/3000',
          title: 'Blindsight p. 42',
          content: 'Scanned OCR passage',
          digest: '',
          userNotes: 'Great quote',
          savedAt: 3000,
          updatedAt: 3000,
          source: 'book-scan',
        },
      ],
      briefings: [],
      tombstones: {},
    });

    await mergeRemoteSyncArchive(remoteArchive);

    const all = await db.articles.toArray();
    expect(all).toHaveLength(2);

    const post1 = all.find((a) => a.url === 'https://example.com/post-1');
    expect(post1.title).toBe('Post 1 Updated on Mobile');
    expect(post1.userNotes).toBe('Newer mobile note');
    expect(post1.digest).toBe('Local Gemini Nano TL;DR');
    expect(post1.content).toBe('Full local body text');
  });

  it('prevents deleted items from resurrecting via tombstones', async () => {
    const url = 'https://example.com/deleted-item';
    const id = await db.articles.add({
      url,
      title: 'To Be Deleted',
      content: 'Body',
      savedAt: 1000,
      updatedAt: 1000,
      status: 'saved',
    });

    recordTombstone(url);
    await db.articles.delete(id);

    const staleRemote = JSON.stringify({
      version: 1,
      articles: [{ url, title: 'To Be Deleted', savedAt: 1000, updatedAt: 1000 }],
      briefings: [],
      tombstones: {},
    });

    await mergeRemoteSyncArchive(staleRemote);
    const remaining = await db.articles.where('url').equals(url).first();
    expect(remaining).toBeUndefined();
  });

  it('round-trips offline JSON backup and restore without Google Drive', async () => {
    await db.articles.add({
      url: 'https://example.com/offline-item',
      title: 'Offline Article',
      content: 'Saved locally',
      digest: 'Digest text',
      userNotes: 'Margin reflection',
      savedAt: 5000,
      updatedAt: 5000,
      status: 'digested',
    });

    const jsonBackup = await exportArchiveJSON();
    await db.articles.clear();
    expect(await db.articles.count()).toBe(0);

    await importArchiveJSON(jsonBackup);
    const restored = await db.articles.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0].title).toBe('Offline Article');
    expect(restored[0].userNotes).toBe('Margin reflection');
  });
});
