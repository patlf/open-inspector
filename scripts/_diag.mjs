import { chromium } from '@playwright/test';
import { cpSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/Users/macbook/Documents/GitHub/bi-claude';
const EXT = mkdtempSync(join(tmpdir(), 'oi-ext-'));
cpSync(join(ROOT, '.output/chrome-mv3'), EXT, { recursive: true });
const mf = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
mf.host_permissions = ['http://localhost:5178/*'];
writeFileSync(join(EXT, 'manifest.json'), JSON.stringify(mf));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oi-prof-')), {
  headless: false, channel: 'chromium', viewport: null,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--start-maximized'],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
worker.on('console', (m) => console.log('  SW>', m.text()));

const page = context.pages()[0] ?? (await context.newPage());
await page.goto('http://localhost:5178/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);

const winState = () => worker.evaluate(async (id) => {
  const t = await chrome.tabs.get(id);
  const w = await chrome.windows.get(t.windowId);
  return { state: w.state, width: w.width };
}, tabId);

// Put the window into true fullscreen — the state the hint blames.
await worker.evaluate(async (id) => {
  const t = await chrome.tabs.get(id);
  await chrome.windows.update(t.windowId, { state: 'fullscreen' });
}, tabId);
await page.waitForTimeout(1500);
console.log('FULLSCREEN:', JSON.stringify(await winState()), 'inner', await page.evaluate(() => innerWidth));

// Exactly what the worker does now: leave the state, then size, back to back.
const out = await worker.evaluate(async (id) => {
  const t = await chrome.tabs.get(id);
  const cur = await chrome.windows.get(t.windowId);
  const log = { before: cur.state };
  if (cur.state && cur.state !== 'normal') {
    await chrome.windows.update(t.windowId, { state: 'normal' });
    log.afterStateCall = (await chrome.windows.get(t.windowId)).state;
  }
  try {
    const r = await chrome.windows.update(t.windowId, { width: 768 });
    log.sized = { width: r.width, state: r.state };
  } catch (e) { log.error = String(e); }
  return log;
}, tabId);
console.log('BACK TO BACK:', JSON.stringify(out));
await page.waitForTimeout(1500);
console.log('RESULT:', JSON.stringify(await winState()), 'inner', await page.evaluate(() => innerWidth));
await context.close();
