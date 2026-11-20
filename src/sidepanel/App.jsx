import React, { useEffect, useRef, useState } from 'react';
import {
    ensurePersistentStorage,
    exportArchiveJSON,
    importArchiveJSON,
} from '../db.js';
import { checkNanoStatus, warmupNanoModel } from '../ai/nano.js';
import { formatDateInput } from './utils/formatters.js';
import { useSpeechBriefing } from './hooks/useSpeechBriefing.js';
import { useArticles } from './hooks/useArticles.js';
import { useBriefings } from './hooks/useBriefings.js';
import { useSemanticSearch } from './hooks/useSemanticSearch.js';
import { Header } from './components/Header.jsx';
import { AboutPanel } from './components/AboutPanel.jsx';
import { BriefingPanel } from './components/BriefingPanel.jsx';
import { SearchSection } from './components/SearchSection.jsx';
import { ArticleCard } from './components/ArticleCard.jsx';

export default function App() {
    const [statusMsg, setStatusMsg] = useState('');
    const [nanoStatus, setNanoStatus] = useState({ summarizer: 'checking', prompt: 'checking' });
    const [showAbout, setShowAbout] = useState(false);
    const isGeneratingRef = useRef(false);

    function setBackgroundStatus(msg) {
        if (!isGeneratingRef.current) {
            setStatusMsg(msg);
        }
    }

    useEffect(() => {
        ensurePersistentStorage();
        checkNanoStatus().then(setNanoStatus);
    }, []);

    const speech = useSpeechBriefing();

    const articlesHook = useArticles({
        setStatusMsg,
        setBackgroundStatus,
    });

    const briefingsHook = useBriefings({
        setStatusMsg,
        isGeneratingRef,
        ensureAllEmbeddings: articlesHook.ensureAllEmbeddings,
        loadArticles: articlesHook.loadArticles,
        onBeforeBriefingChange: speech.stop,
    });

    const search = useSemanticSearch({
        articles: articlesHook.articles,
        ensureAllEmbeddings: articlesHook.ensureAllEmbeddings,
        ensureBriefingEmbeddings: briefingsHook.ensureBriefingEmbeddings,
        setStatusMsg,
    });

    async function handleExportJSON() {
        const json = await exportArchiveJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `synapse-read-backup-${formatDateInput(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setStatusMsg('Full archive backup exported.');
    }

    async function handleImportJSON(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const res = await importArchiveJSON(text);
            await articlesHook.loadArticles();
            await briefingsHook.loadBriefings();
            setStatusMsg(
                `Imported ${res.addedArticles} new, ${res.updatedArticles} updated article(s), and ${res.addedBriefings} briefing(s).`
            );
        } catch (err) {
            console.error(err);
            setStatusMsg('Import failed: ' + err.message);
        } finally {
            e.target.value = '';
        }
    }

    async function handleWarmupNano() {
        try {
            await warmupNanoModel(setStatusMsg);
            const updated = await checkNanoStatus();
            setNanoStatus(updated);
            setStatusMsg('Gemini Nano downloaded and ready for offline briefings!');
        } catch (err) {
            console.error(err);
            setStatusMsg('Model download error: ' + err.message);
        }
    }

    const nanoReady = nanoStatus.prompt !== 'unavailable';

    return (
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Header
                nanoReady={nanoReady}
                showAbout={showAbout}
                onToggleAbout={() => setShowAbout((prev) => !prev)}
                onSyncList={() => articlesHook.syncReadingList(false)}
                onBackup={handleExportJSON}
                onRestore={handleImportJSON}
            />

            {!showAbout && nanoStatus.prompt === 'downloadable' && (
                <div
                    style={{
                        padding: '8px 10px',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '6px',
                        fontSize: '11px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                    }}
                >
          <span style={{ color: '#1e3a8a' }}>
            First-time setup: download Gemini Nano once so briefings run fast offline.
          </span>
                    <button
                        onClick={handleWarmupNano}
                        style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
                    >
                        Download AI
                    </button>
                </div>
            )}

            {showAbout ? (
                <AboutPanel
                    articleCount={articlesHook.articles.length}
                    briefingCount={briefingsHook.briefings.length}
                    nanoStatus={nanoStatus}
                    onClose={() => setShowAbout(false)}
                />
            ) : (
                <>
                    {/* Capture Controls */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => articlesHook.saveActiveTab('content')}
                            style={{ flex: 1, padding: '8px', cursor: 'pointer', fontWeight: 600 }}
                        >
                            Save Content
                        </button>
                        <button
                            onClick={() => articlesHook.saveActiveTab('bookmark')}
                            style={{ flex: 1, padding: '8px', cursor: 'pointer' }}
                        >
                            Save Link Only
                        </button>
                    </div>

                    <BriefingPanel
                        nanoReady={nanoReady}
                        statusMsg={statusMsg}
                        briefingsHook={briefingsHook}
                        speech={speech}
                    />

                    <SearchSection
                        search={search}
                        onOpenBriefing={briefingsHook.openBriefing}
                    />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {search.visibleArticles.map((item) => (
                            <ArticleCard
                                key={item.id}
                                item={item}
                                isFetching={!!articlesHook.fetchingMap[item.id]}
                                relatedArticles={articlesHook.relatedMap[item.id]}
                                onFetchAndDigest={articlesHook.fetchAndDigest}
                                onToggleRelated={articlesHook.toggleRelated}
                                onDelete={articlesHook.deleteArticle}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}