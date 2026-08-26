/**
 * Building a reusable index of every author rule on the page, and querying it
 * per element.
 *
 * Two constraints shape this file.
 *
 * The first is that `element.matches(selectorText)` over `document.styleSheets`
 * is the only route available — `getMatchedCSSRules` is gone. So the work is
 * O(rules) per element unless the rules are bucketed first, and a CSS-in-JS
 * page can easily ship 10,000+ of them. Hence the split: {@link buildStyleIndex}
 * walks the sheets once and keys every selector by the required id, class or
 * tag in its rightmost compound; {@link collectElementRules} then tests only the
 * handful of selectors that could possibly match. Callers are expected to build
 * the index once and reuse it across hovers.
 *
 * The second is that cross-origin stylesheets throw a `SecurityError` the
 * moment `.cssRules` is touched, and there is nothing to be done about it. Those
 * sheets are counted and reported rather than swallowed, so the UI can say the
 * list is incomplete instead of implying it is whole.
 */

import type { SelectorScore, Specificity } from './specificity.js';
import {
  compareSpecificity,
  resolveNestingSelector,
  scoreSelectorList,
  splitPseudoElement,
  tokenizeSelector,
} from './specificity.js';

/* -------------------------------------------------------------------------- */
/* Structural views of the CSSOM                                              */
/* -------------------------------------------------------------------------- */

/*
 * The walker is typed against the slice of the CSSOM it actually touches rather
 * than against `CSSStyleSheet`/`CSSRule`. Real DOM objects satisfy these
 * structurally, and tests can hand-build rule trees — including a sheet whose
 * `cssRules` getter throws, which is the case that matters most and which no
 * headless DOM will produce on its own.
 */

/** The parts of `CSSStyleDeclaration` needed to read a declaration block. */
export interface StyleDeclarationLike {
  readonly length: number;
  item(index: number): string;
  getPropertyValue(property: string): string;
  getPropertyPriority(property: string): string;
}

/** The parts of `CSSRule` and its subclasses the walker inspects. */
export interface RuleLike {
  readonly type?: number;
  readonly selectorText?: string;
  readonly style?: StyleDeclarationLike;
  readonly cssRules?: ArrayLike<RuleLike> | null;
  readonly conditionText?: string;
  readonly media?: { readonly mediaText?: string } | null;
  readonly name?: string;
  readonly nameList?: ArrayLike<string>;
  readonly containerName?: string;
  readonly containerQuery?: string;
  readonly start?: string | null;
  readonly end?: string | null;
  readonly styleSheet?: StyleSheetLike | null;
  readonly layerName?: string | null;
}

/** The parts of `CSSStyleSheet` the walker inspects. */
export interface StyleSheetLike {
  readonly href?: string | null;
  /** Accessing this on a cross-origin sheet throws; never read it directly. */
  readonly cssRules?: ArrayLike<RuleLike> | null;
  /** Typed loosely: a sheet can be owned by a `<style>`, a `<link>`, or an XML processing instruction. */
  readonly ownerNode?: unknown;
  readonly disabled?: boolean;
  readonly title?: string | null;
}

/** A `Document` or `ShadowRoot` — anything that owns stylesheets. */
export interface StyleSheetHost {
  readonly styleSheets: ArrayLike<StyleSheetLike>;
  readonly adoptedStyleSheets?: ArrayLike<StyleSheetLike>;
}

/* -------------------------------------------------------------------------- */
/* Result shapes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How a sheet reached the page.
 *
 * `injected` is deliberately distinct from `inline`: a `<style>` element the
 * author wrote and one a CSS-in-JS runtime created are indistinguishable at
 * runtime, so `injected` is reserved for sheets with no owner node at all.
 */
export type StyleSheetKind = 'linked' | 'inline' | 'injected' | 'adopted' | 'imported';

/** Identification of one stylesheet, stable for the lifetime of an index. */
export interface SheetOrigin {
  readonly id: number;
  /** Absolute URL, or `null` for `<style>`, constructed and adopted sheets. */
  readonly href: string | null;
  readonly kind: StyleSheetKind;
  /** Short label for the UI: the file name, `<style>`, `adopted`, `injected`. */
  readonly label: string;
  readonly disabled: boolean;
}

/** A single `property: value` pair, with its `!important` flag. */
export interface CssDeclaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

