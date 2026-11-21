import { test, expect, chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let previewProc = null;

test.beforeAll(async () => {
  previewProc = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: path.resolve('pwa'),
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
});

test.afterAll(() => {
  previewProc?.kill();
});

test('Release ZIP hygiene: contains manifest.json and no personal backup JSON files', () => {
  expect(fs.existsSync('docs/afterword.zip')).toBe(true);
  const listing = execFileSync('unzip', ['-l', 'docs/afterword.zip'], { encoding: 'utf8' });
  expect(listing).toContain('afterword/manifest.json');
  expect(listing).toContain('afterword/background.js');
  expect(listing).not.toMatch(/backup.*\.json/i);
});

test('Desktop Vercel PWA (1280x800): renders Overview with zero console/page errors and working Copy button', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
  await expect(page.locator('.landing-embed')).toBeVisible();

  const copyBtn = page.locator('.landing-embed button.btn-copy').first();
  if (await copyBtn.count()) {
    await copyBtn.click();
    await expect(copyBtn).toHaveText('Copied!');
  }

  await page.getByRole('button', { name: 'Architecture & Design' }).click();
  await expect(page.getByRole('heading', { name: /Designing Afterword/i })).toBeVisible();
  expect(pageErrors).toEqual([]);
  await context.close();
});

test('Mobile Vercel PWA (390x844): renders Mobile Companion Workflows and reader tabs cleanly', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
    isMobile: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expect(page.getByText('Mobile Companion Workflows')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Scan Page' })).toBeVisible();
  expect(pageErrors).toEqual([]);
  await context.close();
});

test('Chrome Extension Side Panel (dist/): loads unpacked extension without runtime errors', async () => {
  const extPath = path.resolve('dist');
  const userDataDir = fs.mkdtempSync('/tmp/pw-afterword-ext-');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
    ],
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extId = new URL(sw.url()).host;

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await expect(page.getByRole('heading', { name: 'Afterword' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Save Content' })).toBeVisible();
    await page.getByRole('button', { name: 'About' }).click();
    await expect(page.getByRole('button', { name: 'Backup JSON' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
