import {
  testWithHostAccess as test,
  testWithStaleWorker as staleWorkerTest,
  expect,
  FIXTURE_URL,
  activeTabId,
  toggleInspector,
} from './fixtures.js';
import type { Locator, Page } from '@playwright/test';

/**
 * The panel's own behaviour, driven through the real extension.
 *
 * Separate from inspector.spec.ts, which covers the overlay and the injection
 * plumbing. These are about what the panel does once it is on screen — the
 * parts a unit test cannot reach, because they depend on a real cascade, real
 * computed styles and a real shadow tree.
 *
 * Nothing here sleeps. Every step waits on something the panel visibly does —
 * a tab going selected, a row appearing, a computed style landing — so a slow
 * machine makes the suite slower rather than red.
 */

/**
 * The panel host.
 *
 * Its shadow root is open, unlike the overlay's, and Playwright's CSS engine
 * pierces open shadow roots — so `panel(page).locator('.row')` reaches inside
 * and gets auto-waiting and real input for free.
 */
function panel(page: Page): Locator {
  return page.locator('open-inspector-panel');
}

/** Text that is exactly `label` — so `:focus` does not also match `:focus-within`. */
function exactly(label: string): RegExp {
  return new RegExp(`^${label}$`);
}

/** Choose a tab, and wait until the panel says it is showing it. */
async function openTab(page: Page, label: string): Promise<void> {
  // By id, not text: the Styles tab also carries a count once there are edits.
  const tab = panel(page).locator(`#oi-tab-${label.toLowerCase()}`);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).locator('#oi-tabpanel')).toHaveAttribute(
    'aria-labelledby',
    `oi-tab-${label.toLowerCase()}`,
  );
}

/**
 * Pin an element by clicking it, so the panel stops following the pointer.
 *
 * Hover first and let that frame paint, as a person's pointer would. The
 * settled page scan is scheduled by the hover render, not by the click, so a
 * click that lands before any hover frame pins the element but never gets a
 * scan — pseudo-state availability and the page-wide findings never arrive.
 * The hover has painted once the panel leaves its onboarding screen for the
 * element view.
 */
async function pin(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.hover();
  await expect(panel(page).locator('#oi-tabpanel')).toBeVisible();
  // The inspector swallows the click before the page sees it, and turns it
  // into a selection.
  await target.click();
}

/**
 * Wait for the settled page scan to land.
 *
 * It runs once the pointer stops, and working out which pseudo-states the
 * page styles rides along with it. Until it lands every toggle advertises
 * itself; after, the ones nothing styles go disabled. The fixture styles
 * `:focus` nowhere, so that toggle going disabled is the scan arriving.
 */
async function waitForSettledScan(page: Page): Promise<void> {
  await expect(
    panel(page).locator('.state-toggle').filter({ hasText: exactly(':focus') }),
  ).toBeDisabled();
}

async function open(page: Page, serviceWorker: Parameters<typeof activeTabId>[0]) {
  await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
  const tabId = await activeTabId(serviceWorker);
  expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
  await expect(panel(page).locator('.panel')).toBeVisible();
  return tabId;
}

test.describe('panel search', () => {
  test('filters rows down to what was typed', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');

    const rows = panel(page).locator('.row');
    await expect.poll(() => rows.count()).toBeGreaterThan(5);
    const before = await rows.count();

    await panel(page).locator('.search').fill('padding');
    // The filtered render is the one that marks the body as searching.
    await expect(panel(page).locator('#oi-tabpanel')).toHaveAttribute('data-searching', 'true');

    const texts = await rows.allTextContents();

    expect(texts.length).toBeGreaterThan(0);
    expect(texts.length).toBeLessThan(before);
    // Every surviving row mentions it somewhere — label, value or property.
    for (const row of texts) expect(row.toLowerCase()).toContain('padding');
  });

  test('hides the groups it emptied rather than leaving bare headings', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');

    await panel(page).locator('.search').fill('padding');
    await expect(panel(page).locator('#oi-tabpanel')).toHaveAttribute('data-searching', 'true');

    // A group left holding only its own title must not be on screen.
    const bareTitles = await panel(page)
      .locator('.group')
      .evaluateAll(
        (groups) =>
          groups.filter((group) => {
            const meaningful = [...group.children].filter(
              (child) => !child.classList.contains('group-title'),
            );
            return meaningful.length === 0 && getComputedStyle(group).display !== 'none';
          }).length,
      );

    expect(bareTitles).toBe(0);
  });
});

