import type { ColorSource, ColorUsage } from './element-colors.js';
import { collectElementColors, hasDirectText } from './element-colors.js';
import type { ColorFormats, Hsl, Oklch, Rgba } from './parse.js';
import { formatColor, oklabDistance, toHex, toHsl, toOklch } from './parse.js';

/** What a colour is mostly doing on the page. */
export type ColorRole = 'text' | 'background' | 'border' | 'accent';

/** Usage tally per kind of declaration. */
export type SourceCounts = Record<ColorSource, number>;

/** One exact colour folded into a palette entry. */
export interface PaletteMember {
  hex: string;
  count: number;
}

/** A palette row: everything the UI needs to draw a swatch and explain it. */
export interface PaletteEntry {
  /** The cluster representative: the exact colour of its most-used member. */
  color: Rgba;
  /** Display strings — swatch label, copy targets. */
  formats: ColorFormats;
  /** Structured conversions, for sorting and filtering. */
  hsl: Hsl;
  oklch: Oklch;
  /** Occurrences across every member of the cluster. */
  count: number;
  sources: SourceCounts;
  role: ColorRole;
  /** Exact colours in this cluster, most-used first; always at least one. */
  members: PaletteMember[];
  /** How many near-identical colours were folded in (`members.length - 1`). */
  mergedCount: number;
}

/** The outcome of walking a subtree for colours. */
export interface PaletteResult {
  /** Rows, most-used first. */
  entries: PaletteEntry[];
  elementsScanned: number;
  /** The element budget stopped the walk before the subtree was exhausted. */
  truncated: boolean;
  /** Colour declarations we declined to guess at, e.g. `lab()`. */
  unreadable: number;
  /** Total colour occurrences counted, across all entries. */
  totalUsages: number;
}

/**
 * OKLab delta-E below which two colours are treated as one.
 *
 * Roughly the point where two flat swatches stop being distinguishable side by
 * side. Set too high and a page's real secondary colour disappears into its
 * primary; set to zero and a page with a dozen hand-tuned greys reports a dozen
 * greys, which is the failure mode that makes competing palette tools useless.
 */
export const DEFAULT_MERGE_DISTANCE = 0.02;

/**
 * Alpha difference that blocks merging regardless of perceptual distance.
 *
 * `#000` and `#0000001a` sit at the same point in OKLab — alpha is not a
 * perceptual axis — but a hairline divider and body text are not the same
 * colour in any sense the user cares about.
 */
export const ALPHA_MERGE_TOLERANCE = 0.05;

/** Chroma at or above which a colour reads as coloured rather than neutral. */
export const ACCENT_MIN_CHROMA = 0.06;

/** A colour used in more than this share of the page is structural, not an accent. */
export const ACCENT_MAX_SHARE = 0.08;

/** Elements visited before the walk gives up. */
export const DEFAULT_ELEMENT_BUDGET = 5000;

/**
 * Elements whose computed colours describe nothing on screen.
 *
 * The subtree is skipped along with the element: `<head>` in particular still
 * has children with computed styles, and counting them adds a phantom copy of
 * the default text colour to every page.
 */
const NON_RENDERED_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'head',
  'title',
  'noscript',
  'template',
  'base',
]);

function emptySourceCounts(): SourceCounts {
  return { text: 0, background: 0, border: 0, outline: 0, shadow: 0, gradient: 0 };
}

/** Inputs the role rule needs, separated from the palette so it can be tested alone. */
export interface ColorRoleInput {
  sources: SourceCounts;
  /** This colour's share of every colour occurrence on the page, 0-1. */
  share: number;
  /** OKLCH chroma of the representative colour. */
  chroma: number;
}

/**
 * Decide what a colour is *for*.
 *
 * Frequency has to be part of this, not just provenance. A brand colour used
 * for four buttons and a link is a background by property and an accent by
 * intent; a grey used as the background of nine hundred elements is a
 * background by both. So a saturated colour that appears rarely is called an
 * accent, and everything else is named after the kind of declaration it appears
 * in most, with ties broken text > background > border because that is the
 * order in which the attribution is informative.
 */
