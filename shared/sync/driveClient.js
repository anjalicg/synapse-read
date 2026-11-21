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