/** An at-rule wrapped around a style rule. */
export interface RuleCondition {
  readonly kind: 'media' | 'supports' | 'container' | 'scope' | 'starting-style' | 'other';
  readonly text: string;
  /**
   * `null` when the condition genuinely cannot be evaluated here — container
   * queries depend on the element being matched, `@scope` on tree position.
   * Reported as unknown rather than assumed true.
   */
  readonly applies: boolean | null;
}

/** Whether a rule's surrounding at-rules currently let it through. */
export type ConditionState = 'applies' | 'excluded' | 'indeterminate';

/** A cascade layer, ranked against the other layers in the same index. */
export interface LayerRef {
  /** Dotted full name, e.g. `components.button`. Empty for an anonymous `@layer {}`. */
  readonly name: string;
  /**
   * Priority rank. Higher means declared later, which for normal declarations
   * means stronger; {@link ./resolve.js} reverses it for `!important`.
   */
  readonly order: number;
}

/** One part of a rule's selector list, prepared for matching. */
export interface IndexedSelector extends SelectorScore {
  /** The part `element.matches()` is given: `selector` minus any pseudo-element. */
  readonly matchText: string;
  /** e.g. `::before`, or `null`. */
  readonly pseudoElement: string | null;
}

/** A style rule, flattened out of its at-rule nesting. */
export interface IndexedRule {
  readonly id: number;
  readonly selectorText: string;
  readonly selectors: readonly IndexedSelector[];
  readonly declarations: readonly CssDeclaration[];
  readonly sheet: SheetOrigin;
  /** `null` for unlayered author styles, which outrank every layer. */
  readonly layer: LayerRef | null;
  readonly conditions: readonly RuleCondition[];
  readonly conditionState: ConditionState;
  /** Position in flattened document order. Later wins ties in the cascade. */
  readonly order: number;
}

/** A rule paired with one of its selector parts, as stored in a bucket. */
export interface IndexEntry {
  readonly rule: IndexedRule;
  readonly selector: IndexedSelector;
}

/** A sheet whose contents could not be read, and why. */
export interface UnreadableSheet {
  readonly href: string | null;
  /** `security` is the cross-origin case; anything else is `error`. */
  readonly reason: 'security' | 'error';
  readonly message: string;
}

/** Selector buckets keyed by the one thing a matching element must have. */
export interface SelectorBuckets {
  readonly byId: ReadonlyMap<string, readonly IndexEntry[]>;
  readonly byClass: ReadonlyMap<string, readonly IndexEntry[]>;
  readonly byTag: ReadonlyMap<string, readonly IndexEntry[]>;
  /** Selectors with no keyable requirement — tested against every element. */
  readonly universal: readonly IndexEntry[];
}

/** Everything one pass over the stylesheets produced. Build once, query often. */
export interface StyleIndex {
  readonly rules: readonly IndexedRule[];
  readonly sheets: readonly SheetOrigin[];
  readonly layers: readonly LayerRef[];
  /** Sheets that threw on `.cssRules`. Non-empty means results are incomplete. */
  readonly unreadable: readonly UnreadableSheet[];
  /** True when `maxRules` was reached and the tail of the document was skipped. */
  readonly truncated: boolean;
  readonly buckets: SelectorBuckets;
  readonly selectorCount: number;
}

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

/** Evaluates an at-rule condition, or returns `null` when it cannot. */
export type ConditionEvaluator = (kind: RuleCondition['kind'], text: string) => boolean | null;

/** Tuning for {@link buildStyleIndex}. */
export interface IndexOptions {
  /** Hard cap on indexed rules. Default 20000; pathological pages exceed it. */
  readonly maxRules?: number;
  /** Nesting depth cap for grouping rules. Default 32. */
  readonly maxDepth?: number;
  /** Follow `@import`ed sheets. Default true; they can be cross-origin too. */
  readonly followImports?: boolean;
  /** Omit to leave every condition indeterminate (the pure, DOM-free default). */
  readonly evaluateCondition?: ConditionEvaluator;
}

const DEFAULT_MAX_RULES = 20_000;
const DEFAULT_MAX_DEPTH = 32;

/* -------------------------------------------------------------------------- */
/* Reading declarations                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Read a declaration block into plain data.
 *
 * Whether a shorthand appears as `margin` or as four longhands is an engine
 * detail that differs between browsers; both are reported faithfully rather
 * than normalized, because guessing at expansion is how an inspector starts
 * lying about what the author wrote.
 */
