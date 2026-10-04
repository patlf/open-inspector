import { browser } from 'wxt/browser';
import {
  createPanel,
  createRemoteSurface,
  type InspectorSession,
  type PanelHandle,
  type PanelOptions,
  type RemotePort,
} from '@open-inspector/ui';
import { PAGE_PORT, type DevtoolsSelectEventMessage } from './messages.js';

type Port = ReturnType<typeof browser.runtime.connect>;

/** A runtime port, as the panel's protocol sees one. */
function asRemotePort(port: Port): RemotePort {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage(listener) {
      const wrapped = (message: unknown): void => listener(message);
      port.onMessage.addListener(wrapped);
      return () => port.onMessage.removeListener(wrapped);
    },
  };
}

export interface DevtoolsBridge {
  /** Builds the panel: in DevTools while a DevTools tab is showing this page, here otherwise. */
  surface(options: PanelOptions): PanelHandle;
  /** A DevTools tab is showing this page: connect to it, and start if asked. */
  attach(session: InspectorSession, activate: boolean): void;
  destroy(): void;
}

/**
 * The content script's half of the Firefox DevTools tab.
 *
 * While a DevTools tab is attached, the session's panel is a remote one, drawn
 * there; when it goes — DevTools closed, the worker gone — the session builds
 * the in-page panel again, keeping its selection and its edits.
 *
 * It also follows DevTools' own selection. Firefox gives extensions no event
 * for it, so the tab asks for `$0` through `inspectedWindow.eval` and has it
 * dispatch an event — named here, at random — on that element. An event is
 * the one thing that reaches this world from the page's with the element
 * itself attached.
 */
export function createDevtoolsBridge(view: Window): DevtoolsBridge {
  let port: Port | null = null;
  let session: InspectorSession | null = null;
  let stopListening: (() => void) | null = null;
  /** The last element DevTools reported, so asking again changes nothing. */
  let reported: Element | null = null;

  function followSelection(name: string): () => void {
    const listener = (event: Event): void => {
      // Ours: the page's listeners further along need not see it.
      event.stopImmediatePropagation();
      const target = event.composedPath()[0];
      if (!(target instanceof Element) || target === reported || !session) return;
      reported = target;
      if (!session.active) session.activate();
      session.select(target);
    };
    view.addEventListener(name, listener, true);
    return () => view.removeEventListener(name, listener, true);
  }

  function detach(): void {
    stopListening?.();
    stopListening = null;
    port = null;
    reported = null;
    session?.replaceSurface();
  }

  return {
    surface(options) {
      return port ? createRemoteSurface(asRemotePort(port), options) : createPanel(options);
    },

    attach(next, activate) {
      session = next;
      if (!port) {
        const connected = browser.runtime.connect({ name: PAGE_PORT });
        port = connected;
        connected.onDisconnect.addListener(() => {
          if (port === connected) detach();
        });

        const name = `open-inspector-select-${Math.random().toString(36).slice(2, 12)}`;
        stopListening = followSelection(name);
        const announce: DevtoolsSelectEventMessage = { type: 'open-inspector:select-event', name };
        connected.postMessage(announce);

        next.replaceSurface();
      }
      if (activate && !next.active) next.activate();
    },

    destroy() {
      const connected = port;
      detach();
      connected?.disconnect();
    },
  };
}