test.describe('markup export', () => {
  test('writes the element back out as source, without our own attributes', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');
    await openTab(page, 'Markup');

    const source = panel(page).locator('pre');
    await expect(source).toContainText('<article');

    const html = await source.textContent();
    expect(html).toContain('class=');
    // The inspector must never appear in markup meant for someone's codebase.
    expect(html).not.toContain('open-inspector');

    // JSX is the same subtree in the other dialect.
    await panel(page).getByRole('button', { name: 'JSX', exact: true }).click();
    await expect(source).toContainText('className=');
    expect(await source.textContent()).not.toContain(' class=');
  });
});

test.describe('hide element', () => {
  test('takes the element out of the layout and puts it back', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');

    const card = page.locator('.card').first();
    const hide = panel(page).locator('.toolbar .hide-btn');

    await expect(card).not.toHaveCSS('display', 'none');

    await hide.click();
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(card).toHaveCSS('display', 'none');

    await hide.click();
    await expect(hide).toHaveAttribute('aria-pressed', 'false');
    await expect(card).not.toHaveCSS('display', 'none');
  });

  test('leaves nothing behind when the inspector closes', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    const tabId = await open(page, serviceWorker);
    await pin(page, '.card');

    const card = page.locator('.card').first();
    await panel(page).locator('.toolbar .hide-btn').click();
    await expect(card).toHaveCSS('display', 'none');

    await toggleInspector(serviceWorker, tabId);

    // Not merely visible again — the style attribute we created must be gone,
    // down to not leaving an empty one behind.
    await expect(card).not.toHaveCSS('display', 'none');
    await expect(card).not.toHaveAttribute('style');
  });
});

test.describe('editing type and colour', () => {
  test('font-size is editable from the Type tab', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');
    await openTab(page, 'Type');

    const size = panel(page)
      .locator('.row')
      .filter({ has: page.locator('.row-label', { hasText: exactly('size') }) })
      .first();
    await size.locator('.editable').click();

    /**
     * Real keystrokes, not synthesised events.
     *
     * Preact re-renders asynchronously, so an `input` event and an Enter
     * keydown dispatched in one synchronous block ran the keydown handler from
     * the render *before* the typing — still closed over the old draft, so it
     * committed nothing. `fill` and `press` are separate trips to the browser,
     * with the re-render between them, exactly as for someone typing.
     */
    const input = panel(page).locator('.edit-input');
    await input.fill('31px');
    await input.press('Enter');

    await expect(page.locator('.card').first()).toHaveCSS('font-size', '31px');
  });

  test('a colour row offers a picker seeded with its current value', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');
    await openTab(page, 'Color');

    const well = panel(page).locator('.color-well').first();
    await expect(well).toHaveAttribute('type', 'color');
    // Seeded from the page, not left at the control's default black.
    await expect(well).toHaveValue(/^#[0-9a-f]{6}$/);
  });
});

test.describe('the panel collapses', () => {
  test('shrinks to an edge tab and comes back', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');

    const body = panel(page).locator('.panel');
    const edgeTab = panel(page).locator('.panel-tab');
    await expect(body).toBeVisible();

    // The collapse control is the header icon button whose title says so.
    await panel(page).locator('.head-actions .icon-btn[title^="Collapse"]').click();

    await expect(body).toHaveCount(0);
    await expect(edgeTab).toBeVisible();

    await edgeTab.click();
    await expect(body).toBeVisible();
  });
});