export function readDeclarations(style: StyleDeclarationLike | undefined): CssDeclaration[] {
  if (!style) return [];

  const declarations: CssDeclaration[] = [];
  const length = Number.isFinite(style.length) ? style.length : 0;

  for (let index = 0; index < length; index += 1) {
    let property: string;
    try {
      property = style.item(index);
    } catch {
      continue;
    }
    if (!property) continue;

    declarations.push({
      property,
      value: style.getPropertyValue(property),
      important: style.getPropertyPriority(property) === 'important',
    });
  }

  return declarations;
}

/**
 * Read an element's `style` attribute.
 *
 * Element-attached declarations outrank every style rule of the same
 * importance, so they are collected separately rather than folded in as a
 * pseudo-rule with an invented specificity.
 */
export function readInlineDeclarations(element: Element): CssDeclaration[] {
  const style = (element as Partial<ElementCSSInlineStyle>).style;
  return readDeclarations(style as StyleDeclarationLike | undefined);
}

/* -------------------------------------------------------------------------- */
/* Sheet classification                                                       */
/* -------------------------------------------------------------------------- */

function fileNameFromHref(href: string): string {
  const withoutQuery = href.split(/[?#]/, 1)[0] ?? href;
  const segments = withoutQuery.split('/');
  const last = segments[segments.length - 1] ?? '';
  return last === '' ? href : last;
}

/** Read `ownerNode.tagName` without assuming the owner is an element at all. */
function ownerTagName(ownerNode: unknown): string {
  if (!ownerNode || typeof ownerNode !== 'object') return '';
  if (!('tagName' in ownerNode)) return '';
  const tagName = (ownerNode as { readonly tagName?: unknown }).tagName;
  return typeof tagName === 'string' ? tagName.toUpperCase() : '';
}

/**
 * Work out where a sheet came from.
 *
 * `kindHint` exists because adopted and `@import`ed sheets are
 * indistinguishable from injected ones by inspection — only the caller that
 * walked to them knows.
 */
export function describeSheet(
  sheet: StyleSheetLike,
  id: number,
  kindHint: StyleSheetKind | null = null,
): SheetOrigin {
  const href = sheet.href ?? null;
  const ownerTag = ownerTagName(sheet.ownerNode);

  let kind: StyleSheetKind;
  if (kindHint) kind = kindHint;
  else if (href) kind = 'linked';
  else if (ownerTag === 'STYLE') kind = 'inline';
  else kind = 'injected';

  let label: string;
  if (href) label = fileNameFromHref(href);
  else if (kind === 'adopted') label = 'adopted';
  else if (kind === 'inline') label = '<style>';
  else label = 'injected';

  return { id, href, kind, label, disabled: sheet.disabled === true };
}

/**
 * Read `sheet.cssRules` without letting one sheet abort the walk.
 *
 * A cross-origin sheet throws `SecurityError` here, every time, with no way to
 * opt in short of a CORS header the page does not control. Returning the
 * failure as data is what lets the UI admit the gap.
 */
export function readSheetRules(
  sheet: StyleSheetLike,
): { readonly rules: readonly RuleLike[] } | { readonly unreadable: UnreadableSheet } {
  try {
    return { rules: toRuleArray(sheet.cssRules) };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    return {
      unreadable: {
        href: sheet.href ?? null,
        reason: name === 'SecurityError' ? 'security' : 'error',
        message,
      },
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Rule classification                                                        */
/* -------------------------------------------------------------------------- */

/** What the walker decided a CSSOM rule is. */
export type RuleShape =
  | { readonly kind: 'style' }
  | { readonly kind: 'layer-block'; readonly name: string }
  | { readonly kind: 'layer-statement'; readonly names: readonly string[] }
  | { readonly kind: 'condition'; readonly condition: Omit<RuleCondition, 'applies'> }
  | { readonly kind: 'import'; readonly layerName: string | null }
  | { readonly kind: 'ignore' };

const CSSOM_PAGE_RULE = 6;
const CSSOM_KEYFRAMES_RULE = 7;

/**
 * Identify a rule by shape rather than by `instanceof`.
 *
 * `CSSLayerBlockRule`, `CSSContainerRule` and `CSSScopeRule` are missing from
 * older engines and from every headless DOM, so an `instanceof` chain would
 * quietly classify half of a modern stylesheet as "ignore". The numeric `type`
 * property is only consulted where it disambiguates — it is 0 for everything
 * added after it was deprecated.
 */
export function classifyRule(rule: RuleLike): RuleShape {
  if (rule.type === CSSOM_PAGE_RULE) return { kind: 'ignore' };

  if (typeof rule.selectorText === 'string' && rule.style) return { kind: 'style' };

  if (rule.styleSheet) return { kind: 'import', layerName: rule.layerName ?? null };

  const nameList = rule.nameList;
  if (nameList) {
    const names: string[] = [];
    for (let index = 0; index < nameList.length; index += 1) names.push(nameList[index] ?? '');
    return { kind: 'layer-statement', names };
  }

  if (!rule.cssRules) return { kind: 'ignore' };

  // `@keyframes` also carries a `name` and child rules, but its children are
  // keyframes, not style rules, and must never reach the selector matcher.
  if (rule.type === CSSOM_KEYFRAMES_RULE) return { kind: 'ignore' };

  if (typeof rule.name === 'string' && rule.conditionText === undefined) {
    return { kind: 'layer-block', name: rule.name };
  }

  if (rule.containerQuery !== undefined || rule.containerName !== undefined) {
    const name = rule.containerName ? `${rule.containerName} ` : '';
    return {
      kind: 'condition',
      condition: { kind: 'container', text: `${name}${rule.containerQuery ?? rule.conditionText ?? ''}`.trim() },
    };
  }

  const mediaText = rule.media?.mediaText;
  if (typeof mediaText === 'string' && mediaText !== '') {
    return { kind: 'condition', condition: { kind: 'media', text: mediaText } };
  }

  if (typeof rule.conditionText === 'string') {
    return { kind: 'condition', condition: { kind: 'supports', text: rule.conditionText } };
  }

  if (rule.start !== undefined || rule.end !== undefined) {
    const start = rule.start ?? '';
    const end = rule.end ? ` to (${rule.end})` : '';
    return { kind: 'condition', condition: { kind: 'scope', text: `${start}${end}`.trim() } };
  }

  // A grouping rule we do not recognise — `@starting-style` today, something
  // else next year. Recurse into it, but flag that its condition is unknown.
  return { kind: 'condition', condition: { kind: 'starting-style', text: '' } };
}

/** Collapse a rule's conditions into a single verdict. */
export function summarizeConditions(conditions: readonly RuleCondition[]): ConditionState {
  let indeterminate = false;
  for (const condition of conditions) {
    if (condition.applies === false) return 'excluded';
    if (condition.applies === null) indeterminate = true;
  }
  return indeterminate ? 'indeterminate' : 'applies';
}

/* -------------------------------------------------------------------------- */
/* Layer ordering                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Internal marker for an anonymous `@layer {}`.
 *
 * Each anonymous block is a separate layer, so it needs a distinct path
 * segment to keep the ranks apart. `#` cannot appear in a CSS identifier, so
 * the marker can never collide with a layer the author actually named.
 */
const ANONYMOUS_LAYER_PREFIX = 'anonymous#';

/** Turn an internal layer path back into something worth putting on screen. */
export function displayLayerName(internalName: string): string {
  return internalName
    .split('.')
    .map((segment) => (segment.startsWith(ANONYMOUS_LAYER_PREFIX) ? '(anonymous)' : segment))
    .join('.');
}

/**
 * Rank layers the way the cascade does, from the order they were first named.
 *
 * Two rules make this more than a running counter. Sublayers sort inside their
 * parent, so `@layer a; @layer b; @layer a.x` puts `a.x` below `b`, not above
 * it. And a layer's own declarations behave as an implicit final sublayer, so
 * `a` outranks `a.x`. Both fall out of a depth-first walk that numbers children
 * before their parent.
 */
export function rankLayers(declaredNames: readonly string[]): Map<string, number> {
  interface Node {
    readonly children: Map<string, Node>;
    declared: boolean;
  }

  const root: Node = { children: new Map(), declared: false };

  for (const fullName of declaredNames) {
    let node = root;
    for (const segment of fullName.split('.')) {
      let next = node.children.get(segment);
      if (!next) {
        next = { children: new Map(), declared: false };
        node.children.set(segment, next);
      }
      node = next;
    }
    node.declared = true;
  }

  const ranks = new Map<string, number>();
  let counter = 0;

  const visit = (node: Node, path: readonly string[]): void => {
    for (const [segment, child] of node.children) visit(child, [...path, segment]);
    if (path.length > 0) {
      ranks.set(path.join('.'), counter);
      counter += 1;
    }
  };

  visit(root, []);
  return ranks;
}

/* -------------------------------------------------------------------------- */
/* Indexing                                                                   */
/* -------------------------------------------------------------------------- */

/** The one thing an element must have for a selector to stand a chance. */
export type MatchKey =
  | { readonly kind: 'id'; readonly value: string }
  | { readonly kind: 'class'; readonly value: string }
  | { readonly kind: 'tag'; readonly value: string }
  | { readonly kind: 'universal' };

/**
 * The cheapest necessary condition for a selector to match, taken from its
 * rightmost compound.
 *
 * Only requirements that are unconditionally present count: an id or class
 * inside `:not()` or `:is()` is not required, so anything built from a
 * functional pseudo falls back to `universal` and gets tested against every
 * element. Being conservative here costs a little speed; being clever here
 * costs correctness.
 */
export function selectorMatchKey(selector: string): MatchKey {
  const tokens = tokenizeSelector(selector);

  let start = 0;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index]?.kind === 'combinator') {
      start = index + 1;
      break;
    }
  }

  let tag: string | null = null;
  let className: string | null = null;

  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.kind === 'id') return { kind: 'id', value: token.name };
    if (token.kind === 'class' && className === null) className = token.name;
    if (token.kind === 'type' && tag === null) tag = token.name;
  }

  if (className !== null) return { kind: 'class', value: className };
  if (tag !== null) return { kind: 'tag', value: tag.toLowerCase() };
  return { kind: 'universal' };
}

