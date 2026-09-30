import { testWithHostAccess as test, expect, activeTabId, toggleInspector } from './fixtures.js';
import type { BrowserContext, Page, Request } from '@playwright/test';
import { PLAYGROUND, openTab, panel, pin, stateToggle } from './support/panel.js';

/**
 * "Nothing leaves this tab" as a network trace.
 *
 * The static guard (scripts/check-zero-egress.mjs) proves the bundle contains
 * no fetch/XHR/beacon code. It cannot prove the panel never *causes* a
 * request — an `<img src>` in a thumbnail, a url() in a rule copied into a
 * stylesheet of ours — because those are the browser fetching on our behalf.
 * Only watching the wire catches that, so this does: once the page has
 * settled, every inspector feature is exercised and the request log must not
 * grow by one entry.
 *
 * The fixture (apps/playground/egress.html) is built to make the two known
 * ways of getting this wrong loud:
 *
 * - Assets that are referenced but never fetched: og:image, an
 *   apple-touch-icon, a media-mismatched preload, and the background of a
 *   display:none element. A thumbnail for any of them would be the first
 *   request for it.
 * - Two prefetch hints, which the page *does* fetch — but not into this document's cache.
 * - A `:hover` rule in /egress/css/hover.css with `url(../img/hover.svg)`.
 *   Forcing :hover copies that rule into a <style> of ours; if the url() is
 *   not re-based it resolves against the document, to /img/hover.svg.
 */

const EGRESS_URL = `${PLAYGROUND}/egress.html`;

const UNLOADED = [
  'unloaded-og.png',
  'unloaded-touch-icon.png',
  'unloaded-preload.png',
  'unloaded-hidden-bg.png',
] as const;

/** Prefetched by the page; a thumbnail of either would be a fresh request. */
const PREFETCHED = ['/egress/img/prefetch-404.png', '/egress/img/prefetched.svg'] as const;

function isPrefetched(url: string): boolean {
  return PREFETCHED.some((path) => url === `${PLAYGROUND}${path}`);
}

interface Recorded {
  url: string;
  resourceType: string;
  fromServiceWorker: boolean;
}

/**
 * Record every request the context sees, pages and workers alike.
 * `context.on('request')` covers requests from service workers too, which is
 * where the extension's own background would make one.
 */
function record(context: BrowserContext): Recorded[] {
  const log: Recorded[] = [];
  const push = (request: Request) =>
    log.push({
      url: request.url(),
      resourceType: request.resourceType(),
      fromServiceWorker: request.serviceWorker() !== null,
    });
  context.on('request', push);
  return log;
}

/** Network requests only. The extension reading its own packaged files is not egress. */
function network(log: readonly Recorded[]): Recorded[] {
  return log.filter((entry) => /^(https?|wss?):/.test(entry.url));
}

async function exerciseEverything(page: Page): Promise<void> {
  // Sweep the pointer over the page so hover rendering runs on several elements.
  for (const selector of ['h1', '.card', '#loaded', '.faint', '#hover-target']) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`no box for ${selector}`);
    await page.mouse.move(box.x + 4, box.y + box.height / 2, { steps: 3 });
  }

  await pin(page, '#hover-target');
  await expect(panel(page).locator('.selector')).toContainText('hover-target');

  for (const tab of ['styles', 'color', 'type', 'layout', 'markup', 'export'] as const) {
    await openTab(page, tab);
  }

  // Assets: every thumbnail the panel decided to render, rendered and settled.
  await openTab(page, 'assets');
  const assets = panel(page).locator('.asset');
  await expect(assets.first()).toBeVisible();
  const notLoaded = panel(page).locator('.asset-thumb-note', { hasText: 'not loaded by the page' });
  await expect.poll(() => notLoaded.count()).toBeGreaterThanOrEqual(UNLOADED.length);
  for (const name of UNLOADED) {
    const entry = assets.filter({ has: page.locator('.asset-name', { hasText: name }) });
    await expect(entry, `${name} should be listed`).toHaveCount(1);
    await expect(entry.locator('img')).toHaveCount(0);
    await expect(entry.locator('.asset-thumb-note')).toHaveText('not loaded by the page');
  }
  const loaded = assets.filter({ has: page.locator('.asset-name', { hasText: 'loaded.svg' }) });
  await expect(loaded.locator('img')).toHaveCount(1);
  await expect
    .poll(() =>
      panel(page)
        .locator('.asset-thumb img')
        .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete)),
    )
    .toBe(true);

  // The page-wide contrast audit.
  await openTab(page, 'color');
  await panel(page).getByRole('button', { name: 'Scan the page' }).click();
  await expect(panel(page).getByRole('button', { name: 'Scan again' })).toBeVisible();

  // Forced :hover, whose copied rule carries a relative url().
  await openTab(page, 'styles');
  await expect(stateToggle(page, 'hover')).toBeEnabled();
  await stateToggle(page, 'hover').click();
  await expect(stateToggle(page, 'hover')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(2, 2);
  await expect
    .poll(() => page.locator('#hover-target').evaluate((element) => getComputedStyle(element).backgroundImage))
    .toBe(`url("${PLAYGROUND}/egress/img/hover.svg")`);
}

