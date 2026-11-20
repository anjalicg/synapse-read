import React, { useEffect, useRef, useState } from 'react';
import './theme.css';
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
    a.download = `afterword-backup-${formatDateInput(new Date())}.json`;
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
        `Archive merged: +${res.addedArticles} new, ${res.mergedArticles} merged post(s); +${res.addedBriefings} new, ${res.mergedBriefings} merged synthesis(es).`
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
    <div className="sr-shell">
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
          className="sr-card"
          style={{
            '--accent': 'var(--ochre)',
            background: '#FDF7E7',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11.5px',
          }}
        >
          <div>
            <div className="sr-node-tag" style={{ marginBottom: '2px' }}>
              <i className="sr-node-dot" /> setup:warmup
            </div>
            <div style={{ color: 'var(--ink)' }}>
              Download Gemini Nano once so briefings run fast offline.
            </div>
          </div>
          <button
            onClick={handleWarmupNano}
            className="sr-btn"
            style={{ background: 'var(--ochre)', color: '#FFFDF9', flexShrink: 0, fontSize: '11px', padding: '5px 9px' }}
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => articlesHook.saveActiveTab('content')}
              className="sr-btn sr-btn-primary"
              style={{ flex: 1 }}
            >
              + Save Content
            </button>
            <button
              onClick={() => articlesHook.saveActiveTab('bookmark')}
              className="sr-btn sr-btn-secondary"
              style={{ flex: 1 }}
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {search.visibleArticles.map((item) => (
              <ArticleCard
                key={item.id}
                item={item}
                isFetching={!!articlesHook.fetchingMap[item.id]}
                relatedArticles={articlesHook.relatedMap[item.id]}
                onFetchAndDigest={articlesHook.fetchAndDigest}
                onSaveNotes={articlesHook.saveArticleNotes}
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
