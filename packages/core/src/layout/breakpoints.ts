/**
 * Breakpoint discovery for a single element.
 *
 * "This page has 40 media queries" is not an answer. "This element changes at
 * 768px, and here is what changes" is. So the scan walks the CSSOM, then keeps
 * only the rules whose selectors match the element or one of its ancestors —
 * an ancestor counts because `@media (min-width: 768px) { .sidebar { display:
 * none } }` is exactly why the element the user clicked disappeared.
 *
 * Stylesheets we cannot read are reported as unreadable rather than skipped
 * silently: a cross-origin stylesheet may hold the breakpoint that matters, and
 * "no breakpoints found" would be a lie.
 */

import { parseCssLength, splitTopLevel } from './css-text.js';

/** The slice of a `CSSStyleDeclaration` the scanner needs. */
export interface CssStyleLike {
  length: number;
  item(index: number): string;
}

/**
 * The slice of `CSSRule` the scanner needs.
 *
 * Structural rather than the real DOM types so tests can hand it plain objects:
 * `CSSMediaRule` is not constructible, and no non-browser DOM implementation
 * builds a faithful rule tree.
 */
export interface CssRuleLike {
  /**
   * Present on every real `CSSRule`. Unused by the walk, but it keeps this from
   * being an all-optional "weak" type that a real `CSSRule` cannot be assigned to.
   */
  cssText?: string | undefined;
  /** Present on media rules. */
  media?: { mediaText: string } | undefined;
  /** Present on `@media`, `@supports` and `@container` rules. */
  conditionText?: string | undefined;
  /** Present on container rules. */
  containerName?: string | undefined;
  containerQuery?: string | undefined;
  /** Present on style rules. */
  selectorText?: string | undefined;
  style?: CssStyleLike | undefined;
  /** Present on every grouping rule, including `@layer` and `@supports`. */
  cssRules?: ArrayLike<CssRuleLike> | undefined;
  /** Present on `@import`; its sheet may itself be cross-origin. */
  styleSheet?: StyleSheetLike | undefined;
}

/** The slice of `CSSStyleSheet` the scanner needs. */
export interface StyleSheetLike {
  href?: string | null | undefined;
  cssRules?: ArrayLike<CssRuleLike> | undefined;
}

/** A selector inside a conditional rule and the properties it sets. */
export interface MediaBlock {
  selector: string;
  properties: string[];
}

/** One conditional rule, flattened out of whatever nesting it was found in. */
export interface MediaRuleRecord {
  kind: 'media' | 'container';
  /** The condition verbatim, e.g. `screen and (min-width: 768px)`. */
  condition: string;
  /** The queried container's name, for `@container sidebar (...)`. */
  containerName: string | null;
  blocks: MediaBlock[];
  /** Stylesheet URL, or null for an inline `<style>`. */
  href: string | null;
}

/** A stylesheet whose rules could not be read. */
export interface UnreadableStyleSheet {
  href: string | null;
  /**
   * `cross-origin` when the browser threw a `SecurityError`. Anything else is
   * `unknown` — we do not guess.
   */
  reason: 'cross-origin' | 'unknown';
  message: string;
}

/** Everything the CSSOM walk produced. */
export interface MediaRuleScan {
  rules: MediaRuleRecord[];
  unreadable: UnreadableStyleSheet[];
  styleSheetCount: number;
}

const MEDIA_TYPES: ReadonlySet<string> = new Set(['all', 'screen', 'print', 'speech']);
const CONNECTORS: ReadonlySet<string> = new Set(['and', 'or', 'only', 'not', ',']);
const PREFERENCE = /^prefers-|^forced-colors$|^inverted-colors$/;

/** A parsed piece of a media condition. */
export type MediaFeature =
  | {
      kind: 'min-width' | 'max-width' | 'min-height' | 'max-height';
      px: number;
      raw: string;
      /** True when the pixel figure came from an `em`/`rem` conversion. */
      approximate: boolean;
    }
  | { kind: 'orientation'; value: string; raw: string }
  | { kind: 'preference'; name: string; value: string; raw: string }
  | { kind: 'media-type'; value: string; raw: string }
  | { kind: 'other'; raw: string };

