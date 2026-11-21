cat << 'SCRIPT_EOF' > /tmp/refactor-p2.sh
set -e

# 1. Backup current trees
rm -rf /tmp/afterword-refactor-p2 && mkdir -p /tmp/afterword-refactor-p2
cp -R src pwa shared tests /tmp/afterword-refactor-p2/

# 2. Create @shared/db/syncEngine.js
mkdir -p shared/db shared/sync

cat << 'EOF' > shared/db/syncEngine.js
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
EOF

# 3. Create @shared/sync/driveClient.js
cat << 'EOF' > shared/sync/driveClient.js
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const SYNC_FILENAME = 'afterword-sync.json';

async function driveFetch(url, accessToken, options = {}, onUnauthorized = null) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error('Drive session expired. Click Sync Drive to reconnect.');
  }
  return res;
}

export async function pullDriveSyncFile(accessToken, { onUnauthorized } = {}) {
  const q = encodeURIComponent(`name='${SYNC_FILENAME}' and trashed=false`);
  const listRes = await driveFetch(
    `${DRIVE_FILES_URL}?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`,
    accessToken,
    {},
    onUnauthorized
  );
  if (!listRes.ok) throw new Error(`Drive search failed (${listRes.status})`);
  const data = await listRes.json();
  const file = data.files?.[0];
  if (!file) return null;

  const res = await driveFetch(`${DRIVE_FILES_URL}/${file.id}?alt=media`, accessToken, {}, onUnauthorized);
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return {
    fileId: file.id,
    modifiedTime: file.modifiedTime,
    jsonText: await res.text(),
  };
}

export async function pushDriveSyncFile(accessToken, jsonText, existingFileId = null, { onUnauthorized } = {}) {
  if (existingFileId) {
    const res = await driveFetch(
      `${DRIVE_UPLOAD_URL}/${existingFileId}?uploadType=media`,
      accessToken,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: jsonText,
      },
      onUnauthorized
    );
    if (!res.ok) throw new Error(`Drive update failed (${res.status})`);
    return res.json();
  }

  const boundary = 'afterword_sync_boundary';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: SYNC_FILENAME, mimeType: 'application/json' }),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    jsonText,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await driveFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
    onUnauthorized
  );
  if (!res.ok) throw new Error(`Drive create failed (${res.status})`);
  return res.json();
}

export async function extractTextViaDriveOCR(accessToken, file, { onUnauthorized } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const boundary = 'afterword_ocr_boundary';
  const header = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({ name: `afterword-ocr-${Date.now()}`, mimeType: 'application/vnd.google-apps.document' }),
    `\r\n--${boundary}\r\n`,
    'Content-Type: image/jpeg\r\n\r\n',
  ].join('');

  const multipart = new Blob([header, jpegBlob, `\r\n--${boundary}--`], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const upRes = await driveFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`,
    accessToken,
    { method: 'POST', body: multipart },
    onUnauthorized
  );
  if (!upRes.ok) throw new Error(`OCR upload failed (${upRes.status})`);
  const { id: tempId } = await upRes.json();

  try {
    const expRes = await driveFetch(
      `${DRIVE_FILES_URL}/${tempId}/export?mimeType=text/plain`,
      accessToken,
      {},
      onUnauthorized
    );
    if (!expRes.ok) throw new Error(`OCR export failed (${expRes.status})`);
    return (await expRes.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  } finally {
    fetch(`${DRIVE_FILES_URL}/${tempId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }
}
EOF

# 4. Refactor pwa/src/db.js, src/db.js, pwa/src/googleDrive.js, and src/sync/googleDrive.js to consume @shared
cat << 'EOF' > pwa/src/db.js
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
EOF

node --input-type=module << 'EOF'
import fs from 'node:fs';

let extDb = fs.readFileSync('src/db.js', 'utf8');
const syncStart = extDb.indexOf("const TOMBSTONE_KEY = 'afterword:tombstones';");
if (syncStart === -1) throw new Error('Could not find TOMBSTONE_KEY in src/db.js');

