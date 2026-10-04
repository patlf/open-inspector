import { probeAtPoint, readBoxModel, describeElement, script } from '@open-inspector/core';
import { js as beautifyJs } from 'js-beautify';
import {
  createInspectorSession,
  type InspectorSession,
  type InspectorSettings,
} from '@open-inspector/ui';

/**
 * The playground's inspector session, hot-swapped on every source change.
 *
 * Every edit to core or ui lands here, and only here: this module accepts its
 * own updates, and it is the only one on the page that imports either
 * package, so Vite never has to fall back to reloading the page. Each run
 * takes over from the session the last one left on the window — open or
 * not, picking or not, the held element, the tab, the structure drawer, how
 * far the panel was scrolled, the settings — destroys it, and carries on
 * with a new one built from the new code. A changed stylesheet or component
 * shows on the element you were already looking at.
 *
 * The takeover happens here, as the new code runs, rather than in Vite's
 * `dispose`. Two edits close together send two updates, and the second
 * `dispose` ran before the first update's module had, against a session
 * already destroyed: it handed over "inactive", and the inspector closed.
 * Taken over here, whichever run is last wins, and an update that fails to
 * load leaves the old session working rather than torn down.
 *
 * Playground-only. The extension reloads itself instead: a content script
 * cannot be hot-swapped from a dev server without the page being able to
 * reach it, which is exactly what the extension forbids.
 */

interface HandOver {
  active: boolean;
  picking: boolean;
  selected: Element | null;
  /** Id of the selected rail tab, settings included. */
  tab: string | null;
  structureOpen: boolean;
  scrollTop: number;
  settings: InspectorSettings | undefined;
}

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle');
const status = document.querySelector<HTMLElement>('#status');

function render(active: boolean): void {
  if (toggleButton) {
    toggleButton.textContent = active ? 'Inspect (on)' : 'Inspect (off)';
    toggleButton.setAttribute('aria-pressed', String(active));
  }
  if (status) status.textContent = active ? 'hover to inspect · Escape to stop' : 'idle';
}

const STRUCTURE_TOGGLE = 'button[aria-label="Structure"]';

/** What one run leaves on the window for the next to take over. */
interface Live {
  session: InspectorSession;
  settings(): InspectorSettings | undefined;
}
const LIVE = '__openInspectorPlayground';
const slot = window as unknown as Record<typeof LIVE, Live | undefined>;

/** The panel's shadow root, open by design. */
function panelRoot(): ShadowRoot | null {
  return document.querySelector('open-inspector-panel')?.shadowRoot ?? null;
}

/** Read what the last run's session was doing, then retire it. */
function takeOver(live: Live): HandOver {
  const root = panelRoot();
  const handOver: HandOver = {
    active: live.session.active,
    picking: live.session.picking,
    selected: live.session.selected,
    tab:
      root?.querySelector('#oi-tab-settings[aria-pressed="true"]')?.id ??
      root?.querySelector('[role="tab"][aria-selected="true"]')?.id ??
      null,
    scrollTop: root?.querySelector('.body')?.scrollTop ?? 0,
    structureOpen: root?.querySelector(STRUCTURE_TOGGLE)?.getAttribute('aria-pressed') === 'true',
    settings: live.settings(),
  };
  live.session.destroy();
  return handOver;
}

const live = slot[LIVE];
const previous = live ? takeOver(live) : undefined;
let settings = previous?.settings;

const session = createInspectorSession({
  onDeactivate: () => render(false),
  ...(settings ? { settings } : {}),
  onSettingsChange: (next) => {
    settings = next;
  },
  // The playground is the page, so the probe runs right here; the extension
  // has its worker run it in the page's world instead.
  readPageHandlers: (eventName) => {
    script.probeHandlersInPage(eventName, 8000);
    return Promise.resolve(true);
  },
  // Formatted right here; the extension asks its worker, which carries the formatter.
  beautify: (code) =>
    Promise.resolve(beautifyJs(code, { indent_size: 2, max_preserve_newlines: 2, end_with_newline: false })),
});

// Assigned, not added: this module runs again on every update, and a second
// listener would toggle the session twice per click.
if (toggleButton) toggleButton.onclick = () => render(session.toggle());

render(false);

if (previous?.active) {
  session.activate();
  render(true);
  if (previous.selected?.isConnected) session.select(previous.selected);
  session.setPicking(previous.picking);

  // The panel renders on the next frame; the tab and the scroll go after it.
  requestAnimationFrame(() => {
    const root = panelRoot();
    if (previous.tab) root?.querySelector<HTMLElement>(`#${previous.tab}`)?.click();
    if (previous.structureOpen) root?.querySelector<HTMLElement>(STRUCTURE_TOGGLE)?.click();
    requestAnimationFrame(() => {
      const body = panelRoot()?.querySelector<HTMLElement>('.body');
      if (body) body.scrollTop = previous.scrollTop;
    });
  });
}

slot[LIVE] = { session, settings: () => settings };
import.meta.hot?.accept();

/**
 * Debug handles for driving the engine from the console.
 *
 * Playground-only. The extension never exposes anything on `window` — the
 * content script runs in an isolated world precisely so it cannot be reached
 * from the page.
 */
Object.assign(window, {
  inspectorSession: session,
  openInspectorDebug: {
    probeAtPoint,
    readBoxModel,
    describeElement,
    /**
     * Probe the centre of the first element matching a selector.
     *
     * Scrolls into view first: `elementFromPoint` works in viewport
     * coordinates and correctly returns nothing for anything below the fold.
     */
    probeCentreOf(selector: string) {
      const element = document.querySelector(selector);
      if (!element) return { error: `no element matches ${selector}` };

      element.scrollIntoView({ block: 'center', behavior: 'instant' });

      const rect = element.getBoundingClientRect();
      const result = probeAtPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!result) return { error: 'probe hit nothing' };

      return {
        resolved: describeElement(result.element).selectorLabel,
        shadowDepth: result.shadowDepth,
        boundary: result.boundary,
        pathTags: result.path.map((el) => el.tagName.toLowerCase()),
      };
    },
  },
});
