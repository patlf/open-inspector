import type { EdgeSizes, Rect } from '../types.js';

/** Convert a live `DOMRect` into a plain, serializable `Rect`. */
export function toRect(domRect: DOMRectReadOnly): Rect {
  return {
    x: domRect.x,
    y: domRect.y,
    width: domRect.width,
    height: domRect.height,
  };
}

/**
 * Shrink a rect by per-side edge sizes.
 *
 * Dimensions clamp at zero: a 4px-wide element with 10px of horizontal padding
 * would otherwise produce a negative width, which breaks overlay rendering.
 */
export function insetRect(rect: Rect, edges: EdgeSizes): Rect {
  return {
    x: rect.x + edges.left,
    y: rect.y + edges.top,
    width: Math.max(0, rect.width - edges.left - edges.right),
    height: Math.max(0, rect.height - edges.top - edges.bottom),
  };
}

/** Grow a rect by per-side edge sizes. Negative margins legitimately grow it. */
export function outsetRect(rect: Rect, edges: EdgeSizes): Rect {
  return {
    x: rect.x - edges.left,
    y: rect.y - edges.top,
    width: Math.max(0, rect.width + edges.left + edges.right),
    height: Math.max(0, rect.height + edges.top + edges.bottom),
  };
}

/** True when the rect occupies no visible area. */
export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

/**
 * Parse a CSS pixel length into a number.
 *
 * Computed styles return used values in `px` for the properties we read, but
 * keywords (`auto`, `medium`) and empty strings still occur — notably on
 * detached elements and in non-browser DOM implementations. Those become 0
 * rather than NaN, which would poison every downstream calculation.
 */
export function parsePx(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Round to a fixed number of decimals, avoiding `-0` and float noise. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