test.describe('zero egress', () => {
  test('using every feature makes no network request', async ({ context, serviceWorker }) => {
    const log = record(context);
    const page = await context.newPage();
    await page.goto(EGRESS_URL, { waitUntil: 'networkidle' });

    // The fixture must actually have loaded what it claims to have loaded,
    // and not what it claims it did not.
    const baseline = network(log).map((entry) => entry.url);
    expect(baseline).toContain(`${PLAYGROUND}/egress/img/loaded.svg`);
    expect(baseline).toContain(`${PLAYGROUND}/egress/img/hover.svg`);
    expect(baseline).toContain(`${PLAYGROUND}/egress/css/hover.css`);
    for (const never of UNLOADED) {
      expect(baseline.some((url) => url.includes(never)), `${never} should not load with the page`).toBe(false);
    }

    const mark = log.length;

    const tabId = await activeTabId(serviceWorker);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await expect(panel(page).locator('.panel')).toBeVisible();

    await exerciseEverything(page);

    // Asserting an absence needs a quiet window: a lazy thumbnail or a
    // late-applied background would be requested a frame or two after the
    // action that caused it, and there is no event to wait on for a request
    // that should never happen.
    await page.waitForTimeout(750);

    const after = log.slice(mark);
    expect(
      after.filter((entry) => entry.url.includes('/img/hover.svg') && !entry.url.includes('/egress/img/')),
      'forced :hover requested a url() resolved against the document instead of its stylesheet',
    ).toEqual([]);
    expect(network(after)).toEqual([]);
  });

  /**
   * Regression: Resource Timing lists `<link rel=prefetch>` fetches (even
   * failed ones), but a prefetch is not in this document's memory cache, so a
   * thumbnail of one was a fresh request. Prefetches and error responses no
   * longer count as loaded.
   */
  test('thumbnails of prefetched URLs do not re-request them', async ({
    context,
    serviceWorker,
  }) => {
    const log = record(context);
    const page = await context.newPage();
    const prefetched = Promise.all(
      PREFETCHED.map((path) => page.waitForRequest(`${PLAYGROUND}${path}`)),
    );
    await page.goto(EGRESS_URL, { waitUntil: 'networkidle' });
    await prefetched;
    const mark = log.length;

    const tabId = await activeTabId(serviceWorker);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await pin(page, '#hover-target');
    await openTab(page, 'assets');
    await expect(panel(page).locator('.asset').first()).toBeVisible();

    // Nothing to wait on for a request that should never happen.
    await page.waitForTimeout(750);
    expect(network(log.slice(mark))).toEqual([]);
  });

  test('closing the inspector makes no request either', async ({ context, serviceWorker }) => {
    const log = record(context);
    const page = await context.newPage();
    await page.goto(EGRESS_URL, { waitUntil: 'networkidle' });
    const mark = log.length;

    const tabId = await activeTabId(serviceWorker);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await pin(page, '#hover-target');
    await openTab(page, 'assets');
    await expect(panel(page).locator('.asset').first()).toBeVisible();
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(false);
    await expect(panel(page)).toHaveCount(0);

    // Same reason as above: the thing being asserted is that nothing arrives.
    await page.waitForTimeout(500);
    expect(network(log.slice(mark)).filter((entry) => !isPrefetched(entry.url))).toEqual([]);
  });
});
