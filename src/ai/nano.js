
const MAX_SUMMARY_CHARS = 4500;
const DIGEST_TIMEOUT_MS = 25000;

export async function checkNanoStatus() {
    const hasSummarizer = 'Summarizer' in self;
    const hasPrompt = 'LanguageModel' in self;

    if (!hasSummarizer && !hasPrompt) {
        return { summarizer: 'unavailable', prompt: 'unavailable' };
    }

    const summarizer = hasSummarizer
        ? await self.Summarizer.availability({ outputLanguage: 'en' })
        : 'unavailable';
    const prompt = hasPrompt
        ? await self.LanguageModel.availability({
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
        })
        : 'unavailable';

    return { summarizer, prompt };
}

/**
 * Generates a short 2-3 sentence digest when an article is saved.
 * Falls back to a simple text snippet if Gemini Nano is unavailable.
 */
export async function generateDigest(text, title = '', onProgress) {
    if (!text?.trim()) return '';

    const fallbackSnippet = text.replace(/\s+/g, ' ').slice(0, 280).trim() + '...';

    if (!('Summarizer' in self)) return fallbackSnippet;

    const availability = await self.Summarizer.availability({ outputLanguage: 'en' });
    if (availability === 'unavailable') return fallbackSnippet;

    let summarizer;
    try {
        summarizer = await self.Summarizer.create({
            type: 'tldr',
            length: 'short',
            format: 'plain-text',
            outputLanguage: 'en',
            sharedContext: title ? `Article title: ${title}` : undefined,
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    const pct = Math.round((e.loaded / (e.total || 1)) * 100);
                    console.log(`Gemini Nano download: ${pct}%`);
                    onProgress?.(`Downloading Gemini Nano (${pct}%)...`);
                });
            },
        });

        onProgress?.('Summarizing locally...');
        const trimmed = text.slice(0, MAX_SUMMARY_CHARS);
        const digest = await summarizer.summarize(trimmed);
        return digest.trim();
    } catch (err) {
        console.warn('Summarizer API failed, using fallback snippet:', err);
        return fallbackSnippet;
    } finally {
        summarizer?.destroy();
    }
}

/**
 * Builds the map-reduce prompt using pre-computed digests so wide date windows
 * (e.g., 30 days) fit comfortably inside Gemini Nano's local context window.
 */
export function buildBriefingPrompt(articles, archiveMatches = []) {
    const formatted = articles
        .map((a, idx) => {
            const body = a.digest || a.content?.slice(0, 400) || '(Link only - no extracted text)';
            return `[${idx + 1}] Title: ${a.title}\nURL: ${a.url}\nDigest: ${body}`;
        })
        .join('\n\n');

    let archiveSection = '';
    let archiveInstruction = '';

    if (archiveMatches.length > 0) {
        const formattedArchive = archiveMatches
            .map((a, idx) => {
                const savedDate = new Date(a.savedAt).toLocaleDateString();
                const body = a.digest || a.content?.slice(0, 300) || '(Link only)';
                return `[A${idx + 1}] Title: ${a.title}\nURL: ${a.url}\nSaved On: ${savedDate}\nConnects To: "${a.matchedWith}"\nDigest: ${body}`;
            })
            .join('\n\n');

        archiveSection = `\n\nForgotten Connections from Older Archive:\n${formattedArchive}`;
        archiveInstruction = `\n5. Add a "## From Your Archive" section at the end highlighting how those older saved articles connect to this period's reading, citing each with its exact [Title](URL) link and saved date.`;
    }

    return `Here are ${articles.length} articles saved during the selected period:\n\n${formatted}${archiveSection}\n\nTask:
1. Pick the top 3 most insightful articles from the selected period.
2. Write a cohesive 2-minute text briefing summarizing their key takeaways.
3. Cite each article inline using its exact Markdown link: [Title](URL).
4. Add a brief "## Emerging Themes" bullet list if any recent articles connect.${archiveInstruction}`;
}

/**
 * Generates the on-demand briefing using Chrome's built-in Prompt API (Gemini Nano).
 */
export async function generateBriefing(articles, archiveMatches = [], onProgress) {
    if (!('LanguageModel' in self)) {
        throw new Error('Chrome Built-in Prompt API is not available in this browser.');
    }

    const availability = await self.LanguageModel.availability({
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    if (availability === 'unavailable') {
        throw new Error('Gemini Nano is unavailable on this device (requires desktop Chrome + 22 GB free disk).');
    }

    let session;
    try {
        session = await self.LanguageModel.create({
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
            initialPrompts: [
                {
                    role: 'system',
                    content:
                        'You are a concise research editor. Synthesize saved web articles into a crisp, high-signal text briefing. Always use the exact [Title](URL) links provided and never invent URLs.',
                },
            ],
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    const pct = Math.round((e.loaded / (e.total || 1)) * 100);
                    onProgress?.(`Downloading Gemini Nano (${pct}%)...`);
                });
            },
        });

        const userPrompt = buildBriefingPrompt(articles, archiveMatches);
        const result = await session.prompt(userPrompt);
        return result.trim();
    } finally {
        session?.destroy();
    }
}