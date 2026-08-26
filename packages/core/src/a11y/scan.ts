import type { ElementDescriptor } from '../types.js';
import { describeElement } from '../probe/describe.js';
import { parsePx, round } from '../geometry/rect.js';
import type { SrgbAlpha, WcagLevel } from './contrast.js';
import { LOWEST_WCAG_TEXT_RATIO, requiredRatio } from './contrast.js';
import type {
  AssessedContrast,
  IndeterminateReason,
  ResolvedBackground,
} from './assess.js';
import { assessContrast, normalizeFontWeight } from './assess.js';
import { parseCssColor } from './css-color.js';

/**
 * Subtree-wide contrast scan.
 *
 * Two constraints shape this file. First, background resolution lives outside
 * this module, so it is injected rather than imported — the scan is otherwise
 * unopinionated about how a background gets resolved. Second, the DOM reads
 * (computed style, rect) are all behind injectable functions, because no DOM
 * implementation outside a real browser computes layout faithfully and the
 * walk logic has to be testable without one.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Tags whose text content is never rendered as page text.
 *
 * `title` is in here because its text shows in the tab chrome, not the page,
 * and grading it against the body background would invent a failure.
 */
const NON_RENDERED_TAGS: ReadonlySet<string> = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TITLE',
  'HEAD',
  'META',
  'LINK',
  'BASE',
]);

/** Default cap on elements examined. Large enough for real pages, small enough to stay interactive. */
export const DEFAULT_ELEMENT_BUDGET = 1500;

/** How far below its requirement a sample sits. */
export type ContrastSeverity = 'critical' | 'serious' | 'moderate';

/**
 * Whether an element renders, and whether its subtree can still render.
 *
 * The distinction matters: `display: none` and `opacity: 0` cannot be undone
 * by a descendant, so those subtrees are pruned. `visibility: hidden` *can* be
 * undone (a child may set `visibility: visible`), and a zero-sized box can
 * still have overflowing or absolutely positioned children — so those skip
 * only the element itself.
 */
export type VisibilityVerdict = 'visible' | 'hidden' | 'hidden-subtree';

/** The style and geometry facts that decide whether text is on screen. */
export interface VisibilityInput {
  display: string;
  visibility: string;
  opacity: string;
  contentVisibility: string;
  width: number;
  height: number;
}

/**
 * Pure visibility rule, split out so it can be tested without a layout engine.
 *
 * Deliberately does not use `Element.checkVisibility()`: its option names were
 * renamed after Chromium shipped them (`checkOpacity` → `opacityProperty`), it
 * is absent in older engines, and it collapses the prune/skip distinction the
 * walk depends on.
 */
export function classifyVisibility(input: VisibilityInput): VisibilityVerdict {
  if (input.display === 'none') return 'hidden-subtree';
  if (input.contentVisibility === 'hidden') return 'hidden-subtree';

  const opacity = Number.parseFloat(input.opacity);
  if (Number.isFinite(opacity) && opacity <= 0) return 'hidden-subtree';

  if (input.visibility === 'hidden' || input.visibility === 'collapse') return 'hidden';
  if (input.width <= 0 || input.height <= 0) return 'hidden';

  return 'visible';
}

/** Collapse runs of whitespace so a text sample reads as one line. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The text this element renders itself, ignoring descendants.
 *
 * A `<div>` wrapping three `<p>`s does not paint any text of its own, so its
 * colour and background are not what the reader sees; grading it would produce
 * duplicate (and sometimes contradictory) findings for the same pixels.
 * Non-breaking spaces count as whitespace here — `String.trim` strips them —
 * which is what we want, since a lone `&nbsp;` is a spacer, not text.
 */
export function directText(element: Element): string {
  let text = '';
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === TEXT_NODE) text += node.nodeValue ?? '';
  }
  return collapseWhitespace(text);
}

/**
 * Rank a failure.
 *
 * `critical` is anything below 3:1 — it fails every WCAG text criterion at
 * every size, so it is a failure no matter how the text is later restyled.
 * `moderate` is only reachable when scanning at AAA, where a sample can pass
 * AA and still be reported.
 */
