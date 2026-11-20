import Dexie from 'dexie';

export const db = new Dexie('SynapseReadDB');

db.version(1).stores({
    articles: '++id, &url, status, savedAt, source, *tags',
});

db.version(2).stores({
    articles: '++id, &url, status, savedAt, source, *tags',
    briefings: '++id, createdAt, startDate, endDate',
});

export async function ensurePersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        const persisted = await navigator.storage.persisted();
        if (!persisted) {
            await navigator.storage.persist();
        }
    }
}
export async function exportArchiveJSON() {
    const articles = await db.articles.toArray();
    const briefings = db.briefings ? await db.briefings.toArray() : [];
    return JSON.stringify(
        {
            app: 'synapse-read',
            version: 2,
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
    if (!Array.isArray(data.articles)) {
        throw new Error('Invalid Synapse-Read archive file.');
    }

    let addedArticles = 0;
    let updatedArticles = 0;

    for (const raw of data.articles) {
        const { id, ...record } = raw;
        if (!record.url) continue;

        const existing = await db.articles.where('url').equals(record.url).first();
        if (existing) {
            await db.articles.update(existing.id, {
                ...record,
                digest: record.digest || existing.digest,
                content: record.content || existing.content,
                embedding: record.embedding || existing.embedding,
            });
            updatedArticles++;
        } else {
            await db.articles.add(record);
            addedArticles++;
        }
    }

    let addedBriefings = 0;
    if (db.briefings && Array.isArray(data.briefings)) {
        const existingBriefings = await db.briefings.toArray();
        const seenKeys = new Set(
            existingBriefings.map((b) => `${b.createdAt}_${b.startDate}_${b.endDate}`)
        );

        for (const rawB of data.briefings) {
            const { id, ...bRecord } = rawB;
            const key = `${bRecord.createdAt}_${bRecord.startDate}_${bRecord.endDate}`;
            if (!seenKeys.has(key)) {
                await db.briefings.add(bRecord);
                seenKeys.add(key);
                addedBriefings++;
            }
        }
    }

    return { addedArticles, updatedArticles, addedBriefings };
}