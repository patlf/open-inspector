import type { Locator, Page, Worker } from '@playwright/test';
import { expect, activeTabId, toggleInspector } from '../fixtures.js';

/**
 * Shared driving code for the specs that were added after fixtures.ts.
 *
 * Everything here goes through real input — mouse, keyboard, `fill` — and
 * waits with web-first assertions. The panel's shadow root is open, so
 * Playwright's CSS engine pierces it and `panel(page).locator('.row')` reaches
 * straight into it.
 */

export const PLAYGROUND = 'http://localhost:5178';

/** The panel host. Every locator into the panel hangs off this. */
export function panel(page: Page): Locator {
  return page.locator('open-inspector-panel');
}

/** Load a page, turn the inspector on, and wait for the panel to be on screen. */
export async function openInspector(
  page: Page,
  serviceWorker: Worker,
  url: string,
  { waitUntil = 'load' }: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' } = {},
): Promise<number> {
  await page.goto(url, { waitUntil });
  const tabId = await activeTabId(serviceWorker);
  expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
  await expect(panel(page).locator('.panel')).toBeVisible();
  return tabId;
}

/**
 * Hover then click an element so the panel holds it.
 *
 * Waits until the breadcrumb (only rendered once there is element data) is up
 * and the settled page scan has landed — the Force state group is the marker
 * for that, since its availability comes from the same pass.
 */
export async function pin(page: Page, target: string | Locator): Promise<void> {
  const locator = typeof target === 'string' ? page.locator(target).first() : target;
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${String(target)}`);
  const x = box.x + Math.min(box.width / 2, 40);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  // The hover must have been rendered before the click, or the click lands on
  // whatever the probe saw last.
  await expect(panel(page).locator('.crumbs')).toBeVisible();
  await page.mouse.click(x, y);
  await expect(panel(page).locator('.crumbs')).toBeVisible();
}

/** Select a tab by id and wait for it to report itself selected. */
export async function openTab(
  page: Page,
  id: 'styles' | 'color' | 'type' | 'layout' | 'assets' | 'markup' | 'export',
): Promise<void> {
  const tab = panel(page).locator(`#oi-tab-${id}`);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The editable row whose visible label is exactly `label`. */
export function row(page: Page, label: string): Locator {
  return panel(page)
    .locator('.row')
    .filter({ has: page.locator('.row-label', { hasText: new RegExp(`^${escape(label)}$`) }) });
}

/** Click a row's value, type a new one, press Enter. */
export async function editRow(page: Page, label: string, value: string): Promise<void> {
  const target = row(page, label).first();
  await target.locator('.editable').click();
  const input = panel(page).locator('.edit-input');
  await expect(input).toBeFocused();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/** The close button in the header. */
export function closeButton(page: Page): Locator {
  return panel(page).locator('.head-actions .icon-btn[title^="Close"]');
}

/** A force-state chip by its state name, without the colon. */
export function stateToggle(page: Page, state: string): Locator {
  return panel(page).locator('.state-toggle', { hasText: new RegExp(`^:${escape(state)}$`) });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The document as the page would serialize it, minus the two hosts the
 * inspector appends to <html>. Anything else that differs is ours.
 */
export async function serializePage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    for (const host of clone.querySelectorAll('open-inspector-panel, open-inspector-overlay')) {
      host.remove();
    }
    return clone.outerHTML;
  });
}
