const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const SYNC_FILENAME = 'afterword-sync.json';
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

async function driveFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearCachedDriveToken();
    throw new Error('Drive session expired. Click Sync Drive to reconnect.');
  }
  return res;
}

async function findSyncFile(accessToken) {
  const q = encodeURIComponent(`name='${SYNC_FILENAME}' and trashed=false`);
  const res = await driveFetch(
    `${DRIVE_FILES_URL}?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`,
    accessToken
  );
  if (!res.ok) throw new Error(`Drive search failed (${res.status})`);
  const data = await res.json();
  return data.files?.[0] || null;
}

export async function pullDriveSyncFile(accessToken) {
  const file = await findSyncFile(accessToken);
  if (!file) return null;

  const res = await driveFetch(`${DRIVE_FILES_URL}/${file.id}?alt=media`, accessToken);
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return {
    fileId: file.id,
    modifiedTime: file.modifiedTime,
    jsonText: await res.text(),
  };
}

export async function pushDriveSyncFile(accessToken, jsonText, existingFileId = null) {
  if (existingFileId) {
    const res = await driveFetch(`${DRIVE_UPLOAD_URL}/${existingFileId}?uploadType=media`, accessToken, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: jsonText,
    });
    if (!res.ok) throw new Error(`Drive update failed (${res.status})`);
    return res.json();
  }

  const boundary = 'afterword_sync_boundary';
  const metadata = JSON.stringify({
    name: SYNC_FILENAME,
    mimeType: 'application/json',
  });

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    jsonText,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await driveFetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive create failed (${res.status})`);
  return res.json();
}
