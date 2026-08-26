#!/usr/bin/env node
/**
 * shotkit — screenshots that look like a product, not a bug report.
 *
 * Three commands:
 *
 *   capture   drive a headless browser to a clean, deterministic raw shot
 *   frame     composite that shot onto a backdrop: padding, radius, layered
 *             shadow, optional window chrome, annotations
 *   check     lint a finished shot for the defects that make one look cheap
 *
 * The frame is rendered as HTML and screenshotted, rather than composited with
 * an image library, for one reason: CSS already has layered box-shadows,
 * gradients, backdrop-filter, subpixel-accurate rounded clipping and real font
 * rendering. Re-implementing a penumbra in Node would be worse and slower.
 *
 * The one rule the renderer never breaks: the source pixels are placed 1:1 on
 * the output raster. The image is displayed at exactly naturalWidth / scale CSS
 * pixels and positioned on a whole device pixel, so it is never resampled.
 * Everything soft-looking about a bad screenshot starts with resampling.
 *
 * No dependencies. Uses Playwright if it can be resolved, otherwise a local
 * Chrome/Chromium binary in headless mode.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

/* ------------------------------------------------------------------ args -- */

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const eq = arg.indexOf('=');
    if (eq !== -1) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) flags[key] = argv[++i];
    else flags[key] = true;
  }
  return { positional, flags };
}

const num = (value, fallback) => (value === undefined ? fallback : Number(value));
const bool = (value, fallback = false) =>
  value === undefined ? fallback : value !== 'false' && value !== '0';

function fail(message) {
  console.error(`shotkit: ${message}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- images -- */

/**
 * Dimensions without an image library.
 *
 * Needed *before* the page is built, because the page is sized to fit the shot
 * exactly — that is what avoids a clip step, and a clip step is where fractional
 * offsets and resampling creep in.
 */
function imageSize(file) {
  const buf = readFileSync(file);

  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 1) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // Standalone markers carry no length field.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }

  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
    return {
      width: Number(/pixelWidth:\s*(\d+)/.exec(out)[1]),
      height: Number(/pixelHeight:\s*(\d+)/.exec(out)[1]),
    };
  } catch {
    fail(`cannot read the dimensions of ${file} (supported: png, jpeg, or any format sips can read)`);
  }
}

/**
 * Inlined rather than referenced by file:// URL.
 *
 * A data: URI is same-origin, so the page may read it back through a canvas —
 * which `--bg auto` and `check` both need. A file:// image on a file:// page
 * taints the canvas unless Chrome is launched with a flag that also weakens it
 * for everything else.
 */
function dataUri(file) {
  const ext = extname(file).toLowerCase();
  const mime =
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : ext === '.avif' ? 'image/avif'
    : 'image/png';
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

/* -------------------------------------------------------------- backends -- */

async function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
    try {
      const mod = await import(name);
      if (mod.chromium) return mod.chromium;
    } catch { /* try the next one */ }
  }
  return null;
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  return CHROME_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

/**
 * Render an HTML string to a PNG at an exact size.
 *
 * `transparent` matters for `--bg transparent`: the shot keeps its rounded
 * corners and shadow as real alpha, so it can be dropped onto a page whose
 * background is not known at capture time.
 */
async function renderHtml({ html, width, height, scale, transparent, out, quality }) {
  const chromium = await loadPlaywright();
  const isJpeg = /\.jpe?g$/i.test(out);

  if (chromium) {
    const browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: Math.ceil(width), height: Math.ceil(height) },
      deviceScaleFactor: scale,
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    await page.screenshot({
      path: out,
      omitBackground: transparent,
      type: isJpeg ? 'jpeg' : 'png',
      ...(isJpeg ? { quality: quality ?? 92 } : {}),
    });
    await browser.close();
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    fail('needs Playwright or a local Chrome/Chromium.\n' +
         '  npm i -D playwright && npx playwright install chromium\n' +
         '  …or set CHROME_PATH to a Chrome binary.');
  }
  if (isJpeg) fail('jpeg output needs Playwright; install it or write a .png');

  const dir = mkdtempSync(join(tmpdir(), 'shotkit-'));
  const page = join(dir, 'frame.html');
  writeFileSync(page, html);
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--force-device-scale-factor=${scale}`,
    `--window-size=${Math.ceil(width)},${Math.ceil(height)}`,
    ...(transparent ? ['--default-background-color=00000000'] : []),
    '--virtual-time-budget=3000',
    `--screenshot=${out}`,
    `file://${page}`,
  ], { stdio: 'ignore' });
}

