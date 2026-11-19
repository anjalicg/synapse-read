const MAX_SUMMARY_CHARS = 6000;
const DIGEST_TIMEOUT_MS = 10000;

function withTimeout(promise, ms, label = 'Operation') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
        ? await self.LanguageModel.availability({ outputLanguage: 'en' })
        : 'unavailable';

    return { summarizer, prompt };
}

/**
 * Generates a short 2-3 sentence digest with a 10-second fallback timeout.
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
                    onProgress?.(`Downloading Gemini Nano (${pct}%)...`);
                });
            },
        });

        onProgress?.('Summarizing locally...');
        const trimmed = text.slice(0, MAX_SUMMARY_CHARS);
        const digest = await withTimeout(
            summarizer.summarize(trimmed),
            DIGEST_TIMEOUT_MS,
            'Digest'
        );
        return digest.trim();
    } catch (err) {
        console.warn('Summarizer fallback triggered:', err.message);
        return fallbackSnippet;
    } finally {
        summarizer?.destroy();
    }
}

export function buildBriefingPrompt(articles) {
    const formatted = articles
        .map((a, idx) => {
            const body = a.digest || a.content?.slice(0, 400) || '(Link only - no extracted text)';
            return `[${idx + 1}] Title: ${a.title}\nURL: ${a.url}\nDigest: ${body}`;
        })
        .join('\n\n');

    return `Here are ${articles.length} articles saved during the selected period:\n\n${formatted}\n\nTask:
1. Pick the top 3 most insightful articles.
2. Write a cohesive 2-minute text briefing summarizing their key takeaways.
3. Cite each article inline using its exact Markdown link: [Title](URL).
4. Add a brief "Emerging Themes" bullet list at the end if any articles connect.`;
}

export async function generateBriefing(articles, onProgress) {
    if (!('LanguageModel' in self)) {
        throw new Error('Chrome Built-in Prompt API is not available in this browser.');
    }

    const availability = await self.LanguageModel.availability({ outputLanguage: 'en' });
    if (availability === 'unavailable') {
        throw new Error('Gemini Nano is unavailable on this device (requires desktop Chrome + 22 GB free disk).');
    }

    let session;
    try {
        session = await self.LanguageModel.create({
            outputLanguage: 'en',
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

        const userPrompt = buildBriefingPrompt(articles);
        const result = await session.prompt(userPrompt);
        return result.trim();
    } finally {
        session?.destroy();
    }
}