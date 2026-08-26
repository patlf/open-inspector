/**
 * Spacing scale inference.
 *
 * Design systems are built on a base unit — 4px, 8px, sometimes 10px — and the
 * interesting question about a page is never "what is this margin", it is
 * "does this page have a system, and where does it break". This walks a subtree,
 * collects every margin, padding and gap, and works backwards to the unit.
 *
 * The inference is pure and separated from the walk, because the judgement
 * calls (which bases to try, how much sub-pixel drift to forgive) are exactly
 * what needs testing against ugly real-world numbers.
 */

import { parsePx, round } from '../geometry/rect.js';
import { buildSelectorLabel } from '../probe/describe.js';

/** One spacing value, tagged with where it came from so outliers can be pointed at. */
export interface SpacingSample {
  /** Pixels, signed: negative margins are real and deliberate. */
  value: number;
  /** The longhand property, e.g. `margin-top`, `column-gap`. */
  property: string;
  /** Selector label of the element it was read from. */
  source: string;
}

/** A distinct value and how often it occurs. */
export interface SpacingValueCount {
  value: number;
  count: number;
  /** A few elements using it — enough to go look, not enough to flood the UI. */
  sources: string[];
}

/** The verdict on a subtree's spacing. */
export type SpacingScale =
  | {
      kind: 'scale';
      /** The inferred base unit, in pixels. */
      base: number;
      /** 0–1 share of samples that are near-multiples of `base`. */
      conformance: number;
      /** Every distinct value found, most common first. */
      values: SpacingValueCount[];
      /** The values that break the scale, most common first. */
      outliers: SpacingValueCount[];
      sampleSize: number;
      summary: string;
    }
  | {
      kind: 'no-consistent-scale';
      /** The best candidate tried, so the UI can show how close it got. */
      bestBase: number | null;
      conformance: number;
      values: SpacingValueCount[];
      sampleSize: number;
      summary: string;
    }
  | { kind: 'insufficient-data'; sampleSize: number; summary: string };

/** Knobs for {@link inferSpacingScale}. Defaults are tuned for web design systems. */
export interface SpacingScaleOptions {
  /** Bases to try, alongside a GCD-derived candidate. Defaults to 4, 8, 10, 16. */
  candidates?: readonly number[];
  /** Pixels of drift still counted as conforming. Defaults to 0.5. */
  tolerance?: number;
  /** Below this share, the answer is "no consistent scale". Defaults to 0.75. */
  minConformance?: number;
  /** Fewer samples than this and no verdict is honest. Defaults to 4. */
  minSamples?: number;
  /** How many example elements to keep per distinct value. Defaults to 3. */
  maxSourcesPerValue?: number;
}

const DEFAULT_CANDIDATES = [4, 8, 10, 16] as const;
const DEFAULT_TOLERANCE = 0.5;
const DEFAULT_MIN_CONFORMANCE = 0.75;
const DEFAULT_MIN_SAMPLES = 4;
const DEFAULT_MAX_SOURCES = 3;
/** Above this a "base unit" stops being a scale and starts being a coincidence. */
const MAX_BASE = 64;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/**
 * A base unit derived from the greatest common divisor of the values in use.
 *
 * Catches the systems nobody guesses: a 6px or 12px scale conforms poorly to
 * every hardcoded candidate but perfectly to its own GCD. Non-integer values
 * are excluded from the GCD — one `13.3333px` from a percentage would drag the
 * divisor to 1 and hide a real scale.
 */
export function gcdCandidate(values: readonly number[], tolerance = DEFAULT_TOLERANCE): number | null {
  const integers = values
    .map((value) => Math.abs(value))
    .filter((value) => value > 0 && Math.abs(value - Math.round(value)) <= Math.min(tolerance, 0.1))
    .map((value) => Math.round(value));

  if (integers.length < 2) return null;

  let divisor = integers[0] ?? 0;
  for (const value of integers) divisor = gcd(divisor, value);

  if (divisor < 2 || divisor > MAX_BASE) return null;
  return divisor;
}

/**
 * Whether a value sits on the scale.
 *
 * The `multiple >= 1` guard is what stops every base from "explaining" a 0.5px
 * hairline: rounding to the zero multiple is not conformance, it is a value
 * smaller than the unit itself.
 */