/** Run JS against an HTML string and get a JSON value back, on either backend. */
async function evaluateInPage(html, fnSource) {
  const chromium = await loadPlaywright();
  if (chromium) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const value = await page.evaluate(`(${fnSource})()`);
    await browser.close();
    return value;
  }

  const chrome = findChrome();
  if (!chrome) fail('needs Playwright or a local Chrome/Chromium (see `shotkit help`)');

  const dir = mkdtempSync(join(tmpdir(), 'shotkit-eval-'));
  const file = join(dir, 'eval.html');
  writeFileSync(file, `${html}
<script>
  (async () => {
    const value = await (${fnSource})();
    const sink = document.createElement('pre');
    sink.id = 'shotkit-result';
    sink.textContent = JSON.stringify(value);
    document.body.appendChild(sink);
  })();
</script>`);
  const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', `file://${file}`,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const match = /<pre id="shotkit-result">([\s\S]*?)<\/pre>/.exec(dom);
  if (!match) fail('could not read the analysis back out of the page');
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return JSON.parse(decode(match[1]));
}

/* -------------------------------------------------------------- presets --- */

/**
 * Shadows are stacked, not single.
 *
 * A real shadow is darkest and tightest where the object meets the surface and
 * fades out over a much larger radius. One `0 20px 60px rgba(0,0,0,.3)` gives
 * you a uniform grey halo with no contact — it is the single clearest tell of a
 * screenshot that was decorated rather than lit. `reach` is roughly how far the
 * shadow travels, and is what the minimum padding is derived from: a shadow
 * clipped by the canvas edge looks like a rendering bug.
 */
const SHADOWS = {
  none: { css: 'none', reach: 0 },
  contact: {
    reach: 18,
    css: '0 1px 1px rgba(12,16,20,.05), 0 2px 3px rgba(12,16,20,.05), 0 5px 8px rgba(12,16,20,.06)',
  },
  soft: {
    reach: 64,
    css: [
      '0 1px 1px rgba(12,16,20,.04)',
      '0 2px 4px rgba(12,16,20,.04)',
      '0 6px 10px rgba(12,16,20,.05)',
      '0 14px 22px rgba(12,16,20,.06)',
      '0 28px 44px rgba(12,16,20,.07)',
      '0 52px 80px rgba(12,16,20,.09)',
    ].join(', '),
  },
  deep: {
    reach: 110,
    css: [
      '0 2px 3px rgba(8,11,14,.06)',
      '0 5px 9px rgba(8,11,14,.07)',
      '0 12px 22px rgba(8,11,14,.08)',
      '0 26px 44px rgba(8,11,14,.10)',
      '0 50px 84px rgba(8,11,14,.13)',
      '0 90px 140px rgba(8,11,14,.16)',
    ].join(', '),
  },
  lifted: {
    reach: 150,
    css: [
      '0 3px 5px rgba(8,11,14,.07)',
      '0 9px 16px rgba(8,11,14,.08)',
      '0 22px 38px rgba(8,11,14,.10)',
      '0 46px 76px rgba(8,11,14,.13)',
      '0 88px 132px rgba(8,11,14,.16)',
      '0 150px 210px rgba(8,11,14,.18)',
    ].join(', '),
  },
};

/**
 * Backdrops.
 *
 * Deliberately low-chroma. A screenshot is the subject; a saturated gradient
 * behind it competes for the same attention and dates the image to whatever
 * year that gradient was fashionable. Every one of these is a two-stop linear
 * gradient at 160deg, which reads as light falling from above-left without
 * announcing itself as a gradient.
 */
const BACKDROPS = {
  paper: 'linear-gradient(160deg, #fdfcfa 0%, #f0ece5 100%)',
  slate: 'linear-gradient(160deg, #eef1f4 0%, #d9e0e7 100%)',
  sand: 'linear-gradient(160deg, #f7f1e8 0%, #e9dcc9 100%)',
  mint: 'linear-gradient(160deg, #eef6f2 0%, #d6e9de 100%)',
  blush: 'linear-gradient(160deg, #faf0ee 0%, #efd9d6 100%)',
  dusk: 'linear-gradient(160deg, #2b303b 0%, #171a21 100%)',
  ink: 'linear-gradient(160deg, #1c2126 0%, #0d1013 100%)',
  graphite: 'linear-gradient(160deg, #33383d 0%, #202428 100%)',
};