interface DraftRule {
  readonly selectorText: string;
  readonly selectors: readonly IndexedSelector[];
  readonly declarations: readonly CssDeclaration[];
  readonly sheet: SheetOrigin;
  readonly layerName: string | null;
  readonly conditions: readonly RuleCondition[];
}

interface WalkState {
  readonly drafts: DraftRule[];
  readonly sheets: SheetOrigin[];
  readonly unreadable: UnreadableSheet[];
  readonly layerNames: string[];
  readonly seenSheets: Set<StyleSheetLike>;
  readonly maxRules: number;
  readonly maxDepth: number;
  readonly followImports: boolean;
  readonly evaluate: ConditionEvaluator | null;
  anonymousLayers: number;
  truncated: boolean;
  nextSheetId: number;
}

interface WalkContext {
  readonly sheet: SheetOrigin;
  readonly layerPath: readonly string[];
  readonly conditions: readonly RuleCondition[];
  readonly depth: number;
  /** Parent selector text, present only inside a nested style rule. */
  readonly parentSelector: string | null;
  readonly parentSpecificity: Specificity | null;
}

function registerLayer(state: WalkState, name: string): void {
  if (!state.layerNames.includes(name)) state.layerNames.push(name);
}

function buildCondition(
  state: WalkState,
  shape: Omit<RuleCondition, 'applies'>,
): RuleCondition {
  // Container and scope conditions depend on the element being inspected, so
  // they stay unknown at index time no matter what evaluator is supplied.
  const evaluable = shape.kind === 'media' || shape.kind === 'supports';
  const applies = evaluable && state.evaluate ? state.evaluate(shape.kind, shape.text) : null;
  return { kind: shape.kind, text: shape.text, applies };
}

