import { useEffect, useState } from 'react';
import { prepareSpeechChunks } from '../utils/formatters.js';

export function useSpeechBriefing() {
    const [speechState, setSpeechState] = useState('idle'); // 'idle' | 'playing' | 'paused'
    const [voices, setVoices] = useState([]);
    const [selectedVoiceURI, setSelectedVoiceURI] = useState('');

    useEffect(() => {
        function loadVoices() {
            const allVoices = window.speechSynthesis?.getVoices() || [];
            const enVoices = allVoices.filter((v) => v.lang.startsWith('en'));
            setVoices(enVoices);

            if (enVoices.length > 0) {
                const preferred =
                    enVoices.find((v) => /Premium|Enhanced|Natural|Google US English/i.test(v.name)) ||
                    enVoices[0];
                setSelectedVoiceURI((prev) => prev || preferred.voiceURI);
            }
        }

        loadVoices();
        if (window.speechSynthesis) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }

        return () => {
            window.speechSynthesis?.cancel();
            if (window.speechSynthesis) {
                window.speechSynthesis.onvoiceschanged = null;
            }
        };
    }, []);

    function stop() {
        window.speechSynthesis?.cancel();
        setSpeechState('idle');
    }

    function playPause(markdownText) {
        if (!('speechSynthesis' in window) || !markdownText) return;

        if (speechState === 'playing') {
            window.speechSynthesis.pause();
            setSpeechState('paused');
            return;
        }

        if (speechState === 'paused') {
            window.speechSynthesis.resume();
            setSpeechState('playing');
            return;
        }

        window.speechSynthesis.cancel();
        const chunks = prepareSpeechChunks(markdownText);
        if (chunks.length === 0) return;

        const chosenVoice = voices.find((v) => v.voiceURI === selectedVoiceURI);
        setSpeechState('playing');

        chunks.forEach((sentence, idx) => {
            const utterance = new SpeechSynthesisUtterance(sentence);
            if (chosenVoice) utterance.voice = chosenVoice;
            utterance.rate = 0.96;
            utterance.pitch = 1.02;

            if (idx === chunks.length - 1) {
                utterance.onend = () => setSpeechState('idle');
            }
            utterance.onerror = () => setSpeechState('idle');

            window.speechSynthesis.speak(utterance);
        });
    }

    function changeVoice(voiceURI) {
        stop();
        setSelectedVoiceURI(voiceURI);
    }

    return {
        speechState,
        voices,
        selectedVoiceURI,
        playPause,
        stop,
        changeVoice,
    };
}