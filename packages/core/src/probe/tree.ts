import { describeElement } from './describe.js';

/**
 * Moving around the DOM without the mouse.
 *
 * Hit-testing can only reach what is visually on top. A wrapper with no
 * padding is unclickable — there is no pixel that belongs to it and not to its
 * child — so without this, a large part of any page simply cannot be selected.
 * Every inspector solves this with a breadcrumb and arrow keys.
 */

/** One step in the ancestor chain. */
export interface TreeCrumb {
  element: Element;
  /** `div#hero.card` */
  label: string;
  /** 0 is the element itself; larger numbers are further up. */
  depth: number;
}

/** Where an element sits among its siblings and children. */
export interface TreePosition {
  /** The element and its ancestors, nearest first. */
  trail: TreeCrumb[];
  parent: Element | null;
  firstChild: Element | null;
  previousSibling: Element | null;
  nextSibling: Element | null;
  childCount: number;
  /** 1-based position among element siblings, for display. */
  siblingIndex: number;
  siblingCount: number;
}

export interface TreeOptions {
  /**
   * Elements to treat as invisible — the inspector's own UI.
   *
   * Without this the panel and overlay appear as siblings of whatever is being
   * inspected, and arrow-keying sideways walks straight into our own chrome.
   */
  ignore?: (element: Element) => boolean;
  /** How far up to build the trail. Deep DOMs make an unreadable breadcrumb. */
  maxDepth?: number;
}

/** Long enough to reach a meaningful container, short enough to read. */
export const DEFAULT_TRAIL_DEPTH = 12;

function visibleChildren(parent: Element | null, ignore?: (element: Element) => boolean): Element[] {
  if (!parent) return [];
  const children = Array.from(parent.children);
  return ignore ? children.filter((child) => !ignore(child)) : children;
}

/**
 * The chain from an element up to the document root.
 *
 * Ordered nearest-first so a breadcrumb can be rendered by reversing it, and
 * so truncation drops the least useful end — nobody needs to see `html > body`
 * to understand where they are.
 */
export function ancestorTrail(element: Element, options: TreeOptions = {}): TreeCrumb[] {
  const maxDepth = options.maxDepth ?? DEFAULT_TRAIL_DEPTH;
  const trail: TreeCrumb[] = [];

  let current: Element | null = element;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (!options.ignore?.(current)) {
      trail.push({ element: current, label: describeElement(current).selectorLabel, depth });
    }
    current = current.parentElement;
    depth += 1;
  }

  return trail;
}

/**
 * Everything needed to navigate away from this element.
 *
 * Computed in one pass because the panel needs all of it at once to decide
 * which arrows to enable, and walking the tree four separate times per hover
 * would be wasteful on deep documents.
 */
export function readTreePosition(element: Element, options: TreeOptions = {}): TreePosition {
  const parent = element.parentElement;
  const siblings = visibleChildren(parent, options.ignore);
  const index = siblings.indexOf(element);
  const children = visibleChildren(element, options.ignore);

  return {
    trail: ancestorTrail(element, options),
    parent,
    firstChild: children[0] ?? null,
    // `index - 1` on a missing element is -1, which would wrap to the last
    // sibling; guard rather than relying on the caller to notice.
    previousSibling: index > 0 ? (siblings[index - 1] ?? null) : null,
    nextSibling: index >= 0 ? (siblings[index + 1] ?? null) : null,
    childCount: children.length,
    siblingIndex: index >= 0 ? index + 1 : 0,
    siblingCount: siblings.length,
  };
}

export type TreeDirection = 'parent' | 'child' | 'previous' | 'next';

/**
 * Step one element in a direction, or `null` when there is nowhere to go.
 *
 * Returning `null` rather than staying put lets the caller decide whether to
 * ignore the keystroke or signal that the edge was reached.
 */
export function stepTree(
  element: Element,
  direction: TreeDirection,
  options: TreeOptions = {},
): Element | null {
  const position = readTreePosition(element, options);

  switch (direction) {
    case 'parent':
      // Stop at the document element; there is nothing useful above it.
      return position.parent && position.parent !== element.ownerDocument?.documentElement
        ? position.parent
        : (position.parent ?? null);
    case 'child':
      return position.firstChild;
    case 'previous':
      return position.previousSibling;
    case 'next':
      return position.nextSibling;
  }
}
