const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const SYNC_FILENAME = 'afterword-sync.json';

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

export async function pullDriveSyncFile(accessToken) {
  const q = encodeURIComponent(`name='${SYNC_FILENAME}' and trashed=false`);
  const listRes = await fetch(
    `${DRIVE_FILES_URL}?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) throw new Error(`Drive search failed (${listRes.status})`);
  const data = await listRes.json();
  const file = data.files?.[0];
  if (!file) return null;

  const res = await fetch(`${DRIVE_FILES_URL}/${file.id}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return { fileId: file.id, jsonText: await res.text() };
}

export async function pushDriveSyncFile(accessToken, jsonText, existingFileId = null) {
  if (existingFileId) {
    const res = await fetch(`${DRIVE_UPLOAD_URL}/${existingFileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: jsonText,
    });
    if (!res.ok) throw new Error(`Drive update failed (${res.status})`);
    return res.json();
  }

  const boundary = 'afterword_pwa_boundary';
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

  const res = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive create failed (${res.status})`);
  return res.json();
}

export async function extractTextViaDriveOCR(accessToken, file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const boundary = 'afterword_mobile_ocr';
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

  const upRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: multipart,
  });
  if (!upRes.ok) throw new Error(`OCR upload failed (${upRes.status})`);
  const { id: tempId } = await upRes.json();

  try {
    const expRes = await fetch(`${DRIVE_FILES_URL}/${tempId}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!expRes.ok) throw new Error(`OCR export failed (${expRes.status})`);
    return (await expRes.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  } finally {
    fetch(`${DRIVE_FILES_URL}/${tempId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }
}