export function classifySeverity(ratio: number, requiredForAA: number): ContrastSeverity {
  if (ratio < LOWEST_WCAG_TEXT_RATIO) return 'critical';
  if (ratio < requiredForAA) return 'serious';
  return 'moderate';
}

/** A text sample that failed the level being scanned. */
export interface ContrastFinding {
  element: Element;
  descriptor: ElementDescriptor;
  /** Truncated sample of the element's own text, for identifying it in a list. */
  text: string;
  verdict: AssessedContrast;
  severity: ContrastSeverity;
  /** The ratio required at the scanned level. */
  required: number;
  /** `required - ratio`, the sort key: how badly it misses. */
  deficit: number;
}

/** A text sample whose contrast could not be determined. Reported, never guessed at. */
export interface IndeterminateFinding {
  element: Element;
  descriptor: ElementDescriptor;
  text: string;
  reason: IndeterminateReason;
  detail: string | null;
}

/** Outcome of a subtree scan. */
export interface ContrastScanResult {
  level: WcagLevel;
  /** Failures, worst first. */
  failures: ContrastFinding[];
  indeterminate: IndeterminateFinding[];
  /** Text samples that met the level. */
  passes: number;
  /** Elements examined, including ones that were skipped. */
  visited: number;
  /** Text-bearing, visible elements that produced a verdict. */
  assessed: number;
  /** Elements skipped as non-rendered, non-text, or invisible. */
  skipped: number;
  /** True when the budget stopped the walk before the subtree was exhausted. */
  truncated: boolean;
  budget: number;
}

/** Injection points for the scan. Only `resolveBackground` has no sane default. */
export interface ContrastScanOptions {
  /**
   * Resolve the effective background behind an element's text.
   *
   * Required, and required for a reason: getting this right means walking
   * ancestors, compositing translucent layers, and giving up honestly on
   * gradients and images. That logic lives in its own module; wiring it in is
   * the caller's decision, and a stub that always answers "indeterminate" is a
   * legitimate (if unhelpful) choice.
   */
  resolveBackground: (element: Element, style: CSSStyleDeclaration) => ResolvedBackground;
  /** Level a sample must meet to count as a pass. Defaults to `'AA'`. */
  level?: WcagLevel;
  /** Maximum elements examined. Defaults to {@link DEFAULT_ELEMENT_BUDGET}. */
  maxElements?: number;
  view?: Window;
  getStyle?: (element: Element) => CSSStyleDeclaration;
  /** Defaults to parsing `style.color`; inject the colour module's parser for full coverage. */
  readForeground?: (element: Element, style: CSSStyleDeclaration) => SrgbAlpha | null;
  classifyElementVisibility?: (element: Element, style: CSSStyleDeclaration) => VisibilityVerdict;
  /** Walk open shadow roots. Defaults to true. */
  pierceShadow?: boolean;
  /** Compute a suggested colour for each failure. Defaults to true. */
  suggestFix?: boolean;
  /** Characters of sample text kept per finding. Defaults to 80. */
  maxTextLength?: number;
}

