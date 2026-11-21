import { useEffect, useRef, useState } from 'react';
import { db, getArticlesInDateRange, loadArticleMetadataList } from '../../db.js';
import { synthesizeBriefing, buildBriefingPrompt } from '../../ai/nano.js';
import { generateEmbedding, cosineSimilarity } from '../../ai/embeddings.js';
import { formatDateInput, truncateToMaxWords } from '../utils/formatters.js';

function averageVectors(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += vec[i];
  }
  const norm = Math.sqrt(sum.reduce((acc, v) => acc + v * v, 0)) || 1;
  return sum.map((v) => v / norm);
}

export function useBriefings({
  setStatusMsg,
  isGeneratingRef,
  ensureAllEmbeddings,
  loadArticles,
  onBeforeBriefingChange,
}) {
  const [preset, setPreset] = useState('7D');
  const [startDate, setStartDate] = useState(() =>
    formatDateInput(new Date(Date.now() - 7 * 86400000))
  );
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()));

  const [briefings, setBriefings] = useState([]);
  const [activeBriefingId, setActiveBriefingId] = useState(null);
  const [briefing, setBriefing] = useState('');
  const [userNotes, setUserNotes] = useState('');
  const [notesStatus, setNotesStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const saveTimerRef = useRef(null);
  const latestNotesRef = useRef({ id: null, text: '' });

  async function loadBriefings(selectLatest = false) {
    const all = await db.briefings.orderBy('createdAt').reverse().toArray();
    setBriefings(all);
    if (all.length > 0 && (selectLatest || !activeBriefingId)) {
      const target = all[0];
      setActiveBriefingId(target.id);
      setBriefing(target.summaryMarkdown || '');
      setUserNotes(target.userNotes || '');
    }
    return all;
  }

  useEffect(() => {
    loadBriefings(true);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function applyPreset(label, days) {
    setPreset(label);
    setEndDate(formatDateInput(new Date()));
    setStartDate(formatDateInput(new Date(Date.now() - days * 86400000)));
  }

  function updateCustomDate(which, value) {
    setPreset('CUSTOM');
    if (which === 'start') setStartDate(value);
    else setEndDate(value);
  }

  async function persistNotesNow(id, text, summaryMarkdown) {
    if (!id) return;
    setNotesStatus('Saving...');
    try {
      const embedSource = [summaryMarkdown, text].filter(Boolean).join('\n\n');
      const embedding = embedSource ? await generateEmbedding(embedSource) : null;
      await db.briefings.update(id, { userNotes: text, embedding });
      setBriefings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, userNotes: text, embedding } : b))
      );
      setNotesStatus('Saved');
    } catch (err) {
      console.error('Failed to save briefing notes:', err);
      await db.briefings.update(id, { userNotes: text });
      setNotesStatus('Saved');
    }
  }

  function handleNotesChange(rawText) {
    const clamped = truncateToMaxWords(rawText);
    setUserNotes(clamped);
    setNotesStatus('Unsaved...');
    latestNotesRef.current = { id: activeBriefingId, text: clamped };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persistNotesNow(activeBriefingId, clamped, briefing);
    }, 650);
  }

  async function flushNotes() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const { id, text } = latestNotesRef.current;
    if (id && id === activeBriefingId) {
      await persistNotesNow(id, text, briefing);
    }
  }

  function openBriefing(target) {
    if (!target) return;
    onBeforeBriefingChange?.();
    setActiveBriefingId(target.id);
    setBriefing(target.summaryMarkdown || '');
    setUserNotes(target.userNotes || '');
    setNotesStatus('');
    latestNotesRef.current = { id: target.id, text: target.userNotes || '' };
  }

  function selectBriefingById(idStr) {
    const target = briefings.find((b) => String(b.id) === String(idStr));
    openBriefing(target);
  }

  async function buildWindowArticlesWithArchiveLinks() {
    const windowArticles = await getArticlesInDateRange(startDate, endDate);
    const enriched = windowArticles.map((a) => ({
      ...a,
      digest: [
        a.digest || a.content?.slice(0, 600) || '',
        a.userNotes ? `User Note: ${a.userNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }));

    const allMeta = await loadArticleMetadataList();
    await ensureAllEmbeddings(allMeta);
    const refreshedMeta = await loadArticleMetadataList();

    const windowIds = new Set(windowArticles.map((a) => a.id));
    const windowVectors = refreshedMeta
      .filter((a) => windowIds.has(a.id) && Array.isArray(a.embedding))
      .map((a) => a.embedding);

    const centroid = averageVectors(windowVectors);
    let archiveConnections = [];
    if (centroid) {
      archiveConnections = refreshedMeta
        .filter((a) => !windowIds.has(a.id) && Array.isArray(a.embedding))
        .map((a) => ({
          ...a,
          score: cosineSimilarity(centroid, a.embedding),
        }))
        .filter((a) => a.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    }

    return { windowArticles, enriched, archiveConnections };
  }

  async function generateNewBriefing() {
    if (isGenerating) return;
    isGeneratingRef.current = true;
    setIsGenerating(true);
    onBeforeBriefingChange?.();

    try {
      setStatusMsg('Gathering articles and semantic connections...');
      const { windowArticles, enriched, archiveConnections } =
        await buildWindowArticlesWithArchiveLinks();

      if (windowArticles.length === 0) {
        setStatusMsg(`No saved articles found between ${startDate} and ${endDate}.`);
        return;
      }

      setStatusMsg(`Synthesizing ${windowArticles.length} post(s) with Gemini Nano...`);
      let summaryMarkdown = await synthesizeBriefing(enriched, `${startDate} to ${endDate}`, ({ message }) => {
        setStatusMsg(message);
      });

      if (archiveConnections.length > 0) {
        const archiveLines = archiveConnections
          .map(
            (a) =>
              `- [${a.title}](${a.url}) *(${Math.round(a.score * 100)}% semantic match${
                a.userNotes ? ` — Note: ${a.userNotes.slice(0, 90)}` : ''
              })*`
          )
          .join('\n');
        summaryMarkdown += `\n\n### From Your Archive\n${archiveLines}`;
      }

      const embedding = await generateEmbedding(summaryMarkdown);
      const newId = await db.briefings.add({
        createdAt: Date.now(),
        startDate,
        endDate,
        summaryMarkdown,
        userNotes: '',
        embedding,
      });

      await loadBriefings(false);
      await loadArticles();
      setActiveBriefingId(newId);
      setBriefing(summaryMarkdown);
      setUserNotes('');
      setNotesStatus('');
      latestNotesRef.current = { id: newId, text: '' };
      setStatusMsg('Briefing ready.');
    } catch (err) {
      console.error('Briefing generation error:', err);
      setStatusMsg('Briefing error: ' + err.message);
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }

  async function copyPromptFallback() {
    const { windowArticles, enriched } = await buildWindowArticlesWithArchiveLinks();
    if (windowArticles.length === 0) {
      setStatusMsg(`No saved articles found between ${startDate} and ${endDate}.`);
      return;
    }
    const prompt = buildBriefingPrompt(enriched, `${startDate} to ${endDate}`);
    await navigator.clipboard.writeText(prompt);
    setStatusMsg(`Copied synthesis prompt for ${windowArticles.length} post(s) to clipboard.`);
  }

  async function ensureBriefingEmbeddings() {
    const all = await db.briefings.toArray();
    for (const b of all) {
      const embedSource = [b.summaryMarkdown, b.userNotes].filter(Boolean).join('\n\n');
      if (!b.embedding && embedSource) {
        try {
          const embedding = await generateEmbedding(embedSource);
          await db.briefings.update(b.id, { embedding });
        } catch (err) {
          console.error('Briefing embedding error:', err);
        }
      }
    }
  }

  async function exportMarkdown() {
    if (!briefing) return;

    const activeRecord = briefings.find((b) => b.id === activeBriefingId);
    const winStart = activeRecord?.startDate || startDate;
    const winEnd = activeRecord?.endDate || endDate;
    const windowArticles = await getArticlesInDateRange(winStart, winEnd);
    const annotatedCount = windowArticles.filter((a) => (a.userNotes || '').trim()).length;

    const frontmatter = [
      '---',
      `title: "Afterword Briefing (${winStart} to ${winEnd})"`,
      `date_range: "${winStart} to ${winEnd}"`,
      `exported_at: "${new Date().toISOString()}"`,
      `articles_count: ${windowArticles.length}`,
      `annotated_posts_count: ${annotatedCount}`,
      '---',
      '',
    ].join('\n');

    const sections = [frontmatter, briefing.trim()];

    if (userNotes.trim()) {
      sections.push(`\n## My Briefing Reflections\n\n${userNotes.trim()}`);
    }

    if (windowArticles.length > 0) {
      const postLines = windowArticles.map((art) => {
        const lines = [`- **[${art.title}](${art.url})** *(${new Date(art.savedAt).toLocaleDateString()})*`];
        if (art.digest) {
          lines.push(`  - **Digest:** ${art.digest.trim()}`);
        }
        if ((art.userNotes || '').trim()) {
          const formattedNote = art.userNotes
            .trim()
            .split('\n')
            .map((l) => `  > ${l}`)
            .join('\n');
          lines.push(`  > **My Note:**\n${formattedNote}`);
        }
        return lines.join('\n');
      });

      sections.push(
        `\n## Saved Posts & Attached Notes (${winStart} to ${winEnd})\n\n${postLines.join('\n\n')}`
      );
    }

    const mdContent = sections.join('\n') + '\n';
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `afterword-briefing-${winStart}-to-${winEnd}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Exported Markdown with post notes.');
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
    applyPreset,
    updateCustomDate,
    generateNewBriefing,
    copyPromptFallback,
    handleNotesChange,
    flushNotes,
    selectBriefingById,
    openBriefing,
    exportMarkdown,
    ensureBriefingEmbeddings,
  };
}
