import { testWithHostAccess as test, expect, activeTabId, toggleInspector } from './fixtures.js';
import type { Page } from '@playwright/test';
import { PLAYGROUND, openInspector, openTab, panel, pin } from './support/panel.js';

/**
 * The panel on a page that fights back.
 *
 * apps/playground/hostile.html resets every property on every element with
 * `all: unset !important`, zeroes font sizes and line heights, forces block
 * display and static positioning, links a stylesheet from another origin,
 * owns a shadow root of its own, and swaps its stylesheet with a pushState
 * router. Each is something real sites do, if rarely all at once.
 */

const HOSTILE_URL = `${PLAYGROUND}/hostile.html`;

/** Exactly the copy RulesSection renders for one unreadable sheet (sections.tsx `unreadableNote`). */
const UNREADABLE_NOTE =
  '1 stylesheet is served cross-origin, so the browser will not let any extension read the rules inside.';

interface TextMetrics {
  fontSize: number;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  width: number;
  height: number;
  textTransform: string;
  textAlign: string;
  cursor: string;
}

async function metrics(page: Page, selector: string): Promise<TextMetrics> {
  return panel(page)
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        color: style.color,
        width: box.width,
        height: box.height,
        textTransform: style.textTransform,
        textAlign: style.textAlign,
        cursor: style.cursor,
      };
    });
}

async function expectPanelFillsViewport(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const box = await panel(page).locator('.panel').boundingBox();
  expect(box).not.toBeNull();
  // 12px inset on every side; a transformed ancestor or a page reset that
  // reached it would change these first.
  expect(box!.width).toBeGreaterThanOrEqual(300);
  expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 24 - 2);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
}