function defaultVisibility(element: Element, style: CSSStyleDeclaration): VisibilityVerdict {
  const rect = element.getBoundingClientRect();
  return classifyVisibility({
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    // Not in every `CSSStyleDeclaration` typing; read defensively.
    contentVisibility: style.getPropertyValue('content-visibility'),
    width: rect.width,
    height: rect.height,
  });
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * Order failures worst-first.
 *
 * Sorts by how far the sample misses its requirement rather than by raw ratio,
 * so a 2.9:1 heading (needs 3) does not outrank a 2.9:1 caption (needs 4.5).
 * The raw ratio breaks ties, and `Array#sort` is stable, so equal samples stay
 * in document order.
 */
export function sortFindings(findings: readonly ContrastFinding[]): ContrastFinding[] {
  return [...findings].sort((a, b) => {
    if (b.deficit !== a.deficit) return b.deficit - a.deficit;
    return a.verdict.ratioExact - b.verdict.ratioExact;
  });
}

/**
 * Find every text-bearing element in a subtree and grade its contrast.
 *
 * Walks in document order and prunes subtrees that cannot render, which is how
 * ancestor effects (`display: none`, `opacity: 0`) are handled without asking
 * each element about its ancestors. Stops at the element budget and says so
 * rather than silently returning a partial page as if it were the whole one.
 */
export function scanContrast(root: ParentNode, options: ContrastScanOptions): ContrastScanResult {
  const view = options.view ?? window;
  const getStyle = options.getStyle ?? ((element: Element) => view.getComputedStyle(element));
  const readForeground =
    options.readForeground ?? ((_element: Element, style: CSSStyleDeclaration) => parseCssColor(style.color));
  const classifyElement = options.classifyElementVisibility ?? defaultVisibility;
  const level = options.level ?? 'AA';
  const budget = Math.max(0, options.maxElements ?? DEFAULT_ELEMENT_BUDGET);
  const pierceShadow = options.pierceShadow ?? true;
  const suggestFix = options.suggestFix ?? true;
  const maxTextLength = options.maxTextLength ?? 80;

  const failures: ContrastFinding[] = [];
  const indeterminate: IndeterminateFinding[] = [];
  let passes = 0;
  let visited = 0;
  let assessed = 0;
  let skipped = 0;
  let truncated = false;

  const stack: Element[] = [];

  const pushAll = (children: HTMLCollection): void => {
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children.item(index);
      if (child) stack.push(child);
    }
  };

  if (root.nodeType === ELEMENT_NODE) stack.push(root as Element);
  else pushAll(root.children);

  while (stack.length > 0) {
    if (visited >= budget) {
      truncated = true;
      break;
    }

    const element = stack.pop();
    if (!element) break;
    visited += 1;

    if (NON_RENDERED_TAGS.has(element.tagName.toUpperCase())) {
      skipped += 1;
      continue;
    }

    const style = getStyle(element);
    const visibility = classifyElement(element, style);
    if (visibility === 'hidden-subtree') {
      skipped += 1;
      continue;
    }

    // Descend before assessing: a hidden-but-not-pruned element still has
    // children that may render.
    if (pierceShadow && element.shadowRoot) pushAll(element.shadowRoot.children);
    pushAll(element.children);

    const text = directText(element);
    if (visibility === 'hidden' || text === '') {
      skipped += 1;
      continue;
    }

    const foreground = readForeground(element, style);
    const sample = truncateText(text, maxTextLength);

    if (!foreground) {
      assessed += 1;
      indeterminate.push({
        element,
        descriptor: describeElement(element),
        text: sample,
        reason: 'unparsable-color',
        detail: style.color || null,
      });
      continue;
    }

    // Fully transparent text is an invisibility bug, not a contrast one;
    // reporting it as a 1:1 failure would bury the real findings.
    if (foreground.alpha <= 0) {
      skipped += 1;
      continue;
    }

    const verdict = assessContrast(
      {
        foreground,
        background: options.resolveBackground(element, style),
        fontSizePx: parsePx(style.fontSize),
        fontWeight: normalizeFontWeight(style.fontWeight),
      },
      { level, suggestFix },
    );

    assessed += 1;

    if (verdict.status === 'indeterminate') {
      indeterminate.push({
        element,
        descriptor: describeElement(element),
        text: sample,
        reason: verdict.reason,
        detail: verdict.detail,
      });
      continue;
    }

    const required = requiredRatio(verdict.textSize, level);
    if (verdict.ratioExact >= required) {
      passes += 1;
      continue;
    }

    failures.push({
      element,
      descriptor: describeElement(element),
      text: sample,
      verdict,
      severity: classifySeverity(verdict.ratioExact, verdict.requiredAA),
      required,
      deficit: round(required - verdict.ratioExact),
    });
  }

  return {
    level,
    failures: sortFindings(failures),
    indeterminate,
    passes,
    visited,
    assessed,
    skipped,
    truncated,
    budget,
  };
}