function buildSelectors(
  selectorText: string,
  context: WalkContext,
): { readonly text: string; readonly selectors: IndexedSelector[] } {
  const resolvedText =
    context.parentSelector === null
      ? selectorText
      : resolveNestingSelector(selectorText, context.parentSelector);

  const options = context.parentSpecificity ? { nesting: context.parentSpecificity } : {};

  const selectors = scoreSelectorList(resolvedText, options).map((score): IndexedSelector => {
    const split = splitPseudoElement(score.selector);
    return {
      selector: score.selector,
      specificity: score.specificity,
      exact: score.exact,
      matchText: split.base,
      pseudoElement: split.pseudoElement,
    };
  });

  return { text: resolvedText, selectors };
}

function walkRules(rules: readonly RuleLike[], context: WalkContext, state: WalkState): void {
  if (context.depth > state.maxDepth) return;

  for (const rule of rules) {
    if (state.drafts.length >= state.maxRules) {
      state.truncated = true;
      return;
    }
    if (!rule) continue;

    const shape = classifyRule(rule);

    switch (shape.kind) {
      case 'ignore':
        break;

      case 'layer-statement':
        for (const name of shape.names) {
          const trimmed = name.trim();
          if (trimmed !== '') registerLayer(state, trimmed);
        }
        break;

      case 'layer-block': {
        // An anonymous `@layer {}` is its own layer every time it appears, so
        // it needs a synthetic path segment to keep the ranks distinct.
        let segment = shape.name.trim();
        if (segment === '') {
          state.anonymousLayers += 1;
          segment = `${ANONYMOUS_LAYER_PREFIX}${state.anonymousLayers}`;
        }
        const layerPath = [...context.layerPath, ...segment.split('.')];
        registerLayer(state, layerPath.join('.'));
        walkRules(toRuleArray(rule.cssRules), { ...context, layerPath, depth: context.depth + 1 }, state);
        break;
      }

      case 'condition': {
        const condition = buildCondition(state, shape.condition);
        walkRules(
          toRuleArray(rule.cssRules),
          { ...context, conditions: [...context.conditions, condition], depth: context.depth + 1 },
          state,
        );
        break;
      }

      case 'import': {
        if (!state.followImports) break;
        const imported = rule.styleSheet;
        if (!imported || state.seenSheets.has(imported)) break;
        // `@import url(x) layer(theme)` puts the whole sheet in a layer.
        const layerName = shape.layerName?.trim() ?? '';
        const layerPath =
          layerName === '' ? context.layerPath : [...context.layerPath, ...layerName.split('.')];
        if (layerName !== '') registerLayer(state, layerPath.join('.'));
        walkSheet(imported, 'imported', state, {
          layerPath,
          conditions: context.conditions,
          depth: context.depth + 1,
        });
        break;
      }

      case 'style': {
        const { text, selectors } = buildSelectors(rule.selectorText ?? '', context);
        const declarations = readDeclarations(rule.style);

        if (selectors.length > 0 && declarations.length > 0) {
          state.drafts.push({
            selectorText: text,
            selectors,
            declarations,
            sheet: context.sheet,
            layerName: context.layerPath.length > 0 ? context.layerPath.join('.') : null,
            conditions: context.conditions,
          });
        }

        // CSS nesting: a style rule can contain further style rules whose
        // `selectorText` still carries `&`.
        const nested = toRuleArray(rule.cssRules);
        if (nested.length > 0) {
          const specificities = selectors.map((selector) => selector.specificity);
          let best: Specificity = [0, 0, 0, 0];
          for (const value of specificities) {
            if (compareSpecificity(value, best) > 0) best = value;
          }
          walkRules(
            nested,
            {
              ...context,
              depth: context.depth + 1,
              parentSelector: text,
              parentSpecificity: best,
            },
            state,
          );
        }
        break;
      }
    }
  }
}

