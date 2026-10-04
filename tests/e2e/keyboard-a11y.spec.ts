import AxeBuilder from '@axe-core/playwright';
import { testWithHostAccess as test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';
import { PLAYGROUND, openInspector, openTab, panel, pin } from './support/panel.js';

/**
 * The panel for someone who does not use a mouse, or cannot see it well.
 *
 * axe runs against the panel's shadow tree only — the fixture page is not
 * the thing under test — in both colour schemes, since the panel carries two
 * full palettes and a contrast regression in one would not show in the
 * other. Serious and critical findings fail the test.
 */

const KEYBOARD_URL = `${PLAYGROUND}/keyboard.html`;
const TABS = ['styles', 'color', 'type', 'layout', 'assets', 'markup', 'js', 'export', 'svg'] as const;

interface Finding {
  surface: string;
  id: string;
  impact: string;
  help: string;
  target: string;
  summary: string;
}

async function auditPanel(page: Page, surface: string): Promise<Finding[]> {
  const results = await new AxeBuilder({ page }).include('open-inspector-panel').analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap((violation) =>
      violation.nodes.map((node) => ({
        surface,
        id: violation.id,
        impact: violation.impact ?? 'unknown',
        help: violation.help,
        target: JSON.stringify(node.target),
        summary: node.failureSummary ?? '',
      })),
    );
}

/** Pin an element and run axe over every tab, plus the shortcut list. */
async function auditEverySurface(page: Page): Promise<Finding[]> {
  await pin(page, '#c2');
  await expect(panel(page).locator('.selector')).toContainText('c2');

  const findings: Finding[] = [];
  for (const tab of TABS) {
    await openTab(page, tab);
    findings.push(...(await auditPanel(page, tab)));
  }

  // A surface that only exists after an action.
  await panel(page).getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(panel(page).locator('.head .onboard-keys')).toBeVisible();
  findings.push(...(await auditPanel(page, 'shortcuts open')));

  await panel(page).getByRole('button', { name: 'Structure' }).click();
  await expect(panel(page).getByRole('tree')).toBeVisible();
  findings.push(...(await auditPanel(page, 'structure open')));
  return findings;
}

/**
 * Violations accepted for now, matched precisely — rule and element — so that
 * anything else, including the same rule on a different element, still fails
 * the main test. Empty: keep it that way, or add an entry with a test that
 * owns the fix.
 */
const KNOWN: ReadonlyArray<{ id: string; target: RegExp; fixme: string }> = [];

function isKnown(finding: Finding): boolean {
  return KNOWN.some((known) => known.id === finding.id && known.target.test(finding.target));
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe, ${colorScheme} scheme`, () => {
    // Eight full axe passes over a large shadow tree take ~12s on their own.
    test.describe.configure({ timeout: 60_000 });

    test('finds nothing serious in the panel on any tab', async ({ context, serviceWorker }) => {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme });
      await openInspector(page, serviceWorker, KEYBOARD_URL);
      expect(await page.evaluate((scheme) => matchMedia(`(prefers-color-scheme: ${scheme})`).matches, colorScheme)).toBe(true);

      const unexpected = (await auditEverySurface(page)).filter((finding) => !isKnown(finding));
      expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
    });

    /**
     * Regression: axe `label-title-only` — the filter box was named only by
     * its title and placeholder.
     */
    test('the search box has a real label', async ({ context, serviceWorker }) => {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme });
      await openInspector(page, serviceWorker, KEYBOARD_URL);
      const findings = await auditEverySurface(page);
      expect(findings.filter((finding) => finding.id === 'label-title-only' && /"\.search"/.test(finding.target))).toEqual([]);
    });

    /**
     * Regression: axe `label-title-only` — the colour inputs were named only
     * by their title.
     */
    test('colour wells have a real label', async ({ context, serviceWorker }) => {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme });
      await openInspector(page, serviceWorker, KEYBOARD_URL);
      const findings = await auditEverySurface(page);
      expect(findings.filter((finding) => finding.id === 'label-title-only' && /\.color-well/.test(finding.target))).toEqual([]);
    });

    /**
     * Regression: axe `scrollable-region-focusable` — the Export and Markup
     * `<pre>` blocks could not be focused, so they could not be scrolled from
     * the keyboard.
     */
    test('code blocks are keyboard-scrollable', async ({ context, serviceWorker }) => {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme });
      await openInspector(page, serviceWorker, KEYBOARD_URL);
      const findings = await auditEverySurface(page);
      expect(findings.filter((finding) => finding.id === 'scrollable-region-focusable')).toEqual([]);
    });
  });
}

test.describe('keyboard only', () => {
  test('arrow keys walk the tree from a pinned element', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, KEYBOARD_URL);
    await pin(page, '#c2');
    const label = panel(page).locator('.selector');
    await expect(label).toContainText('c2');

    await page.keyboard.press('ArrowUp');
    await expect(label).toContainText('parent');
    await page.keyboard.press('ArrowDown');
    await expect(label).toContainText('c1');
    await page.keyboard.press('ArrowRight');
    await expect(label).toContainText('c2');
    await page.keyboard.press('ArrowRight');
    await expect(label).toContainText('c3');
    await page.keyboard.press('ArrowLeft');
    await expect(label).toContainText('c2');
  });

  test('arrow keys in a page text field still move its caret', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, KEYBOARD_URL);
    await pin(page, '#c2');
    const label = panel(page).locator('.selector');
    await expect(label).toContainText('c2');

    // Give the page back so a click can focus its field; the selection is kept.
    await panel(page).locator('.primary-btn').click();
    await expect(panel(page).locator('.primary-btn')).toHaveAttribute('aria-pressed', 'false');
    const input = page.locator('#page-input');
    await input.click();
    await expect(input).toBeFocused();

    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => input.evaluate((field) => (field as HTMLInputElement).selectionStart)).toBe(4);
    await page.keyboard.type('X');
    await expect(input).toHaveValue('abcdXef');

    // Up/Down are the tree walk's parent/child keys; in a field they are the field's.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(label).toContainText('c2');
    await expect(input).toBeFocused();
  });

  test('the tab strip is one tab stop with arrow-key roving', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, KEYBOARD_URL);
    await pin(page, '#c2');
    const label = panel(page).locator('.selector');

    const styles = panel(page).locator('#oi-tab-styles');
    await styles.focus();
    await expect(styles).toBeFocused();
    await expect(panel(page).locator('[role="tab"][tabindex="0"]')).toHaveCount(1);

    await page.keyboard.press('ArrowRight');
    const color = panel(page).locator('#oi-tab-color');
    await expect(color).toHaveAttribute('aria-selected', 'true');
    await expect(color).toBeFocused();
    await expect(styles).toHaveAttribute('tabindex', '-1');

    // SVG is the last tab on the rail.
    await page.keyboard.press('End');
    await expect(panel(page).locator('#oi-tab-svg')).toBeFocused();
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(styles).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // wraps back
    await expect(panel(page).locator('#oi-tab-svg')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(styles).toHaveAttribute('aria-selected', 'true');

    // The strip took those arrows; the tree walk did not.
    await expect(label).toContainText('c2');
  });

  test('the ? button toggles the shortcut list from the keyboard', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, KEYBOARD_URL);
    await pin(page, '#c2');

    const keys = panel(page).getByRole('button', { name: 'Keyboard shortcuts' });
    const list = panel(page).locator('.head .onboard-keys');
    await expect(list).toHaveCount(0);

    await keys.focus();
    await page.keyboard.press('Enter');
    await expect(keys).toHaveAttribute('aria-pressed', 'true');
    await expect(list).toBeVisible();
    await expect(list).toContainText('parent · first child');
    await expect(list).toContainText('Esc');

    await page.keyboard.press('Space');
    await expect(keys).toHaveAttribute('aria-pressed', 'false');
    await expect(list).toHaveCount(0);
  });

  test('Escape unwinds: release the pin, stop picking, then close', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, KEYBOARD_URL);
    await pin(page, '#c2');
    const label = panel(page).locator('.selector');
    await expect(label).toContainText('c2');

    // 1: released — hovering follows the pointer again.
    await page.keyboard.press('Escape');
    const c3 = await page.locator('#c3').boundingBox();
    await page.mouse.move(c3!.x + 10, c3!.y + 10);
    await expect(label).toContainText('c3');

    // 2: picking stops; the page is usable and the panel stays.
    await page.keyboard.press('Escape');
    await expect(panel(page).locator('.primary-btn')).toHaveAttribute('aria-pressed', 'false');
    await expect(panel(page).locator('.panel')).toBeVisible();

    // 3: nothing pending, so no confirmation — it just closes.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Escape in the filter box clears it and nothing else', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, KEYBOARD_URL);
    await pin(page, '#c2');
    const label = panel(page).locator('.selector');
    await expect(label).toContainText('c2');

    const filter = panel(page).locator('.search');
    await filter.fill('padding');
    await filter.press('Escape');
    await expect(filter).toHaveValue('');

    // Still pinned: moving the pointer away does not change what is shown.
    const c3 = await page.locator('#c3').boundingBox();
    await page.mouse.move(c3!.x + 10, c3!.y + 10);
    await expect(label).toContainText('c2');
  });
});
