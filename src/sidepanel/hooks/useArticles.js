import { useEffect, useState } from 'react';
import { Readability } from '@mozilla/readability';
import { db } from '../../db.js';
import { generateDigest } from '../../ai/nano.js';
import { generateEmbedding, findRelatedArticles } from '../../ai/embeddings.js';
import { syncChromeReadingList } from '../../sync/readingList.js';

export function useArticles({ setStatusMsg, setBackgroundStatus }) {
    const [articles, setArticles] = useState([]);
    const [fetchingMap, setFetchingMap] = useState({});
    const [relatedMap, setRelatedMap] = useState({});

    async function loadArticles() {
        const all = await db.articles.orderBy('savedAt').reverse().toArray();
        setArticles(all);
        return all;
    }

    async function syncReadingList(silent = false) {
        try {
            const count = await syncChromeReadingList();
            if (count > 0) {
                await loadArticles();
                setBackgroundStatus(`Imported ${count} item(s) from Chrome Reading List.`);
            } else if (!silent) {
                setBackgroundStatus('Chrome Reading List is up to date.');
            }
        } catch (err) {
            console.warn('Reading list sync skipped:', err);
        }
    }

    useEffect(() => {
        loadArticles();
        syncReadingList(true);

        const onReadingListAdded = () => syncReadingList(true);
        chrome?.readingList?.onEntryAdded?.addListener(onReadingListAdded);

        return () => {
            chrome?.readingList?.onEntryAdded?.removeListener(onReadingListAdded);
        };
    }, []);

    async function ensureAllEmbeddings(allArticles) {
        const missing = allArticles.filter(
            (a) => !Array.isArray(a.embedding) && (a.digest || a.content)
        );

        for (let i = 0; i < missing.length; i++) {
            const item = missing[i];
            setStatusMsg(`Indexing archive (${i + 1}/${missing.length})...`);
            const emb = await generateEmbedding(`${item.title}\n${item.digest || item.content}`);
            if (emb) {
                await db.articles.update(item.id, { embedding: emb });
                item.embedding = emb;
            }
        }

        if (missing.length > 0) {
            await loadArticles();
        }
        return allArticles;
    }

    async function saveActiveTab(mode) {
        setBackgroundStatus('Saving...');
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id || !tab.url?.startsWith('http')) {
                setBackgroundStatus('Open a standard web page to save.');
                return;
            }

            let title = tab.title || tab.url;
            let content = '';

            if (mode === 'content') {
                const [{ result: html }] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => document.documentElement.outerHTML,
                });

                const doc = new DOMParser().parseFromString(html, 'text/html');
                const parsed = new Readability(doc).parse();
                if (parsed) {
                    title = parsed.title || title;
                    content = parsed.textContent?.trim() || '';
                }
            }

            const existing = await db.articles.where('url').equals(tab.url).first();
            let articleId = existing?.id;

            if (existing) {
                if (mode === 'content' && content) {
                    await db.articles.update(existing.id, {
                        title,
                        content,
                        savedAt: Date.now(),
                        source: 'extension-content',
                    });
                    setBackgroundStatus('Saved! Generating digest in background...');
                } else {
                    setBackgroundStatus('Already saved in Synapse-Read.');
                    return;
                }
            } else {
                articleId = await db.articles.add({
                    url: tab.url,
                    title,
                    content,
                    digest: '',
                    status: 'unread',
                    savedAt: Date.now(),
                    source: mode === 'content' ? 'extension-content' : 'extension-bookmark',
                    tags: [],
                });
                setBackgroundStatus(
                    mode === 'content' && content
                        ? 'Saved! Generating digest in background...'
                        : 'Saved link!'
                );
            }

            await loadArticles();

            if (mode === 'content' && content && articleId) {
                generateDigest(content, title, setBackgroundStatus)
                    .then(async (digest) => {
                        if (digest) {
                            await db.articles.update(articleId, { digest });
                            await loadArticles();
                        }
                        const embedInput = `${title}\n${digest || content}`;
                        const embedding = await generateEmbedding(embedInput, setBackgroundStatus);
                        if (embedding) {
                            await db.articles.update(articleId, { embedding });
                            await loadArticles();
                            setBackgroundStatus('Digest & connections ready!');
                        }
                    })
                    .catch((err) => console.warn('Background AI error:', err));
            }
        } catch (err) {
            console.error(err);
            setBackgroundStatus('Error: ' + err.message);
        }
    }

    async function fetchAndDigest(item) {
        if (!item?.url || fetchingMap[item.id]) return;
        setFetchingMap((prev) => ({ ...prev, [item.id]: true }));
        setStatusMsg(`Fetching "${item.title}"...`);

        try {
            const res = await fetch(item.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();

            const doc = new DOMParser().parseFromString(html, 'text/html');
            if (!doc.querySelector('base')) {
                const base = doc.createElement('base');
                base.href = item.url;
                doc.head.prepend(base);
            }

            const parsed = new Readability(doc).parse();
            const content = parsed?.textContent?.trim() || '';
            const title = parsed?.title || item.title;

            if (!content) {
                setStatusMsg(
                    'Could not extract text (site may require JS/login). Open the tab and click Save Content.'
                );
                return;
            }

            await db.articles.update(item.id, { title, content });
            await loadArticles();
            setStatusMsg('Fetched! Generating digest & connections...');

            const digest = await generateDigest(content, title, setBackgroundStatus);
            if (digest) {
                await db.articles.update(item.id, { digest });
                await loadArticles();
            }

            const embedding = await generateEmbedding(
                `${title}\n${digest || content}`,
                setBackgroundStatus
            );
            if (embedding) {
                await db.articles.update(item.id, { embedding });
                await loadArticles();
            }

            setBackgroundStatus('Digest & connections ready!');
        } catch (err) {
            console.error('Fetch & Digest failed:', err);
            setStatusMsg(`Fetch failed (${err.message}). Open the tab and click Save Content.`);
        } finally {
            setFetchingMap((prev) => {
                const next = { ...prev };
                delete next[item.id];
                return next;
            });
        }
    }

    async function deleteArticle(id) {
        await db.articles.delete(id);
        setRelatedMap((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        await loadArticles();
    }

    async function toggleRelated(item) {
        if (relatedMap[item.id]) {
            setRelatedMap((prev) => {
                const next = { ...prev };
                delete next[item.id];
                return next;
            });
            return;
        }

        try {
            const all = await ensureAllEmbeddings(await db.articles.toArray());
            const target = all.find((a) => a.id === item.id) || item;
            const matches = findRelatedArticles(target, all);
            setRelatedMap((prev) => ({ ...prev, [target.id]: matches }));
            setStatusMsg('');
        } catch (err) {
            console.error('Related articles indexing failed:', err);
            setStatusMsg('Connection error: ' + err.message);
        }
    }

    return {
        articles,
        fetchingMap,
        relatedMap,
        loadArticles,
        syncReadingList,
        ensureAllEmbeddings,
        saveActiveTab,
        fetchAndDigest,
        deleteArticle,
        toggleRelated,
    };
}