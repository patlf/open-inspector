/**
 * Type scale inference.
 *
 * Given every font size a subtree actually uses, decide whether they were
 * generated from a modular ratio — and, far more often, say plainly that they
 * were not. Most real pages have no consistent scale; a tool that always names
 * one is telling its user something false about the design they are looking at.
 *
 * Two guards keep the answer meaningful. Conformance is measured over *distinct*
 * sizes, so a page whose body text dominates the element count cannot inflate
 * the score. And a size only counts as conforming if it is close to a step both
 * in relative terms and as a fraction of the gap between steps — without the
 * second test, small ratios like 1.125 have steps dense enough that almost any
 * set of sizes "fits" them.
 */

import { parsePx, round } from '../geometry/rect.js';

/** A named modular ratio. */
export interface ScaleRatio {
  ratio: number;
  name: string;
}

/** One distinct font size and how many elements use it. */
export interface FontSizeUsage {
  px: number;
  count: number;
}

/** A size that landed on a step, with its position relative to the base. */
export interface TypeScaleStep {
  px: number;
  /** Steps above (positive) or below (negative) the base size. */
  step: number;
  count: number;
}

/** How well one candidate ratio explains the observed sizes. */
export interface TypeScaleMatch {
  ratio: number;
  name: string;
  /** The size the scale is anchored on: the most-used one. */
  base: number;
  /** Share of distinct sizes landing on a step, 0–100. */
  conformance: number;
  steps: TypeScaleStep[];
  outliers: FontSizeUsage[];
}

/** The outcome of inference. `'none'` is the common, honest answer. */
export type TypeScaleResult =
  | { kind: 'scale'; sizes: FontSizeUsage[]; match: TypeScaleMatch }
  | {
      kind: 'none';
      reason: 'no-sizes' | 'too-few-sizes' | 'no-matching-ratio';
      sizes: FontSizeUsage[];
      /** The best-scoring ratio even though it failed, so the UI can show how close. */
      closest: TypeScaleMatch | null;
    };

/** Tuning knobs; the defaults are what {@link inferTypeScale} uses. */
export interface TypeScaleOptions {
  /** Distinct sizes required before inference is meaningful. Default 3. */
  minSizes?: number;
  /** Conformance percentage required to call it a scale. Default 75. */
  minConformance?: number;
  /** Allowed distance from a step, in steps. Default 0.15. */
  maxStepError?: number;
  /** Allowed distance from a step, relative to the size. Default 0.04. */
  maxRelativeError?: number;
  ratios?: readonly ScaleRatio[];
}

/** The ratios design systems actually use, by their musical-interval names. */
export const MODULAR_RATIOS: readonly ScaleRatio[] = [
  { ratio: 1.125, name: 'Major Second' },
  { ratio: 1.2, name: 'Minor Third' },
  { ratio: 1.25, name: 'Major Third' },
  { ratio: 1.333, name: 'Perfect Fourth' },
  { ratio: 1.414, name: 'Augmented Fourth' },
  { ratio: 1.5, name: 'Perfect Fifth' },
  { ratio: 1.618, name: 'Golden Ratio' },
];

const DEFAULT_MIN_SIZES = 3;
const DEFAULT_MIN_CONFORMANCE = 75;
const DEFAULT_MAX_STEP_ERROR = 0.15;
const DEFAULT_MAX_RELATIVE_ERROR = 0.04;

/** Where the base is picked from when usage counts tie: the usual body size. */
const TYPICAL_BODY_SIZE = 16;

/** Elements that carry a computed font size but never paint text. */
const NON_RENDERED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'HEAD',
  'META',
  'LINK',
  'TITLE',
  'BASE',
]);

/** Controls whose text lives in a value or a UA shadow root, not in a child node. */
const TEXT_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Ceiling on elements visited by {@link collectFontSizes}.
 *
 * `getComputedStyle` is a forced style resolution per element; on a page with
 * six figures of nodes an uncapped walk is a visible freeze. The cap is high
 * enough that the size *set* is complete long before it is reached.
 */