function toRuleArray(list: ArrayLike<RuleLike> | null | undefined): RuleLike[] {
  if (!list) return [];
  const length = Number.isFinite(list.length) ? list.length : 0;
  const out: RuleLike[] = [];
  for (let index = 0; index < length; index += 1) {
    const rule = list[index];
    if (rule) out.push(rule);
  }
  return out;
}

function walkSheet(
  sheet: StyleSheetLike,
  kindHint: StyleSheetKind | null,
  state: WalkState,
  inherited: {
    readonly layerPath: readonly string[];
    readonly conditions: readonly RuleCondition[];
    readonly depth: number;
  },
): void {
  if (state.seenSheets.has(sheet)) return;
  state.seenSheets.add(sheet);

  const origin = describeSheet(sheet, state.nextSheetId, kindHint);
  state.nextSheetId += 1;
  state.sheets.push(origin);

  // A disabled sheet contributes nothing to the cascade, and reading it would
  // put rules in the results that do not apply.
  if (origin.disabled) return;

  const read = readSheetRules(sheet);
  if ('unreadable' in read) {
    state.unreadable.push(read.unreadable);
    return;
  }

  walkRules(
    read.rules,
    {
      sheet: origin,
      layerPath: inherited.layerPath,
      conditions: inherited.conditions,
      depth: inherited.depth,
      parentSelector: null,
      parentSpecificity: null,
    },
    state,
  );
}

/** A sheet plus what the caller knows about how it got here. */
export interface SheetInput {
  readonly sheet: StyleSheetLike;
  /** `null` to classify from the sheet itself. */
  readonly kind: StyleSheetKind | null;
}

/**
 * Walk every sheet once and bucket its selectors.
 *
 * This is the expensive call — do it once per page (or once per mutation
 * batch), then hand the result to {@link collectElementRules} for each element.
 * Re-walking the CSSOM on every hover is what makes naive inspectors stutter on
 * CSS-in-JS pages.
 */
