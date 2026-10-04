import { browser } from 'wxt/browser';
import { mountRemotePanel, type RemotePort } from '@open-inspector/ui';
import {
  DEVTOOLS_PORT,
  isDevtoolsSelectEvent,
  isDevtoolsStatus,
  type DevtoolsHelloMessage,
  type DevtoolsStartMessage,
} from '../../lib/messages.js';

/**
 * The Firefox DevTools tab: the inspector's panel, drawn here while the
 * inspector itself runs in the page.
 *
 * One port to the worker, which joins it to the content script in the same
 * tab. Everything the panel draws arrives on it; everything it asks for goes
 * back on it. If the worker is suspended and the port drops, it reconnects.
 */

const tabId = browser.devtools.inspectedWindow.tabId;

/** How often to ask DevTools what it has selected, while the tab is in view. */
const SELECTION_POLL_MS = 500;
/** How long to wait before reconnecting a dropped port. */
const RECONNECT_MS = 1000;

/**
 * Firefox lets the extension into a page only after the toolbar button or
 * the keyboard shortcut — not after a click in DevTools, whatever the docs
 * suggest; its source grants activeTab nowhere else. So the tab can start an
 * inspector that is already in the page, and otherwise says how to start one.
 */
const START_HINT =
  'Press Alt+Shift+I on the page, or click the Open Inspector toolbar button, to start it. Firefox lets the extension into a page only after one of those, and only into that tab.';
const RESTART_HINT = 'It reads only this tab, and only while it runs.';

const listeners = new Set<(message: unknown) => void>();
let port: ReturnType<typeof browser.runtime.connect> | null = null;
let selectEvent: string | null = null;
/** Whether the tab is in view, and the poll that runs while it is. */
let visible = document.visibilityState === 'visible';
let poll: ReturnType<typeof setInterval> | null = null;

/** The panel's view of the connection: stable across reconnects. */
const remote: RemotePort = {
  postMessage: (message) => port?.postMessage(message),
  onMessage(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const host = document.getElementById('inspector') as HTMLElement;
const panel = mountRemotePanel(host, remote, {
  onStart: () => {
    const start: DevtoolsStartMessage = { type: 'open-inspector:start' };
    port?.postMessage(start);
  },
  startHint: START_HINT,
});
panel.setIdle({ canStart: false, hint: START_HINT });

function connect(): void {
  const connected = browser.runtime.connect({ name: DEVTOOLS_PORT });
  port = connected;

  connected.onMessage.addListener((message: unknown) => {
    if (isDevtoolsStatus(message)) {
      if (!message.injected) {
        selectEvent = null;
        panel.reset();
      }
      panel.setIdle(
        message.injected
          ? { canStart: true, hint: RESTART_HINT }
          : {
              canStart: false,
              hint: message.error ? `${START_HINT} (Firefox said: ${message.error})` : START_HINT,
            },
      );
      return;
    }
    if (isDevtoolsSelectEvent(message)) {
      selectEvent = message.name;
      followSelection();
      return;
    }
    for (const listener of listeners) listener(message);
  });

  connected.onDisconnect.addListener(() => {
    if (port !== connected) return;
    port = null;
    selectEvent = null;
    setTimeout(connect, RECONNECT_MS);
  });

  const hello: DevtoolsHelloMessage = { type: 'open-inspector:hello', tabId };
  connected.postMessage(hello);
}

/**
 * Ask DevTools for its selected element, and have it announce itself to the
 * content script.
 *
 * `$0` exists only in the page's world, where `inspectedWindow.eval` runs, so
 * the element cannot be returned — only data can. Dispatching the content
 * script's event on it hands the element across instead. The event name is
 * checked against a strict pattern before it is spliced in, and serialized
 * as a string literal besides.
 */
function followSelection(): void {
  if (!selectEvent || !visible) return;
  const name = JSON.stringify(selectEvent);
  void browser.devtools.inspectedWindow
    .eval(
      `(() => { const el = $0; if (el && el.nodeType === 1) el.dispatchEvent(new CustomEvent(${name}, { composed: true })); })()`,
    )
    .catch(() => undefined);
}

function setVisible(next: boolean): void {
  visible = next;
  if (visible && poll === null) {
    followSelection();
    poll = setInterval(followSelection, SELECTION_POLL_MS);
  } else if (!visible && poll !== null) {
    clearInterval(poll);
    poll = null;
  }
}

// The DevTools page says when the tab is shown or hidden; the document's own
// visibility covers the moment before it first does.
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin) return;
  const data = event.data as { type?: unknown; shown?: unknown } | null;
  if (data?.type === 'open-inspector:visibility' && typeof data.shown === 'boolean') setVisible(data.shown);
});
document.addEventListener('visibilitychange', () => setVisible(document.visibilityState === 'visible'));

connect();
setVisible(visible);
