import { buildSelectorLabel, describeElement } from './describe.js';

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

/* -------------------------------------------------------------------------- */
/* The structure view                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Anything the structure view lists: an element, or the open shadow root it
 * hosts. Closed shadow roots are invisible here as everywhere else — the
 * browser hands back `null`, which is indistinguishable from no root at all.
 */
export type StructureNode = Element | ShadowRoot;

export interface StructureNodeRow {
  kind: 'element' | 'shadow-root';
  node: StructureNode;
  /** 0 is the root the walk started from. */
  depth: number;
  /** `div#hero.card+4`, or `#shadow-root (open)`. */
  label: string;
  /**
   * The start of a childless element's text, so a column of `<span>` rows
   * says which span is which. Null wherever children carry the meaning.
   */
  text: string | null;
  /** A frame's address: which document is in there, when its tree is not. */
  address: string | null;
  /**
   * Which file a script, stylesheet link or style block came from: its name,
   * and the full URL behind it when there is one. `inline` when it is written
   * into the page itself.
   */
  file: { name: string; url: string | null } | null;
  expandable: boolean;
  expanded: boolean;
}

/** Stands in for the children past a node's listing limit. */
export interface StructureMoreRow {
  kind: 'more';
  /** The node whose children were cut short. */
  parent: StructureNode;
  depth: number;
  hidden: number;
}

export type StructureRow = StructureNodeRow | StructureMoreRow;

export interface StructureOptions {
  /** Whether a node's children are listed. The caller owns this state. */
  isExpanded: (node: StructureNode) => boolean;
  /** How many children to list before a "more" row. */
  childLimit?: (node: StructureNode) => number;
  /** The inspector's own UI, which must not show up in the page's tree. */
  ignore?: (element: Element) => boolean;
  /** Ceiling on rows in total. */
  maxRows?: number;
}

export interface StructureListing {
  rows: StructureRow[];
  /** True when `maxRows` cut the listing short. */
  truncated: boolean;
}

/**
 * Children listed before a "more" row.
 *
 * A server-rendered table or an unvirtualized feed can put thousands of rows
 * under one parent, and listing them all would bury the rest of the tree and
 * stall the panel on every repaint.
 */
export const DEFAULT_STRUCTURE_CHILD_LIMIT = 100;

/**
 * Rows listed at most, however much is expanded.
 *
 * The listing is rebuilt on every repaint, so this is a frame budget rather
 * than a display preference: past a thousand rows the walk and the diff start
 * to show up as hover lag on the page.
 */
export const MAX_STRUCTURE_ROWS = 1000;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_FRAGMENT_NODE = 11;

/** Text that would only be noise in a row: source code and inert markup. */
const NO_TEXT_PREVIEW = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const TEXT_PREVIEW_LENGTH = 40;
const FRAME_TAGS = new Set(['IFRAME', 'FRAME']);

/**
 * The attribute dev servers put on the style blocks they inject, naming the
 * source file. Vite writes `data-vite-dev-id`; without one, a style block is
 * just inline.
 */
const STYLE_SOURCE_ATTRIBUTES = ['data-vite-dev-id'];

function isShadowRoot(node: StructureNode): node is ShadowRoot {
  return node.nodeType === DOCUMENT_FRAGMENT_NODE;
}

/**
 * What sits directly under a node in the structure view.
 *
 * An open shadow root comes first, as DevTools shows it: it is what actually
 * renders, and the light-DOM children after it are only what gets slotted in.
 */
export function structureChildren(
  node: StructureNode,
  ignore?: (element: Element) => boolean,
): StructureNode[] {
  const children: StructureNode[] = [];
  if (!isShadowRoot(node) && node.shadowRoot) children.push(node.shadowRoot);

  for (const child of Array.from(node.children)) {
    if (!ignore?.(child)) children.push(child);
  }

  return children;
}

function textPreview(element: Element): string | null {
  if (NO_TEXT_PREVIEW.has(element.tagName.toUpperCase())) return null;
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > TEXT_PREVIEW_LENGTH ? `${text.slice(0, TEXT_PREVIEW_LENGTH)}…` : text;
}