const DEFAULT_ELEMENT_LIMIT = 25_000;

/**
 * Count distinct sizes.
 *
 * Rounds to two decimals first: a 1.5 % browser zoom turns one authored size
 * into a spray of values like 15.9999 and 16.0001, which would otherwise look
 * like a dozen distinct steps and defeat inference entirely.
 */
export function tallyFontSizes(values: readonly number[]): FontSizeUsage[] {
  const counts = new Map<number, number>();

  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) continue;
    const px = round(value);
    counts.set(px, (counts.get(px) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([px, count]) => ({ px, count }))
    .sort((a, b) => a.px - b.px);
}

/**
 * Choose the size the scale is anchored on.
 *
 * The most-used size is the body text, which is what a designer picks as the
 * base. Ties break toward 16px — the size a page most likely inherited rather
 * than chose — and then toward the smaller value so the result is deterministic.
 */
export function pickBaseSize(sizes: readonly FontSizeUsage[]): number | null {
  let best: FontSizeUsage | null = null;

  for (const size of sizes) {
    if (!best) {
      best = size;
      continue;
    }
    if (size.count > best.count) {
      best = size;
      continue;
    }
    if (size.count < best.count) continue;

    const currentDistance = Math.abs(best.px - TYPICAL_BODY_SIZE);
    const candidateDistance = Math.abs(size.px - TYPICAL_BODY_SIZE);
    if (candidateDistance < currentDistance) best = size;
    else if (candidateDistance === currentDistance && size.px < best.px) best = size;
  }

  return best ? best.px : null;
}

interface RatioScore {
  match: TypeScaleMatch;
  meanStepError: number;
}

function scoreRatio(
  sizes: readonly FontSizeUsage[],
  base: number,
  candidate: ScaleRatio,
  maxStepError: number,
  maxRelativeError: number,
): RatioScore {
  const steps: TypeScaleStep[] = [];
  const outliers: FontSizeUsage[] = [];
  let errorSum = 0;

  for (const size of sizes) {
    const exactStep = Math.log(size.px / base) / Math.log(candidate.ratio);
    const step = Math.round(exactStep);
    const predicted = base * candidate.ratio ** step;
    const stepError = Math.abs(exactStep - step);
    const relativeError = predicted > 0 ? Math.abs(size.px - predicted) / predicted : 1;

    errorSum += stepError;

    if (stepError <= maxStepError && relativeError <= maxRelativeError) {
      steps.push({ px: size.px, step, count: size.count });
    } else {
      outliers.push(size);
    }
  }

  return {
    match: {
      ratio: candidate.ratio,
      name: candidate.name,
      base,
      conformance: round((steps.length / sizes.length) * 100, 1),
      steps,
      outliers,
    },
    meanStepError: errorSum / sizes.length,
  };
}

/**
 * Decide whether a set of sizes follows a modular ratio.
 *
 * Returns `kind: 'none'` with the closest candidate attached whenever nothing
 * clears the conformance bar, so the UI can say "closest was 1.25 at 43 %"
 * instead of either lying or going blank.
 */
