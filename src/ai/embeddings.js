import { pipeline, env } from '@huggingface/transformers';

// Load ONNX WASM & .mjs workers from local extension bundle (MV3 CSP compliant)
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = globalThis.chrome?.runtime?.getURL?.('/') || '/';
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

let extractorPromise = null;

async function getExtractor(onProgress) {
    if (!extractorPromise) {
        extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            dtype: 'q8',
            progress_callback: (info) => {
                if (info.status === 'progress' && info.progress != null) {
                    onProgress?.(`Loading embedding model (${Math.round(info.progress)}%)...`);
                }
            },
        }).catch((err) => {
            extractorPromise = null;
            throw err;
        });
    }
    return extractorPromise;
}

/**
 * Generates a normalized 384-dimension embedding vector (plain Array for IndexedDB).
 */
export async function generateEmbedding(text, onProgress) {
    if (!text?.trim()) return null;
    const extractor = await getExtractor(onProgress);
    const snippet = text.replace(/\s+/g, ' ').slice(0, 2000);
    const output = await extractor(snippet, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

/**
 * Computes cosine similarity between two normalized vectors (dot product).
 */
export function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
    }
    return dot;
}

/**
 * Returns the topK most similar articles above minScore across all saved history.
 */
export function findRelatedArticles(targetArticle, allArticles, { topK = 3, minScore = 0.25 } = {}) {
    if (!targetArticle?.embedding) return [];

    return allArticles
        .filter((a) => a.id !== targetArticle.id && Array.isArray(a.embedding))
        .map((a) => ({
            id: a.id,
            title: a.title,
            url: a.url,
            savedAt: a.savedAt,
            score: cosineSimilarity(targetArticle.embedding, a.embedding),
        }))
        .filter((item) => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

/**
 * Finds the topK older archived articles outside the current date window
 * that most strongly connect to the articles in windowArticles.
 */
export function findArchiveConnections(windowArticles, allArticles, { topK = 3, minScore = 0.25 } = {}) {
    const embeddedWindow = windowArticles.filter((a) => Array.isArray(a.embedding));
    if (embeddedWindow.length === 0) return [];

    const windowIds = new Set(windowArticles.map((a) => a.id));
    const archiveCandidates = allArticles.filter(
        (a) => !windowIds.has(a.id) && Array.isArray(a.embedding)
    );

    return archiveCandidates
        .map((candidate) => {
            let bestScore = -1;
            let matchedWith = null;

            for (const recent of embeddedWindow) {
                const score = cosineSimilarity(candidate.embedding, recent.embedding);
                if (score > bestScore) {
                    bestScore = score;
                    matchedWith = recent.title;
                }
            }

            return {
                ...candidate,
                score: bestScore,
                matchedWith,
            };
        })
        .filter((item) => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

/**
 * Searches the entire article archive using semantic cosine similarity
 * combined with a lightweight keyword match boost.
 */
export async function semanticSearch(query, allArticles, { topK = 8, minScore = 0.22 } = {}) {
    const cleanQuery = query.trim();
    if (!Array.isArray(allArticles)) return [];
    if (!cleanQuery) return allArticles;

    const queryLower = cleanQuery.toLowerCase();
    const queryEmbedding = await generateEmbedding(cleanQuery);

    return allArticles
        .map((article) => {
            const textBlob = `${article.title || ''} ${article.digest || ''}`.toLowerCase();
            const keywordBoost = textBlob.includes(queryLower) ? 0.25 : 0;
            const vectorScore =
                queryEmbedding && Array.isArray(article.embedding)
                    ? cosineSimilarity(queryEmbedding, article.embedding)
                    : 0;

            return {
                ...article,
                searchScore: vectorScore + keywordBoost,
            };
        })
        .filter((item) => item.searchScore >= minScore)
        .sort((a, b) => b.searchScore - a.searchScore)
        .slice(0, topK);
}

/**
 * Searches saved briefings and 1,000-word user notes using semantic cosine similarity
 * combined with a keyword match boost.
 */
export async function semanticSearchBriefings(query, allBriefings, { topK = 3, minScore = 0.22 } = {}) {
    const cleanQuery = query.trim();
    if (!cleanQuery || !Array.isArray(allBriefings)) return [];

    const queryLower = cleanQuery.toLowerCase();
    const queryEmbedding = await generateEmbedding(cleanQuery);

    return allBriefings
        .filter((b) => b.userNotes?.trim() || b.summaryMarkdown?.trim())
        .map((briefing) => {
            const textBlob = `${briefing.userNotes || ''} ${briefing.summaryMarkdown || ''}`.toLowerCase();
            const keywordBoost = textBlob.includes(queryLower) ? 0.25 : 0;
            const vectorScore =
                queryEmbedding && Array.isArray(briefing.embedding)
                    ? cosineSimilarity(queryEmbedding, briefing.embedding)
                    : 0;

            return {
                ...briefing,
                searchScore: vectorScore + keywordBoost,
            };
        })
        .filter((item) => item.searchScore >= minScore)
        .sort((a, b) => b.searchScore - a.searchScore)
        .slice(0, topK);
}