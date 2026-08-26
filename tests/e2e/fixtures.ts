import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** The artifact that would go to the Chrome Web Store, byte for byte. */
export const SHIPPED_EXTENSION = join(ROOT, '.output/chrome-mv3');

/**
 * Fixture page for these tests.
 *
 * Deliberately not the interactive playground at `/` — that page creates its
 * own inspector session, so a test could not tell the extension's overlay
 * apart from the page's own.
 */
export const FIXTURE_URL = 'http://localhost:5178/e2e.html';

export interface ExtensionFixtures {
  context: BrowserContext;
  /** The MV3 background service worker, awake and ready to evaluate against. */
  serviceWorker: Worker;
  extensionId: string;
}

function assertBuilt(dir: string): void {
  if (existsSync(join(dir, 'manifest.json'))) return;
  throw new Error(
    `No built extension at ${dir}.\n` +
      `Run \`pnpm build\` before the end-to-end tests — they exercise the real\n` +
      `packaged artifact, not the source.`,
  );
}

async function launchWithExtension(extensionDir: string): Promise<{
  context: BrowserContext;
  profileDir: string;
}> {
  const profileDir = mkdtempSync(join(tmpdir(), 'open-inspector-profile-'));

  const context = await chromium.launchPersistentContext(profileDir, {
    /**
     * `channel: 'chromium'` is load-bearing, not decoration.
     *
     * Playwright's default headless path runs the *headless shell*, a stripped
     * binary with no extension support at all. It does not error — it just
     * loads nothing, and every assertion fails somewhere confusing and far
     * away. The full Chromium build supports extensions in new headless mode.
     */
    channel: 'chromium',
    headless: !process.env['HEADED'],
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });

  return { context, profileDir };
}

async function resolveServiceWorker(context: BrowserContext): Promise<Worker> {
  // The worker may already have started before we get here, in which case the
  // event has been and gone; check first, then wait.
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent('serviceworker', { timeout: 30_000 });
}

function buildFixtures(prepareExtensionDir: () => string) {
  return base.extend<ExtensionFixtures>({
    context: async ({}, use) => {
      const extensionDir = prepareExtensionDir();
      const { context, profileDir } = await launchWithExtension(extensionDir);

      await use(context);

      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
      if (extensionDir !== SHIPPED_EXTENSION) {
        rmSync(extensionDir, { recursive: true, force: true });
      }
    },

    serviceWorker: async ({ context }, use) => {
      await use(await resolveServiceWorker(context));
    },

    extensionId: async ({ serviceWorker }, use) => {
      // chrome-extension://<id>/background.js
      const id = new URL(serviceWorker.url()).host;
      await use(id);
    },
  });
}

/**
 * Tests against the extension exactly as it ships.
 *
 * Use this for anything about permissions and privacy — the whole point is
 * that the assertions apply to the artifact a user would install.
 */
export const test = buildFixtures(() => {
  assertBuilt(SHIPPED_EXTENSION);
  return SHIPPED_EXTENSION;
});

/**
 * Tests against the same bundles with one extra host permission.
 *
 * Why this exists: `activeTab` is granted by a real click on the toolbar
 * button, and no automation framework can click browser chrome. Without a
 * gesture the browser correctly refuses `scripting.executeScript`, so the
 * functional path cannot be reached at all from a test.
 *
 * Only `manifest.json` is rewritten — every line of shipped JavaScript is
 * identical. The privacy properties of the real manifest are asserted
 * separately in extension-privacy.spec.ts, against {@link test}.
 */
/**
 * The extension with a background worker that ignores everything.
 *
 * Stands in for the most confusing failure this extension has: an unpacked
 * install whose files changed on disk but whose service worker was never
 * reloaded. The content script is read fresh on every injection, so the panel
 * looks completely current, while the worker behind it is from an older build
 * and answers none of its messages. `runtime.sendMessage` does not reject in
 * that situation — it never settles — so anything awaiting it waits forever.
 */
export const testWithStaleWorker = buildFixtures(() => {
  assertBuilt(SHIPPED_EXTENSION);

  const patchedDir = mkdtempSync(join(tmpdir(), 'open-inspector-e2e-stale-'));
  cpSync(SHIPPED_EXTENSION, patchedDir, { recursive: true });

  const manifestPath = join(patchedDir, 'manifest.json');
  const manifest: Record<string, unknown> = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest['host_permissions'] = ['http://localhost:5178/*'];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Registers a listener, understands nothing, replies to nothing.
  writeFileSync(
    join(patchedDir, 'background.js'),
    'chrome.runtime.onMessage.addListener(() => undefined);\n',
  );

  return patchedDir;
});

export const testWithHostAccess = buildFixtures(() => {
  assertBuilt(SHIPPED_EXTENSION);

  const patchedDir = mkdtempSync(join(tmpdir(), 'open-inspector-e2e-ext-'));
  cpSync(SHIPPED_EXTENSION, patchedDir, { recursive: true });

  const manifestPath = join(patchedDir, 'manifest.json');
  const manifest: Record<string, unknown> = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest['host_permissions'] = ['http://localhost/*', 'http://127.0.0.1/*'];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return patchedDir;
});

export { expect } from '@playwright/test';

/**
 * Inject the inspector if needed, then toggle it — exactly what the toolbar
 * button does.
 *
 * The ping-before-inject guard is not incidental: `executeScript` is not
 * idempotent. Running it twice evaluates the content script twice, producing a
 * second independent session with its own listener, and the two then disagree
 * about whether the inspector is on. This mirrors `toggleInspector` in
 * apps/extension/entrypoints/background.ts; if that guard is ever dropped,
 * the "toggling twice returns to the original state" test goes red.
 */
export async function toggleInspector(
  serviceWorker: Worker,
  tabId: number,
): Promise<{ active: boolean }> {
  return serviceWorker.evaluate(async (id: number) => {
    let alreadyInjected = true;
    try {
      await chrome.tabs.sendMessage(id, { type: 'open-inspector:ping' });
    } catch {
      alreadyInjected = false;
    }

    if (!alreadyInjected) {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        files: ['content-scripts/inspector.js'],
      });
    }

    return (await chrome.tabs.sendMessage(id, { type: 'open-inspector:toggle' })) as {
      active: boolean;
    };
  }, tabId);
}

/** Inject without toggling. Used to prove double injection is guarded. */
export async function injectInspector(serviceWorker: Worker, tabId: number): Promise<void> {
  await serviceWorker.evaluate(async (id: number) => {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      files: ['content-scripts/inspector.js'],
    });
  }, tabId);
}

/** The tab id of the active tab, as the background worker sees it. */
export async function activeTabId(serviceWorker: Worker): Promise<number> {
  return serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error('no active tab');
    return tab.id;
  });
}
