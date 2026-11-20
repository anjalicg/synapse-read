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
