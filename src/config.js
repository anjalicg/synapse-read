const STORAGE_KEY = 'afterword:googleClientId';

export function getGoogleClientId() {
  const envId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID || '').trim();
  if (envId) return envId;
  return (localStorage.getItem(STORAGE_KEY) || '').trim();
}

export function setGoogleClientId(clientId) {
  const trimmed = (clientId || '').trim();
  if (trimmed) {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
