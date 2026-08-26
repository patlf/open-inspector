import {
  testWithHostAccess as test,
  expect,
  FIXTURE_URL,
  activeTabId,
  toggleInspector,
  injectInspector,
} from './fixtures.js';
import type { Page } from '@playwright/test';

/**
 * The overlay sits one layer below the panel.
 *
 * They used to share the maximum, which left DOM order deciding the winner —
 * and it decided wrongly: the translucent wash painted over the panel whenever
 * a full-width element was selected.
 */
const OVERLAY_Z_INDEX = '2147483646';

/**
 * The functional path, driven through the real extension plumbing:
 * background worker → scripting.executeScript → content script → message →
 * session → overlay in the page.
 *
 * See fixtures.ts for why these use a host-permission-patched manifest. Every
 * line of JavaScript under test is the shipped build, unmodified.
 */

/** Read what the overlay is doing, from the page's side of the fence. */
async function readOverlay(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('open-inspector-overlay');
    if (!host) {
      return { present: false, documentCursor: document.documentElement.style.cursor };
    }

    const style = getComputedStyle(host);
    return {
      present: true,
      // A closed shadow root reads as null from the page. That is the point of
      // using one: the host page cannot reach into our UI.
      shadowReachableFromPage: host.shadowRoot !== null,
      position: style.position,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
      display: style.display,
      parentTag: host.parentElement?.tagName ?? null,
      documentCursor: document.documentElement.style.cursor,
    };
  });
}

/** What the panel header says it is showing. */
async function panelSelector(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      document.querySelector('open-inspector-panel')?.shadowRoot?.querySelector('.selector')
        ?.textContent ?? undefined,
  );
}

async function openInspector(page: Page, serviceWorker: Parameters<typeof activeTabId>[0]) {
  await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
  const tabId = await activeTabId(serviceWorker);
  const state = await toggleInspector(serviceWorker, tabId);
  expect(state.active).toBe(true);
  return tabId;
}

