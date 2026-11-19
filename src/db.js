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