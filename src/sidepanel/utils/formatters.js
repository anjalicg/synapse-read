export const MAX_NOTE_WORDS = 1000;

export function formatDateInput(date) {
    return date.toISOString().split('T')[0];
}

export function getDateDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return formatDateInput(d);
}

export function countWords(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function buildBriefingEmbedText(userNotes, summaryMarkdown) {
    const notes = (userNotes || '').trim();
    const summary = (summaryMarkdown || '').trim();
    return [notes, summary].filter(Boolean).join('\n\n');
}

export function prepareSpeechChunks(md) {
    return md
        .split('\n')
        .map((line) =>
            line
                .replace(/^#{1,6}\s+/, '')
                .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/^[-*]\s+/, '')
                .trim()
        )
        .filter(Boolean)
        .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`));
}