/**
 * Where a frame points, as the browser would name its document.
 *
 * Frames are leaves here — a cross-origin document cannot be read, and a
 * same-origin one is not walked yet — so the address is the one thing the row
 * can say about what is inside. The attribute as written, not resolved: it is
 * what you would search the source for.
 */
function frameAddress(element: Element): string | null {
  if (!FRAME_TAGS.has(element.tagName.toUpperCase())) return null;
  const src = element.getAttribute('src');
  if (src) return src;
  return element.hasAttribute('srcdoc') ? 'about:srcdoc' : 'about:blank';
}

/** The last path segment of a URL, which is what people call a file. */
export function fileName(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    if (parsed.protocol === 'data:') return 'data URI';
    if (parsed.protocol === 'blob:') return 'blob';
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return parsed.host || url;
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return url;
  }
}

/** Where a script, linked resource or style block came from. */
function assetFile(element: Element): StructureNodeRow['file'] {
  const tag = element.tagName.toUpperCase();
  const base = element.baseURI || undefined;

  if (tag === 'SCRIPT') {
    const src = element.getAttribute('src');
    return src ? { name: fileName(src, base), url: src } : { name: 'inline', url: null };
  }

  if (tag === 'LINK') {
    const href = element.getAttribute('href');
    return href ? { name: fileName(href, base), url: href } : null;
  }

  if (tag === 'STYLE') {
    for (const attribute of STYLE_SOURCE_ATTRIBUTES) {
      const source = element.getAttribute(attribute);
      if (source) return { name: fileName(source, 'file:///'), url: source };
    }
    return { name: 'inline', url: null };
  }

  return null;
}

function nodeRow(
  node: StructureNode,
  depth: number,
  options: StructureOptions,
): { row: StructureNodeRow; children: StructureNode[] } {
  const children = structureChildren(node, options.ignore);
  const expandable = children.length > 0;
  const expanded = expandable && options.isExpanded(node);

  if (isShadowRoot(node)) {
    return {
      row: {
        kind: 'shadow-root',
        node,
        depth,
        label: '#shadow-root (open)',
        text: null,
        address: null,
        file: null,
        expandable,
        expanded,
      },
      children,
    };
  }

  const label = buildSelectorLabel(
    node.tagName.toLowerCase(),
    node.id ? node.id : null,
    Array.from(node.classList),
  );

  return {
    row: {
      kind: 'element',
      node,
      depth,
      label,
      text: expandable ? null : textPreview(node),
      address: frameAddress(node),
      file: assetFile(node),
      expandable,
      expanded,
    },
    children,
  };
}

/**
 * The expanded part of a tree, flattened into rows in document order.
 *
 * Only what the caller has expanded is walked, so the cost follows what is on
 * screen rather than the size of the page. Iterative rather than recursive:
 * a pathologically deep DOM is a stack overflow waiting to happen.
 */
export function flattenStructure(root: StructureNode, options: StructureOptions): StructureListing {
  const maxRows = options.maxRows ?? MAX_STRUCTURE_ROWS;
  const rows: StructureRow[] = [];

  type Pending =
    | { kind: 'node'; node: StructureNode; depth: number }
    | { kind: 'more'; parent: StructureNode; depth: number; hidden: number };

  const stack: Pending[] = [{ kind: 'node', node: root, depth: 0 }];

  while (stack.length > 0) {
    if (rows.length >= maxRows) return { rows, truncated: true };

    const next = stack.pop();
    if (!next) break;
    if (next.kind === 'more') {
      rows.push(next);
      continue;
    }

    const { row, children } = nodeRow(next.node, next.depth, options);
    rows.push(row);
    if (!row.expanded) continue;

    const limit = Math.max(0, options.childLimit?.(next.node) ?? DEFAULT_STRUCTURE_CHILD_LIMIT);
    const listed = children.slice(0, limit);
    const hidden = children.length - listed.length;

    // Pushed in reverse so they pop in document order, the "more" row last.
    if (hidden > 0) stack.push({ kind: 'more', parent: next.node, depth: next.depth + 1, hidden });
    for (let index = listed.length - 1; index >= 0; index -= 1) {
      stack.push({ kind: 'node', node: listed[index] as StructureNode, depth: next.depth + 1 });
    }
  }

  return { rows, truncated: false };
}

