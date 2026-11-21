const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

export async function resizeImageToJpegBlob(fileOrBlob, maxEdge = 1600, quality = 0.85) {
  const bitmap = await createImageBitmap(fileOrBlob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas image encoding failed.'))),
      'image/jpeg',
      quality
    );
  });
}

export async function extractTextViaDriveOCR(accessToken, fileOrBlob) {
  const resizedBlob = await resizeImageToJpegBlob(fileOrBlob);
  const boundary = 'afterword_ocr_boundary';

  const metadataPart = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({
      name: `afterword-ocr-${Date.now()}`,
      mimeType: 'application/vnd.google-apps.document',
    }),
    `\r\n--${boundary}\r\n`,
    'Content-Type: image/jpeg\r\n\r\n',
  ].join('');

  const closingPart = `\r\n--${boundary}--`;
  const multipartBlob = new Blob([metadataPart, resizedBlob, closingPart], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const uploadRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: multipartBlob,
  });

  if (!uploadRes.ok) {
    throw new Error(`Drive OCR upload failed (${uploadRes.status})`);
  }

  const { id: tempDocId } = await uploadRes.json();

  try {
    const exportRes = await fetch(
      `${DRIVE_FILES_URL}/${tempDocId}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!exportRes.ok) {
      throw new Error(`Drive OCR export failed (${exportRes.status})`);
    }
    const rawText = await exportRes.text();
    return rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  } finally {
    // Delete temp Google Doc immediately so 0 bytes of Drive quota are consumed
    fetch(`${DRIVE_FILES_URL}/${tempDocId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }
}