export function inferTypeScale(
  sizes: readonly FontSizeUsage[],
  options: TypeScaleOptions = {},
): TypeScaleResult {
  const ordered = [...sizes].filter((size) => size.px > 0).sort((a, b) => a.px - b.px);
  const minSizes = options.minSizes ?? DEFAULT_MIN_SIZES;
  const minConformance = options.minConformance ?? DEFAULT_MIN_CONFORMANCE;
  const maxStepError = options.maxStepError ?? DEFAULT_MAX_STEP_ERROR;
  const maxRelativeError = options.maxRelativeError ?? DEFAULT_MAX_RELATIVE_ERROR;
  const ratios = options.ratios ?? MODULAR_RATIOS;

  if (ordered.length === 0) {
    return { kind: 'none', reason: 'no-sizes', sizes: ordered, closest: null };
  }
  if (ordered.length < minSizes) {
    return { kind: 'none', reason: 'too-few-sizes', sizes: ordered, closest: null };
  }

  const base = pickBaseSize(ordered);
  if (base === null || base <= 0) {
    return { kind: 'none', reason: 'no-sizes', sizes: ordered, closest: null };
  }

  let best: RatioScore | null = null;
  for (const candidate of ratios) {
    if (!(candidate.ratio > 1)) continue;
    const score = scoreRatio(ordered, base, candidate, maxStepError, maxRelativeError);
    if (
      !best ||
      score.match.conformance > best.match.conformance ||
      (score.match.conformance === best.match.conformance &&
        score.meanStepError < best.meanStepError)
    ) {
      best = score;
    }
  }

  if (!best) {
    return { kind: 'none', reason: 'no-matching-ratio', sizes: ordered, closest: null };
  }
  if (best.match.conformance < minConformance) {
    return { kind: 'none', reason: 'no-matching-ratio', sizes: ordered, closest: best.match };
  }

  return { kind: 'scale', sizes: ordered, match: best.match };
}

/**
 * Whether this element contributes a size worth counting.
 *
 * Only elements with text of their own count. Wrappers inherit a font size they
 * never paint, and counting them would let a deeply nested layout outvote the
 * headings — the base size would end up being whatever `<div>` nesting was
 * deepest rather than what the reader sees.
 */
export function isTextBearing(element: Element): boolean {
  if (NON_RENDERED_TAGS.has(element.tagName.toUpperCase())) return false;
  if (TEXT_CONTROL_TAGS.has(element.tagName.toUpperCase())) return true;

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType !== 3) continue;
    if ((node.nodeValue ?? '').trim() !== '') return true;
  }
  return false;
}

/** Options for {@link collectFontSizes}. */
export interface CollectFontSizesOptions {
  view?: Window;
  /** Descend into open shadow roots. Default true. */
  pierceShadow?: boolean;
  /** Element budget; see {@link DEFAULT_ELEMENT_LIMIT}. */
  limit?: number;
  /**
   * Skip an element and everything inside it.
   *
   * An inspector panel injected into the page carries a dozen font sizes of
   * its own — 9px, 9.5px, 10.5px — none of which belong to the page's type
   * scale, and all of which are counted without this.
   */
  shouldSkip?: (element: Element) => boolean;
}

/**
 * Gather the font sizes actually used for text in a subtree.
 *
 * Open shadow roots are included by default: a component-based page keeps most
 * of its text there, and a scale inferred from the light DOM alone would be
 * inferred from the page chrome only. Closed roots stay invisible, as always.
 */
export function collectFontSizes(
  root: Element,
  options: CollectFontSizesOptions = {},
): FontSizeUsage[] {
  const view = options.view ?? root.ownerDocument.defaultView ?? window;
  const pierceShadow = options.pierceShadow ?? true;
  const limit = options.limit ?? DEFAULT_ELEMENT_LIMIT;

  const values: number[] = [];
  const queue: Element[] = [root];
  let visited = 0;

  const shouldSkip = options.shouldSkip;

  while (queue.length > 0 && visited < limit) {
    const element = queue.shift();
    if (!element) break;
    visited += 1;

    if (shouldSkip?.(element)) continue;
    if (NON_RENDERED_TAGS.has(element.tagName.toUpperCase())) continue;

    if (isTextBearing(element)) {
      values.push(parsePx(view.getComputedStyle(element).fontSize));
    }

    if (pierceShadow && element.shadowRoot) {
      queue.push(...Array.from(element.shadowRoot.children));
    }
    queue.push(...Array.from(element.children));
  }

  return tallyFontSizes(values);
}

/** Collect and infer in one call — the entry point a "scan this page" action uses. */
export function inferTypeScaleForSubtree(
  root: Element,
  options: CollectFontSizesOptions & TypeScaleOptions = {},
): TypeScaleResult {
  return inferTypeScale(collectFontSizes(root, options), options);
}