test.describe('responsive preview', () => {
  /**
   * The claim being tested is that this is a *real* resize.
   *
   * Constraining the page inside a narrow box looks the same in a screenshot
   * but media queries evaluate against the viewport, so a boxed page still
   * renders its desktop layout. Asserting on `innerWidth` — and on a media
   * query actually matching — is the difference between the feature working
   * and merely appearing to.
   */
  test('moves the real window, so media queries re-evaluate', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    const tabId = await open(page, serviceWorker);
    await pin(page, '.card');
    // The presets live with the breakpoints they exist to test.
    await openTab(page, 'Layout');

    /**
     * Measured through the browser, not through `window.innerWidth`.
     *
     * Playwright pins the page's viewport with `setDeviceMetricsOverride`, so
     * `innerWidth` stays at the emulated size no matter what the real window
     * does. The window is what this feature moves, so the window is what the
     * test has to look at.
     */
    const windowWidth = async (): Promise<number> =>
      serviceWorker.evaluate(async (id) => {
        const tab = await chrome.tabs.get(id as number);
        const win = await chrome.windows.get(tab.windowId!);
        return win.width ?? 0;
      }, tabId);

    /**
     * Start from bounds the API will accept.
     *
     * Chrome refuses any `windows.update` whose bounds fall more than half
     * outside the visible screen, and the window Playwright creates is wide
     * enough on this display to trip that on the way back. Shrinking first
     * keeps the test about the feature rather than about the CI display.
     */
    await serviceWorker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id as number);
      await chrome.windows.update(tab.windowId!, { state: 'normal', width: 900, height: 700 });
    }, tabId);
    await expect.poll(windowWidth).toBe(900);
    const before = 900;

    const presets = panel(page).locator('.viewport-btn');
    const narrow = presets.filter({ hasText: exactly('375') });
    await expect(narrow, 'the 375 preset should be offered inside the extension').toBeVisible();
    await narrow.click();

    // Every platform enforces a minimum window width — around 570px on macOS
    // — so 375 is a request, not a guarantee. What must be true is that the
    // window really moved, and moved narrower.
    await expect.poll(windowWidth, { timeout: 4000 }).toBeLessThan(before);

    /**
     * The panel stays put, whatever width was asked for.
     *
     * It used to collapse itself below 900px to avoid covering the viewport it
     * had just created. That reads as the panel crashing on a button press,
     * and it takes the viewport control away with it — leaving no visible way
     * back out of a 375px window. It now says the page is covered and offers
     * the collapse instead.
     */
    await expect(panel(page).locator('.coverage-hint')).toBeVisible();
    await expect(panel(page).locator('.panel')).toBeVisible();
    await expect(panel(page).locator('.panel-tab')).toHaveCount(0);

    // "auto" puts back the size we found, not some remembered default.
    await presets.filter({ hasText: exactly('auto') }).click();

    await expect.poll(windowWidth, { timeout: 4000 }).toBe(before);
  });
});

test.describe('force-state toggles', () => {
  /**
   * The availability answer used to arrive late, and wrongly.
   *
   * The controller that works out which states a page styles was built on the
   * first toggle press. Until then every state advertised itself as available;
   * pressing one produced the real — usually much shorter — list, and the state
   * just forced could fall outside it. It then rendered pressed *and* disabled,
   * a combination no rule styled: white label, blanked background, a third
   * opacity. The control vanished, and with it the only way to turn it off.
   */
  test('stay legible and releasable once forced', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await page.addStyleTag({
      content: '#plain-button:hover { background: rgb(0, 128, 0) !important; }',
    });

    await pin(page, '#plain-button');
    // The availability scan rides along with the settled page scan.
    await waitForSettledScan(page);

    const hover = panel(page).locator('.state-toggle').filter({ hasText: exactly(':hover') });

    // The page styles :hover, so the toggle must be usable from the start —
    // no click needed to discover that.
    await expect(hover).toBeEnabled();

    await hover.click();
    await expect(hover).toHaveAttribute('aria-pressed', 'true');

    // Releasable: a forced state is never disabled, whatever the scan concluded.
    await expect(hover).toBeEnabled();

    const forced = await hover.evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        color: style.color,
        background: style.backgroundColor,
        opacity: Number(style.opacity),
      };
    });
    // Legible: an opaque, filled chip rather than white-on-white.
    expect(forced.opacity).toBe(1);
    expect(forced.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(forced.background).not.toBe(forced.color);
  });

  test('report honestly which states the page styles, before being pressed', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '#plain-button');

    // This fixture styles no pseudo-states at all. Every toggle saying so up
    // front beats every toggle claiming to work and then not.
    const toggles = panel(page).locator('.state-toggle');
    await expect.poll(() => toggles.count()).toBeGreaterThan(0);
    await expect(toggles.and(page.locator(':enabled'))).toHaveCount(0);
  });
});

