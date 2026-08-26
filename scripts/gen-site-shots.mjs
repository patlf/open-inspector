#!/usr/bin/env node
/**
 * Screenshot the panel for the website.
 *
 * Generated rather than captured by hand, like the icons and the promo images:
 * a binary nobody can regenerate drifts from the product the moment the
 * product changes, and this project's whole claim is that you can check it.
 *
 * Two details are load-bearing:
 *
 *  - **`deviceScaleFactor: 2`**, set on the *context* rather than the page,
 *    which is the only place Playwright accepts it. The bento tiles show these
 *    at roughly 500 CSS px; a 1x capture of a 348px panel upscales and goes
 *    soft exactly where the type is smallest.
 *  - **A patched manifest.** `activeTab` cannot be granted under automation, so
 *    one host permission is added to a copy. Only manifest.json differs; every
 *    line of JavaScript is the shipped build.
 */
import { chromium } from '@playwright/test';
import { cpSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'apps/site/public/shots');
const DEMO = 'http://localhost:5178/demo.html';

mkdirSync(OUT, { recursive: true });

const EXTENSION = mkdtempSync(join(tmpdir(), 'oi-site-shots-'));
cpSync(join(ROOT, '.output/chrome-mv3'), EXTENSION, { recursive: true });
const manifestPath = join(EXTENSION, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = ['http://localhost:5178/*'];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

/**
 * Both themes, because the site has both.
 *
 * The panel follows the viewer's colour-scheme preference, and so does the
 * website. Showing a light-mode panel to someone reading the dark-mode site
 * is the sort of detail this project has no business getting wrong.
 */
const SCHEME = process.argv[2] === 'dark' ? 'dark' : 'light';
const SUFFIX = SCHEME === 'dark' ? '-dark' : '';

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oi-site-profile-')), {
  headless: true,
  channel: 'chromium',
  viewport: { width: 1280, height: 820 },
  deviceScaleFactor: 2,
  colorScheme: SCHEME,
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(DEMO, { waitUntil: 'networkidle' });

const tabId = await worker.evaluate(
  async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
);
await worker.evaluate(async (id) => {
  await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content-scripts/inspector.js'] });
  await chrome.tabs.sendMessage(id, { type: 'open-inspector:toggle' });
}, tabId);
await page.waitForTimeout(600);

async function pick(selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(20, box.height / 2);
  await page.mouse.move(x, y);
  await page.waitForTimeout(180);
  await page.mouse.click(x, y);
  await page.waitForTimeout(800);
}

async function openTab(label) {
  await page.evaluate((wanted) => {
    const shadow = document.querySelector('open-inspector-panel').shadowRoot;
    [...shadow.querySelectorAll('.tab')].find((b) => b.textContent.trim() === wanted)?.click();
  }, label);
  await page.waitForTimeout(450);
}

/** Just the panel, cut off below the fold so it bleeds out of its tile. */
async function shoot(name, height = 470) {
  await page.mouse.move(30, 800);
  await page.waitForTimeout(280);
  const box = await page.locator('open-inspector-panel').evaluate((el) => {
    const r = el.shadowRoot.querySelector('.panel').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({
    path: join(OUT, `panel-${name}${SUFFIX}.png`),
    clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, height) },
  });
  console.warn(`  panel-${name}${SUFFIX}.png`);
}

await pick('.card');
await shoot('styles');

await openTab('Layout');
await shoot('layout');

await openTab('Assets');
await shoot('assets');

await openTab('Markup');
await shoot('markup');

await openTab('Export');
await shoot('export');

await pick('h1');
await openTab('Color');
await page.evaluate(() => {
  const shadow = document.querySelector('open-inspector-panel').shadowRoot;
  [...shadow.querySelectorAll('.sample-btn')].find((b) => b.textContent.includes('Scan'))?.click();
});
await page.waitForTimeout(1600);
await shoot('color');

await openTab('Type');
await shoot('type');

await context.close();
console.warn(`\n  ${SCHEME} panel screenshots written to apps/site/public/shots\n`);
