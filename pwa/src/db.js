import Dexie from 'dexie';

export const db = new Dexie('AfterwordMobileDB');

db.version(1).stores({
  articles: '++id, &url, savedAt, updatedAt, status, source',
  briefings: '++id, &syncKey, createdAt, startDate, endDate',
});

const TOMBSTONE_KEY = 'afterword:pwa:tombstones';

function loadTombstones() {
  try {
    return JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function recordTombstone(key) {
  if (!key) return;
  const map = loadTombstones();
  map[key] = Date.now();
  localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(map));
}

export async function exportSyncArchiveJSON() {
  const articles = await db.articles.toArray();
  const briefings = await db.briefings.toArray();
  const tombstones = loadTombstones();

  return JSON.stringify({
    app: 'Afterword',
    version: 2,
    exportedAt: new Date().toISOString(),
    tombstones,
    articles: articles.map(({ id, ...rest }) => ({
      ...rest,
      updatedAt: rest.updatedAt || rest.savedAt || Date.now(),
    })),
    briefings: briefings.map(({ id, ...rest }) => ({
      ...rest,
      syncKey: rest.syncKey || `${rest.startDate}_${rest.endDate}_${rest.createdAt}`,
      updatedAt: rest.updatedAt || rest.createdAt || Date.now(),
    })),
  });
}

export async function mergeRemoteSyncArchive(jsonText) {
  const payload = JSON.parse(jsonText);
  const localTombstones = loadTombstones();
  const remoteTombstones = payload.tombstones || {};
  const mergedTombstones = { ...localTombstones };

  for (const [key, ts] of Object.entries(remoteTombstones)) {
    mergedTombstones[key] = Math.max(mergedTombstones[key] || 0, Number(ts) || 0);
  }
  localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(mergedTombstones));

  const localArticles = await db.articles.toArray();
  const localByUrl = new Map(localArticles.map((a) => [a.url, a]));

  for (const local of localArticles) {
    const deletedAt = mergedTombstones[local.url];
    if (deletedAt && deletedAt > (local.updatedAt || local.savedAt || 0)) {
      await db.articles.delete(local.id);
      localByUrl.delete(local.url);
    }
  }

  for (const remote of payload.articles || []) {
    if (!remote.url) continue;
    const remoteUpdated = remote.updatedAt || remote.savedAt || 0;
    const deletedAt = mergedTombstones[remote.url];
    if (deletedAt && deletedAt >= remoteUpdated) continue;

    const existing = localByUrl.get(remote.url);
    if (!existing) {
      await db.articles.add({
        url: remote.url,
        title: remote.title || remote.url,
        content: remote.content || '',
        digest: remote.digest || '',
        userNotes: remote.userNotes || '',
        savedAt: remote.savedAt || Date.now(),
        updatedAt: remoteUpdated || Date.now(),
        status: remote.status || (remote.digest ? 'digested' : 'saved'),
        source: remote.source || 'sync',
      });
    } else {
      const localUpdated = existing.updatedAt || existing.savedAt || 0;
      if (
        remoteUpdated > localUpdated ||
        (remote.digest && !existing.digest) ||
        (remote.content && !existing.content)
      ) {
        await db.articles.update(existing.id, {
          title: remoteUpdated > localUpdated ? remote.title || existing.title : existing.title,
          content: existing.content || remote.content || '',
          digest: remote.digest || existing.digest || '',
          userNotes: remoteUpdated > localUpdated ? remote.userNotes ?? existing.userNotes : existing.userNotes,
          status: remote.digest || existing.digest ? 'digested' : existing.status,
          updatedAt: Math.max(localUpdated, remoteUpdated),
        });
      }
    }
  }

  const localBriefings = await db.briefings.toArray();
  const localBriefingMap = new Map(localBriefings.map((b) => [b.syncKey, b]));

  for (const local of localBriefings) {
    const deletedAt = mergedTombstones[local.syncKey];
    if (deletedAt && deletedAt > (local.updatedAt || local.createdAt || 0)) {
      await db.briefings.delete(local.id);
      localBriefingMap.delete(local.syncKey);
    }
  }

  for (const remote of payload.briefings || []) {
    const key = remote.syncKey || `${remote.startDate}_${remote.endDate}_${remote.createdAt}`;
    const remoteUpdated = remote.updatedAt || remote.createdAt || 0;
    const deletedAt = mergedTombstones[key];
    if (deletedAt && deletedAt >= remoteUpdated) continue;

    const existing = localBriefingMap.get(key);
    if (!existing) {
      await db.briefings.add({
        ...remote,
        syncKey: key,
        updatedAt: remoteUpdated || Date.now(),
      });
    } else if (remoteUpdated > (existing.updatedAt || existing.createdAt || 0)) {
      await db.briefings.update(existing.id, {
        ...remote,
        syncKey: key,
        updatedAt: remoteUpdated,
      });
    }
  }
}