export function buildStyleIndex(
  sheets: Iterable<SheetInput>,
  options: IndexOptions = {},
): StyleIndex {
  const state: WalkState = {
    drafts: [],
    sheets: [],
    unreadable: [],
    layerNames: [],
    seenSheets: new Set(),
    maxRules: options.maxRules ?? DEFAULT_MAX_RULES,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    followImports: options.followImports ?? true,
    evaluate: options.evaluateCondition ?? null,
    anonymousLayers: 0,
    truncated: false,
    nextSheetId: 0,
  };

  for (const input of sheets) {
    if (!input?.sheet) continue;
    walkSheet(input.sheet, input.kind, state, { layerPath: [], conditions: [], depth: 0 });
  }

  // Layer ranks are only knowable once every `@layer` in the document has been
  // seen, so rules are drafted first and finalized here.
  const ranks = rankLayers(state.layerNames);
  const layers: LayerRef[] = [];
  const layerByName = new Map<string, LayerRef>();
  for (const [name, order] of ranks) {
    const ref: LayerRef = { name: displayLayerName(name), order };
    layerByName.set(name, ref);
    layers.push(ref);
  }
  layers.sort((a, b) => a.order - b.order);

  const rules: IndexedRule[] = state.drafts.map((draft, order) => ({
    id: order,
    selectorText: draft.selectorText,
    selectors: draft.selectors,
    declarations: draft.declarations,
    sheet: draft.sheet,
    layer: draft.layerName === null ? null : (layerByName.get(draft.layerName) ?? null),
    conditions: draft.conditions,
    conditionState: summarizeConditions(draft.conditions),
    order,
  }));

  const byId = new Map<string, IndexEntry[]>();
  const byClass = new Map<string, IndexEntry[]>();
  const byTag = new Map<string, IndexEntry[]>();
  const universal: IndexEntry[] = [];
  let selectorCount = 0;

  const bucketFor = (map: Map<string, IndexEntry[]>, key: string): IndexEntry[] => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    return bucket;
  };

  for (const rule of rules) {
    for (const selector of rule.selectors) {
      selectorCount += 1;
      const entry: IndexEntry = { rule, selector };
      const key = selectorMatchKey(selector.matchText);
      if (key.kind === 'id') bucketFor(byId, key.value).push(entry);
      else if (key.kind === 'class') bucketFor(byClass, key.value).push(entry);
      else if (key.kind === 'tag') bucketFor(byTag, key.value).push(entry);
      else universal.push(entry);
    }
  }

  return {
    rules,
    sheets: state.sheets,
    layers,
    unreadable: state.unreadable,
    truncated: state.truncated,
    buckets: { byId, byClass, byTag, universal },
    selectorCount,
  };
}

/** Collect the sheet inputs of a document or shadow root, tagging adopted ones. */
export function sheetInputsFrom(host: StyleSheetHost): SheetInput[] {
  const inputs: SheetInput[] = [];

  const own = host.styleSheets;
  const ownLength = own && Number.isFinite(own.length) ? own.length : 0;
  for (let index = 0; index < ownLength; index += 1) {
    const sheet = own[index];
    if (sheet) inputs.push({ sheet, kind: null });
  }

  const adopted = host.adoptedStyleSheets;
  const adoptedLength = adopted && Number.isFinite(adopted.length) ? adopted.length : 0;
  for (let index = 0; index < adoptedLength; index += 1) {
    const sheet = adopted?.[index];
    if (sheet) inputs.push({ sheet, kind: 'adopted' });
  }

  return inputs;
}

/**
 * The two globals condition evaluation needs.
 *
 * Declared structurally rather than as `Window` because `CSS` lives on the
 * global scope, not on the `Window` interface, and because tests need to pass
 * a stub.
 */
export interface ConditionHost {
  matchMedia?(query: string): { readonly matches: boolean };
  CSS?: { supports(condition: string): boolean };
}

/**
 * Evaluate `@media` and `@supports` against a real window.
 *
 * Kept as an injectable function so the index stays testable without a browser,
 * and so a caller that does not care about condition state pays nothing.
 * The result is a snapshot: a viewport resize invalidates the index.
 */
export function createConditionEvaluator(view: ConditionHost = window): ConditionEvaluator {
  return (kind, text) => {
    if (text === '') return null;
    try {
      if (kind === 'media') return view.matchMedia?.(text)?.matches ?? null;
      if (kind === 'supports') return view.CSS?.supports(text) ?? null;
    } catch {
      // A malformed condition throws rather than returning false. Unknown is
      // the honest answer; false would hide a rule that may well apply.
      return null;
    }
    return null;
  };
}

/** Index the stylesheets of a document or shadow root. */
export function indexStyleSheets(
  host: StyleSheetHost = document,
  options: IndexOptions = {},
): StyleIndex {
  return buildStyleIndex(sheetInputsFrom(host), options);
}

