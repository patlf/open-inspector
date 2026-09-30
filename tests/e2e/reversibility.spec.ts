import { testWithHostAccess as test, expect, FIXTURE_URL, activeTabId, toggleInspector } from './fixtures.js';
import type { Page } from '@playwright/test';
import {
  closeButton,
  editRow,
  openTab,
  panel,
  pin,
  serializePage,
  stateToggle,
} from './support/panel.js';

/**
 * "Closing the inspector puts every edit back" is the promise the panel prints
 * on its first screen. These hold it to that literally: the document after a
 * session of edits, forced states and hiding must serialize to the same bytes
 * it did before the inspector was ever opened.
 */

const TOUCHED = ['.card', '.card:nth-child(2)', '#plain-button'] as const;

interface Snapshot {
  /** Serialized document, with a known leftover normalized away — see below. */
  html: string;
  /** Raw `style` attribute on <html>, also asserted on its own below. */
  rootStyle: string | null;
  computed: Record<string, Record<string, string>>;
  styleSheets: number;
  adoptedSheets: number;
  styled: string[];
  forced: number;
  ourStyles: number;
}

async function snapshot(page: Page): Promise<Snapshot> {
  // The pointer sits somewhere neutral both times, so real :hover cannot differ.
  await page.mouse.move(2, 2);
  const html = (await serializePage(page));
  const rest = await page.evaluate((selectors) => {
    const computed: Record<string, Record<string, string>> = {};
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`fixture lost ${selector}`);
      const style = getComputedStyle(element);
      const entries: Record<string, string> = {};
      for (let i = 0; i < style.length; i += 1) {
        const name = style.item(i);
        entries[name] = style.getPropertyValue(name);
      }
      computed[selector] = entries;
    }
    return {
      rootStyle: document.documentElement.getAttribute('style'),
      computed,
      styleSheets: document.styleSheets.length,
      adoptedSheets: document.adoptedStyleSheets.length,
      // Our hosts carry inline geometry locks; they are removed or inert, and
      // are not the page's.
      styled: [...document.querySelectorAll('[style]')]
        .filter((element) => !element.matches('open-inspector-panel, open-inspector-overlay'))
        // The <html> attribute is also asserted on its own, below.
        .filter((element) => !(element === document.documentElement && element.getAttribute('style') === ''))
        .map((element) => `${element.tagName.toLowerCase()}[style="${element.getAttribute('style')}"]`),
      forced: document.querySelectorAll('[data-open-inspector-force]').length,
      ourStyles: document.querySelectorAll('style[data-open-inspector]').length,
    };
  }, TOUCHED as unknown as string[]);
  return { html, ...rest };
}

/** Bring the page to a state with a hover rule to force. Part of the baseline. */
async function loadFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE_URL, { waitUntil: 'load' });
  await page.addStyleTag({
    content: '#plain-button:hover { outline: 3px solid rgb(255, 0, 0); }',
  });
}

/**
 * Four overrides on three elements, plus one forced state.
 * Returns once every one of them is visibly in effect.
 */
