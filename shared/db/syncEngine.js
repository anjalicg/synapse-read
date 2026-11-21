export function createSyncEngine({ db, tombstoneKey, hasEmbeddings = false }) {
  function loadTombstones() {
    try {
      return JSON.parse(localStorage.getItem(tombstoneKey) || '{}');
    } catch {
      return {};
    }
  }

  function recordTombstone(key) {
    if (!key) return;
    const map = loadTombstones();
    map[key] = Date.now();
    localStorage.setItem(tombstoneKey, JSON.stringify(map));
  }

  async function exportSyncArchiveJSON() {
    const articles = await db.articles.toArray();
    const briefings = await db.briefings.toArray();
    const tombstones = loadTombstones();

    return JSON.stringify({
      app: 'Afterword',
      version: 2,
      exportedAt: new Date().toISOString(),
      tombstones,
      articles: articles.map(({ id, embedding, ...rest }) => ({
        ...rest,
        updatedAt: rest.updatedAt || rest.savedAt || Date.now(),
      })),
      briefings: briefings.map(({ id, embedding, ...rest }) => ({
        ...rest,
        syncKey: rest.syncKey || `${rest.startDate}_${rest.endDate}_${rest.createdAt}`,
        updatedAt: rest.updatedAt || rest.createdAt || Date.now(),
      })),
    });
  }

  async function mergeRemoteSyncArchive(jsonText) {
    const payload = JSON.parse(jsonText);
    const localTombstones = loadTombstones();
    const remoteTombstones = payload.tombstones || {};
    const mergedTombstones = { ...localTombstones };

    for (const [key, ts] of Object.entries(remoteTombstones)) {
      mergedTombstones[key] = Math.max(mergedTombstones[key] || 0, Number(ts) || 0);
    }
    localStorage.setItem(tombstoneKey, JSON.stringify(mergedTombstones));

    let addedArticles = 0;
    let updatedArticles = 0;
    let addedBriefings = 0;
    let updatedBriefings = 0;

    // Apply tombstones to local articles
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
          ...(hasEmbeddings ? { embedding: null } : {}),
          savedAt: remote.savedAt || Date.now(),
          updatedAt: remoteUpdated || Date.now(),
          status: remote.status || (remote.digest ? 'digested' : 'saved'),
          source: remote.source || 'sync',
        });
        addedArticles++;
      } else {
        const localUpdated = existing.updatedAt || existing.savedAt || 0;
        const mergedNotes =
          remoteUpdated > localUpdated
            ? remote.userNotes ?? existing.userNotes
            : existing.userNotes || remote.userNotes || '';
        const mergedDigest = existing.digest || remote.digest || '';
        const mergedContent = existing.content || remote.content || '';
        const textChanged =
          mergedNotes !== (existing.userNotes || '') ||
          mergedDigest !== (existing.digest || '');

        if (
          remoteUpdated > localUpdated ||
          mergedNotes !== (existing.userNotes || '') ||
          mergedDigest !== (existing.digest || '') ||
          mergedContent !== (existing.content || '')
        ) {
          await db.articles.update(existing.id, {
            title: remoteUpdated > localUpdated ? remote.title || existing.title : existing.title,
            content: mergedContent,
            digest: mergedDigest,
            userNotes: mergedNotes,
            status: mergedDigest ? 'digested' : existing.status,
            updatedAt: Math.max(localUpdated, remoteUpdated),
            ...(hasEmbeddings && textChanged ? { embedding: null } : {}),
          });
          updatedArticles++;
        }
      }
    }

    // Merge briefings
    const localBriefings = await db.briefings.toArray();
    const localBriefingMap = new Map(
      localBriefings.map((b) => [b.syncKey || `${b.startDate}_${b.endDate}_${b.createdAt}`, b])
    );

    for (const local of localBriefings) {
      const key = local.syncKey || `${local.startDate}_${local.endDate}_${local.createdAt}`;
      const deletedAt = mergedTombstones[key];
      if (deletedAt && deletedAt > (local.updatedAt || local.createdAt || 0)) {
        await db.briefings.delete(local.id);
        localBriefingMap.delete(key);
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
          ...(hasEmbeddings ? { embedding: null } : {}),
          updatedAt: remoteUpdated || Date.now(),
        });
        addedBriefings++;
      } else {
        const localUpdated = existing.updatedAt || existing.createdAt || 0;
        if (remoteUpdated > localUpdated && (remote.userNotes || '') !== (existing.userNotes || '')) {
          await db.briefings.update(existing.id, {
            userNotes: remote.userNotes || '',
            updatedAt: remoteUpdated,
            ...(hasEmbeddings ? { embedding: null } : {}),
          });
          updatedBriefings++;
        }
      }
    }

    return { addedArticles, updatedArticles, addedBriefings, updatedBriefings };
  }

  return {
    recordTombstone,
    exportSyncArchiveJSON,
    mergeRemoteSyncArchive,
  };
}
