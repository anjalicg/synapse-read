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
