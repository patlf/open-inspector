#!/usr/bin/env node
/**
 * The Chrome Web Store screenshots: 1280×800, the real extension over the
 * project's own website.
 *
 * Generated for the same reason as every other image here — a screenshot
 * nobody can regenerate drifts from the product the moment the panel changes,
 * and the store listing is the first thing most people see.
 *
 * Requires the site dev server (`pnpm site:dev`) and a production build
 * (`pnpm build`). The site is served to the browser as `example.com`, because
 * the Export tab prints the page's host into every token file and a dev URL
 * has no business in a store listing.
 */
import { chromium } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'store/screenshots');
const LOCAL = process.env['SITE_ORIGIN'] ?? 'http://localhost:8788';
const PUBLIC = 'https://example.com';

mkdirSync(OUT, { recursive: true });

// Host access for this capture only, so the script can inject without a click.
const EXTENSION = mkdtempSync(join(tmpdir(), 'oi-store-shots-'));
cpSync(join(ROOT, '.output/chrome-mv3'), EXTENSION, { recursive: true });
const manifestPath = join(EXTENSION, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = [`${PUBLIC}/*`];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oi-store-profile-')), {
  headless: true,
  channel: 'chromium',
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});

await context.route(`${PUBLIC}/**`, async (route) => {
  const url = route.request().url().replace(PUBLIC, LOCAL);
  await route.fulfill({ response: await route.fetch({ url }) });
});

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(`${PUBLIC}/`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const tabId = await worker.evaluate(
  async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
);
await worker.evaluate(async (id) => {
  await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content-scripts/inspector.js'] });
  await chrome.tabs.sendMessage(id, { type: 'open-inspector:toggle' });
}, tabId);
await page.waitForTimeout(600);

/** Scroll the target into the left of the page, then hover and click it. */
async function pick(selector) {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(300);
  const box = await target.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + Math.min(40, box.width / 2);
  const y = box.y + Math.min(20, box.height / 2);
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  await page.mouse.click(x, y);
  await page.waitForTimeout(900);
}

async function openTab(id) {
  const found = await page.evaluate((tab) => {
    const button = document.querySelector('open-inspector-panel').shadowRoot.querySelector(`#oi-tab-${tab}`);
    button?.click();
    return Boolean(button);
  }, id);
  if (!found) throw new Error(`no ${id} tab`);
  await page.waitForTimeout(450);
}

async function shoot(name) {
  // Park the pointer in a corner of the page: a pinned selection ignores it,
  // and nothing in the panel is left in a hover state.
  await page.mouse.move(8, 792);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.warn(`  ${name}.png`);
}

// The "asks for nothing" card: a real padded, bordered box, and the claim itself.
const CARD = '.ask[data-ours="true"]';

await pick(CARD);
await shoot('01-styles');

await pick('h1');
await openTab('color');
await page.evaluate(() => {
  const shadow = document.querySelector('open-inspector-panel').shadowRoot;
  [...shadow.querySelectorAll('button')].find((b) => /scan/i.test(b.textContent ?? ''))?.click();
});
await page.waitForTimeout(1600);
await shoot('02-contrast');

await pick(CARD);
await openTab('layout');
await shoot('03-layout');

await openTab('export');
await shoot('04-export');

await pick('h1');
await openTab('type');
await shoot('05-type');

await context.close();
console.warn('\n  Store screenshots written to store/screenshots\n');