export function classifyColorRole(input: ColorRoleInput): ColorRole {
  const { sources } = input;
  const text = sources.text;
  const surfaces = sources.background + sources.gradient;
  const strokes = sources.border + sources.outline + sources.shadow;

  if (text + surfaces + strokes === 0) return 'accent';

  if (input.chroma >= ACCENT_MIN_CHROMA && input.share < ACCENT_MAX_SHARE) return 'accent';

  if (text >= surfaces && text >= strokes) return 'text';
  if (surfaces >= strokes) return 'background';
  return 'border';
}

/** Options for turning a list of usages into palette rows. */
export interface PaletteBuildOptions {
  /** OKLab delta-E for merging. Defaults to {@link DEFAULT_MERGE_DISTANCE}. */
  mergeDistance?: number;
  /**
   * Keep fully transparent colours. Off by default: nearly every element has
   * `background-color: rgba(0, 0, 0, 0)`, so including them produces one
   * enormous meaningless row at the top of every palette.
   */
  includeTransparent?: boolean;
}

interface ExactGroup {
  hex: string;
  color: Rgba;
  count: number;
  sources: SourceCounts;
}

interface Cluster {
  representative: ExactGroup;
  members: ExactGroup[];
  count: number;
  sources: SourceCounts;
}

/**
 * Group colour usages into palette rows.
 *
 * Two passes on purpose. Exact colours are tallied first, then clustered in
 * descending frequency order — which means the first member of a cluster is
 * always its most-used colour, so the representative falls out of the ordering
 * instead of needing a second pass to pick one. Greedy clustering can chain
 * (a merges with b, b with c, while a and c differ), which is why membership is
 * tested against the representative only and not against the whole cluster.
 */
export function buildPalette(
  usages: readonly ColorUsage[],
  options: PaletteBuildOptions = {},
): PaletteEntry[] {
  const mergeDistance = options.mergeDistance ?? DEFAULT_MERGE_DISTANCE;
  const includeTransparent = options.includeTransparent ?? false;

  const groups = new Map<string, ExactGroup>();
  let total = 0;

  for (const usage of usages) {
    if (!includeTransparent && usage.color.a === 0) continue;

    const hex = toHex(usage.color);
    const existing = groups.get(hex);
    const group = existing ?? { hex, color: usage.color, count: 0, sources: emptySourceCounts() };
    group.count += 1;
    group.sources[usage.source] += 1;
    if (!existing) groups.set(hex, group);
    total += 1;
  }

  // Hex is the tie-break so the same page always produces the same palette.
  const ordered = [...groups.values()].sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));

  const clusters: Cluster[] = [];
  for (const group of ordered) {
    const target = clusters.find(
      (cluster) =>
        Math.abs(cluster.representative.color.a - group.color.a) <= ALPHA_MERGE_TOLERANCE &&
        oklabDistance(cluster.representative.color, group.color) <= mergeDistance,
    );

    if (!target) {
      clusters.push({
        representative: group,
        members: [group],
        count: group.count,
        sources: { ...group.sources },
      });
      continue;
    }

    target.members.push(group);
    target.count += group.count;
    for (const source of Object.keys(target.sources) as ColorSource[]) {
      target.sources[source] += group.sources[source];
    }
  }

  clusters.sort((a, b) => b.count - a.count || a.representative.hex.localeCompare(b.representative.hex));

  return clusters.map((cluster) => {
    const color = cluster.representative.color;
    const oklch = toOklch(color);

    return {
      color,
      formats: formatColor(color),
      hsl: toHsl(color),
      oklch,
      count: cluster.count,
      sources: cluster.sources,
      role: classifyColorRole({
        sources: cluster.sources,
        share: total === 0 ? 0 : cluster.count / total,
        chroma: oklch.c,
      }),
      members: cluster.members.map((member) => ({ hex: member.hex, count: member.count })),
      mergedCount: cluster.members.length - 1,
    };
  });
}