type SizeKind = 'min-width' | 'max-width' | 'min-height' | 'max-height';

function sizeFeature(kind: SizeKind, value: string, raw: string, rootFontSize: number): MediaFeature {
  const length = parseCssLength(value, rootFontSize);
  if (!length) return { kind: 'other', raw };
  return { kind, px: length.px, raw, approximate: length.approximate };
}

function rangeKind(axis: string, operator: string, featureOnLeft: boolean): SizeKind | null {
  const dimension = axis === 'width' ? 'width' : axis === 'height' ? 'height' : null;
  if (dimension === null) return null;

  // `width >= 768px` and `768px <= width` say the same thing; flipping the
  // comparison when the feature is on the right is the whole trick.
  const effective = featureOnLeft
    ? operator
    : operator === '<' || operator === '<='
      ? '>='
      : operator === '>' || operator === '>='
        ? '<='
        : operator;

  if (effective === '>=' || effective === '>') return `min-${dimension}`;
  if (effective === '<=' || effective === '<') return `max-${dimension}`;
  return null;
}

/**
 * Parse one parenthesised media feature.
 *
 * Handles both spellings a stylesheet can use: the classic
 * `(min-width: 768px)` and the range syntax `(width >= 768px)` /
 * `(400px <= width <= 900px)`, which is increasingly common and which naive
 * `min-width` string matching misses entirely.
 */
export function parseMediaFeature(input: string, rootFontSize = 16): MediaFeature[] {
  const raw = input.trim();
  const colon = raw.indexOf(':');

  if (colon > 0) {
    const name = raw.slice(0, colon).trim().toLowerCase();
    const value = raw.slice(colon + 1).trim();

    if (name === 'min-width' || name === 'max-width' || name === 'min-height' || name === 'max-height') {
      return [sizeFeature(name, value, raw, rootFontSize)];
    }
    if (name === 'orientation') return [{ kind: 'orientation', value: value.toLowerCase(), raw }];
    if (PREFERENCE.test(name)) {
      return [{ kind: 'preference', name, value: value.toLowerCase(), raw }];
    }
    return [{ kind: 'other', raw }];
  }

  const parts = raw.split(/(<=|>=|<|>|=)/).map((part) => part.trim());
  if (parts.length === 3) {
    const [left, operator, right] = parts;
    if (left !== undefined && operator !== undefined && right !== undefined) {
      const leftIsFeature = /^[a-z-]+$/i.test(left);
      const axis = (leftIsFeature ? left : right).toLowerCase();
      const value = leftIsFeature ? right : left;
      const kind = rangeKind(axis, operator, leftIsFeature);
      if (kind) return [sizeFeature(kind, value, raw, rootFontSize)];
    }
    return [{ kind: 'other', raw }];
  }

  if (parts.length === 5) {
    const [low, firstOp, axis, secondOp, high] = parts;
    if (
      low !== undefined &&
      firstOp !== undefined &&
      axis !== undefined &&
      secondOp !== undefined &&
      high !== undefined
    ) {
      const features: MediaFeature[] = [];
      const lowKind = rangeKind(axis.toLowerCase(), firstOp, false);
      const highKind = rangeKind(axis.toLowerCase(), secondOp, true);
      if (lowKind) features.push(sizeFeature(lowKind, low, raw, rootFontSize));
      if (highKind) features.push(sizeFeature(highKind, high, raw, rootFontSize));
      if (features.length > 0) return features;
    }
    return [{ kind: 'other', raw }];
  }

  const bare = raw.toLowerCase();
  if (MEDIA_TYPES.has(bare)) return [{ kind: 'media-type', value: bare, raw }];
  return [{ kind: 'other', raw }];
}

