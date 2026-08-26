import type { ElementDescriptor } from '../types.js';
import { round } from '../geometry/rect.js';

const DEFAULT_MAX_CLASSES = 3;

/**
 * Build a short label like `div#hero.card.is-active+2`.
 *
 * Real pages — Tailwind ones especially — put dozens of classes on a single
 * element, so the list is truncated and the remainder shown as a count. Pure
 * and exported so the truncation rule is directly testable.
 */
export function buildSelectorLabel(
  tagName: string,
  id: string | null,
  classNames: readonly string[],
  maxClasses: number = DEFAULT_MAX_CLASSES,
): string {
  let label = tagName;
  if (id) label += `#${id}`;

  const shown = classNames.slice(0, Math.max(0, maxClasses));
  for (const className of shown) label += `.${className}`;

  const hidden = classNames.length - shown.length;
  if (hidden > 0) label += `+${hidden}`;

  return label;
}

/**
 * Summarize an element for display in the overlay chip.
 *
 * Reads classes via `classList` rather than `className`, because on SVG
 * elements `className` is an `SVGAnimatedString`, not a string — a classic
 * source of `.split is not a function` in inspectors.
 */
export function describeElement(element: Element): ElementDescriptor {
  const rect = element.getBoundingClientRect();
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? element.id : null;
  const classNames = Array.from(element.classList);

  return {
    tagName,
    id,
    classNames,
    selectorLabel: buildSelectorLabel(tagName, id, classNames),
    width: round(rect.width),
    height: round(rect.height),
  };
}

/** Format dimensions for the overlay chip, e.g. `1200 × 480`. */
export function formatDimensions(width: number, height: number): string {
  return `${round(width)} × ${round(height)}`;
}