/** Options for walking a subtree and collecting colour usages. */
export interface PaletteWalkOptions {
  /** Elements to visit before stopping. Defaults to {@link DEFAULT_ELEMENT_BUDGET}. */
  maxElements?: number;
  view?: Window;
  /** Style reader override; injectable so the walk is testable without layout. */
  readStyle?: (element: Element) => CSSStyleDeclaration;
  /** Skip an element *and its subtree* — the inspector's own overlay host, say. */
  shouldSkip?: (element: Element) => boolean;
  /** Descend into open shadow roots. On by default; design systems live in there. */
  pierceShadowRoots?: boolean;
}

/** Options for the full page-palette pass. */
export interface PaletteOptions extends PaletteWalkOptions, PaletteBuildOptions {}

/** What one pass over the tree found, before clustering. */
export interface ColorWalkResult {
  usages: ColorUsage[];
  elementsScanned: number;
  truncated: boolean;
  unreadable: number;
}

function viewOf(root: Element | Document): Window {
  const document = 'defaultView' in root ? root : root.ownerDocument;
  return document?.defaultView ?? window;
}

function rootElements(root: Element | Document): Element[] {
  if ('defaultView' in root) {
    const element = root.documentElement;
    return element ? [element] : [];
  }
  return [root];
}

/**
 * Walk a subtree collecting every colour actually in use.
 *
 * Iterative rather than recursive: a 50,000-node page is the case this has to
 * survive, and deep DOM trees do blow a recursive walk's stack. The element
 * budget is the other half of that promise — it bounds the work regardless of
 * page size and reports honestly when it cut the walk short, so the UI can say
 * "first 5,000 elements" instead of implying it saw everything.
 *
 * Text colours are only counted for elements that actually render text.
 * Everything inherits `color`, so counting all of them would report the body
 * text colour once per div and drown the palette.
 */
export function walkColorUsages(
  root: Element | Document,
  options: PaletteWalkOptions = {},
): ColorWalkResult {
  const view = options.view ?? viewOf(root);
  const readStyle = options.readStyle ?? ((element: Element) => view.getComputedStyle(element));
  const budget = options.maxElements ?? DEFAULT_ELEMENT_BUDGET;
  const pierce = options.pierceShadowRoots ?? true;
  const shouldSkip = options.shouldSkip;

  const usages: ColorUsage[] = [];
  const stack = rootElements(root).reverse();
  let elementsScanned = 0;
  let unreadable = 0;
  let truncated = false;

  while (stack.length > 0) {
    if (elementsScanned >= budget) {
      truncated = true;
      break;
    }

    const element = stack.pop();
    if (!element) break;

    if (NON_RENDERED_TAGS.has(element.tagName.toLowerCase())) continue;
    if (shouldSkip?.(element)) continue;

    elementsScanned += 1;

    const colors = collectElementColors(readStyle(element));
    unreadable += colors.unreadable.length;

    const rendersText = hasDirectText(element);
    for (const usage of colors.usages) {
      if (usage.source === 'text' && !rendersText) continue;
      usages.push(usage);
    }

    const children = Array.from(element.children);
    if (pierce && element.shadowRoot) {
      children.unshift(...Array.from(element.shadowRoot.children));
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push(child);
    }
  }

  return { usages, elementsScanned, truncated, unreadable };
}

/**
 * Collect the palette of a page or subtree.
 *
 * The composition of {@link walkColorUsages} and {@link buildPalette}, kept as
 * one call because that is what the UI wants and as two functions because the
 * clustering is worth testing without a DOM.
 */
export function collectPalette(root: Element | Document, options: PaletteOptions = {}): PaletteResult {
  const walk = walkColorUsages(root, options);
  const entries = buildPalette(walk.usages, options);

  return {
    entries,
    elementsScanned: walk.elementsScanned,
    truncated: walk.truncated,
    unreadable: walk.unreadable,
    totalUsages: entries.reduce((sum, entry) => sum + entry.count, 0),
  };
}
