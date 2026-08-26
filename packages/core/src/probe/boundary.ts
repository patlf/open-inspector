import type { ProbeBoundary } from '../types.js';

function tagOf(element: Element): string {
  return element.tagName.toUpperCase();
}

/**
 * Whether this frame can reach into the framed document.
 *
 * Cross-origin access either throws a `SecurityError` or yields `null`
 * depending on the browser, so both outcomes are treated as unreachable.
 */
function canReachFrameDocument(element: Element): boolean {
  try {
    return (element as HTMLIFrameElement).contentDocument != null;
  } catch {
    return false;
  }
}

/**
 * A custom element that rendered something but exposes nothing.
 *
 * A closed shadow root is deliberately undetectable — `element.shadowRoot` is
 * `null` whether the root is closed or absent. So this is a heuristic: a
 * hyphenated tag name that the probe landed on, with no reachable shadow root,
 * no element children, and no text of its own, is almost certainly hiding a
 * closed root. Reported as a boundary so the UI can say "can't read this"
 * rather than describing an empty box.
 */
function looksOpaqueCustomElement(element: Element): boolean {
  if (!element.tagName.includes('-')) return false;
  if (element.shadowRoot) return false;
  if (element.childElementCount > 0) return false;
  return (element.textContent ?? '').trim().length === 0;
}

/**
 * Identify anything the probe cannot see through.
 *
 * Returns `null` for ordinary elements. Honest failure is the point: a wrong
 * answer at a boundary is worse than an admitted gap.
 */
export function detectBoundary(element: Element): ProbeBoundary | null {
  const tag = tagOf(element);

  if (tag === 'IFRAME' || tag === 'FRAME') {
    return { kind: 'iframe', sameOrigin: canReachFrameDocument(element) };
  }

  if (tag === 'CANVAS') {
    return { kind: 'canvas' };
  }

  if (looksOpaqueCustomElement(element)) {
    return { kind: 'opaque-custom-element' };
  }

  return null;
}