test.describe('hostile page', () => {
  test('the panel stays legible under global !important resets', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, HOSTILE_URL);
    await pin(page, '.title');
    await expect(panel(page).locator('.selector')).toHaveText('h1.title');

    await expectPanelFillsViewport(page);

    for (const selector of ['#oi-tab-styles', '.selector', '.group-title', '.row-label', '.foot-link']) {
      const text = await metrics(page, selector);
      expect(text.fontSize, `${selector} font-size`).toBeGreaterThanOrEqual(9);
      expect(text.lineHeight, `${selector} line-height`).not.toBe('0px');
      expect(text.height, `${selector} height`).toBeGreaterThan(8);
      expect(text.width, `${selector} width`).toBeGreaterThan(8);
      expect(text.color, `${selector} color`).not.toBe('rgba(0, 0, 0, 0)');
      // 0.6em of tracking would push every label out of its column.
      expect(['normal', '0px'].includes(text.letterSpacing) || Number.parseFloat(text.letterSpacing) < 2, `${selector} letter-spacing ${text.letterSpacing}`).toBe(true);
    }

    // Every tab still reachable and readable.
    for (const id of ['styles', 'color', 'type', 'layout', 'assets', 'markup', 'export'] as const) {
      await openTab(page, id);
      await expect(panel(page).locator('#oi-tabpanel')).toBeVisible();
    }
  });

  test('says the cross-origin sheet cannot be read instead of pretending it has no rules', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, HOSTILE_URL);

    // The fixture is only meaningful if the sheet really is opaque.
    expect(
      await page.evaluate(() =>
        [...document.styleSheets].filter((sheet) => {
          try {
            void sheet.cssRules;
            return false;
          } catch {
            return true;
          }
        }).length,
      ),
    ).toBe(1);

    await pin(page, '.hover-me');
    await openTab(page, 'styles');
    await expect(panel(page).locator('#oi-tabpanel')).toContainText(UNREADABLE_NOTE);
    // The forcing controls own up to the same limit.
    await expect(panel(page).locator('#oi-tabpanel')).toContainText(
      '1 cross-origin stylesheet could not be read, so states defined there cannot be forced.',
    );
  });

  test('never re-fetches the cross-origin sheet or anything else', async ({
    context,
    serviceWorker,
  }) => {
    const requests: string[] = [];
    context.on('request', (request) => requests.push(request.url()));

    const page = await context.newPage();
    await page.goto(HOSTILE_URL, { waitUntil: 'networkidle' });
    expect(requests).toContain('http://cross.localhost:5178/hostile/cross.css');
    const mark = requests.length;

    const tabId = await activeTabId(serviceWorker);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await pin(page, '.hover-me');
    for (const id of ['styles', 'color', 'type', 'layout', 'assets', 'markup', 'export'] as const) {
      await openTab(page, id);
    }

    // An absence has no event to wait for; give a late request time to show.
    await page.waitForTimeout(500);
    expect(requests.slice(mark).filter((url) => /^https?:/.test(url))).toEqual([]);
  });

  test('inspects inside the page’s own open shadow root', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, HOSTILE_URL);

    await pin(page, page.locator('page-card').locator('.inner'));
    await expect(panel(page).locator('.selector')).toHaveText('div.inner');
    await openTab(page, 'color');
    await expect(panel(page).locator('#oi-tabpanel')).toContainText('#e6f0fa');
  });

  test('after a pushState route change, reopening shows the new route’s styles', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    const tabId = await openInspector(page, serviceWorker, HOSTILE_URL);
    const rules = panel(page).locator('.rule-block', { hasText: '.title' });

    await pin(page, '.title');
    await expect(rules).toContainText('rgb(200, 0, 0)');

    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(false);
    await expect(panel(page)).toHaveCount(0);

    // The inspector is closed, so this is the page's own click and its router.
    await page.locator('#to-b').click();
    await expect(page).toHaveURL(`${PLAYGROUND}/hostile/route-b`);
    await expect(page.locator('.title')).toHaveText('Route B');

    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await pin(page, '.title');
    await expect(rules).toContainText('rgb(0, 0, 200)');
    await expect(rules).not.toContainText('rgb(200, 0, 0)');
    await openTab(page, 'color');
    await expect(panel(page).locator('#oi-tabpanel')).toContainText('#0000c8');
  });

  /** Pin .title, hand the page back, follow the router to route B, re-arm the picker. */
  async function changeRouteWhileOpen(page: Page) {
    const rules = panel(page).locator('.rule-block', { hasText: '.title' });
    await pin(page, '.title');
    await expect(rules).toContainText('rgb(200, 0, 0)');

    await panel(page).locator('.primary-btn').click();
    await expect(panel(page).locator('.primary-btn')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#to-b').click();
    await expect(page.locator('.title')).toHaveText('Route B');
    await panel(page).locator('.primary-btn').click();
    await expect(panel(page).locator('.primary-btn')).toHaveAttribute('aria-pressed', 'true');
    return rules;
  }

  test('a route change while open is picked up once another element is selected', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, HOSTILE_URL);
    const rules = await changeRouteWhileOpen(page);

    await pin(page, '.hover-me');
    await expect(panel(page).locator('.selector')).toHaveText('p.hover-me');
    await pin(page, '.title');
    await expect(panel(page).locator('.selector')).toHaveText('h1.title');
    await expect(rules).toContainText('rgb(0, 0, 200)');
    await expect(rules).not.toContainText('rgb(200, 0, 0)');
  });

  /**
   * Regression: the stale-cache check only ran when the selected element
   * changed, so re-picking an element the router kept mounted showed the
   * previous route's rules. It now runs on every collect.
   */
  test('a route change while open is picked up when re-picking the same element', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, HOSTILE_URL);
    const rules = await changeRouteWhileOpen(page);

    await pin(page, '.title');
    await expect(rules).toContainText('rgb(0, 0, 200)');
    await expect(rules).not.toContainText('rgb(200, 0, 0)');
  });

  /**
   * Regression: a transform on `<html>` makes it the containing block for our
   * `position: fixed` host, and the panel collapsed to a sliver. The host now
   * lives in the top layer.
   */
  test('stays full height when the page transforms <html>', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, `${HOSTILE_URL}?root-transform`);
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).transform),
    ).not.toBe('none');
    await pin(page, '.title');
    await expectPanelFillsViewport(page);
  });

  /**
   * Regression: a page `!important` rule on the host beat `:host { all:
   * initial }`, and inherited text styles leaked into the panel. The host is
   * now reset inline.
   */
  test('does not inherit text-transform, text-align or cursor from the page', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, `${HOSTILE_URL}?inherit`);
    await pin(page, '.title');

    for (const selector of ['.selector', '.foot-name', '.rule-selector', '.decl .val']) {
      const text = await metrics(page, selector);
      expect(text.textTransform, `${selector} text-transform`).toBe('none');
      expect(text.textAlign, `${selector} text-align`).not.toBe('right');
      expect(text.cursor, `${selector} cursor`).not.toBe('none');
    }
  });
});
