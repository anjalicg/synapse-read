import React, { useEffect, useRef, useState } from 'react';
import './theme.css';
import {
  ensurePersistentStorage,
  exportArchiveJSON,
  importArchiveJSON,
  exportSyncArchiveJSON,
  mergeRemoteSyncArchive,
} from '../db.js';
import { checkNanoStatus, warmupNanoModel } from '../ai/nano.js';
import { getGoogleClientId, setGoogleClientId } from '../config.js';
import {
  getExtensionDriveToken,
  pullDriveSyncFile,
  pushDriveSyncFile,
} from '../sync/googleDrive.js';
import { extractTextViaDriveOCR } from '../sync/imageOcr.js';
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
import { ScanModal } from './components/ScanModal.jsx';

export default function App() {
  const [statusMsg, setStatusMsg] = useState('');
  const [nanoStatus, setNanoStatus] = useState({ summarizer: 'checking', prompt: 'checking' });
  const [showAbout, setShowAbout] = useState(false);
  const [isBriefingMinimized, setIsBriefingMinimized] = useState(false);

  // Google Drive sync & Scan state
  const [clientId, setClientId] = useState(() => getGoogleClientId());
  const [showClientConfig, setShowClientConfig] = useState(false);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState('');

  const [scanOpen, setScanOpen] = useState(false);
  const [isExtractingOcr, setIsExtractingOcr] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState('');

  const isGeneratingRef = useRef(false);
  const fileInputRef = useRef(null);

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
    onArchiveMutated: () => {
      if (getGoogleClientId()) {
        handleDriveSync(true);
      }
    },
  });

  const briefingsHook = useBriefings({
    setStatusMsg,
    isGeneratingRef,
    ensureAllEmbeddings: articlesHook.ensureAllEmbeddings,
    loadArticles: articlesHook.loadArticles,
    onBeforeBriefingChange: () => {
      speech.stop();
      setIsBriefingMinimized(false);
    },
  });

  const search = useSemanticSearch({
    articles: articlesHook.articles,
    ensureAllEmbeddings: articlesHook.ensureAllEmbeddings,
    ensureBriefingEmbeddings: briefingsHook.ensureBriefingEmbeddings,
    setStatusMsg,
  });

  async function handleDriveSync(silent = false) {
    const activeClientId = getGoogleClientId();
    if (!activeClientId) {
      if (!silent) setShowClientConfig(true);
      return;
    }

    setIsSyncingDrive(true);
    if (!silent) setStatusMsg('Syncing with Google Drive...');

    try {
      const token = await getExtensionDriveToken(activeClientId, !silent);
      const remote = await pullDriveSyncFile(token);

      if (remote?.jsonText) {
        const mergeRes = await mergeRemoteSyncArchive(remote.jsonText);
        const refreshed = await articlesHook.loadArticles();
        await briefingsHook.loadBriefings();
        await articlesHook.enrichPendingArticles(refreshed);

        if (
          !silent &&
          (mergeRes.addedArticles > 0 ||
            mergeRes.updatedArticles > 0 ||
            mergeRes.addedBriefings > 0)
        ) {
          setStatusMsg(
            `Drive synced: +${mergeRes.addedArticles} new, ${mergeRes.updatedArticles} updated post(s).`
          );
        }
      }

      const localSyncJson = await exportSyncArchiveJSON();
      await pushDriveSyncFile(token, localSyncJson, remote?.fileId || null);

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSyncedAt(timeStr);
      if (!silent) setStatusMsg(`Google Drive synced (${timeStr}).`);
    } catch (err) {
      console.error('Drive sync failed:', err);
      if (!silent) setStatusMsg(`Drive sync: ${err.message}`);
    } finally {
      setIsSyncingDrive(false);
    }
  }

  async function processImageFileForOcr(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const activeClientId = getGoogleClientId();
    if (!activeClientId) {
      setShowClientConfig(true);
      setStatusMsg('Enter your Google OAuth Client ID to enable Drive OCR.');
      return;
    }

    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    setOcrPreviewUrl(URL.createObjectURL(file));
    setOcrText('');
    setScanOpen(true);
    setIsExtractingOcr(true);

    try {
      const token = await getExtensionDriveToken(activeClientId, true);
      const extracted = await extractTextViaDriveOCR(token, file);
      setOcrText(extracted);
    } catch (err) {
      console.error('OCR failed:', err);
      setStatusMsg(`OCR error: ${err.message}`);
      setScanOpen(false);
    } finally {
      setIsExtractingOcr(false);
    }
  }

  // Support Cmd+V / Ctrl+V pasting of screenshots anywhere in the Side Panel
  useEffect(() => {
    function handlePaste(e) {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processImageFileForOcr(file);
            break;
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [clientId]);

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
    <div
      className="sr-shell"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) {
          e.preventDefault();
          processImageFileForOcr(file);
        }
      }}
    >
      <Header
        nanoReady={nanoReady}
        showAbout={showAbout}
        onToggleAbout={() => setShowAbout((prev) => !prev)}
        onSyncList={() => articlesHook.syncReadingList(false)}
        onBackup={handleExportJSON}
        onRestore={handleImportJSON}
      />

      {/* Google Drive Sync & Book Page OCR Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => handleDriveSync(false)}
            disabled={isSyncingDrive}
            className="sr-pill"
          >
            {isSyncingDrive
              ? 'Syncing...'
              : lastSyncedAt
                ? `Drive Synced (${lastSyncedAt})`
                : 'Sync Drive'}
          </button>
          
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processImageFileForOcr(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="sr-pill"
            title="Scan book image, drop an image, or press Cmd+V to paste"
          >
            + Scan Image
          </button>
        </div>
      </div>

      {showClientConfig && (
        <div
          className="sr-card"
          style={{ '--accent': 'var(--periwinkle)', display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          <div style={{ fontSize: '11px', fontWeight: 600 }}>
            Google OAuth Web Client ID (for Drive Sync & Free OCR)
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789-xxxx.apps.googleusercontent.com"
              className="sr-input"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={() => {
                setGoogleClientId(clientId);
                setShowClientConfig(false);
                handleDriveSync(false);
              }}
              className="sr-btn sr-btn-primary"
            >
              Save & Sync
            </button>
          </div>
        </div>
      )}

      <ScanModal
        isOpen={scanOpen}
        isExtracting={isExtractingOcr}
        initialText={ocrText}
        previewUrl={ocrPreviewUrl}
        onClose={() => setScanOpen(false)}
        onSaveScan={async (scanData) => {
          setScanOpen(false);
          await articlesHook.saveScannedExcerpt(scanData);
        }}
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
            isMinimized={isBriefingMinimized}
            onToggleMinimize={() => setIsBriefingMinimized((prev) => !prev)}
          />

          <SearchSection
            search={search}
            onOpenBriefing={(target) => {
              setIsBriefingMinimized(false);
              briefingsHook.openBriefing(target);
            }}
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
