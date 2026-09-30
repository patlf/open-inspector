#!/usr/bin/env node
/**
 * Capture the call-outs for the launch and store banners.
 *
 * Each banner shows the panel, and beside it one or two things the panel in
 * that image does *not* show: a section further down, a different format, or
 * the highlight on the page itself. An enlarged copy of something already on
 * screen says nothing twice; a second fact says twice as much.
 *
 * Captured from the real extension on the playground demo page, dark scheme,
 * at 3x, into store/launch/src/details/. Requires `pnpm build` and the
 * playground (`pnpm --filter @open-inspector/playground dev`). Re-run after
 * the panel changes, then `pnpm gen:store`.
 */
import { chromium } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'store/launch/src/details');
const LOCAL = 'http://localhost:5178';
// Same reason as gen-site-shots: exports print the page's host.
const PUBLIC = 'https://example.com';

mkdirSync(OUT, { recursive: true });

const EXTENSION = mkdtempSync(join(tmpdir(), 'oi-details-'));
cpSync(join(ROOT, '.output/chrome-mv3'), EXTENSION, { recursive: true });
const manifestPath = join(EXTENSION, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = [`${PUBLIC}/*`];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oi-details-profile-')), {
  headless: true,
  channel: 'chromium',
  // Tall, so a long section fits the viewport and never needs stitching.
  viewport: { width: 1280, height: 1400 },
  deviceScaleFactor: 3,
  colorScheme: 'dark',
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});

await context.route(`${PUBLIC}/**`, async (route) => {
  const url = route.request().url().replace(PUBLIC, LOCAL);
  await route.fulfill({ response: await route.fetch({ url }) });
});

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(`${PUBLIC}/demo.html`, { waitUntil: 'networkidle' });

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
  const x = box.x + Math.min(40, box.width / 2);
  const y = box.y + Math.min(20, box.height / 2);
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  await page.mouse.click(x, y);
  await page.waitForTimeout(900);
}

async function openTab(id) {
  await page.locator(`open-inspector-panel #oi-tab-${id}`).click();
  await page.waitForTimeout(500);
}

/**
 * One section of the panel, by its title.
 *
 * Starts just above the title, not at the section's box, which also holds the
 * divider from the section before.
 */
async function group(title, name, { maxHeight = 1000 } = {}) {
  const section = page
    .locator('open-inspector-panel .group')
    .filter({ has: page.locator('.group-title', { hasText: new RegExp(`^${title}`) }) })
    .first();
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await section.boundingBox();
  const heading = await section.locator('.group-title').boundingBox();
  if (!box || !heading) throw new Error(`no "${title}" section`);

  const bottom = Math.min(box.y + box.height, heading.y + maxHeight);
  // Tight enough to leave out the divider above and the panel's own edge.
  const pad = 9;
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: {
      x: box.x - pad,
      y: heading.y - pad,
      width: box.width + pad * 2,
      height: bottom - heading.y + pad + 4,
    },
  });
  console.warn(`  ${name}.png`);
}

/** The page around an element, with our highlight and size chip on it. */
async function onPage(selector, name) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const margin = 28;
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin - 30),
      width: box.width + margin * 2,
      height: box.height + margin * 2 + 30,
    },
  });
  console.warn(`  ${name}.png`);
}

// Styles: the highlight and size chip on the page itself.
await pick('.card');
await onPage('.card', 'page-card');

// Layout: what the viewport presets exist to test.
await pick('.card');
await openTab('layout');
await group('Breakpoints affecting this element', 'layout-breakpoints');

// Color and Type, on the page's headline.
await pick('h1');
await openTab('color');
await group('Page palette', 'color-palette');
await openTab('type');
await group('Type scale', 'type-scale');

// Export: a second format beside the CSS variables the panel shows.
await pick('.card');
await openTab('export');
await page.locator('open-inspector-panel button', { hasText: /^Tailwind$/ }).click();
await page.waitForTimeout(400);
await group('Tailwind', 'export-tailwind', { maxHeight: 250 });

await context.close();
console.warn('\n  Launch call-outs written to store/launch/src/details\n');
