import Dexie from 'dexie';
import { createSyncEngine } from '@shared/db/syncEngine.js';

export const db = new Dexie('AfterwordMobileDB');

db.version(1).stores({
  articles: '++id, &url, savedAt, updatedAt, status, source',
  briefings: '++id, &syncKey, createdAt, startDate, endDate',
});

export const {
  recordTombstone,
  exportSyncArchiveJSON,
  mergeRemoteSyncArchive,
} = createSyncEngine({
  db,
  tombstoneKey: 'afterword:pwa:tombstones',
  hasEmbeddings: false,
});