/** Whole looks, so a set of shots can be made consistent with one word. */
const PRESETS = {
  clean: { bg: 'auto', pad: '9%', radius: 10, shadow: 'soft', chrome: 'none', hairline: true },
  mac: { bg: 'auto', pad: '10%', radius: 12, shadow: 'deep', chrome: 'mac', hairline: true },
  browser: { bg: 'slate', pad: '10%', radius: 12, shadow: 'deep', chrome: 'browser', hairline: true },
  hero: { bg: 'auto', pad: '14%', radius: 14, shadow: 'lifted', chrome: 'mac', hairline: true },
  docs: { bg: 'transparent', pad: 28, radius: 8, shadow: 'contact', chrome: 'none', hairline: true },
  flat: { bg: 'auto', pad: '7%', radius: 8, shadow: 'none', chrome: 'none', hairline: true },
  bare: { bg: 'transparent', pad: 0, radius: 10, shadow: 'none', chrome: 'none', hairline: false },
};

const CHROME_HEIGHT = { none: 0, mac: 30, 'mac-dark': 30, browser: 44, 'browser-dark': 44 };

/* ------------------------------------------------------------ background -- */

/**
 * Derive a backdrop from the shot itself.
 *
 * Sampling the edge pixels and shifting lightness in OKLCH keeps the backdrop
 * in the same colour family as the UI, so the pair reads as one object under
 * one light. Chroma is capped hard: a screenshot with a red banner along the
 * top should not end up on a pink card.
 *
 * Returned as a source string evaluated in the page, because the sampling needs
 * a canvas and the canvas needs the image already decoded.
 */
const AUTO_BG_FN = `async () => {
  const img = document.getElementById('shot');
  await img.decode();
  const canvas = document.createElement('canvas');
  const w = canvas.width = Math.min(img.naturalWidth, 400);
  const h = canvas.height = Math.min(img.naturalHeight, 400);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  // A ring just inside the edge: the frame of the UI, not its busy middle.
  let r = 0, g = 0, b = 0, n = 0;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x < band || y < band || x >= w - band || y >= h - band;
      if (!edge) continue;
      const i = (y * w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  r /= n; g /= n; b /= n;

  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  const C = Math.min(Math.hypot(A, Bb), 0.045);
  const H = (Math.atan2(Bb, A) * 180) / Math.PI;

  // Dark UI sits on a darker backdrop; light UI on a slightly darker one too.
  // Lifting a light UI onto a lighter backdrop erases its own edges.
  const dark = L < 0.5;
  const near = dark ? Math.max(0.10, L - 0.06) : Math.max(0.86, Math.min(0.965, L - 0.035));
  const far  = dark ? Math.max(0.05, L - 0.13) : Math.max(0.78, near - 0.075);

  const stop = (light, chroma) => 'oklch(' + light.toFixed(4) + ' ' + chroma.toFixed(4) + ' ' + H.toFixed(1) + ')';
  return {
    dark,
    css: 'linear-gradient(160deg, ' + stop(near, C * 0.9) + ' 0%, ' + stop(far, C * 1.15) + ' 100%)',
  };
}`;

/* ---------------------------------------------------------- window chrome -- */