extDb =
  `import { createSyncEngine } from '@shared/db/syncEngine.js';\n` +
  extDb.slice(0, syncStart) +
  `export const {\n  recordTombstone,\n  exportSyncArchiveJSON,\n  mergeRemoteSyncArchive,\n} = createSyncEngine({\n  db,\n  tombstoneKey: 'afterword:tombstones',\n  hasEmbeddings: true,\n});\n`;

fs.writeFileSync('src/db.js', extDb, 'utf8');
console.log('Switched src/db.js to @shared/db/syncEngine.js');
EOF

cat << 'EOF' > pwa/src/googleDrive.js
import {
  DRIVE_SCOPE,
  pullDriveSyncFile,
  pushDriveSyncFile,
  extractTextViaDriveOCR,
} from '@shared/sync/driveClient.js';

export { pullDriveSyncFile, pushDriveSyncFile, extractTextViaDriveOCR };

export function requestMobileDriveToken(clientId) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity script still loading. Try again in a moment.'));
      return;
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.access_token);
        }
      },
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}
EOF

cat << 'EOF' > src/sync/googleDrive.js
import {
  DRIVE_SCOPE,
  pullDriveSyncFile as sharedPullDriveSyncFile,
  pushDriveSyncFile as sharedPushDriveSyncFile,
} from '@shared/sync/driveClient.js';

const TOKEN_CACHE_KEY = 'afterword:driveToken';

function getCachedToken() {
  try {
    const raw = localStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.accessToken && parsed.expiresAt > Date.now() + 60_000) {
      return parsed.accessToken;
    }
  } catch {
    // ignore invalid cache
  }
  return null;
}

function setCachedToken(accessToken, expiresInSec = 3500) {
  localStorage.setItem(
    TOKEN_CACHE_KEY,
    JSON.stringify({
      accessToken,
      expiresAt: Date.now() + Number(expiresInSec) * 1000,
    })
  );
}

export function clearCachedDriveToken() {
  localStorage.removeItem(TOKEN_CACHE_KEY);
}

export async function getExtensionDriveToken(clientId, interactive = true) {
  if (!clientId) {
    throw new Error('Set your Google OAuth Client ID first.');
  }

  const cached = getCachedToken();
  if (cached) return cached;

  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', DRIVE_SCOPE);
  authUrl.searchParams.set('prompt', interactive ? 'consent' : 'none');

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive,
  });

  if (!responseUrl) {
    throw new Error('Google sign-in was cancelled.');
  }

  const hashParams = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  const accessToken = hashParams.get('access_token');
  const expiresIn = hashParams.get('expires_in') || 3500;

  if (!accessToken) {
    throw new Error(hashParams.get('error') || 'No access token returned.');
  }

  setCachedToken(accessToken, expiresIn);
  return accessToken;
}

export function pullDriveSyncFile(accessToken) {
  return sharedPullDriveSyncFile(accessToken, { onUnauthorized: clearCachedDriveToken });
}

export function pushDriveSyncFile(accessToken, jsonText, existingFileId = null) {
  return sharedPushDriveSyncFile(accessToken, jsonText, existingFileId, {
    onUnauthorized: clearCachedDriveToken,
  });
}
EOF

# 5. Rebuild extension zip + run full npm run verify (auto-rollback if anything fails)
set +e
npm run build && \
rm -rf /tmp/afterword docs/afterword.zip && \
cp -R dist /tmp/afterword && \
(cd /tmp && zip -r "$OLDPWD/docs/afterword.zip" afterword) && \
cp -f docs/afterword.zip pwa/public/afterword.zip && \
npm run verify

STATUS=$?
if [ $STATUS -eq 0 ]; then
  git add -A && \
  git commit -m "Extract @shared syncEngine and Google Drive client across extension and PWA" && \
  git push origin main
else
  rm -rf src pwa shared tests && \
  cp -R /tmp/afterword-refactor-p2/* . && \
  echo "Verification failed — restored clean Phase 1 backup. Check test-results.log."
  exit $STATUS
fi
SCRIPT_EOF
bash /tmp/refactor-p2.sh