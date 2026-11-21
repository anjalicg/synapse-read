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
