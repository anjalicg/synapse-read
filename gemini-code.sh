node --input-type=module << 'EOF'
import fs from 'node:fs';

let spec = fs.readFileSync('tests/e2e/production.spec.js', 'utf8');
spec = spec.replace(
  'await context.close();',
  'await Promise.race([context.close(), new Promise((r) => setTimeout(r, 3000))]);'
);
// Replace the second context.close() inside the extension test's finally block as well
spec = spec.replace(
  `  } finally {
    await context.close();`,
  `  } finally {
    await Promise.race([context.close(), new Promise((r) => setTimeout(r, 3000))]);`
);
fs.writeFileSync('tests/e2e/production.spec.js', spec, 'utf8');
console.log('Added bounded context.close() guard in tests/e2e/production.spec.js');
EOF

npm run verify && \
git add -A && \
git commit -m "Fix semantic search, paywall handling, cached Nano sessions, and E2E teardown" && \
git push origin main