function chromeMarkup(kind, title, width) {
  if (kind === 'none') return '';
  const dark = kind.endsWith('-dark');
  const lights = `
    <span class="light" style="background:#ff5f57"></span>
    <span class="light" style="background:#febc2e"></span>
    <span class="light" style="background:#28c840"></span>`;

  if (kind.startsWith('mac')) {
    return `<div class="chrome mac ${dark ? 'dark' : ''}">
      <div class="lights">${lights}</div>
      ${title ? `<div class="title">${escapeHtml(title)}</div>` : ''}
    </div>`;
  }

  return `<div class="chrome browser ${dark ? 'dark' : ''}">
    <div class="lights">${lights}</div>
    <div class="omnibox" style="max-width:${Math.max(120, width - 190)}px">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
        <rect x="3.2" y="7" width="9.6" height="7" rx="1.4"/><path d="M5.4 7V4.8a2.6 2.6 0 0 1 5.2 0V7"/>
      </svg>
      <span>${escapeHtml(title || 'example.com')}</span>
    </div>
  </div>`;
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ----------------------------------------------------------- annotations -- */

/**
 * Coordinates are in source-image CSS pixels — i.e. natural pixels divided by
 * `--scale`, the same space the shot is laid out in. Anything else forces the
 * caller to redo the DPR arithmetic every time they move an arrow 4px.
 */
function annotationMarkup(items, accent) {
  if (!items.length) return '';

  const shapes = items.map((item, index) => {
    const { type } = item;
    if (type === 'box' || type === 'highlight') {
      return `<div class="anno-box" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px"></div>`;
    }
    if (type === 'spotlight') {
      return `<div class="anno-spot" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px"></div>`;
    }
    if (type === 'blur') {
      return `<div class="anno-blur" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px"></div>`;
    }
    if (type === 'redact') {
      return `<div class="anno-redact" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px"></div>`;
    }
    if (type === 'badge') {
      return `<div class="anno-badge" style="left:${item.x}px;top:${item.y}px">${escapeHtml(item.label ?? item.n ?? index + 1)}</div>`;
    }
    if (type === 'text') {
      return `<div class="anno-text" style="left:${item.x}px;top:${item.y}px;${item.width ? `max-width:${item.width}px` : ''}">${escapeHtml(item.text)}</div>`;
    }
    if (type === 'arrow') {
      const [x1, y1] = item.from;
      const [x2, y2] = item.to;
      // A slight bow reads as drawn rather than computed; the control point is
      // offset perpendicular to the line so the curve always bends the same way.
      const bend = item.bend ?? 0.18;
      const mx = (x1 + x2) / 2 - (y2 - y1) * bend;
      const my = (y1 + y2) / 2 + (x2 - x1) * bend;
      return `<svg class="anno-arrow" aria-hidden="true">
        <defs><marker id="head${index}" viewBox="0 0 10 10" refX="8.5" refY="5"
          markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="${accent}"/></marker></defs>
        <path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" fill="none" stroke="${accent}"
          stroke-width="3" stroke-linecap="round" marker-end="url(#head${index})"/>
      </svg>`;
    }
    return '';
  });

  return `<div class="annotations">${shapes.join('\n')}</div>`;
}

/* ---------------------------------------------------------------- frame --- */

function buildHtml(opts) {
  const {
    uri, imgW, imgH, pageW, pageH, shotX, shotY, shotW, radius, shadow, chrome,
    chromeHeight, title, hairline, background, transparent, annotations, accent, tint, autoBg,
  } = opts;

  const backdrop = transparent ? 'transparent' : background;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${pageW}px; height: ${pageH}px;
    overflow: hidden;
    background: ${backdrop};
    -webkit-font-smoothing: antialiased;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif;
  }
  .shot {
    position: absolute;
    left: ${shotX}px; top: ${shotY}px;
    width: ${shotW}px;
    border-radius: ${radius}px;
    overflow: hidden;
    box-shadow: ${shadow};
    /* Promote to its own layer: without it, a large multi-layer shadow is
       rasterised into the page backing store and can band on gradients. */
    will-change: transform;
  }
  ${hairline ? `.shot::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    border-radius: ${radius}px;
    box-shadow: inset 0 0 0 1px rgba(${autoBg?.dark ? '255,255,255,.14' : '16,20,24,.09'});
  }` : ''}
  #shot {
    display: block;
    width: ${imgW}px; height: ${imgH}px;
    /* The source is placed 1:1 on the raster; never let the UA resample it. */
    image-rendering: -webkit-optimize-contrast;
  }
  ${tint ? `.tint { position:absolute; inset:0; background:${tint}; mix-blend-mode:multiply; pointer-events:none; }` : ''}

  .chrome { display: flex; align-items: center; gap: 10px; padding: 0 12px; position: relative; }
  .chrome.mac { height: ${CHROME_HEIGHT.mac}px; background: #e9e9eb; box-shadow: inset 0 -1px 0 rgba(0,0,0,.08); }
  .chrome.mac.dark { background: #33343a; box-shadow: inset 0 -1px 0 rgba(255,255,255,.07); }
  .chrome.browser { height: ${CHROME_HEIGHT.browser}px; background: #e4e5e8; box-shadow: inset 0 -1px 0 rgba(0,0,0,.09); }
  .chrome.browser.dark { background: #2c2d31; box-shadow: inset 0 -1px 0 rgba(255,255,255,.07); }
  .lights { display: flex; gap: 7px; flex: none; }
  .light { width: 11px; height: 11px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.12); }
  .chrome .title {
    position: absolute; left: 0; right: 0; text-align: center;
    font-size: 12px; font-weight: 500; color: #5c5c60; pointer-events: none;
  }
  .chrome.dark .title { color: #a5a5ab; }
  .omnibox {
    display: flex; align-items: center; gap: 6px; margin-left: 6px;
    height: 26px; padding: 0 12px; border-radius: 13px;
    background: #f7f8f9; color: #5c5c60;
    font-size: 12px; white-space: nowrap; overflow: hidden;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,.06);
  }
  .chrome.dark .omnibox { background: #1e1f23; color: #a5a5ab; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
  .omnibox span { overflow: hidden; text-overflow: ellipsis; }

  .annotations { position: absolute; left: 0; top: ${chromeHeight}px; width: ${imgW}px; height: ${imgH}px; }
  .anno-box {
    position: absolute; border: 3px solid ${accent}; border-radius: 6px;
    box-shadow: 0 0 0 1px rgba(255,255,255,.5), 0 6px 18px rgba(0,0,0,.18);
  }
  .anno-spot {
    position: absolute; border-radius: 6px;
    box-shadow: 0 0 0 9999px rgba(10,13,16,.55);
  }
  .anno-blur { position: absolute; backdrop-filter: blur(9px) saturate(.55); border-radius: 4px; }
  .anno-redact { position: absolute; background: #14181c; border-radius: 4px; }
  .anno-badge {
    position: absolute; transform: translate(-50%, -50%);
    min-width: 26px; height: 26px; padding: 0 7px; border-radius: 13px;
    background: ${accent}; color: #fff;
    font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 6px rgba(0,0,0,.28), 0 0 0 2px rgba(255,255,255,.85);
  }
  .anno-text {
    position: absolute; padding: 6px 10px; border-radius: 7px;
    background: rgba(20,24,28,.92); color: #fff; font-size: 13px; line-height: 1.35;
    box-shadow: 0 4px 14px rgba(0,0,0,.24);
  }
  .anno-arrow { position: absolute; inset: 0; overflow: visible; }
</style></head>
<body>
  <div class="shot">
    ${chromeMarkup(chrome, title, shotW)}
    <img id="shot" src="${uri}" alt="">
    ${tint ? '<div class="tint"></div>' : ''}
    ${annotationMarkup(annotations, accent)}
  </div>
</body></html>`;
}

function resolvePad(spec, shortSide, minimum) {
  if (spec === undefined) return Math.max(minimum, Math.round(shortSide * 0.09));
  const raw = String(spec).trim();
  const value = raw.endsWith('%') ? Math.round(shortSide * (parseFloat(raw) / 100)) : Number(raw);
  if (!Number.isFinite(value)) fail(`--pad wants a number or a percentage, got "${spec}"`);
  return value;
}

function resolveBackground(spec) {
  if (!spec || spec === 'auto') return { kind: 'auto' };
  if (spec === 'transparent' || spec === 'none') return { kind: 'transparent' };
  if (BACKDROPS[spec]) return { kind: 'css', css: BACKDROPS[spec] };
  if (/^linear:/.test(spec)) {
    const [a, b, angle = '160'] = spec.slice(7).split(',');
    return { kind: 'css', css: `linear-gradient(${angle}deg, ${a} 0%, ${b} 100%)` };
  }
  if (/^radial:/.test(spec)) {
    const [a, b] = spec.slice(7).split(',');
    return { kind: 'css', css: `radial-gradient(120% 120% at 30% 0%, ${a} 0%, ${b} 100%)` };
  }
  return { kind: 'css', css: spec };
}

async function frameOne(input, outPath, flags) {
  const presetName = flags.preset ?? 'clean';
  const preset = PRESETS[presetName];
  if (!preset) fail(`unknown --preset "${presetName}" (have: ${Object.keys(PRESETS).join(', ')})`);

  const scale = num(flags.scale, 2);
  if (![1, 2, 3].includes(scale)) fail('--scale must be 1, 2 or 3');

  const natural = imageSize(input);
  const imgW = natural.width / scale;
  const imgH = natural.height / scale;

  const chrome = flags.chrome ?? preset.chrome;
  if (!(chrome in CHROME_HEIGHT)) fail(`unknown --chrome "${chrome}" (have: ${Object.keys(CHROME_HEIGHT).join(', ')})`);
  const chromeHeight = CHROME_HEIGHT[chrome];

  const shadowName = flags.shadow ?? preset.shadow;
  const shadow = SHADOWS[shadowName];
  if (!shadow) fail(`unknown --shadow "${shadowName}" (have: ${Object.keys(SHADOWS).join(', ')})`);

  const backgroundSpec = resolveBackground(flags.bg ?? preset.bg);
  const transparent = backgroundSpec.kind === 'transparent';

  const shortSide = Math.min(imgW, imgH);
  const minPad = Math.ceil(shadow.reach * 0.75);
  const padWasAsked = flags.pad !== undefined;
  let pad = resolvePad(flags.pad ?? preset.pad, shortSide, minPad);
  if (pad > 0 && pad < minPad) {
    // The preset's percentage is a proportion, not a promise. On a narrow shot it
    // lands under the shadow's reach, and a clipped shadow reads as a bug — so the
    // preset yields. An explicit --pad is the caller's call, and only gets a warning.
    if (padWasAsked) {
      console.warn(`  note: --pad ${pad} is tighter than the "${shadowName}" shadow reaches (${shadow.reach}px); it will be clipped at the edge`);
    } else {
      pad = minPad;
    }
  }
  // The shadow falls downward, so it needs more room below — and the extra room
  // is also what stops the shot from looking like it is sliding off the bottom.
  const padTop = pad;
  const padBottom = pad === 0 ? 0 : Math.round(pad * 1.14);
  const padX = pad;

  const shotW = imgW;
  const shotH = imgH + chromeHeight;

  let pageW = Math.ceil(shotW + padX * 2);
  let pageH = Math.ceil(shotH + padTop + padBottom);

  if (flags.ratio) {
    const [rw, rh] = String(flags.ratio).split(/[:/x]/).map(Number);
    if (!rw || !rh) fail('--ratio wants w:h, e.g. 16:10');
    const target = rw / rh;
    if (pageW / pageH < target) pageW = Math.ceil(pageH * target);
    else pageH = Math.ceil(pageW / target);
  }

  // Snap the shot to a whole device pixel. A half-pixel offset resamples every
  // source pixel and is exactly the softness this tool exists to avoid.
  const snap = (v) => Math.round(v * scale) / scale;
  const shotX = snap((pageW - shotW) / 2);
  const shotY = snap(padTop + (pageH - shotH - padTop - padBottom) / 2);

  const uri = dataUri(input);
  const accent = flags.accent ?? '#e5484d';
  const tint = flags.tint ? String(flags.tint) : null;

  let annotations = [];
  if (flags.annotate) {
    const spec = String(flags.annotate);
    const json = existsSync(spec) ? readFileSync(spec, 'utf8') : spec;
    try { annotations = JSON.parse(json); } catch { fail('--annotate wants a JSON file or a JSON array'); }
    if (!Array.isArray(annotations)) fail('--annotate wants an array of shapes');
  }

  // Resolve `--bg auto` by asking the image, before the real render.
  let autoBg = null;
  let background = backgroundSpec.css ?? 'transparent';
  if (backgroundSpec.kind === 'auto') {
    autoBg = await evaluateInPage(
      `<!doctype html><html><body><img id="shot" src="${uri}"></body></html>`,
      AUTO_BG_FN,
    );
    background = autoBg.css;
  }

  const html = buildHtml({
    uri, imgW, imgH, scale, pageW, pageH, shotX, shotY, shotW, radius: num(flags.radius, preset.radius),
    shadow: shadow.css, chrome, chromeHeight, title: flags.title, hairline: bool(flags.hairline, preset.hairline),
    background, transparent, annotations, accent, tint, autoBg,
  });

  if (flags['dump-html']) {
    writeFileSync(String(flags['dump-html']), html);
    console.warn(`  wrote ${flags['dump-html']}`);
  }

  mkdirSync(resolve(outPath, '..'), { recursive: true });
  await renderHtml({
    html, width: pageW, height: pageH, scale, transparent, out: outPath, quality: num(flags.quality, 92),
  });

  const bytes = statSync(outPath).size;
  console.warn(
    `  ${basename(outPath)}  ${pageW * scale}×${pageH * scale}  ${(bytes / 1024).toFixed(0)} KB` +
    `  [${presetName}${chrome !== 'none' ? ` · ${chrome}` : ''}${autoBg ? ' · auto bg' : ''}]`,
  );
}

async function cmdFrame(positional, flags) {
  const inputs = positional.filter((p) => !p.startsWith('--'));
  if (!inputs.length) fail('frame needs at least one input image');

  const outFlag = flags.out ?? flags.o;
  if (!outFlag) fail('frame needs --out <file.png> or --out <directory>');

  const many = inputs.length > 1;
  const outIsDir = many || (typeof outFlag === 'string' && (existsSync(outFlag) && statSync(outFlag).isDirectory() || !extname(outFlag)));

  for (const input of inputs) {
    if (!existsSync(input)) fail(`no such file: ${input}`);
    const suffix = flags.suffix ?? '';
    const ext = flags.format ? `.${flags.format}` : extname(input) || '.png';
    const out = outIsDir
      ? join(String(outFlag), `${basename(input, extname(input))}${suffix}${ext}`)
      : String(outFlag);
    await frameOne(input, out, flags);
  }
}

/* -------------------------------------------------------------- capture --- */

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; scrollbar-width: none !important; }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
`;

async function cmdCapture(positional, flags) {
  const url = positional[0];
  if (!url) fail('capture needs a URL (or a file:// path)');
  const out = String(flags.out ?? flags.o ?? fail('capture needs --out <file.png>'));

  const chromium = await loadPlaywright();
  if (!chromium) {
    fail('capture needs Playwright:\n  npm i -D playwright && npx playwright install chromium');
  }

  const [vw, vh] = String(flags.viewport ?? '1280x800').split(/[x×,]/).map(Number);
  const scale = num(flags.scale, 2);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: scale,
    colorScheme: flags.theme === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

  if (bool(flags.freeze, true)) await page.addStyleTag({ content: FREEZE_CSS });

  if (flags.hide) {
    const selectors = String(flags.hide).split(',').map((s) => s.trim()).filter(Boolean);
    await page.addStyleTag({ content: `${selectors.join(', ')} { visibility: hidden !important; }` });
  }

  if (flags.click) await page.click(String(flags.click));
  if (flags['wait-for']) await page.waitForSelector(String(flags['wait-for']), { timeout: 20000 });

  // Fonts before pixels: a shot taken mid-swap shows the fallback face, which
  // is the difference between "our type" and "some type".
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(num(flags.wait, 400));

  // Park the pointer somewhere inert so no hover state leaks into the shot.
  await page.mouse.move(2, vh - 2);
  await page.waitForTimeout(120);

  mkdirSync(resolve(out, '..'), { recursive: true });

  let clip;
  if (flags.selector) {
    const box = await page.locator(String(flags.selector)).first().boundingBox();
    if (!box) fail(`--selector "${flags.selector}" matched nothing with a box`);
    const bleed = num(flags.bleed, 0);
    clip = {
      x: Math.max(0, box.x - bleed),
      y: Math.max(0, box.y - bleed),
      width: Math.min(vw, box.width + bleed * 2),
      height: Math.min(vh, box.height + bleed * 2),
    };
    if (flags['max-height']) clip.height = Math.min(clip.height, num(flags['max-height']));
  }

  const raw = flags.preset || flags.bg || flags.chrome
    ? join(mkdtempSync(join(tmpdir(), 'shotkit-raw-')), 'raw.png')
    : out;

  await page.screenshot({
    path: raw,
    fullPage: bool(flags['full-page'], false),
    omitBackground: bool(flags['omit-background'], false),
    ...(clip ? { clip } : {}),
  });
  await browser.close();

  if (raw !== out) {
    await frameOne(raw, out, flags);
  } else {
    const { width, height } = imageSize(out);
    console.warn(`  ${basename(out)}  ${width}×${height}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
  }
}

/* ---------------------------------------------------------------- check --- */

/**
 * The defects that make a screenshot look cheap are mostly measurable.
 *
 * The one worth the most is edge bleed: a crop that runs through a line of text
 * leaves a column of half-glyphs at the boundary. It reads as carelessness from
 * across the room, and it is invisible to whoever chose the crop height, because
 * they were looking at the content and not at the edge.
 */
const CHECK_FN = `async () => {
  const img = document.getElementById('shot');
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lum = (x, y) => {
    const i = (y * w + x) * 4;
    const a = data[i + 3] / 255;
    // Composite onto mid grey so a transparent corner is not read as content.
    return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * a + 128 * (1 - a);
  };

  // Walk the strips just inside each edge and count sharp transitions along them.
  // Half-glyphs produce many; background or a solid border produces almost none.
  //
  // A band rather than a single line, because a 1px window border or a rounded
  // corner's antialiasing sits on top of the cut and would hide it. Depth stays
  // shallow — content that legitimately stops 8px short of the edge is a margin,
  // not a crop, and flagging it would make the check noise.
  const strip = (edge, depth) => {
    const n = edge === 'top' || edge === 'bottom' ? w : h;
    const at = (k) =>
      edge === 'top' ? lum(k, depth)
      : edge === 'bottom' ? lum(k, h - 1 - depth)
      : edge === 'left' ? lum(depth, k)
      : lum(w - 1 - depth, k);
    let transitions = 0;
    for (let k = 1; k < n; k++) if (Math.abs(at(k) - at(k - 1)) > 38) transitions++;
    return { transitions, ratio: transitions / n };
  };

  const worst = (edge) => {
    let out = { transitions: 0, ratio: 0 };
    for (let depth = 0; depth <= 4; depth++) {
      const s = strip(edge, depth);
      if (s.ratio > out.ratio) out = s;
    }
    return out;
  };

  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { opaque = false; break; }

  return {
    width: w, height: h, opaque,
    edges: {
      top: worst('top'), bottom: worst('bottom'), left: worst('left'), right: worst('right'),
    },
  };
}`;

async function cmdCheck(positional, flags) {
  const files = [];
  for (const path of positional) {
    if (!existsSync(path)) fail(`no such file: ${path}`);
    if (statSync(path).isDirectory()) {
      files.push(...readdirSync(path).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => join(path, f)));
    } else files.push(path);
  }
  if (!files.length) fail('check needs a file or a directory of images');

  const maxKb = num(flags['max-kb'], 400);
  const bleedLimit = num(flags['bleed-ratio'], 0.05);
  const sizes = new Map();
  let problems = 0;

  for (const file of files.sort()) {
    const uri = dataUri(file);
    const report = await evaluateInPage(
      `<!doctype html><html><body><img id="shot" src="${uri}"></body></html>`,
      CHECK_FN,
    );
    const kb = statSync(file).size / 1024;
    const notes = [];

    for (const [edge, { transitions, ratio }] of Object.entries(report.edges)) {
      if (ratio > bleedLimit) {
        notes.push(`${edge} edge cuts through content (${transitions} sharp transitions, ${(ratio * 100).toFixed(0)}% of the edge) — crop at a boundary or widen the capture`);
      }
    }
    if (kb > maxKb) notes.push(`${kb.toFixed(0)} KB is over the ${maxKb} KB budget — try a lower --scale, or pngquant/oxipng`);
    if (Math.min(report.width, report.height) < 400) {
      notes.push(`${report.width}×${report.height} is small; if this is displayed above ~${Math.round(report.width / 2)}px it will be upscaled and soft`);
    }

    sizes.set(`${report.width}×${report.height}`, (sizes.get(`${report.width}×${report.height}`) ?? 0) + 1);

    problems += notes.length;
    console.warn(`  ${notes.length ? 'FAIL' : 'ok  '} ${basename(file)}  ${report.width}×${report.height}  ${kb.toFixed(0)} KB${report.opaque ? '' : '  (has alpha)'}`);
    for (const note of notes) console.warn(`         ${note}`);
  }

  if (files.length > 1 && sizes.size > 1) {
    console.warn(`\n  note: ${sizes.size} different sizes in this set — ${[...sizes.entries()].map(([s, n]) => `${s}×${n}`).join(', ')}`);
    console.warn('        a set that is meant to be seen together should share one size, or it will jitter in a grid');
  }

  console.warn(problems === 0 ? '\n  clean\n' : `\n  ${problems} problem${problems === 1 ? '' : 's'}\n`);
  process.exit(problems > 0 && !flags['no-fail'] ? 1 : 0);
}

/* ----------------------------------------------------------------- help --- */

const HELP = `
shotkit — screenshots that look like a product, not a bug report.

  capture <url> --out shot.png [--selector .panel] [--viewport 1280x800]
                [--scale 2] [--theme light|dark] [--full-page] [--hide "..."]
                [--wait-for sel] [--click sel] [--wait ms] [--bleed px]
                [--max-height px] [+ any frame flag, to frame in one pass]

  frame <in.png…> --out <file|dir> [--preset clean|mac|browser|hero|docs|flat|bare]
                [--bg auto|transparent|<name>|<css>] [--pad 9%|64] [--radius 12]
                [--shadow none|contact|soft|deep|lifted] [--chrome none|mac|mac-dark|browser|browser-dark]
                [--title "…"] [--scale 2] [--ratio 16:10] [--annotate anno.json]
                [--accent #e5484d] [--suffix -framed] [--format png|jpg]

  check <file|dir…> [--max-kb 400] [--bleed-ratio 0.05] [--no-fail]

  Backdrops: ${Object.keys(BACKDROPS).join(', ')}
  Presets:   ${Object.keys(PRESETS).join(', ')}

  --scale is the DPR the source was captured at. The source is never resampled;
  scale only sets how crisp the frame's own decoration is.
`;

/* ------------------------------------------------------------------ main -- */

const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional.shift();

try {
  if (command === 'frame') await cmdFrame(positional, flags);
  else if (command === 'capture') await cmdCapture(positional, flags);
  else if (command === 'check') await cmdCheck(positional, flags);
  else if (command === 'presets') console.warn(HELP);
  else { console.warn(HELP); process.exit(command ? 1 : 0); }
} catch (error) {
  fail(error?.stack ?? String(error));
}
