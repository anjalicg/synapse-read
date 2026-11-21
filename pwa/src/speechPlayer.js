import { useCallback, useEffect, useRef, useState } from 'react';

export function cleanMarkdownForSpeech(raw = '') {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/^#{1,6}\s+(.+)$/gm, '$1.')
    .replace(/(\*\*|__|\*|_)/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\be\.g\./gi, 'for example,')
    .replace(/\bi\.e\./gi, 'that is,')
    .replace(/\bvs\./gi, 'versus')
    .replace(/\betc\./gi, 'et cetera')
    .replace(/\s+&\s+/g, ' and ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Group adjacent sentences into ~380-char thought blocks so voice prosody flows naturally
export function splitIntoNaturalChunks(raw = '') {
  const cleaned = cleanMarkdownForSpeech(raw);
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];

  for (const para of paragraphs) {
    const sentences = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    let buffer = '';

    for (const sentence of sentences) {
      if (sentence.length > 420) {
        if (buffer) {
          chunks.push(buffer);
          buffer = '';
        }
        const clauses = sentence.split(/(?<=[,;:])\s+/);
        let subBuf = '';
        for (const clause of clauses) {
          if ((subBuf + ' ' + clause).trim().length > 380 && subBuf) {
            chunks.push(subBuf.trim());
            subBuf = clause;
          } else {
            subBuf = (subBuf + ' ' + clause).trim();
          }
        }
        if (subBuf) chunks.push(subBuf.trim());
      } else if ((buffer + ' ' + sentence).trim().length > 400 && buffer) {
        chunks.push(buffer.trim());
        buffer = sentence;
      } else {
        buffer = (buffer + ' ' + sentence).trim();
      }
    }
    if (buffer) chunks.push(buffer.trim());
  }

  return chunks;
}

function pickPreferredVoice(voices) {
  if (!voices.length) return null;
  const enVoices = voices.filter((v) => /^en(-|_)/i.test(v.lang));
  const pool = enVoices.length ? enVoices : voices;
  return (
    pool.find((v) => /Natural|Neural|Google US English|Google UK English/i.test(v.name)) ||
    pool.find((v) => /Ava|Samantha|Daniel|Serena|Moira|Enhanced/i.test(v.name)) ||
    pool.find((v) => v.localService) ||
    pool[0]
  );
}

export function useSpeechPlayer() {
  const [activeId, setActiveId] = useState(null);
  const [title, setTitle] = useState('');
  const [sentences, setSentences] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState('idle');
  const [rate, setRate] = useState(1.0);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');

  const genRef = useRef(0);
  const sentencesRef = useRef([]);
  const indexRef = useRef(0);
  const rateRef = useRef(rate);
  const voiceURIRef = useRef(selectedVoiceURI);
  const voicesRef = useRef([]);

  rateRef.current = rate;
  voiceURIRef.current = selectedVoiceURI;

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices() || [];
      voicesRef.current = list;
      setVoices(list);
      if (!voiceURIRef.current && list.length) {
        const best = pickPreferredVoice(list);
        if (best) setSelectedVoiceURI(best.voiceURI);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    genRef.current += 1;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setStatus('idle');
    setActiveId(null);
    setSentences([]);
    setCurrentIndex(0);
    sentencesRef.current = [];
    indexRef.current = 0;
  }, []);

  const speakFrom = useCallback((idx) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const list = sentencesRef.current;

    if (idx < 0 || idx >= list.length) {
      genRef.current += 1;
      window.speechSynthesis.cancel();
      setStatus('idle');
      setCurrentIndex(0);
      indexRef.current = 0;
      return;
    }

    const gen = ++genRef.current;
    window.speechSynthesis.cancel();

    indexRef.current = idx;
    setCurrentIndex(idx);
    setStatus('playing');

    const utter = new SpeechSynthesisUtterance(list[idx]);
    utter.rate = rateRef.current;
    utter.pitch = 0.98;

    const chosenVoice = voicesRef.current.find((v) => v.voiceURI === voiceURIRef.current);
    if (chosenVoice) utter.voice = chosenVoice;

    utter.onend = () => {
      if (gen !== genRef.current) return;
      if (idx + 1 < list.length) {
        speakFrom(idx + 1);
      } else {
        setStatus('idle');
        setCurrentIndex(0);
        indexRef.current = 0;
      }
    };

    utter.onerror = (e) => {
      if (gen !== genRef.current) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      setStatus('idle');
    };

    window.speechSynthesis.speak(utter);
  }, []);

  const playItem = useCallback(
    (id, rawText, itemTitle = 'Afterword Audio', startIndex = 0) => {
      const chunks = splitIntoNaturalChunks(rawText);
      if (!chunks.length) return;

      setActiveId(id);
      setTitle(itemTitle);
      setSentences(chunks);
      sentencesRef.current = chunks;

      const safeIdx = Math.max(0, Math.min(startIndex, chunks.length - 1));
      speakFrom(safeIdx);
    },
    [speakFrom]
  );

  const togglePause = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (status === 'playing') {
      genRef.current += 1;
      window.speechSynthesis.cancel();
      setStatus('paused');
    } else if (status === 'paused') {
      speakFrom(indexRef.current);
    }
  }, [status, speakFrom]);

  const skip = useCallback(
    (delta) => {
      if (!sentencesRef.current.length) return;
      const nextIdx = Math.max(0, Math.min(indexRef.current + delta, sentencesRef.current.length - 1));
      speakFrom(nextIdx);
    },
    [speakFrom]
  );

  const changeRate = useCallback(
    (newRate) => {
      rateRef.current = newRate;
      setRate(newRate);
      if (status === 'playing') {
        speakFrom(indexRef.current);
      }
    },
    [status, speakFrom]
  );

  const changeVoice = useCallback(
    (newVoiceURI) => {
      voiceURIRef.current = newVoiceURI;
      setSelectedVoiceURI(newVoiceURI);
      if (status === 'playing') {
        speakFrom(indexRef.current);
      }
    },
    [status, speakFrom]
  );

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!activeId) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Afterword Reading',
      artist: 'Afterword Commonplace Book',
    });
    navigator.mediaSession.playbackState = status === 'playing' ? 'playing' : 'paused';

    navigator.mediaSession.setActionHandler('play', () => speakFrom(indexRef.current));
    navigator.mediaSession.setActionHandler('pause', () => togglePause());
    navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => skip(1));
    navigator.mediaSession.setActionHandler('stop', () => stop());
  }, [activeId, title, status, speakFrom, togglePause, skip, stop]);

  return {
    activeId,
    sentences,
    currentIndex,
    status,
    rate,
    voices,
    selectedVoiceURI,
    playItem,
    togglePause,
    skip,
    changeRate,
    changeVoice,
    stop,
  };
}