test.describe('inspecting a page', () => {
  test('injects on demand and toggles state', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    const tabId = await openInspector(page, serviceWorker);

    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(false);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
  });

  test('a second injection replaces the session rather than duplicating it', async ({
    context,
    serviceWorker,
  }) => {
    /**
     * `executeScript` is not idempotent — it evaluates the content script
     * again. WXT handles this by invalidating the previous instance, so the
     * tab keeps exactly one live session and one overlay.
     *
     * Two things could go wrong and this test catches both: an orphaned
     * overlay left behind by the old instance (count would be 2), or a
     * self-guarding new instance that bails out after the old one has already
     * torn itself down (count would be 0).
     */
    const page = await context.newPage();
    const tabId = await openInspector(page, serviceWorker);

    await page.locator('.card').first().hover();
    await expect.poll(async () => (await readOverlay(page)).present).toBe(true);

    // Inject again, deliberately bypassing the background worker's ping guard.
    await injectInspector(serviceWorker, tabId);

    // The replacement session starts inactive, so turn it on before hovering.
    await toggleInspector(serviceWorker, tabId);
    await page.locator('.card').nth(1).hover();

    await expect
      .poll(async () => page.locator('open-inspector-overlay').count(), { timeout: 5000 })
      .toBe(1);
  });

  test('draws the overlay under the pointer', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    await page.locator('.card').first().hover();

    await expect.poll(async () => (await readOverlay(page)).present, { timeout: 5000 }).toBe(true);

    expect(await readOverlay(page)).toMatchObject({
      present: true,
      shadowReachableFromPage: false,
      position: 'fixed',
      zIndex: OVERLAY_Z_INDEX,
      pointerEvents: 'none',
      parentTag: 'HTML',
      documentCursor: 'crosshair',
    });
  });

  test('never paints the overlay over the panel', async ({ context, serviceWorker }) => {
    // Selecting a full-width element puts the overlay across the whole
    // viewport, including underneath the panel. The panel has to win.
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    await page.locator('section').first().hover();
    await expect.poll(async () => (await readOverlay(page)).present).toBe(true);

    const layers = await page.evaluate(() => ({
      overlay: getComputedStyle(document.querySelector('open-inspector-overlay')!).zIndex,
      panel: getComputedStyle(document.querySelector('open-inspector-panel')!).zIndex,
    }));

    expect(Number(layers.panel)).toBeGreaterThan(Number(layers.overlay));
  });

  test('holds the highlight on the clicked element', async ({ context, serviceWorker }) => {
    /**
     * Selecting locks the overlay in place. The colours are the reason you
     * selected the element, and losing them the moment the pointer moves makes
     * the box model unreadable while you work in the panel.
     */
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    await page.locator('#plain-button').click();
    await expect.poll(async () => panelSelector(page)).toBe('button#plain-button');

    // Move the pointer right across the page; the selection must not follow.
    await page.mouse.move(700, 700);
    await page.waitForTimeout(300);

    expect(await panelSelector(page)).toBe('button#plain-button');
    expect((await readOverlay(page)).present).toBe(true);
  });

  test('switches selection in a single click', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    await page.locator('#plain-button').click();
    await expect.poll(async () => panelSelector(page)).toBe('button#plain-button');

    await page.locator('.card').first().click();
    await expect.poll(async () => panelSelector(page)).toBe('article.card');
  });

  test('releases the selection when the same element is clicked again', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    const card = page.locator('.card').first();
    await card.click();
    await expect.poll(async () => panelSelector(page)).toBe('article.card');

    await card.click();
    await page.locator('#plain-button').hover();

    // Hover-following resumes, which is how you can tell it let go.
    await expect.poll(async () => panelSelector(page)).toBe('button#plain-button');
  });

  test('gives the page back on Escape', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    await page.locator('.card').first().hover();
    await expect.poll(async () => (await readOverlay(page)).present).toBe(true);

    await page.keyboard.press('Escape');

    await expect.poll(async () => (await readOverlay(page)).documentCursor).not.toBe('crosshair');
  });

  test('swallows page clicks so that clicking pins instead', async ({ context, serviceWorker }) => {
    /**
     * The inspector deliberately suppresses pointer events on the page while
     * it is on. Without that, inspecting a link or a submit button navigates
     * away the moment you try to hold it still — and links and buttons are
     * most of what anyone wants to inspect.
     *
     * The overlay itself stays `pointer-events: none`; the suppression is done
     * by capture-phase listeners, not by a shield element.
     */
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    await page.locator('.card').first().hover();
    await expect.poll(async () => (await readOverlay(page)).present).toBe(true);

    const button = page.locator('#plain-button');
    await button.click({ timeout: 3000 });

    // The page's own click handler must never have run.
    expect(await button.getAttribute('aria-pressed')).toBe('false');

    // And the overlay must still be inert to hit-testing.
    expect((await readOverlay(page)).pointerEvents).toBe('none');

    // Turning the inspector off gives the page its clicks back.
    await toggleInspector(serviceWorker, await activeTabId(serviceWorker));
    await button.click({ timeout: 3000 });
    expect(await button.getAttribute('aria-pressed')).toBe('true');
  });

  test('survives a page that fights back with !important', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    await page.locator('.card').first().hover();
    await expect.poll(async () => (await readOverlay(page)).present).toBe(true);

    // Aimed squarely at the overlay host — the worst a page could plausibly do
    // short of removing the element. Inline `!important` must still win.
    await page.addStyleTag({
      content: `
        open-inspector-overlay {
          position: static !important;
          z-index: 0 !important;
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          transform: scale(0) !important;
        }
        * { position: static !important; }
      `,
    });

    await page.locator('.card').nth(1).hover();

    expect(await readOverlay(page)).toMatchObject({
      present: true,
      position: 'fixed',
      zIndex: OVERLAY_Z_INDEX,
      display: 'block',
    });
  });

  test('keeps working after the page mutates its whole subtree', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker);

    await page.locator('.card').first().hover();
    await expect.poll(async () => (await readOverlay(page)).present).toBe(true);

    // Single-page apps replace large subtrees; the overlay re-attaches itself
    // rather than assuming it survived.
    await page.evaluate(() => {
      document.querySelector('open-inspector-overlay')?.remove();
    });
    expect((await readOverlay(page)).present).toBe(false);

    await page.mouse.move(10, 10);
    await page.locator('.card').nth(1).hover();

    await expect.poll(async () => (await readOverlay(page)).present).toBe(true);
  });
});

