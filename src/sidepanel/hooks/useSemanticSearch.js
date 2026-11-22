import { useState } from 'react';
import { db } from '../../db.js';
import { semanticSearch, semanticSearchBriefings } from '../../ai/embeddings.js';

export function useSemanticSearch({
                                      articles,
                                      ensureAllEmbeddings,
                                      ensureBriefingEmbeddings,
                                      setStatusMsg,
                                  }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState(null);
    const [matchingBriefings, setMatchingBriefings] = useState([]);

    const visibleArticles = searchQuery.trim() && searchResults ? searchResults : articles;

    function updateQuery(value) {
        setSearchQuery(value);
        if (!value.trim()) {
            setSearchResults(null);
            setMatchingBriefings([]);
        }
    }

    function clearSearch() {
        setSearchQuery('');
        setSearchResults(null);
        setMatchingBriefings([]);
        setStatusMsg('');
    }

    async function runSearch(e) {
        e?.preventDefault();
        const q = searchQuery.trim();
        if (!q) {
            clearSearch();
            return;
        }

        setIsSearching(true);
        try {
            const allArticles = await db.articles.toArray();
            await ensureAllEmbeddings?.(allArticles);
            const allBriefings = db.briefings ? await db.briefings.toArray() : [];
            await ensureBriefingEmbeddings?.(allBriefings);

            const [articleResults, briefingResults] = await Promise.all([
                semanticSearch(q, allArticles),
                semanticSearchBriefings(q, allBriefings),
            ]);

            setSearchResults(articleResults);
            setMatchingBriefings(briefingResults);
            setStatusMsg(
                `Found ${articleResults.length} article(s) and ${briefingResults.length} briefing note(s).`
            );
        } catch (err) {
            console.error(err);
            setStatusMsg('Search error: ' + err.message);
        } finally {
            setIsSearching(false);
        }
    }

    return {
        searchQuery,
        isSearching,
        visibleArticles,
        matchingBriefings,
        updateQuery,
        runSearch,
        clearSearch,
    };
}