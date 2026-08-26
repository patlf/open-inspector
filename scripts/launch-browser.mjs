#!/usr/bin/env node
/**
 * Open a browser with the extension already installed, for hands-on use.
 *
 * Why this exists: branded Chrome removed support for the `--load-extension`
 * command-line switch. Verified dead in Chrome 150 — the profile registers
 * zero extensions and the browser logs "--load-extension is not allowed in
 * Google Chrome, ignoring."
 *
 * Do not try to revive it with
 * `--disable-features=DisableLoadExtensionCommandLineSwitch`. That flag is now
 * a silent no-op: the switch became a compile-time branding check, and the
 * feature symbol the flag names no longer exists. Carrying it makes a broken
 * launch config look deliberate.
 *
 * Side-loading into your everyday Chrome now requires clicking through
 * chrome://extensions by hand, which is fine but tedious to repeat.
 *
 * Playwright's Chromium is not subject to that restriction, so this gives you
 * a disposable browser with the extension loaded in one command. The profile
 * lives in .output/ and is thrown away with the rest of the build artifacts —
 * your real browser profile is never touched.
 *
 * Usage:  pnpm launch  [url]
 */

import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTENSION = join(ROOT, '.output/chrome-mv3');
const PROFILE = join(ROOT, '.output/launch-profile');
const PLAYGROUND_PORT = 5178;
const PLAYGROUND_URL = `http://localhost:${PLAYGROUND_PORT}/`;

const targetUrl = process.argv[2] ?? PLAYGROUND_URL;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!existsSync(join(EXTENSION, 'manifest.json'))) {
  fail('No build found at .output/chrome-mv3.\n  Run `pnpm build` first.');
}

/**
 * Refuse to launch a development build.
 *
 * `wxt dev` writes to the same directory as `wxt build`, but its manifest adds
 * `tabs`, host permissions for localhost, and a relaxed CSP so hot reload can
 * work. Launching that by accident would show a permission posture this
 * project exists to avoid, and would quietly invalidate anything you concluded
 * from looking at the permissions screen.
 */
{
  const manifest = JSON.parse(readFileSync(join(EXTENSION, 'manifest.json'), 'utf8'));
  const extraPermissions = (manifest.permissions ?? []).filter(
    (permission) => permission !== 'activeTab' && permission !== 'scripting',
  );

  if (manifest.host_permissions?.length || extraPermissions.length > 0) {
    fail(
      'The build in .output/chrome-mv3 is a DEVELOPMENT build.\n' +
        `  It requests: permissions ${JSON.stringify(manifest.permissions)}` +
        `, host_permissions ${JSON.stringify(manifest.host_permissions ?? [])}\n\n` +
        '  `wxt dev` writes a looser manifest to the same directory so hot reload works.\n' +
        '  Run `pnpm build` to restore the shipping build, then launch again.',
    );
  }
}

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(1000, () => settle(false));
  });
}

/**
 * Is something listening on this port?
 *
 * Checks both address families deliberately. Vite binds to `localhost`, which
 * on a machine with IPv6 resolves to `::1` only — a check hard-coded to
 * 127.0.0.1 reports the server as down while it is happily serving.
 */
async function portOpen(port) {
  const [v6, v4] = await Promise.all([canConnect(port, '::1'), canConnect(port, '127.0.0.1')]);
  return v6 || v4;
}

async function waitForPort(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (await portOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

let playground = null;

async function ensurePlayground() {
  if (targetUrl !== PLAYGROUND_URL) return;
  if (await portOpen(PLAYGROUND_PORT)) {
    console.log(`  playground   already running on :${PLAYGROUND_PORT}`);
    return;
  }

  console.log('  playground   starting…');
  playground = spawn('pnpm', ['--filter', '@open-inspector/playground', 'dev'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
  });

  if (!(await waitForPort(PLAYGROUND_PORT))) {
    fail('The playground dev server did not come up on :5178.');
  }
}

await ensurePlayground();

/**
 * A fresh profile every launch.
 *
 * Chrome registers an extension's service worker into the profile and keeps
 * that registration across restarts. Rebuild the extension and the injected
 * content script is read fresh from disk — so the panel looks current — while
 * the worker can still be the one from a previous build. Every message the
 * page sends it then goes unanswered, and `runtime.sendMessage` does not
 * reject in that case, it hangs. The result is a feature that appears present
 * and quietly does nothing.
 *
 * This profile is disposable by design, so the cheapest guarantee that the
 * worker matches the build is to not reuse it at all.
 */
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  // The full Chromium build. Playwright's headless shell has no extension
  // support at all, and fails silently rather than loudly.
  channel: 'chromium',
  viewport: null,
  args: [
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
    '--start-maximized',
  ],
});

const worker =
  context.serviceWorkers()[0] ??
  (await context.waitForEvent('serviceworker', { timeout: 20_000 }).catch(() => null));

const extensionId = worker ? new URL(worker.url()).host : null;

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(targetUrl).catch(() => undefined);

console.log(`
  Open Inspector is loaded.

    extension id   ${extensionId ?? 'not detected — check .output/chrome-mv3'}
    page           ${targetUrl}
    profile        ${PROFILE}

  To turn the inspector on, either:

    1. Press Alt+Shift+I, or
    2. Click the puzzle-piece icon in the toolbar, then "Open Inspector".
       Pin it there and the button stays visible.

  Then hover anything on the page. Escape turns it off.

  The toolbar click is what grants activeTab — the extension genuinely cannot
  read the page before it. That is the point, and you can watch it happen:
  chrome://extensions shows no site access requested.

  Close the browser window to stop.
`);

await context.waitForEvent('close', { timeout: 0 }).catch(() => undefined);

if (playground) playground.kill();
process.exit(0);