test.describe('forced pseudo-states', () => {
  /**
   * Hover styles are otherwise uninspectable — reaching the panel means
   * leaving the element, and the state goes with the pointer.
   */
  async function hoverBackground(page: Page): Promise<string> {
    return page.evaluate(
      () => getComputedStyle(document.querySelector('#plain-button')!).backgroundColor,
    );
  }

  test('applies a hover rule while the pointer is elsewhere', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker);
    await page.addStyleTag({
      content: '#plain-button:hover { background: rgb(0, 128, 0) !important; }',
    });

    await page.locator('#plain-button').click();
    // Playwright leaves the pointer on whatever it clicked, so move it away —
    // otherwise the element is genuinely hovered and the test proves nothing.
    await page.mouse.move(20, 700);
    await expect.poll(async () => hoverBackground(page)).not.toBe('rgb(0, 128, 0)');

    await page.evaluate(() => {
      const root = document.querySelector('open-inspector-panel')!.shadowRoot!;
      const toggle = Array.from(root.querySelectorAll('button')).find(
        (button) => button.textContent === ':hover',
      );
      (toggle as HTMLButtonElement | undefined)?.click();
    });

    await expect.poll(async () => hoverBackground(page)).toBe('rgb(0, 128, 0)');
  });

  test('leaves no trace when the inspector closes', async ({ context, serviceWorker }) => {
    // The cleanup used to live in destroy() only, so closing the panel left
    // the page marked and restyled.
    const page = await context.newPage();
    await openInspector(page, serviceWorker);
    await page.addStyleTag({
      content: '#plain-button:hover { background: rgb(0, 128, 0) !important; }',
    });

    await page.locator('#plain-button').click();
    await page.mouse.move(20, 700);
    await page.evaluate(() => {
      const root = document.querySelector('open-inspector-panel')!.shadowRoot!;
      const toggle = Array.from(root.querySelectorAll('button')).find(
        (button) => button.textContent === ':hover',
      );
      (toggle as HTMLButtonElement | undefined)?.click();
    });
    await expect.poll(async () => hoverBackground(page)).toBe('rgb(0, 128, 0)');

    // Escape unwinds selection, then picking, then closes.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expect
      .poll(async () =>
        page.evaluate(() => ({
          marked: document.querySelector('#plain-button')!.hasAttribute(
            'data-open-inspector-force',
          ),
          injected: !!document.querySelector('style[data-open-inspector]'),
        })),
      )
      .toEqual({ marked: false, injected: false });
  });
});

test.describe('the background worker', () => {
  test('clears a stale badge when the tab navigates', async ({ context, serviceWorker }) => {
    // activeTab is revoked on navigation, taking the injected script with it.
    // A badge left reading "on" would be lying about the extension's state.
    const page = await context.newPage();
    const tabId = await openInspector(page, serviceWorker);

    await serviceWorker.evaluate(
      async (id: number) => chrome.action.setBadgeText({ tabId: id, text: 'on' }),
      tabId,
    );
    expect(
      await serviceWorker.evaluate(
        async (id: number) => chrome.action.getBadgeText({ tabId: id }),
        tabId,
      ),
    ).toBe('on');

    // Real navigation fires tabs.onUpdated, which background.ts listens for.
    await page.goto(FIXTURE_URL, { waitUntil: 'load' });

    await expect
      .poll(
        async () =>
          serviceWorker.evaluate(
            async (id: number) => chrome.action.getBadgeText({ tabId: id }),
            tabId,
          ),
        { timeout: 5000 },
      )
      .toBe('');
  });
});
