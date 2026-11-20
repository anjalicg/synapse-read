const MAX_SUMMARY_CHARS = 4500;
const DIGEST_TIMEOUT_MS = 25000;

function buildFallbackDigest(content) {
    const clean = (content || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    return clean.length > 280 ? `${clean.slice(0, 277)}...` : clean;
}

export async function checkNanoStatus() {
    try {
        const hasSummarizer = 'Summarizer' in self;
        const hasPrompt = 'LanguageModel' in self;

        const summarizer = hasSummarizer
            ? await self.Summarizer.availability()
            : 'unavailable';

        const prompt = hasPrompt
            ? await self.LanguageModel.availability({
                expectedOutputs: [{ type: 'text', languages: ['en'] }],
            })
            : 'unavailable';

        return { summarizer, prompt };
    } catch (err) {
        console.warn('Nano availability check failed:', err);
        return { summarizer: 'unavailable', prompt: 'unavailable' };
    }
}

export async function generateDigest(content, title = '', onProgress) {
    const cleanText = (content || '').replace(/\s+/g, ' ').trim();
    if (!cleanText) return '';

    if (!('Summarizer' in self)) {
        return buildFallbackDigest(cleanText);
    }

    let summarizer;
    let timeoutId;

    try {
        const availability = await self.Summarizer.availability();
        if (availability === 'unavailable') {
            return buildFallbackDigest(cleanText);
        }

        const needsDownload = availability !== 'available';
        onProgress?.('Generating local digest...');

        summarizer = await self.Summarizer.create({
            type: 'tldr',
            format: 'plain-text',
            length: 'short',
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    if (needsDownload) {
                        const pct = Math.round((e.loaded / (e.total || 1)) * 100);
                        onProgress?.(`Downloading summarizer (${pct}%)...`);
                    }
                });
            },
        });

        const snippet = cleanText.slice(0, MAX_SUMMARY_CHARS);
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`Digest timed out after ${DIGEST_TIMEOUT_MS / 1000}s`));
            }, DIGEST_TIMEOUT_MS);
        });

        const summary = await Promise.race([
            summarizer.summarize(snippet, title ? { context: `Article title: ${title}` } : undefined),
            timeoutPromise,
        ]);

        return summary?.trim() || buildFallbackDigest(cleanText);
    } catch (err) {
        console.warn('Summarizer fallback triggered:', err.message);
        return buildFallbackDigest(cleanText);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        summarizer?.destroy();
    }
}

export function buildBriefingPrompt(articles, archiveMatches = [], dateRange = null) {
    const today = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
    const periodLabel =
        dateRange?.startDate && dateRange?.endDate
            ? `${dateRange.startDate} to ${dateRange.endDate}`
            : today;

    const formatted = articles
        .map((a, idx) => {
            const savedDate = a.savedAt ? new Date(a.savedAt).toLocaleDateString() : 'Unknown';
            const body = a.digest || a.content?.slice(0, 400) || '(Link only - no extracted text)';
            return `[${idx + 1}] Title: ${a.title}\nSaved On: ${savedDate}\nURL: ${a.url}\nDigest: ${body}`;
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
        archiveInstruction = `\n6. Add a "## From Your Archive" section at the end highlighting how those older saved articles connect to this period's reading, citing each with its exact [Title](URL) link and saved date.`;
    }

    return `Today's Date: ${today}
Selected Reading Window: ${periodLabel}

Here are ${articles.length} articles saved during the selected window:\n\n${formatted}${archiveSection}\n\nTask:
1. Start with the exact heading: "## Briefing (${periodLabel})". Do NOT invent or guess any other dates.
2. Pick the top 3 most insightful articles from the selected window.
3. Write a cohesive 2-minute text briefing summarizing their key takeaways.
4. Cite each article inline using its exact Markdown link: [Title](URL).
5. Add a brief "## Emerging Themes" bullet list if any recent articles connect.${archiveInstruction}`;
}

export async function warmupNanoModel(onProgress) {
    if (!('LanguageModel' in self)) {
        throw new Error('Chrome Built-in Prompt API is not available in this browser.');
    }

    const availability = await self.LanguageModel.availability({
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    if (availability === 'unavailable') {
        throw new Error('Gemini Nano is unavailable on this device.');
    }

    onProgress?.(
        'First-time setup: downloading Gemini Nano to your device. This happens only once—future briefings will run much faster.'
    );

    let session;
    try {
        session = await self.LanguageModel.create({
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    const pct = Math.round((e.loaded / (e.total || 1)) * 100);
                    onProgress?.(
                        `First-time setup: downloading Gemini Nano (${pct}%) — happens only once, next runs will be much faster...`
                    );
                });
            },
        });
    } finally {
        session?.destroy();
    }
}

export async function generateBriefing(
    articles,
    archiveMatches = [],
    onProgress,
    dateRange = null
) {
    if (!('LanguageModel' in self)) {
        throw new Error('Chrome Built-in Prompt API is not available in this browser.');
    }

    const availability = await self.LanguageModel.availability({
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    if (availability === 'unavailable') {
        throw new Error('Gemini Nano is unavailable on this device (requires desktop Chrome + 22 GB free disk).');
    }

    const needsDownload = availability !== 'available';
    if (needsDownload) {
        onProgress?.(
            'First-time setup: downloading Gemini Nano to your device. This happens only once—future briefings will be much faster.'
        );
    }

    const today = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });

    let session;
    try {
        session = await self.LanguageModel.create({
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
            initialPrompts: [
                {
                    role: 'system',
                    content: `You are a concise research editor. Today is ${today}. Synthesize saved web articles into a crisp, high-signal text briefing. Always use the exact [Title](URL) links and dates provided; never invent URLs or dates.`,
                },
            ],
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    const pct = Math.round((e.loaded / (e.total || 1)) * 100);
                    onProgress?.(
                        needsDownload
                            ? `First-time setup: downloading Gemini Nano (${pct}%) — happens only once, next runs will be much faster...`
                            : 'Loading Gemini Nano into memory...'
                    );
                });
            },
        });

        const userPrompt = buildBriefingPrompt(articles, archiveMatches, dateRange);
        const result = await session.prompt(userPrompt);
        return result.trim();
    } finally {
        session?.destroy();
    }
}