import { useEffect, useRef, useState } from 'react';
import { db } from '../../db.js';
import { generateBriefing, buildBriefingPrompt } from '../../ai/nano.js';
import { generateEmbedding, findArchiveConnections } from '../../ai/embeddings.js';
import {
    MAX_NOTE_WORDS,
    formatDateInput,
    getDateDaysAgo,
    countWords,
    buildBriefingEmbedText,
} from '../utils/formatters.js';

export function useBriefings({
                                 setStatusMsg,
                                 isGeneratingRef,
                                 ensureAllEmbeddings,
                                 loadArticles,
                                 onBeforeBriefingChange,
                             }) {
    const [preset, setPreset] = useState('7D');
    const [startDate, setStartDate] = useState(() => getDateDaysAgo(7));
    const [endDate, setEndDate] = useState(() => formatDateInput(new Date()));

    const [briefings, setBriefings] = useState([]);
    const [activeBriefingId, setActiveBriefingId] = useState(null);
    const [briefing, setBriefing] = useState('');
    const [userNotes, setUserNotes] = useState('');
    const [notesStatus, setNotesStatus] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const saveTimerRef = useRef(null);

    async function loadBriefings(selectId = null) {
        if (!db.briefings) return;
        const all = await db.briefings.orderBy('createdAt').reverse().toArray();
        setBriefings(all);

        const target = selectId ? all.find((b) => b.id === selectId) : all[0];
        if (target) {
            setActiveBriefingId(target.id);
            setBriefing(target.summaryMarkdown || '');
            setUserNotes(target.userNotes || '');
        }
    }

    useEffect(() => {
        loadBriefings();
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, []);

    function applyPreset(label, days) {
        setPreset(label);
        setStartDate(getDateDaysAgo(days));
        setEndDate(formatDateInput(new Date()));
    }

    function updateCustomDate(bound, value) {
        setPreset('custom');
        if (bound === 'start') setStartDate(value);
        else setEndDate(value);
    }

    async function getArticlesInWindow() {
        const startMs = new Date(`${startDate}T00:00:00`).getTime();
        const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
        return db.articles.where('savedAt').between(startMs, endMs, true, true).toArray();
    }

    async function ensureBriefingEmbeddings(allBriefings) {
        const missing = allBriefings.filter(
            (b) => !Array.isArray(b.embedding) && (b.userNotes?.trim() || b.summaryMarkdown?.trim())
        );

        for (let i = 0; i < missing.length; i++) {
            const b = missing[i];
            setStatusMsg(`Indexing notes (${i + 1}/${missing.length})...`);
            const emb = await generateEmbedding(buildBriefingEmbedText(b.userNotes, b.summaryMarkdown));
            if (emb) {
                await db.briefings.update(b.id, { embedding: emb });
                b.embedding = emb;
            }
        }

        if (missing.length > 0) {
            await loadBriefings(activeBriefingId);
        }
        return allBriefings;
    }

    async function generateNewBriefing() {
        onBeforeBriefingChange?.();
        isGeneratingRef.current = true;
        setIsGenerating(true);
        setStatusMsg('Querying articles...');

        try {
            const windowArticles = await getArticlesInWindow();
            if (windowArticles.length === 0) {
                setStatusMsg('No articles saved in this date range.');
                return;
            }

            const allArticles = await ensureAllEmbeddings(await db.articles.toArray());
            const windowIds = new Set(windowArticles.map((a) => a.id));
            const hydratedWindow = allArticles.filter((a) => windowIds.has(a.id));
            const archiveMatches = findArchiveConnections(hydratedWindow, allArticles);

            setStatusMsg(
                archiveMatches.length > 0
                    ? `Synthesizing ${hydratedWindow.length} article(s) + ${archiveMatches.length} archive match(es)...`
                    : `Synthesizing ${hydratedWindow.length} article(s) with Gemini Nano...`
            );

            const summaryMarkdown = await generateBriefing(
                hydratedWindow,
                archiveMatches,
                setStatusMsg,
                { startDate, endDate }
            );

            let newId = null;
            if (db.briefings) {
                newId = await db.briefings.add({
                    createdAt: Date.now(),
                    startDate,
                    endDate,
                    articleUrls: hydratedWindow.map((a) => a.url),
                    summaryMarkdown,
                    userNotes: '',
                });

                const initialEmb = await generateEmbedding(buildBriefingEmbedText('', summaryMarkdown));
                if (initialEmb) {
                    await db.briefings.update(newId, { embedding: initialEmb });
                }
            }

            await Promise.all(
                hydratedWindow.map((a) => db.articles.update(a.id, { status: 'summarized' }))
            );

            setBriefing(summaryMarkdown);
            setUserNotes('');
            setNotesStatus('');
            await loadBriefings(newId);
            await loadArticles();
            setStatusMsg('Briefing ready.');
        } catch (err) {
            console.error(err);
            setStatusMsg(err.message);
        } finally {
            isGeneratingRef.current = false;
            setIsGenerating(false);
        }
    }

    async function copyPromptFallback() {
        const windowArticles = await getArticlesInWindow();
        if (windowArticles.length === 0) {
            setStatusMsg('No articles in this date range to copy.');
            return;
        }
        const allArticles = await db.articles.toArray();
        const archiveMatches = findArchiveConnections(windowArticles, allArticles);
        const prompt = buildBriefingPrompt(windowArticles, archiveMatches, {
            startDate,
            endDate,
        });
        await navigator.clipboard.writeText(prompt);
        setStatusMsg('Prompt copied! Paste into ChatGPT, Claude, or Gemini.');
    }

    async function persistNotes(briefingId, text) {
        if (!briefingId || !db.briefings) return;
        setNotesStatus('Saving...');
        const target =
            briefings.find((b) => b.id === briefingId) || (await db.briefings.get(briefingId));
        const emb = await generateEmbedding(buildBriefingEmbedText(text, target?.summaryMarkdown));

        const patch = { userNotes: text, updatedAt: Date.now() };
        if (emb) patch.embedding = emb;

        await db.briefings.update(briefingId, patch);
        setBriefings((prev) =>
            prev.map((b) => (b.id === briefingId ? { ...b, ...patch } : b))
        );
        setNotesStatus('Saved & indexed');
    }

    function handleNotesChange(nextText) {
        if (countWords(nextText) > MAX_NOTE_WORDS) {
            setNotesStatus(`Limit reached (${MAX_NOTE_WORDS} words max)`);
            return;
        }

        setUserNotes(nextText);
        setNotesStatus('Unsaved...');

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            persistNotes(activeBriefingId, nextText);
        }, 600);
    }

    function flushNotes() {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        persistNotes(activeBriefingId, userNotes);
    }

    function openBriefing(chosen) {
        if (!chosen) return;
        onBeforeBriefingChange?.();
        setActiveBriefingId(chosen.id);
        setBriefing(chosen.summaryMarkdown || '');
        setUserNotes(chosen.userNotes || '');
        setNotesStatus('');
    }

    function selectBriefingById(id) {
        const chosen = briefings.find((b) => b.id === Number(id));
        openBriefing(chosen);
    }

    function exportMarkdown() {
        if (!briefing) return;
        const activeObj = briefings.find((b) => b.id === activeBriefingId);
        const dateRange = activeObj
            ? `${activeObj.startDate}_to_${activeObj.endDate}`
            : formatDateInput(new Date());

        const frontmatter = [
            '---',
            `title: "Synapse-Read Briefing (${dateRange.replace('_to_', ' to ')})"`,
            `exported: ${new Date().toISOString()}`,
            `source: Synapse-Read`,
            '---',
            '',
        ].join('\n');

        const notesSection = userNotes.trim()
            ? `\n\n## My Notes & Reflections\n\n${userNotes.trim()}\n`
            : '';

        const fullMarkdown = `${frontmatter}${briefing.trim()}${notesSection}`;
        const blob = new Blob([fullMarkdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `synapse-briefing-${dateRange}.md`;
        a.click();
        URL.revokeObjectURL(url);
        setStatusMsg('Exported Markdown file.');
    }

    return {
        preset,
        startDate,
        endDate,
        briefings,
        activeBriefingId,
        briefing,
        userNotes,
        notesStatus,
        isGenerating,
        loadBriefings,
        ensureBriefingEmbeddings,
        applyPreset,
        updateCustomDate,
        generateNewBriefing,
        copyPromptFallback,
        handleNotesChange,
        flushNotes,
        openBriefing,
        selectBriefingById,
        exportMarkdown,
    };
}