import { test, expect, FIXTURE_URL, activeTabId } from './fixtures.js';

/**
 * These run against the extension exactly as it ships.
 *
 * The project's central claim is that it cannot read your pages until you ask
 * it to. That claim is worth a test that would actually go red if someone
 * added a host permission for convenience — a readme sentence would not.
 */
test.describe('the shipped extension', () => {
  test('requests no host permissions', async ({ serviceWorker }) => {
    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());

    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.permissions).toEqual(['activeTab', 'scripting']);
  });

  test('declares no static content scripts', async ({ serviceWorker }) => {
    // A static content script would run on page load, before any consent.
    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());

    expect(manifest.content_scripts ?? []).toEqual([]);
  });

  test('registers its listeners synchronously at worker startup', async ({ serviceWorker }) => {
    // MV3 terminates the worker when idle and restarts it on the next event.
    // Listeners registered inside a promise callback would be attached too
    // late and the event would be dropped.
    const listeners = await serviceWorker.evaluate(() => ({
      action: chrome.action.onClicked.hasListeners(),
      command: chrome.commands.onCommand.hasListeners(),
      tabsUpdated: chrome.tabs.onUpdated.hasListeners(),
    }));

    expect(listeners).toEqual({ action: true, command: true, tabsUpdated: true });
  });

  test('does not inject itself into pages on load', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    await page.mouse.move(400, 300);

    expect(await page.locator('open-inspector-overlay').count()).toBe(0);
  });

  test('cannot read a tab URL without an activeTab grant', async ({ serviceWorker, context }) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });

    const tab = await serviceWorker.evaluate(async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { url: active?.url ?? null, title: active?.title ?? null };
    });

    // Without host permission or a click, the browser withholds even this.
    expect(tab.url).toBeFalsy();
    expect(tab.title).toBeFalsy();
  });

  test('is refused injection without a user gesture', async ({ serviceWorker, context }) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    const tabId = await activeTabId(serviceWorker);

    const outcome = await serviceWorker.evaluate(async (id: number) => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: id },
          files: ['content-scripts/inspector.js'],
        });
        return 'injected';
      } catch (error) {
        return `refused: ${(error as Error).message}`;
      }
    }, tabId);

    // This failing would mean the extension had gained standing page access.
    expect(outcome).toContain('refused');
    expect(outcome).toContain('Cannot access contents of the page');
  });
});