/** Split a condition into its parenthesised groups and the bare words between them. */
function splitCondition(condition: string): { groups: string[]; bare: string[] } {
  const groups: string[] = [];
  const bare: string[] = [];
  let depth = 0;
  let start = 0;
  let outside = '';

  for (let index = 0; index < condition.length; index += 1) {
    const char = condition[index];
    if (char === '(') {
      if (depth === 0) {
        start = index + 1;
        bare.push(...outside.split(/[\s,]+/).filter(Boolean));
        outside = '';
      }
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) groups.push(condition.slice(start, index));
      if (depth < 0) depth = 0;
      continue;
    }
    if (depth === 0 && char !== undefined) outside += char;
  }

  bare.push(...outside.split(/[\s,]+/).filter(Boolean));
  return { groups, bare };
}

/**
 * Parse a full media or container condition into features.
 *
 * The condition text is always kept verbatim on the breakpoint as well, so
 * connectors and negations this drops are never lost — they are just not
 * something a breakpoint list needs to model.
 */
export function parseMediaCondition(condition: string, rootFontSize = 16): MediaFeature[] {
  const { groups, bare } = splitCondition(condition);
  const features: MediaFeature[] = [];

  for (const group of groups) {
    // Nested groups (`(min-width: 100px) and (max-width: 200px)` inside a
    // negation) recurse; a plain feature falls through to the parser.
    features.push(...(group.includes('(') ? parseMediaCondition(group, rootFontSize) : parseMediaFeature(group, rootFontSize)));
  }

  for (const word of bare) {
    const lower = word.toLowerCase();
    if (CONNECTORS.has(lower)) continue;
    if (MEDIA_TYPES.has(lower)) features.push({ kind: 'media-type', value: lower, raw: word });
  }

  return features;
}

function readProperties(style: CssStyleLike | undefined): string[] {
  if (!style || typeof style.item !== 'function') return [];
  const properties: string[] = [];
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    if (typeof name === 'string' && name !== '') properties.push(name);
  }
  return properties;
}

/**
 * Combine a nested selector with the one it is nested inside.
 *
 * CSS nesting means the interesting selectors are increasingly not top-level.
 * `&` is replaced with `:is(parent)` — using `:is()` rather than raw text
 * substitution keeps specificity-independent matching correct for selector
 * lists like `.a, .b`. A nested selector with no `&` is implicitly a
 * descendant.
 */
export function composeNestedSelector(parent: string | null, child: string): string {
  const trimmed = child.trim();
  if (parent === null || parent.trim() === '') return trimmed;
  if (trimmed.includes('&')) return trimmed.split('&').join(`:is(${parent})`);
  return `:is(${parent}) ${trimmed}`;
}

/**
 * Remove pseudo-elements from a selector so it can be passed to `matches`.
 *
 * `.card::before` never matches an element, but the rule absolutely still
 * applies to `.card` — dropping the pseudo-element is the difference between
 * finding the breakpoint and reporting none.
 */
export function stripPseudoElements(selector: string): string {
  return selector
    .replace(/::[a-z-]+(\([^)]*\))?/gi, '')
    .replace(/:(before|after|first-line|first-letter)\b/gi, '')
    .trim();
}

function isMediaRule(rule: CssRuleLike): boolean {
  return typeof rule.media?.mediaText === 'string';
}

function isContainerRule(rule: CssRuleLike): boolean {
  return typeof rule.containerName === 'string' || typeof rule.containerQuery === 'string';
}

interface WalkContext {
  href: string | null;
  selectorContext: string | null;
  condition: { kind: 'media' | 'container'; text: string; containerName: string | null } | null;
  rules: MediaRuleRecord[];
  unreadable: UnreadableStyleSheet[];
}

