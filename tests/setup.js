import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

const storageState = {};
const storageListeners = new Set();
const messageListeners = new Set();

globalThis.chrome = {
  runtime: {
    id: 'test-afterword-ext-id',
    sendMessage: vi.fn(async (msg) => {
      for (const fn of messageListeners) fn(msg);
    }),
    onMessage: {
      addListener: vi.fn((fn) => messageListeners.add(fn)),
      removeListener: vi.fn((fn) => messageListeners.delete(fn)),
    },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async (key) => {
        if (typeof key === 'string') return { [key]: storageState[key] };
        return { ...storageState };
      }),
      set: vi.fn(async (obj) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: storageState[k], newValue: v };
          storageState[k] = v;
        }
        for (const fn of storageListeners) fn(changes, 'local');
      }),
      remove: vi.fn(async (key) => {
        delete storageState[key];
      }),
    },
    onChanged: {
      addListener: vi.fn((fn) => storageListeners.add(fn)),
      removeListener: vi.fn((fn) => storageListeners.delete(fn)),
    },
  },
  tabs: {
    query: vi.fn(async () => []),
  },
  scripting: {
    executeScript: vi.fn(async () => [{ result: '' }]),
  },
  readingList: {
    query: vi.fn(async () => []),
    onEntryAdded: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  identity: {
    getAuthToken: vi.fn((_, cb) => cb?.('mock-ext-token')),
  },
  sidePanel: {
    setPanelBehavior: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
  },
  contextMenus: {
    removeAll: vi.fn((cb) => cb?.()),
    create: vi.fn(),
    onClicked: { addListener: vi.fn() },
  },
};

globalThis.__resetChromeStorage = () => {
  for (const k of Object.keys(storageState)) delete storageState[k];
};

class MockUtterance {
  constructor(text) {
    this.text = text;
    this.rate = 1;
    this.voice = null;
    this.onend = null;
    this.onerror = null;
  }
}
globalThis.SpeechSynthesisUtterance = MockUtterance;

Object.defineProperty(window, 'speechSynthesis', {
  writable: true,
  value: {
    getVoices: vi.fn(() => [
      { voiceURI: 'en-US-Test', name: 'Test English', lang: 'en-US' },
    ]),
    speak: vi.fn((utterance) => {
      setTimeout(() => utterance.onend?.(), 5);
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onvoiceschanged: null,
  },
});

Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  value: {
    writeText: vi.fn(async () => {}),
  },
});

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
}
