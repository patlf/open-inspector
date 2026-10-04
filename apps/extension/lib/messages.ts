/**
 * The entire message surface between the background worker and the injected
 * content script. Kept deliberately tiny — every message type is another thing
 * a page could try to forge if the listener were ever loosened.
 */

export const PING = 'open-inspector:ping';
export const TOGGLE = 'open-inspector:toggle';
export const SAVE = 'open-inspector:save';
export const RESIZE = 'open-inspector:resize';
export const HANDLERS = 'open-inspector:handlers';
export const BEAUTIFY = 'open-inspector:beautify';
export const DEVTOOLS_ATTACH = 'open-inspector:devtools-attach';
export const DEVTOOLS_SETUP = 'open-inspector:devtools-setup';

/**
 * Port names, for the Firefox DevTools tab. The tab's panel and the content
 * script each hold one port to the worker, and the worker joins the two for
 * the same tab: neither can reach the other directly.
 */
export const DEVTOOLS_PORT = 'open-inspector:devtools';
export const PAGE_PORT = 'open-inspector:page';

export interface PingMessage {
  type: typeof PING;
}

export interface ToggleMessage {
  type: typeof TOGGLE;
}

/**
 * Ask the background worker to start a download.
 *
 * Chrome drops downloads initiated from a content script's isolated world —
 * the anchor is clicked, nothing is raised, and nothing happens. The worker
 * runs the same few lines in the page's main world instead, using the
 * `scripting` permission already held. No new permission, and still no fetch
 * by the extension: the browser does the fetching, when the user asks.
 */
export interface SaveMessage {
  type: typeof SAVE;
  href: string;
  filename: string;
}

/**
 * Ask the background worker to resize the browser window.
 *
 * The responsive preview has to move the real window, because media queries
 * evaluate against the viewport and nothing a content script can do to the
 * page changes that. `windows.update` is the only API that can, it is not
 * reachable from a content script, and — usefully — it requires no permission
 * of its own.
 */
export interface ResizeMessage {
  type: typeof RESIZE;
  /** Viewport width to aim for, or null to restore the size we found. */
  viewportWidth: number | null;
  /**
   * The page's current viewport width.
   *
   * The worker knows the window's outer width and the page knows its inner
   * width; the difference between them is the browser chrome, and neither
   * side can compute it alone. `window.outerWidth` is not a substitute —
   * under automation it reads 0.
   */
  innerWidth: number;
}

/**
 * Ask the background worker to read the page's event handlers.
 *
 * What a page's scripts attach to its elements — an `onclick` property, a
 * React or Vue prop, a jQuery binding — lives in the page's own world, which
 * the content script cannot see into. The worker runs a read-only probe
 * there with `scripting.executeScript`, the permission already held for
 * injecting the inspector, and the probe reports to the content script by
 * dispatching `eventName` on each element it found handlers on.
 */
export interface HandlersMessage {
  type: typeof HANDLERS;
  eventName: string;
}

export interface HandlersResponse {
  ok: boolean;
}

/**
 * Ask the worker to format JavaScript for reading: an inline script or a
 * handler, as the JS tab shows it.
 *
 * The worker carries the formatter so the bundle injected into every page
 * does not. It answers with the formatted code as a string. Nothing leaves
 * the extension; the code is the page's own, already in the content script.
 */
export interface BeautifyMessage {
  type: typeof BEAUTIFY;
  code: string;
}

/** Past this the panel shows code as written: an inline script is cut at 20,000 characters anyway. */
export const MAX_BEAUTIFY_LENGTH = 50_000;

/**
 * Worker → content script: a DevTools tab is showing this tab, so connect to
 * it and draw the panel there. `activate` starts the inspector too, for the
 * tab's own Start button; a toolbar toggle starts it separately.
 */
export interface DevtoolsAttachMessage {
  type: typeof DEVTOOLS_ATTACH;
  activate: boolean;
}

/** Content script → worker: open the page that turns the DevTools tab on. */
export interface DevtoolsSetupMessage {
  type: typeof DEVTOOLS_SETUP;
}

/** DevTools tab → worker, first on its port: which tab it is showing. */
export interface DevtoolsHelloMessage {
  type: 'open-inspector:hello';
  tabId: number;
}

/** DevTools tab → worker: start the inspector in the tab, from the tab's button. */
export interface DevtoolsStartMessage {
  type: 'open-inspector:start';
}

/** Worker → DevTools tab: whether the inspector is in the page, and why not. */
export interface DevtoolsStatusMessage {
  type: 'open-inspector:status';
  injected: boolean;
  error?: string;
}

