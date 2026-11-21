const STORAGE_KEY = 'afterword:googleClientId';
const DEFAULT_CLIENT_ID = '355508535747-le46i085l572ehjkklebif8dfqv7eb8f.apps.googleusercontent.com';

export function getGoogleClientId() {
  const envId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID || '').trim();
  if (envId) return envId;
  return (localStorage.getItem(STORAGE_KEY) || DEFAULT_CLIENT_ID).trim();
}

export function setGoogleClientId(clientId) {
  const trimmed = (clientId || '').trim();
  if (trimmed) {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