function recordFor(context: WalkContext): MediaRuleRecord | null {
  if (!context.condition) return null;
  const { kind, text, containerName } = context.condition;
  const existing = context.rules.find(
    (rule) => rule.kind === kind && rule.condition === text && rule.href === context.href,
  );
  if (existing) return existing;

  const created: MediaRuleRecord = {
    kind,
    condition: text,
    containerName,
    blocks: [],
    href: context.href,
  };
  context.rules.push(created);
  return created;
}

function addBlocks(context: WalkContext, selectors: string[], properties: string[]): void {
  const record = recordFor(context);
  if (!record) return;

  for (const selector of selectors) {
    if (selector === '') continue;
    const existing = record.blocks.find((block) => block.selector === selector);
    if (existing) {
      for (const property of properties) {
        if (!existing.properties.includes(property)) existing.properties.push(property);
      }
    } else {
      record.blocks.push({ selector, properties: [...properties] });
    }
  }
}

function walkRules(rules: ArrayLike<CssRuleLike> | undefined, context: WalkContext): void {
  if (!rules) return;

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule) continue;

    if (isMediaRule(rule) || isContainerRule(rule)) {
      const text = isMediaRule(rule)
        ? (rule.media?.mediaText ?? '')
        : (rule.containerQuery ?? rule.conditionText ?? '');
      const containerName =
        isContainerRule(rule) && rule.containerName ? rule.containerName : null;
      walkRules(rule.cssRules, {
        ...context,
        condition: {
          kind: isMediaRule(rule) ? 'media' : 'container',
          text: text.trim(),
          containerName,
        },
      });
      continue;
    }

    if (typeof rule.selectorText === 'string') {
      const selectors = splitTopLevel(rule.selectorText, 'comma').map((selector) =>
        composeNestedSelector(context.selectorContext, selector),
      );
      addBlocks(context, selectors, readProperties(rule.style));
      // A style rule can itself contain `@media` under CSS nesting.
      walkRules(rule.cssRules, { ...context, selectorContext: selectors.join(', ') });
      continue;
    }

    if (rule.style && context.selectorContext !== null) {
      // Declarations sitting directly inside a nested `@media` are exposed as a
      // rule with a style block but no selector of its own (`CSSNestedDeclarations`);
      // they belong to the selector we are nested inside.
      addBlocks(context, [context.selectorContext], readProperties(rule.style));
      continue;
    }

    if (rule.styleSheet) {
      // `@import`ed sheets are separate sheets and can be cross-origin.
      readSheet(rule.styleSheet, context.rules, context.unreadable);
      continue;
    }

    // `@supports`, `@layer` and friends: transparent to this walk.
    walkRules(rule.cssRules, context);
  }
}

