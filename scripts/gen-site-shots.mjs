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
 *  - **`deviceScaleFactor: 3`**, set on the *context* rather than the page,
 *    which is the only place Playwright accepts it. The panel is 348 CSS px
 *    wide and the tiles render it at up to 420, which a 2x display turns into
 *    840 device px of demand — more than a 2x capture's 696 can supply, so it
 *    was being upscaled and going soft exactly where the type is smallest.
 *    3x gives 1044 and covers every breakpoint with room, and costs nothing in
 *    the end — `pnpm gen:shots` runs both themes and then an optimise pass that
 *    more than pays the extra pixels back.
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
/*
 * Raw, not published.
 *
 * These go through `frame-site-shots.mjs` before they reach the site. Writing
 * the raw capture straight into public/ would mean the framing pass had to read
 * its own output, and framing is not idempotent — the second run would put a
 * backdrop on a backdrop.
 */
const OUT = join(ROOT, '.output/shots-raw');
/*
 * Served under a neutral public-looking origin, not localhost.
 *
 * The Export tab writes the page's host into the header of every token file,
 * and the published shot said `/* localhost:5178 *\/` — a dev URL in the
 * middle of the marketing. `example.com` is reserved for exactly this; every
 * request to it is answered from the local playground, so nothing leaves the
 * machine.
 */
const LOCAL = 'http://localhost:5178';
const PUBLIC = 'https://example.com';
const DEMO = `${PUBLIC}/demo.html`;

mkdirSync(OUT, { recursive: true });

const EXTENSION = mkdtempSync(join(tmpdir(), 'oi-site-shots-'));
cpSync(join(ROOT, '.output/chrome-mv3'), EXTENSION, { recursive: true });
const manifestPath = join(EXTENSION, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = [`${PUBLIC}/*`];
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
  deviceScaleFactor: 3,
  colorScheme: SCHEME,
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');

await context.route(`${PUBLIC}/**`, async (route) => {
  const url = route.request().url().replace(PUBLIC, LOCAL);
  await route.fulfill({ response: await route.fetch({ url }) });
});

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
  // By id: the rail's tabs are icons, so their text is not something to match.
  const found = await page.evaluate((id) => {
    const tab = document.querySelector('open-inspector-panel').shadowRoot.querySelector(`#oi-tab-${id}`);
    tab?.click();
    return Boolean(tab);
  }, label.toLowerCase());
  if (!found) throw new Error(`no ${label} tab — did the panel's tab ids change?`);
  await page.waitForTimeout(450);
}

/**
 * Just the panel, cut off below the fold so it bleeds out of its tile.
 *
 * 507 rather than a round number, because a crop height is not a free choice:
 * the image's bottom edge is visible in the hero and the README banner, and a
 * cut through a row of type or a value field slices it in half. Every height
 * from 440 to 520 was scored for sharp light/dark transitions along the cut
 * across all fourteen captures; 507 is the only one near the old height that
 * `pnpm check:shots` passes on every panel. It was 458 for the previous panel
 * layout — re-score whenever the panel's spacing changes (`SHOT_HEIGHT=560`
 * captures tall raws to score against).
 */
// `SHOT_HEIGHT` overrides the crop, for re-scoring it after the panel changes.
const CROP = Number(process.env['SHOT_HEIGHT']) || 507;

/**
 * Per-shot crop overrides, for re-scoring one capture without the rest:
 * `SHOT_HEIGHT_EXPORT=545` and so on. Unset, every shot shares `CROP`.
 */
const CROPS = {};
for (const name of ['styles', 'layout', 'assets', 'markup', 'export', 'color', 'type']) {
  const override = Number(process.env[`SHOT_HEIGHT_${name.toUpperCase()}`]);
  if (override) CROPS[name] = override;
}

async function shoot(name, height = CROPS[name] ?? CROP) {
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
/*
 * Export ends in a code block taller than the crop leaves room for, so any
 * shared height cuts through a line of it. Scroll the panel just enough that
 * the block ends above the cut — the image then keeps the same height as the
 * others, which the site's walkthrough relies on to switch tabs without a jump.
 */
await page.evaluate((crop) => {
  const shadow = document.querySelector('open-inspector-panel').shadowRoot;
  const panel = shadow.querySelector('.panel').getBoundingClientRect();
  const body = shadow.querySelector('#oi-tabpanel');
  const block = body.querySelector('pre')?.getBoundingClientRect();
  if (block) body.scrollTop += Math.max(0, block.bottom - panel.top - (crop - 14));
}, CROPS['export'] ?? CROP);
await page.waitForTimeout(150);
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
console.warn(`\n  ${SCHEME} panel screenshots captured to .output/shots-raw\n`);