export function conformsToBase(value: number, base: number, tolerance = DEFAULT_TOLERANCE): boolean {
  if (base <= 0) return false;
  const magnitude = Math.abs(value);
  const multiple = Math.round(magnitude / base);
  if (multiple < 1) return false;
  return Math.abs(magnitude - multiple * base) <= tolerance;
}

function tally(
  samples: readonly SpacingSample[],
  maxSources: number,
): { values: SpacingValueCount[]; total: number } {
  const counts = new Map<number, SpacingValueCount>();

  for (const sample of samples) {
    const value = round(sample.value);
    const existing = counts.get(value);
    if (existing) {
      existing.count += 1;
      if (existing.sources.length < maxSources && !existing.sources.includes(sample.source)) {
        existing.sources.push(sample.source);
      }
      continue;
    }
    counts.set(value, { value, count: 1, sources: [sample.source] });
  }

  const values = [...counts.values()].sort((a, b) => b.count - a.count || a.value - b.value);
  return { values, total: samples.length };
}

function formatPx(value: number): string {
  return `${round(value)}px`;
}

/**
 * Infer the base unit a subtree's spacing is built on.
 *
 * Candidates are tried largest first and the largest one that clears the
 * conformance bar wins: 8 and 4 both "explain" a set of 8s and 16s, but only
 * "8px scale" is a useful thing to tell a developer. When nothing clears the
 * bar the result says so — an invented base with 40% conformance would be worse
 * than admitting the page has no system.
 */
export function inferSpacingScale(
  samples: readonly SpacingSample[],
  options: SpacingScaleOptions = {},
): SpacingScale {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const minConformance = options.minConformance ?? DEFAULT_MIN_CONFORMANCE;
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const maxSources = options.maxSourcesPerValue ?? DEFAULT_MAX_SOURCES;

  // Zeros conform to every scale and would inflate every percentage; a page
  // full of `margin: 0` says nothing about its spacing system.
  const spacing = samples.filter((sample) => round(sample.value) !== 0);

  if (spacing.length < minSamples) {
    return {
      kind: 'insufficient-data',
      sampleSize: spacing.length,
      summary: `only ${spacing.length} non-zero spacing value(s) found — not enough to infer a scale`,
    };
  }

  const { values, total } = tally(spacing, maxSources);
  const magnitudes = spacing.map((sample) => sample.value);

  const candidates = [...(options.candidates ?? DEFAULT_CANDIDATES)];
  const derived = gcdCandidate(magnitudes, tolerance);
  if (derived !== null) candidates.push(derived);

  const unique = [...new Set(candidates)]
    .filter((base) => base >= 2 && base <= MAX_BASE)
    .sort((a, b) => b - a);

  let best: { base: number; conformance: number } | null = null;

  for (const base of unique) {
    const conforming = spacing.reduce(
      (count, sample) => count + (conformsToBase(sample.value, base, tolerance) ? 1 : 0),
      0,
    );
    const conformance = conforming / total;
    if (best === null || conformance > best.conformance) best = { base, conformance };
    if (conformance >= minConformance) {
      const outliers = values.filter((entry) => !conformsToBase(entry.value, base, tolerance));
      const percent = Math.round(conformance * 100);
      const outlierText =
        outliers.length === 0
          ? 'no outliers'
          : `outliers: ${outliers
              .slice(0, 3)
              .map((entry) => formatPx(entry.value))
              .join(', ')}${outliers.length > 3 ? ` and ${outliers.length - 3} more` : ''}`;

      return {
        kind: 'scale',
        base,
        conformance,
        values,
        outliers,
        sampleSize: total,
        summary: `${formatPx(base)} scale, ${percent}% conform, ${outlierText}`,
      };
    }
  }

  const percent = best ? Math.round(best.conformance * 100) : 0;
  return {
    kind: 'no-consistent-scale',
    bestBase: best?.base ?? null,
    conformance: best?.conformance ?? 0,
    values,
    sampleSize: total,
    summary: best
      ? `no consistent spacing scale — the best candidate, ${formatPx(best.base)}, only explains ${percent}% of ${total} values`
      : `no consistent spacing scale across ${total} values`,
  };
}