async function makeEdits(page: Page): Promise<void> {
  await pin(page, '.card');
  await editRow(page, 'padding', '31px');
  await editRow(page, 'radius', '9px');
  await expect.poll(() => computed(page, '.card', 'padding-top')).toBe('31px');
  await expect.poll(() => computed(page, '.card', 'border-top-left-radius')).toBe('9px');

  await pin(page, '#plain-button');
  await editRow(page, 'background', 'rgb(0, 128, 0)');
  await expect.poll(() => computed(page, '#plain-button', 'background-color')).toBe('rgb(0, 128, 0)');

  // Availability comes from the settled scan; the page styles :hover here.
  await expect(stateToggle(page, 'hover')).toBeEnabled();
  await stateToggle(page, 'hover').click();
  await expect(stateToggle(page, 'hover')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(2, 2);
  await expect.poll(() => computed(page, '#plain-button', 'outline-color')).toBe('rgb(255, 0, 0)');

  await pin(page, '.card:nth-child(2)');
  await panel(page).locator('.hide-btn').click();
  await expect(panel(page).locator('.hide-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => computed(page, '.card:nth-child(2)', 'display')).toBe('none');
}

function computed(page: Page, selector: string, property: string): Promise<string> {
  return page.evaluate(
    ([css, name]) => getComputedStyle(document.querySelector(css as string)!).getPropertyValue(name as string),
    [selector, property] as const,
  );
}

test.describe('closing puts the page back', () => {
  test('edits, forced states and hiding leave no trace once closed', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await loadFixture(page);
    const before = await snapshot(page);
    expect(before.forced).toBe(0);
    expect(before.ourStyles).toBe(0);

    const tabId = await activeTabId(serviceWorker);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await expect(panel(page).locator('.panel')).toBeVisible();

    await makeEdits(page);

    // Four overrides — hiding is one of them. A forced state is not an edit.
    const badge = panel(page).locator('#oi-tab-styles .tab-count');
    await expect(badge).toHaveText('4');

    // Revert exactly one, from the Changes list, and nothing else moves.
    await openTab(page, 'styles');
    const radiusChange = panel(page)
      .locator('.change')
      .filter({ has: page.locator('.change-prop', { hasText: /^border-radius$/ }) });
    await expect(radiusChange).toHaveCount(1);
    await radiusChange.locator('.revert').click();

    await expect(badge).toHaveText('3');
    await expect(radiusChange).toHaveCount(0);
    await expect
      .poll(() => computed(page, '.card', 'border-top-left-radius'))
      .toBe(before.computed['.card']!['border-top-left-radius']);
    expect(await computed(page, '.card', 'padding-top')).toBe('31px');
    expect(await computed(page, '#plain-button', 'background-color')).toBe('rgb(0, 128, 0)');
    expect(await computed(page, '.card:nth-child(2)', 'display')).toBe('none');

    // First close asks; the page is still edited while it asks.
    await closeButton(page).click();
    const confirm = panel(page).locator('.confirm-close');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('3 changes');
    expect(await computed(page, '.card', 'padding-top')).toBe('31px');

    // Second close confirms.
    await closeButton(page).click();
    await expect(panel(page)).toHaveCount(0);

    const after = await snapshot(page);
    expect(after.forced).toBe(0);
    expect(after.ourStyles).toBe(0);
    expect(after.styleSheets).toBe(before.styleSheets);
    expect(after.adoptedSheets).toBe(before.adoptedSheets);
    expect(after.styled).toEqual(before.styled);
    expect(after.computed).toEqual(before.computed);
    expect(after.html).toBe(before.html);
  });

  test('"Keep open" cancels the close and keeps every edit', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await loadFixture(page);
    const before = await snapshot(page);

    const tabId = await activeTabId(serviceWorker);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await expect(panel(page).locator('.panel')).toBeVisible();
    await makeEdits(page);

    await closeButton(page).click();
    const confirm = panel(page).locator('.confirm-close');
    await expect(confirm).toBeVisible();

    await confirm.getByRole('button', { name: 'Keep open' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(panel(page).locator('.panel')).toBeVisible();
    await expect(panel(page).locator('#oi-tab-styles .tab-count')).toHaveText('4');
    expect(await computed(page, '.card', 'padding-top')).toBe('31px');
    expect(await computed(page, '.card:nth-child(2)', 'display')).toBe('none');
    expect(await page.locator('[data-open-inspector-force]').count()).toBe(1);

    // Cancelled means reset: the next close asks again rather than going through.
    await closeButton(page).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Revert & close' }).click();
    await expect(panel(page)).toHaveCount(0);

    expect((await snapshot(page)).html).toBe(before.html);
  });

  test('Escape takes the same confirm path once the page is handed back', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await loadFixture(page);
    const before = await snapshot(page);

    const tabId = await activeTabId(serviceWorker);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await pin(page, '.card');
    await editRow(page, 'padding', '31px');
    await expect(panel(page).locator('#oi-tab-styles .tab-count')).toHaveText('1');

    await page.keyboard.press('Escape'); // release the pin
    await page.keyboard.press('Escape'); // stop picking
    await expect(panel(page).locator('.primary-btn')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape'); // asks
    await expect(panel(page).locator('.confirm-close')).toBeVisible();
    await page.keyboard.press('Escape'); // confirms
    await expect(panel(page)).toHaveCount(0);

    expect((await snapshot(page)).html).toBe(before.html);
  });

  /**
   * Regression: restoring the crosshair cursor emptied the declaration but
   * left `style=""` on `<html>`, so the page was not byte-identical after
   * closing.
   */
  test('leaves <html> without a style attribute it did not have', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await loadFixture(page);
    const before = await serializePage(page);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('style'))).toBe(false);

    const tabId = await activeTabId(serviceWorker);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await expect(panel(page).locator('.panel')).toBeVisible();
    await closeButton(page).click();
    await expect(panel(page)).toHaveCount(0);

    expect(await page.evaluate(() => document.documentElement.getAttribute('style'))).toBeNull();
    expect(await serializePage(page)).toBe(before);
  });
});