staleWorkerTest.describe('when the background worker is stale', () => {
  /**
   * The failure that hides best is the one that looks like a limit.
   *
   * A resize request to a worker that never answers hangs rather than
   * rejecting, so the panel had nothing to report and fell back to showing the
   * width it measured — which is indistinguishable from a resize that worked
   * and was clamped. The feature appeared present and quietly did nothing.
   */
  staleWorkerTest('says so rather than reporting an unchanged width', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });

    // This worker cannot toggle anything, so inject and start it directly.
    const tabId = await activeTabId(serviceWorker);
    await serviceWorker.evaluate(async (id) => {
      await chrome.scripting.executeScript({
        target: { tabId: id as number },
        files: ['content-scripts/inspector.js'],
      });
      await chrome.tabs.sendMessage(id as number, { type: 'open-inspector:toggle' });
    }, tabId);
    await expect(panel(page).locator('.panel')).toBeVisible();

    await pin(page, '.card');
    await openTab(page, 'Layout');

    await panel(page).locator('.viewport-btn').filter({ hasText: exactly('768') }).click();

    // Longer than the deadline the content script puts on the round trip.
    await expect(panel(page).locator('.viewport-actual')).toHaveText('refused', {
      timeout: 8000,
    });

    const hint = panel(page).locator('.coverage-hint[data-error="true"]');
    await expect(hint).toContainText('did not answer');
    // And it names the fix, rather than leaving the user to guess.
    await expect(hint).toContainText('chrome://extensions');
  });
});

test.describe('page-wide contrast audit', () => {
  /**
   * The single-element verdict answers "is this readable"; this answers
   * "where is this page unreadable", which is the question anyone auditing a
   * site actually has. Run on request rather than on every selection: it is a
   * second full walk of the document.
   */
  test('finds deliberately unreadable text and jumps to it', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);

    await page.addStyleTag({
      content: `
        #contrast-victim {
          color: #bbbbbb;
          background: #ffffff;
          font-size: 14px;
          padding: 10px;
        }
      `,
    });
    await page.evaluate(() => {
      const victim = document.createElement('p');
      victim.id = 'contrast-victim';
      victim.textContent = 'Nobody can read this grey on white';
      document.body.append(victim);
    });

    await pin(page, '.card');
    /**
     * Let the settled scan land before asking for the audit.
     *
     * The style tag above changed the stylesheet count since activation, and
     * the settled scan reads that as a new page and drops its caches — the
     * audit included. An audit run inside that window is thrown away moments
     * after it renders.
     */
    await waitForSettledScan(page);
    await openTab(page, 'Color');

    await panel(page).locator('.sample-btn').filter({ hasText: 'Scan' }).click();

    // #bbbbbb on white is about 1.9:1 — it must be in there.
    const victim = panel(page).locator('.finding').filter({ hasText: 'contrast-victim' });
    await expect(victim.first()).toBeVisible({ timeout: 8000 });

    // Pressing a finding selects that element, which is the point of the list.
    await victim.first().click();

    await expect(panel(page).locator('.selector')).toContainText('contrast-victim');
  });

  test('never audits the inspector itself', async ({ context, serviceWorker }) => {
    // The panel is in the document like anything else. Auditing our own UI
    // would bury the page's findings under our own.
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');
    // As above: an audit run before the settled scan can be discarded by it.
    await waitForSettledScan(page);
    await openTab(page, 'Color');

    const scan = panel(page).locator('.sample-btn').filter({ hasText: 'Scan' });
    await scan.click();
    // The button relabels once there is a result to scan *again*.
    await expect(scan).toHaveText('Scan again', { timeout: 8000 });

    const findings = await panel(page).locator('.finding').allTextContents();
    for (const finding of findings) expect(finding).not.toContain('open-inspector');
  });
});

test.describe('the support link', () => {
  test('is present, safe to click, and makes no request of its own', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();

    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await open(page, serviceWorker);
    await pin(page, '.card');

    const link = panel(page).locator('.foot-link');
    await expect(link).toHaveText('Buy me a coffee');
    // A new tab, and one that cannot reach back into the page it came from.
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);

    // The link is inert until pressed. Rendering the panel must not touch the
    // network — which is why this is a text link and not the hosted badge.
    expect(requests.filter((url) => url.includes('buymeacoffee'))).toEqual([]);
  });

  test('shows on the first screen too, before anything is selected', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);

    await expect(panel(page).locator('.foot-link')).toHaveText('Buy me a coffee');
  });
});
