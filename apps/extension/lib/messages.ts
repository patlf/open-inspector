/**
 * The entire message surface between the background worker and the injected
 * content script. Kept deliberately tiny — every message type is another thing
 * a page could try to forge if the listener were ever loosened.
 */

export const PING = 'open-inspector:ping';
export const TOGGLE = 'open-inspector:toggle';
export const SAVE = 'open-inspector:save';
export const RESIZE = 'open-inspector:resize';

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

export type InspectorMessage = PingMessage | ToggleMessage | SaveMessage | ResizeMessage;

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
  return type === PING || type === TOGGLE || type === SAVE || type === RESIZE;
}