function readSheet(
  sheet: StyleSheetLike,
  rules: MediaRuleRecord[],
  unreadable: UnreadableStyleSheet[],
): void {
  const href = sheet.href ?? null;
  let cssRules: ArrayLike<CssRuleLike> | undefined;

  try {
    cssRules = sheet.cssRules;
  } catch (error) {
    // Reading `cssRules` on a cross-origin sheet throws; that is the browser's
    // only signal, and it must not abort the whole scan.
    const name = error instanceof Error ? error.name : '';
    unreadable.push({
      href,
      reason: name === 'SecurityError' ? 'cross-origin' : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!cssRules) {
    unreadable.push({
      href,
      reason: 'unknown',
      message: 'stylesheet exposed no rules (not loaded yet, or disabled)',
    });
    return;
  }

  walkRules(cssRules, { href, selectorContext: null, condition: null, rules, unreadable });
}

/**
 * Walk stylesheets and collect every conditional rule.
 *
 * Takes the sheets rather than reaching for `document.styleSheets` so the same
 * function serves the extension, a test with hand-built rule objects, and any
 * future "analyze this stylesheet text" path.
 */
export function collectMediaRules(sheets: ArrayLike<StyleSheetLike>): MediaRuleScan {
  const rules: MediaRuleRecord[] = [];
  const unreadable: UnreadableStyleSheet[] = [];

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    if (sheet) readSheet(sheet, rules, unreadable);
  }

  return { rules, unreadable, styleSheetCount: sheets.length };
}

/** One condition that affects the inspected element. */
export interface Breakpoint {
  kind: 'media' | 'container';
  /** The condition verbatim. */
  condition: string;
  containerName: string | null;
  features: MediaFeature[];
  /** The width (or height) this breakpoint turns on at, when it has one. */
  pixelValue: number | null;
  /** `unknown` for container queries: `matchMedia` cannot evaluate them. */
  matches: 'yes' | 'no' | 'unknown';
  /** Properties this condition changes for the element or one of its ancestors. */
  properties: string[];
  /** The selectors that matched, so the developer knows which rule to open. */
  selectors: string[];
  /** Stylesheet URLs the rules came from. */
  sources: string[];
  summary: string;
}

/** The answer for one element. */
export interface BreakpointReport {
  breakpoints: Breakpoint[];
  unreadable: UnreadableStyleSheet[];
  /** Rules seen versus rules kept, so "none" can be distinguished from "none scanned". */
  scanned: { styleSheets: number; conditionalRules: number; matched: number };
  summary: string;
}

/** Decides whether a selector applies to the element or any of its ancestors. */
export type SelectorMatcher = (selector: string) => boolean;

/** Evaluates a media condition; returns null when it cannot be evaluated. */
export type ConditionEvaluator = (condition: string) => boolean | null;

function primaryPixelValue(features: readonly MediaFeature[]): number | null {
  for (const kind of ['min-width', 'max-width', 'min-height', 'max-height'] as const) {
    const found = features.find((feature) => feature.kind === kind);
    if (found && 'px' in found) return found.px;
  }
  return null;
}

function describeCondition(features: readonly MediaFeature[], condition: string): string {
  const parts: string[] = [];
  for (const feature of features) {
    switch (feature.kind) {
      case 'min-width':
        parts.push(`viewport ≥ ${feature.px}px`);
        break;
      case 'max-width':
        parts.push(`viewport ≤ ${feature.px}px`);
        break;
      case 'min-height':
        parts.push(`height ≥ ${feature.px}px`);
        break;
      case 'max-height':
        parts.push(`height ≤ ${feature.px}px`);
        break;
      case 'orientation':
        parts.push(feature.value);
        break;
      case 'preference':
        parts.push(`${feature.name}: ${feature.value}`);
        break;
      case 'media-type':
        parts.push(feature.value);
        break;
      case 'other':
        parts.push(feature.raw);
        break;
    }
  }
  return parts.length > 0 ? parts.join(' and ') : condition;
}

/**
 * Reduce a scan to the breakpoints that actually affect one element.
 *
 * Rules sharing a condition are merged, so a page that repeats
 * `@media (min-width: 768px)` in twelve files still reports one 768px
 * breakpoint with the union of what it changes.
 */
export function selectBreakpointsForElement(
  scan: MediaRuleScan,
  matches: SelectorMatcher,
  options: { evaluate?: ConditionEvaluator; rootFontSize?: number } = {},
): BreakpointReport {
  const rootFontSize = options.rootFontSize ?? 16;
  const merged = new Map<string, Breakpoint>();

  for (const rule of scan.rules) {
    const hits = rule.blocks.filter((block) => matches(block.selector));
    if (hits.length === 0) continue;

    const key = `${rule.kind}:${rule.condition}`;
    const features = parseMediaCondition(rule.condition, rootFontSize);
    const evaluated = rule.kind === 'media' ? (options.evaluate?.(rule.condition) ?? null) : null;

    const existing = merged.get(key) ?? {
      kind: rule.kind,
      condition: rule.condition,
      containerName: rule.containerName,
      features,
      pixelValue: primaryPixelValue(features),
      matches: evaluated === null ? 'unknown' : evaluated ? 'yes' : 'no',
      properties: [],
      selectors: [],
      sources: [],
      summary: '',
    };

    for (const block of hits) {
      if (!existing.selectors.includes(block.selector)) existing.selectors.push(block.selector);
      for (const property of block.properties) {
        if (!existing.properties.includes(property)) existing.properties.push(property);
      }
    }
    if (rule.href !== null && !existing.sources.includes(rule.href)) {
      existing.sources.push(rule.href);
    }

    merged.set(key, existing);
  }

  const breakpoints = [...merged.values()].sort((a, b) => {
    if (a.pixelValue === null && b.pixelValue === null) return a.condition.localeCompare(b.condition);
    if (a.pixelValue === null) return 1;
    if (b.pixelValue === null) return -1;
    return a.pixelValue - b.pixelValue;
  });

  for (const breakpoint of breakpoints) {
    breakpoint.properties.sort();
    const state =
      breakpoint.matches === 'yes'
        ? 'active now'
        : breakpoint.matches === 'no'
          ? 'not active'
          : 'cannot be evaluated from here';
    breakpoint.summary = `${describeCondition(breakpoint.features, breakpoint.condition)} (${state}) — changes ${
      breakpoint.properties.length > 0 ? breakpoint.properties.join(', ') : 'nothing this element uses'
    }`;
  }

  const summaryPieces: string[] = [];
  if (breakpoints.length === 0) {
    summaryPieces.push(
      `no breakpoints affect this element (${scan.rules.length} conditional rule(s) scanned)`,
    );
  } else {
    const widths = breakpoints
      .map((breakpoint) => (breakpoint.pixelValue === null ? breakpoint.condition : `${breakpoint.pixelValue}px`))
      .join(', ');
    summaryPieces.push(`${breakpoints.length} breakpoint(s) affect this element: ${widths}`);
  }
  if (scan.unreadable.length > 0) {
    summaryPieces.push(
      `${scan.unreadable.length} stylesheet(s) could not be read (${scan.unreadable
        .map((sheet) => sheet.reason)
        .join(', ')}), so this list may be incomplete`,
    );
  }

  return {
    breakpoints,
    unreadable: scan.unreadable,
    scanned: {
      styleSheets: scan.styleSheetCount,
      conditionalRules: scan.rules.length,
      matched: breakpoints.length,
    },
    summary: summaryPieces.join('; '),
  };
}

/** Options for the DOM-facing entry point. */
export interface BreakpointOptions {
  /** Defaults to the element's own document. */
  document?: Document;
  /** Used for `matchMedia`. Defaults to the global `window`. */
  view?: Window;
  /** Root font size for `em`-based media queries. Defaults to 16. */
  rootFontSize?: number;
}

/**
 * The element and every ancestor, since a media query on an ancestor changes
 * this element's layout just as surely as one on the element itself.
 */
function elementChain(element: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current) {
    chain.push(current);
    current = current.parentElement;
  }
  return chain;
}

/**
 * Find the breakpoints that affect an element, from the live document.
 *
 * `matches` is wrapped in try/catch per selector: stylesheets in the wild
 * contain vendor pseudo-classes and selector syntax the current browser cannot
 * parse, and one `SyntaxError` must not empty the whole report.
 */
export function discoverBreakpoints(
  element: Element,
  options: BreakpointOptions = {},
): BreakpointReport {
  const doc = options.document ?? element.ownerDocument;
  const view = options.view ?? doc.defaultView ?? window;
  const chain = elementChain(element);

  const scan = collectMediaRules(doc.styleSheets);

  const matcher: SelectorMatcher = (selector) => {
    const cleaned = stripPseudoElements(selector);
    if (cleaned === '') return false;
    return chain.some((candidate) => {
      try {
        return candidate.matches(cleaned);
      } catch {
        return false;
      }
    });
  };

  const evaluate: ConditionEvaluator = (condition) => {
    try {
      return view.matchMedia(condition).matches;
    } catch {
      return null;
    }
  };

  return selectBreakpointsForElement(scan, matcher, {
    evaluate,
    rootFontSize: options.rootFontSize ?? 16,
  });
}