const SPACING_PROPERTIES: ReadonlyArray<[keyof CSSStyleDeclaration & string, string]> = [
  ['marginTop', 'margin-top'],
  ['marginRight', 'margin-right'],
  ['marginBottom', 'margin-bottom'],
  ['marginLeft', 'margin-left'],
  ['paddingTop', 'padding-top'],
  ['paddingRight', 'padding-right'],
  ['paddingBottom', 'padding-bottom'],
  ['paddingLeft', 'padding-left'],
  ['columnGap', 'column-gap'],
  ['rowGap', 'row-gap'],
];

/**
 * Pull every spacing value off one computed style.
 *
 * `auto` margins and the `normal` gap keyword parse to 0 and are dropped by the
 * inference step — they are layout instructions, not spacing decisions, and
 * counting them as "0px" would distort the conformance figure.
 */
export function readSpacingFromStyle(style: CSSStyleDeclaration, source: string): SpacingSample[] {
  const samples: SpacingSample[] = [];

  for (const [property, label] of SPACING_PROPERTIES) {
    const raw = style[property];
    if (typeof raw !== 'string' || raw === '') continue;
    const lower = raw.toLowerCase();
    if (lower === 'auto' || lower === 'normal') continue;

    const value = parsePx(raw);
    if (value === 0) continue;
    samples.push({ value, property: label, source });
  }

  return samples;
}

/** Options for the DOM walk. */
export interface SpacingCollectOptions {
  view?: Window;
  /** Stop after this many elements. Real pages have tens of thousands. Defaults to 1500. */
  maxElements?: number;
  /** Descend into open shadow roots. Defaults to true. */
  pierceShadow?: boolean;
  /**
   * Skip an element and everything inside it.
   *
   * Load-bearing when the caller has injected UI of its own into the page
   * being measured: an inspector panel sitting in the document contributes its
   * own 3px, 5px and 7px values to the tally, and enough of them will bury the
   * scale the page actually follows.
   */
  shouldSkip?: (element: Element) => boolean;
}

/** What the walk found, plus whether it had to stop early. */
export interface SpacingCollection {
  samples: SpacingSample[];
  elementsVisited: number;
  /** True when the element cap was hit, so the scale covers only part of the subtree. */
  truncated: boolean;
}

const DEFAULT_MAX_ELEMENTS = 1500;

/**
 * Walk a subtree collecting spacing values.
 *
 * Bounded on purpose: this runs on a user gesture in a content script, and an
 * unbounded walk of a 40,000-node application would freeze the page. Hitting
 * the cap is reported rather than hidden, because a scale inferred from the
 * first 1500 elements of a page is a different claim from one covering all of
 * it.
 */
export function collectSpacingSamples(
  root: Element,
  options: SpacingCollectOptions = {},
): SpacingCollection {
  const view = options.view ?? window;
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const pierceShadow = options.pierceShadow ?? true;

  const samples: SpacingSample[] = [];
  const queue: Element[] = [root];
  const seen = new Set<Element>();
  let elementsVisited = 0;
  let truncated = false;

  const shouldSkip = options.shouldSkip;

  while (queue.length > 0) {
    const element = queue.shift();
    if (!element || seen.has(element)) continue;
    seen.add(element);

    // Skipping the subtree, not just the element: a panel's children are the
    // part with all the spacing.
    if (shouldSkip?.(element)) continue;

    if (elementsVisited >= maxElements) {
      truncated = true;
      break;
    }
    elementsVisited += 1;

    const label = buildSelectorLabel(
      element.tagName.toLowerCase(),
      element.id ? element.id : null,
      Array.from(element.classList),
    );
    samples.push(...readSpacingFromStyle(view.getComputedStyle(element), label));

    for (const child of Array.from(element.children)) queue.push(child);
    if (pierceShadow && element.shadowRoot) {
      for (const child of Array.from(element.shadowRoot.children)) queue.push(child);
    }
  }

  return { samples, elementsVisited, truncated };
}

/** A scale verdict together with how much of the subtree it is based on. */
export interface SpacingScaleReport {
  scale: SpacingScale;
  elementsVisited: number;
  truncated: boolean;
}

/** Walk a subtree and infer its spacing scale. */
export function analyzeSpacingScale(
  root: Element,
  options: SpacingCollectOptions & SpacingScaleOptions = {},
): SpacingScaleReport {
  const collection = collectSpacingSamples(root, options);
  return {
    scale: inferSpacingScale(collection.samples, options),
    elementsVisited: collection.elementsVisited,
    truncated: collection.truncated,
  };
}
