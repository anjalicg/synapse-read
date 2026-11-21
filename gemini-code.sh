node --input-type=module << 'EOF'
import fs from 'node:fs';

// 1. Pass outputLanguage: 'en' to Summarizer.availability() & reset cachedSummarizer on timeout/error in src/ai/nano.js
let nano = fs.readFileSync('src/ai/nano.js', 'utf8');
nano = nano.replace(
  'const avail = await self.Summarizer.availability();',
  "const avail = await self.Summarizer.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' });"
);
if (!nano.includes('resetNanoSessions')) {
  nano += `\nexport function resetNanoSessions() {\n  try { cachedSummarizer?.destroy?.(); } catch {}\n  try { cachedBasePromptSession?.destroy?.(); } catch {}\n  cachedSummarizer = null;\n  cachedBasePromptSession = null;\n}\n`;
}
fs.writeFileSync('src/ai/nano.js', nano, 'utf8');
console.log('Updated Summarizer.availability outputLanguage and added resetNanoSessions in src/ai/nano.js');

// 2. Add paywall detection, 25s timeout guard, and user-friendly fallback messages in src/sidepanel/hooks/useArticles.js
let ua = fs.readFileSync('src/sidepanel/hooks/useArticles.js', 'utf8');

ua = ua.replace(
  "import { summarizeArticle } from '../../ai/nano.js';",
  "import { summarizeArticle, resetNanoSessions } from '../../ai/nano.js';"
);

const paywallHelper = `function detectPaywallOrBlockedContent(text) {
  const clean = (text || '').trim();
  if (!clean || clean.length < 220) {
    return 'Full article text was not accessible (the site may require a subscription or JavaScript login).';
  }
  const headAndTail = (clean.slice(0, 800) + ' ' + clean.slice(-800)).toLowerCase();
  const paywallSignals = [
    'subscribe to continue reading',
    'subscribe now to read',
    'already a subscriber',
    'sign in to continue reading',
    'log in to continue reading',
    'create a free account to continue',
    'reached your article limit',
    'unlock this article',
    'for unlimited access',
  ];
  if (clean.length < 1200 && paywallSignals.some((sig) => headAndTail.includes(sig))) {
    return 'Full article text appears blocked by a subscription paywall.';
  }
  return null;
}

function withTimeout(promise, ms, timeoutMessage) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timerId));
}

`;

if (!ua.includes('detectPaywallOrBlockedContent')) {
  ua = ua.replace(
    'function buildArticleEmbeddingText(item) {',
    paywallHelper + 'function buildArticleEmbeddingText(item) {'
  );
}

// Guard runBackgroundDigest with paywall check + 25s timeout + friendly status message
const oldRunBgStart = ua.indexOf('  async function runBackgroundDigest(');
const oldRunBgEnd = ua.indexOf('  // Resumes interrupted digests');
if (oldRunBgStart === -1 || oldRunBgEnd === -1) {
  throw new Error('Could not locate runBackgroundDigest in useArticles.js');
}

const newRunBg = `  async function runBackgroundDigest(id, title, content, userNotes = '', batchPrefix = '') {
    const blockedReason = detectPaywallOrBlockedContent(content);
    if (blockedReason) {
      const friendlyNote = \`Saved link only — \${blockedReason} Tip: paste an excerpt via + Note or use + Scan Page.\`;
      await db.articles.update(id, {
        digest: friendlyNote,
        status: 'saved',
        updatedAt: Date.now(),
      });
      await loadArticles();
      setStatusMsg(friendlyNote);
      setBackgroundStatus('');
      if (onArchiveMutated) onArchiveMutated();
      return;
    }

    try {
      setBackgroundStatus(\`\${batchPrefix}Generating digest... 5% (~5s left)\`);
      const digest = await withTimeout(
        summarizeArticle(content, ({ message }) => {
          setBackgroundStatus(\`\${batchPrefix}\${message}\`);
        }),
        25000,
        'On-device summary timed out (page may be gated or too complex).'
      );
      setBackgroundStatus(\`\${batchPrefix}Indexing semantic vector (~1s left)...\`);
      const textToEmbed = [title, digest, userNotes].filter(Boolean).join('\\n\\n');
      const embedding = await generateEmbedding(textToEmbed);
      await db.articles.update(id, {
        digest,
        embedding,
        status: 'digested',
        updatedAt: Date.now(),
      });
      await loadArticles();
      setBackgroundStatus('Digest & semantic index ready.');
      if (onArchiveMutated) onArchiveMutated();
    } catch (err) {
      console.error('Background digest fallback:', err);
      resetNanoSessions();
      const fallbackDigest = \`Saved post — \${err.message || 'could not summarize automatically'}. You can add highlights via + Note.\`;
      try {
        const fallbackText = [title, content.slice(0, 1200), userNotes]
          .filter(Boolean)
          .join('\\n\\n');
        const embedding = fallbackText ? await generateEmbedding(fallbackText) : null;
        await db.articles.update(id, {
          digest: fallbackDigest,
          status: 'saved',
          updatedAt: Date.now(),
          ...(embedding ? { embedding } : {}),
        });
      } catch {
        await db.articles.update(id, {
          digest: fallbackDigest,
          status: 'saved',
          updatedAt: Date.now(),
        });
      }
      await loadArticles();
      setStatusMsg(fallbackDigest);
      setBackgroundStatus('');
      if (onArchiveMutated) onArchiveMutated();
    }
  }

`;

ua = ua.slice(0, oldRunBgStart) + newRunBg + ua.slice(oldRunBgEnd);

// Also check paywall immediately in saveActiveTab when mode === 'content'
ua = ua.replace(
  "    if (mode === 'content' && content) {\n      runBackgroundDigest(id, title, content, '');\n    } else {",
  `    if (mode === 'content') {
      if (!content) {
        const msg = 'Saved bookmark — page text could not be extracted (likely paywalled or script-gated).';
        await db.articles.update(id, { digest: msg });
        await loadArticles();
        setStatusMsg(msg);
        if (onArchiveMutated) onArchiveMutated();
      } else {
        runBackgroundDigest(id, title, content, '');
      }
    } else {`
);

fs.writeFileSync('src/sidepanel/hooks/useArticles.js', ua, 'utf8');
console.log('Added paywall detection, 25s timeout guard, and user-friendly fallback messages in useArticles.js');
EOF

npm run verify && \
rm -rf /tmp/afterword docs/afterword.zip && \
cp -R dist /tmp/afterword && \
(cd /tmp && zip -r "$OLDPWD/docs/afterword.zip" afterword) && \
cp -f docs/afterword.zip pwa/public/afterword.zip && \
git add -A && \
git commit -m "Handle paywalled articles gracefully with clear message, 25s digest timeout, and outputLanguage fix" && \
git push origin main