/* -------------------------------------------------------------------------- */
/* Querying                                                                   */
/* -------------------------------------------------------------------------- */

/** The bucket keys an element carries. */
export interface ElementKeys {
  readonly tagName: string;
  readonly id: string | null;
  readonly classNames: readonly string[];
}

/** Read the bucket keys off an element. `classList` is used because `className` is not a string on SVG. */
export function elementKeys(element: Element): ElementKeys {
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id ? element.id : null,
    classNames: Array.from(element.classList),
  };
}

/**
 * The selectors worth testing against an element, in document order.
 *
 * This is where the index earns its keep: on a 10,000-rule page an element with
 * two classes typically pulls a few dozen candidates instead of all 10,000.
 */
export function candidateEntries(index: StyleIndex, keys: ElementKeys): IndexEntry[] {
  const candidates: IndexEntry[] = [];
  const push = (entries: readonly IndexEntry[] | undefined): void => {
    if (entries) candidates.push(...entries);
  };

  push(index.buckets.universal);
  if (keys.id !== null) push(index.buckets.byId.get(keys.id));
  push(index.buckets.byTag.get(keys.tagName.toLowerCase()));

  const seenClasses = new Set<string>();
  for (const className of keys.classNames) {
    if (seenClasses.has(className)) continue;
    seenClasses.add(className);
    push(index.buckets.byClass.get(className));
  }

  candidates.sort((a, b) => a.rule.order - b.rule.order);
  return candidates;
}

/** Tests one selector against whatever element the caller has in hand. */
export type SelectorMatcher = (selector: string) => boolean;

/** A rule that matched, and the selector-list part responsible. */
export interface MatchedRule {
  readonly rule: IndexedRule;
  readonly matched: IndexedSelector;
  readonly specificity: Specificity;
  /** `null` for the element itself; `::before` etc. for generated content. */
  readonly pseudoElement: string | null;
  readonly conditionState: ConditionState;
}

/**
 * Reduce candidate entries to matched rules.
 *
 * A rule appears once per pseudo-element it targets, carrying the most specific
 * of its matching selector parts — `#a, p { }` matching a `p#a` contributes
 * `1,0,0`, not two separate entries and not `0,0,1`.
 */
export function matchEntries(
  entries: readonly IndexEntry[],
  matches: SelectorMatcher,
): MatchedRule[] {
  const best = new Map<string, MatchedRule>();

  for (const entry of entries) {
    if (!matches(entry.selector.matchText)) continue;

    const key = `${entry.rule.id}|${entry.selector.pseudoElement ?? ''}`;
    const existing = best.get(key);
    if (existing && compareSpecificity(existing.specificity, entry.selector.specificity) >= 0) {
      continue;
    }

    best.set(key, {
      rule: entry.rule,
      matched: entry.selector,
      specificity: entry.selector.specificity,
      pseudoElement: entry.selector.pseudoElement,
      conditionState: entry.rule.conditionState,
    });
  }

  return Array.from(best.values()).sort((a, b) => a.rule.order - b.rule.order);
}

/**
 * `element.matches`, made safe.
 *
 * Legacy and vendor-prefixed selectors (`:-moz-any`, `::-webkit-scrollbar`, an
 * `@import`ed sheet full of hacks) make `matches` throw `SyntaxError`. One bad
 * selector must cost that selector, not the whole result set.
 */
export function createElementMatcher(element: Element): SelectorMatcher {
  return (selector) => {
    if (selector === '') return false;
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  };
}

/** Everything known about one element's author styles. */
export interface ElementRuleSet {
  readonly inline: readonly CssDeclaration[];
  readonly matched: readonly MatchedRule[];
  /** Non-zero means the answer is incomplete — say so in the UI. */
  readonly unreadableSheetCount: number;
  /** True when the index hit its rule cap before the end of the document. */
  readonly truncated: boolean;
  /** Candidates actually tested, against the total indexed. Useful for tuning. */
  readonly candidatesTested: number;
}

/** Match an element against a prebuilt index. Cheap enough to run per hover. */
export function collectElementRules(element: Element, index: StyleIndex): ElementRuleSet {
  const candidates = candidateEntries(index, elementKeys(element));
  return {
    inline: readInlineDeclarations(element),
    matched: matchEntries(candidates, createElementMatcher(element)),
    unreadableSheetCount: index.unreadable.length,
    truncated: index.truncated,
    candidatesTested: candidates.length,
  };
}