/**
 * Content script → DevTools tab: the event its listener is waiting on. The
 * tab dispatches it on DevTools' selected element ($0), through
 * `inspectedWindow.eval`, which is how that element reaches the content
 * script: Firefox has no selection-changed event for extensions.
 */
export interface DevtoolsSelectEventMessage {
  type: 'open-inspector:select-event';
  name: string;
}

export type InspectorMessage =
  | PingMessage
  | ToggleMessage
  | SaveMessage
  | ResizeMessage
  | DevtoolsAttachMessage;

export interface ToggleResponse {
  active: boolean;
}

/**
 * What came of a resize request.
 *
 * The failure path used to be a \`console.debug\` in the background worker — a
 * place nobody looks — while the panel showed the unchanged width and looked
 * simply broken. The reason travels back so the panel can say it.
 */
export interface ResizeResponse {
  ok: boolean;
  /** The window's outer width afterwards, when the call went through. */
  width?: number;
  /** The browser's own words, when it refused. */
  error?: string;
}

/** Path of the built inspector script inside the extension package. */
export const INSPECTOR_SCRIPT = 'content-scripts/inspector.js';

/** Narrow an unknown runtime message. */
export function isInspectorMessage(value: unknown): value is InspectorMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  if (type === DEVTOOLS_ATTACH) return typeof (value as { activate?: unknown }).activate === 'boolean';
  return type === PING || type === TOGGLE || type === SAVE || type === RESIZE;
}

export function isDevtoolsSetupMessage(value: unknown): value is DevtoolsSetupMessage {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === DEVTOOLS_SETUP;
}

export function isDevtoolsHello(value: unknown): value is DevtoolsHelloMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<DevtoolsHelloMessage>;
  return message.type === 'open-inspector:hello' && Number.isInteger(message.tabId);
}

export function isDevtoolsStart(value: unknown): value is DevtoolsStartMessage {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'open-inspector:start';
}

export function isDevtoolsStatus(value: unknown): value is DevtoolsStatusMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<DevtoolsStatusMessage>;
  return message.type === 'open-inspector:status' && typeof message.injected === 'boolean';
}

/** The select event's name: ours, with a random suffix, as it is spliced into evaluated code. */
const SELECT_EVENT = /^open-inspector-select-[a-z0-9]{6,16}$/;

export function isDevtoolsSelectEvent(value: unknown): value is DevtoolsSelectEventMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<DevtoolsSelectEventMessage>;
  return (
    message.type === 'open-inspector:select-event' &&
    typeof message.name === 'string' &&
    SELECT_EVENT.test(message.name)
  );
}

/**
 * Schemes a save may hand to the page's main world.
 *
 * The href is run as an anchor click in the page, so a `javascript:` URL
 * arriving here would be code execution in the page's own origin. Only the
 * shapes an asset can actually take are allowed through.
 */
const SAVEABLE_SCHEMES = new Set(['http:', 'https:', 'data:', 'blob:']);

export function isSaveMessage(value: unknown): value is SaveMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<SaveMessage>;
  if (message.type !== SAVE) return false;
  if (typeof message.href !== 'string' || typeof message.filename !== 'string') return false;
  try {
    return SAVEABLE_SCHEMES.has(new URL(message.href).protocol);
  } catch {
    return false;
  }
}

/**
 * The only event names the probe may dispatch: ours, with a random suffix.
 * Anything else would let a forged message make the probe fire events of
 * the sender's choosing on every element of the page.
 */
const HANDLER_EVENT = /^open-inspector-handlers-[a-z0-9]{6,16}$/;

export function isBeautifyMessage(value: unknown): value is BeautifyMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<BeautifyMessage>;
  return (
    message.type === BEAUTIFY &&
    typeof message.code === 'string' &&
    message.code.length <= MAX_BEAUTIFY_LENGTH
  );
}

export function isHandlersMessage(value: unknown): value is HandlersMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<HandlersMessage>;
  return (
    message.type === HANDLERS &&
    typeof message.eventName === 'string' &&
    HANDLER_EVENT.test(message.eventName)
  );
}

export function isResizeMessage(value: unknown): value is ResizeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<ResizeMessage>;
  if (message.type !== RESIZE) return false;
  const width = message.viewportWidth;
  const widthOk = width === null || (typeof width === 'number' && Number.isFinite(width) && width > 0);
  const inner = message.innerWidth;
  return widthOk && typeof inner === 'number' && Number.isFinite(inner) && inner > 0;
}