/** Nodes a whole-tree walk visits before it stops: a bound on the cost of one search. */
export const MAX_STRUCTURE_VISITS = 20_000;

/**
 * Every element in a tree that `match` accepts, as flat rows in document
 * order: the tree filtered down to what the caller is looking for, with the
 * ancestors left out.
 *
 * Unlike {@link flattenStructure} this walks the whole tree, expanded or not,
 * since a match can be anywhere — so it stops at a number of nodes visited as
 * well as at a number of rows, and reports either as truncation.
 */
export function matchingStructure(
  root: StructureNode,
  match: (element: Element) => boolean,
  options: { ignore?: (element: Element) => boolean; maxRows?: number; maxVisits?: number } = {},
): StructureListing {
  const maxRows = options.maxRows ?? MAX_STRUCTURE_ROWS;
  const maxVisits = options.maxVisits ?? MAX_STRUCTURE_VISITS;
  const flat: StructureOptions = {
    isExpanded: () => false,
    ...(options.ignore ? { ignore: options.ignore } : {}),
  };
  const rows: StructureRow[] = [];
  const stack: StructureNode[] = [root];
  let visits = 0;

  while (stack.length > 0) {
    if (rows.length >= maxRows || visits >= maxVisits) return { rows, truncated: true };
    const node = stack.pop();
    if (!node) break;
    visits += 1;

    const children = structureChildren(node, options.ignore);
    if (!isShadowRoot(node) && match(node)) {
      const { row } = nodeRow(node, 0, flat);
      rows.push({ ...row, expandable: false, expanded: false });
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index] as StructureNode);
    }
  }

  return { rows, truncated: false };
}

/**
 * Whether an element answers a search typed into the structure tree.
 *
 * Matched against what its row shows, `tag#id.class`, and against its own
 * text: the text nodes directly inside it, not its descendants', or every
 * ancestor of a match would match as well. Not the source in a script or
 * style, which its row does not show either. Case and runs of whitespace
 * are ignored; an empty query matches everything.
 */
export function matchesStructureQuery(element: Element, query: string): boolean {
  const wanted = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!wanted) return true;

  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList, (name) => `.${name}`).join('');
  // With and without the id, so `button.primary` finds `button#save.primary`.
  if (`${tag}${id}${classes}`.toLowerCase().includes(wanted)) return true;
  if (`${tag}${classes}`.toLowerCase().includes(wanted)) return true;

  if (NO_TEXT_PREVIEW.has(element.tagName.toUpperCase())) return false;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType !== TEXT_NODE) continue;
    const text = (child.textContent ?? '').replace(/\s+/g, ' ').toLowerCase();
    if (text.includes(wanted)) return true;
  }
  return false;
}

/**
 * The nodes that must be expanded for an element's row to be listed, from the
 * document element down to its parent.
 *
 * Crosses shadow boundaries, unlike {@link ancestorTrail}: the picker pierces
 * open shadow roots, so a selection can sit several roots deep, and revealing
 * it means opening each root on the way down.
 */
export function structurePath(element: Element): StructureNode[] {
  const path: StructureNode[] = [];
  let current = element.parentNode;

  while (current) {
    if (current.nodeType === ELEMENT_NODE) {
      path.push(current as Element);
      current = current.parentNode;
    } else if (current.nodeType === DOCUMENT_FRAGMENT_NODE && (current as ShadowRoot).host) {
      const shadowRoot = current as ShadowRoot;
      path.push(shadowRoot);
      current = shadowRoot.host;
    } else {
      // The document itself, or a fragment detached from any host.
      break;
    }
  }

  return path.reverse();
}
