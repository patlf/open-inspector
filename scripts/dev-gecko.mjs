#!/usr/bin/env node
/**
 * A rebuild-and-reload loop for Firefox and Zen.
 *
 * Why not `wxt -b firefox`: the WXT version this project is on (0.19) refuses
 * dev mode for Firefox MV3 outright — "Dev mode does not support Firefox MV3"
 * — and this extension has to be MV3 on Firefox, because the background
 * worker uses `scripting` and `action`, which MV2 does not have.
 *
 * So this does the loop by hand: build the Firefox target, open it in a
 * Gecko browser through Mozilla's own web-ext, and on every source change
 * rebuild and ask web-ext to reload the extension. It is the production
 * build each time, so what you test is the zero-permission manifest that
 * ships, not a dev manifest with extra access.
 *
 * Reloading the extension invalidates the injected inspector, as on any
 * update; press Alt+Shift+I again to bring it back.
 *
 * Usage:
 *   pnpm dev:zen                 # Zen, at /Applications/Zen.app on macOS
 *   pnpm dev:firefox             # the default Firefox
 *   pnpm dev:firefox --browser /path/to/firefox-or-zen [url]
 *
 * GECKO_BINARY overrides the browser for either. The profile is a fresh
 * temporary one every run; your real profile is never touched.
 */

import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import webExt from 'web-ext';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(ROOT, '.output/firefox-mv3');
const PLAYGROUND_PORT = 5178;
/**
 * The playground's e2e page, not its front page: the front page runs its own
 * copy of the inspector from source, so pressing its Inspect button there
 * opens a panel that is not the extension's and has none of its
 * extension-only parts. On this page the only inspector is the extension's.
 */
const PLAYGROUND_URL = `http://localhost:${PLAYGROUND_PORT}/e2e.html`;

/** Where Zen installs itself, per platform. Elsewhere, pass --browser or GECKO_BINARY. */
const ZEN_BINARIES = {
  darwin: '/Applications/Zen.app/Contents/MacOS/zen',
  linux: 'zen',
  win32: 'C:\\Program Files\\Zen Browser\\zen.exe',
};

/** Source that ends up in the Firefox bundle. Everything else is ignored. */
const WATCHED = ['packages/core/src', 'packages/ui/src', 'apps/extension/entrypoints', 'apps/extension/lib'];

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let browser = process.env['GECKO_BINARY'] ?? null;
  let url = PLAYGROUND_URL;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--browser') {
      browser = argv[index + 1] ?? fail('--browser needs a value: zen, firefox, or a path.');
      index += 1;
    } else if (arg) {
      url = arg;
    }
  }

  if (browser === 'zen') {
    browser = ZEN_BINARIES[process.platform] ?? fail('No default Zen path here; pass --browser.');
    if (browser.includes('/') && !existsSync(browser)) {
      fail(`Zen is not at ${browser}. Pass --browser /path/to/zen, or set GECKO_BINARY.`);
    }
  }

  // web-ext treats a missing binary as "the default Firefox".
  return { browser: browser === 'firefox' ? null : browser, url };
}

const { browser, url } = parseArgs(process.argv.slice(2));

/** Build the Firefox target. Resolves true on success; a failed build keeps the last good one loaded. */
function build() {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['--filter', '@open-inspector/extension', 'build:firefox'], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

function portOpen(port) {
  const attempt = (host) =>
    new Promise((resolve) => {
      const socket = connect({ port, host });
      const settle = (result) => {
        socket.destroy();
        resolve(result);
      };
      socket.once('connect', () => settle(true));
      socket.once('error', () => settle(false));
      socket.setTimeout(1000, () => settle(false));
    });
  // Vite binds `localhost`, which can be ::1 only; check both families.
  return Promise.all([attempt('::1'), attempt('127.0.0.1')]).then(([v6, v4]) => v6 || v4);
}

let playground = null;

async function ensurePlayground() {
  if (url !== PLAYGROUND_URL || (await portOpen(PLAYGROUND_PORT))) return;
  console.log('  playground   starting…');
  playground = spawn('pnpm', ['--filter', '@open-inspector/playground', 'dev'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await portOpen(PLAYGROUND_PORT)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail('The playground dev server did not come up on :5178.');
}

console.log('  building     firefox-mv3…');
if (!(await build())) fail('The first build failed; fix it and run again.');
await ensurePlayground();

const runner = await webExt.cmd.run(
  {
    sourceDir: OUTPUT,
    target: ['firefox-desktop'],
    ...(browser ? { firefox: browser } : {}),
    startUrl: [url],
    // This script decides when to reload: after a build has finished, not
    // halfway through one while the output directory is being rewritten.
    noReload: true,
    noInput: true,
  },
  { shouldExitProgram: false },
);

console.log(`
  Open Inspector is running in ${browser ?? 'Firefox'}.

    page      ${url}
    watching  ${WATCHED.join(', ')}

  Press Alt+Shift+I on the page to inspect. Saving a file rebuilds and
  reloads the extension; press Alt+Shift+I again afterwards.
  Close the browser, or press Ctrl+C here, to stop.
`);

/**
 * Rebuild once the edits stop, and never two builds at once.
 *
 * An editor's save can be several writes in a row, and a build started
 * mid-burst would load half a change. A change that lands during a build
 * queues exactly one more.
 */
let timer = null;
let building = false;
let pending = false;

async function rebuild() {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  const started = Date.now();
  const ok = await build();
  if (ok) {
    await runner.reloadAllExtensions();
    // web-ext prints its own reload line without a newline after it.
    console.log(`\n  reloaded     in ${Date.now() - started}ms`);
  } else {
    console.log('  build failed — the last good build is still loaded');
  }
  building = false;
  if (pending) {
    pending = false;
    void rebuild();
  }
}

const watchers = WATCHED.map((dir) =>
  watch(join(ROOT, dir), { recursive: true }, (_event, file) => {
    if (!file || file.endsWith('.test.ts')) return;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 150);
  }),
);

let stopping = false;

/** Closing the browser and Ctrl+C both end up here; only the first counts. */
function stop() {
  if (stopping) return;
  stopping = true;
  for (const watcher of watchers) watcher.close();
  if (playground) playground.kill();
  void runner.exit().finally(() => process.exit(0));
}

runner.registerCleanup(stop);
process.on('SIGINT', stop);
