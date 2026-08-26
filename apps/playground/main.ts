import { probeAtPoint, readBoxModel, describeElement } from '@open-inspector/core';
import { createInspectorSession } from '@open-inspector/ui';
import { installFixtures } from './fixtures.js';

/**
 * Interactive playground for the engine and overlay.
 *
 * The extension shell is deliberately not involved: everything below the
 * message-passing layer runs here unchanged, which makes this the fastest way
 * to see a rendering change.
 *
 * Note this page creates its *own* inspector session. The end-to-end tests use
 * e2e.html instead, which has none — so the only overlay on that page is the
 * one the extension injected.
 */

installFixtures();

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle');
const status = document.querySelector<HTMLElement>('#status');

function render(active: boolean): void {
  if (toggleButton) {
    toggleButton.textContent = active ? 'Inspect (on)' : 'Inspect (off)';
    toggleButton.setAttribute('aria-pressed', String(active));
  }
  if (status) status.textContent = active ? 'hover to inspect · Escape to stop' : 'idle';
}

const session = createInspectorSession({
  onDeactivate: () => render(false),
});

toggleButton?.addEventListener('click', () => {
  render(session.toggle());
});

render(false);

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
