/**
 * Cascade resolution: given every declaration that reaches an element, decide
 * which one wins each property and in what order the rest were beaten.
 *
 * The sorting rules are the part people get wrong, so they are stated once here
 * and implemented in exactly one comparator:
 *
 *   1. `!important` beats normal. Always, before anything else is considered.
 *   2. Element-attached (`style` attribute) beats any style rule of the same
 *      importance. This is why `style="color:red"` loses to
 *      `#a { color: blue !important }` but wins against `#a { color: blue }`.
 *   3. Layers. For normal declarations, later layers win and unlayered styles
 *      win over all of them. For `!important` the order reverses: earlier
 *      layers win, and unlayered important styles lose to every layer. That
 *      reversal is the single most surprising thing about `@layer`.
 *   4. Specificity.
 *   5. Document order, last one wins.
 *
 * Everything here works on plain data so it can be tested exhaustively without
 * a browser; {@link explainElementCascade} is the thin DOM-facing wrapper.
 */

import type { Specificity } from './specificity.js';
import { INLINE_SPECIFICITY, compareSpecificity } from './specificity.js';
import type { ElementRuleSet, StyleIndex } from './collect.js';
import { collectElementRules } from './collect.js';

/** What became of a declaration once the cascade ran. */
export type DeclarationStatus = 'winning' | 'overridden' | 'invalid';

/** One declaration, reduced to everything the cascade actually sorts on. */
export interface CascadeDeclaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  /** True for `style` attribute declarations, which outrank every style rule. */
  readonly elementAttached: boolean;
  /** Layer rank from the index; `null` for unlayered author styles. */
  readonly layerOrder: number | null;
  readonly specificity: Specificity;
  /**
   * Strictly increasing position in document order. Must be unique per
   * declaration, not per rule — `color: red; color: blue` in one block is
   * decided by this and nothing else.
   */
  readonly order: number;
  /** Back-reference into {@link StyleIndex.rules}; `null` for the style attribute. */
  readonly ruleId: number | null;
}

/** A declaration with the verdict attached. */
export interface ResolvedDeclaration extends CascadeDeclaration {
  readonly status: DeclarationStatus;
}

/** Every declaration that targeted one property, strongest first. */
export interface PropertyCascade {
  readonly property: string;
  /** `null` only when every declaration for the property was rejected as invalid. */
  readonly winner: ResolvedDeclaration | null;
  /** Sorted strongest first, so `declarations[0]` is the winner unless it was invalid. */
  readonly declarations: readonly ResolvedDeclaration[];
}

/** The per-property view the UI renders. */
export interface CascadeResult {
  /** Alphabetical by property, so the panel does not reshuffle between hovers. */
  readonly properties: readonly PropertyCascade[];
  readonly byProperty: ReadonlyMap<string, PropertyCascade>;
}

/**
 * Where unlayered declarations sit relative to layers.
 *
 * Normal unlayered styles behave as a final layer (they win); important
 * unlayered styles behave as a first one (they lose). Expressing both as a rank
 * lets one subtraction handle the reversal instead of four branches.
 */
function layerRank(declaration: CascadeDeclaration): number {
  if (declaration.layerOrder === null) {
    return declaration.important ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  return declaration.important ? -declaration.layerOrder : declaration.layerOrder;
}

/**
 * Order two declarations by cascade priority. Positive means `a` wins.
 *
 * Ranks are compared for inequality rather than subtracted, because two
 * unlayered normal declarations would otherwise produce `Infinity - Infinity`.
 */
export function compareCascade(a: CascadeDeclaration, b: CascadeDeclaration): number {
  if (a.important !== b.important) return a.important ? 1 : -1;
  if (a.elementAttached !== b.elementAttached) return a.elementAttached ? 1 : -1;

  const rankA = layerRank(a);
  const rankB = layerRank(b);
  if (rankA !== rankB) return rankA > rankB ? 1 : -1;

  const specificity = compareSpecificity(a.specificity, b.specificity);
  if (specificity !== 0) return specificity;

  if (a.order !== b.order) return a.order > b.order ? 1 : -1;
  return 0;
}

/**
 * The default validity check.
 *
 * Deliberately shallow. Browsers discard genuinely invalid declarations while
 * parsing, so almost nothing reaching the CSSOM is invalid — an aggressive
 * check here would invent problems that do not exist. Custom properties accept
 * nearly any token sequence, including an empty one, so they are never
 * rejected. Callers with a real grammar available can pass their own.
 */
export function isDeclarationValid(declaration: CascadeDeclaration): boolean {
  if (declaration.property.trim() === '') return false;
  if (declaration.property.startsWith('--')) return true;
  return declaration.value.trim() !== '';
}

/** Tuning for {@link resolveCascade}. */
export interface ResolveOptions {
  /** Replaces {@link isDeclarationValid}; e.g. one backed by `CSS.supports`. */
  readonly isValid?: (declaration: CascadeDeclaration) => boolean;
}

/**
 * Group declarations by property and rank each group.
 *
 * The winner is the strongest *valid* declaration, not simply the strongest —
 * an invalid declaration at the top of the list is marked `invalid` and the
 * next one takes the property, which is what the browser does too.
 */
export function resolveCascade(
  declarations: readonly CascadeDeclaration[],
  options: ResolveOptions = {},
): CascadeResult {
  const isValid = options.isValid ?? isDeclarationValid;

  const groups = new Map<string, CascadeDeclaration[]>();
  for (const declaration of declarations) {
    let group = groups.get(declaration.property);
    if (!group) {
      group = [];
      groups.set(declaration.property, group);
    }
    group.push(declaration);
  }

  const properties: PropertyCascade[] = [];
  const byProperty = new Map<string, PropertyCascade>();

  for (const [property, group] of groups) {
    const sorted = [...group].sort((a, b) => compareCascade(b, a));
    const valid = sorted.map((declaration) => isValid(declaration));
    const winnerIndex = valid.indexOf(true);

    const resolved = sorted.map((declaration, index): ResolvedDeclaration => {
      let status: DeclarationStatus = 'overridden';
      if (!valid[index]) status = 'invalid';
      else if (index === winnerIndex) status = 'winning';
      return { ...declaration, status };
    });

    const entry: PropertyCascade = {
      property,
      winner: winnerIndex < 0 ? null : (resolved[winnerIndex] ?? null),
      declarations: resolved,
    };
    properties.push(entry);
    byProperty.set(property, entry);
  }

  properties.sort((a, b) => (a.property < b.property ? -1 : a.property > b.property ? 1 : 0));
  return { properties, byProperty };
}

/** Which declarations from a rule set to feed into the cascade. */
export interface CascadeInputOptions {
  /** `null` (the default) resolves the element itself; `'::before'` its marker box. */
  readonly pseudoElement?: string | null;
  /**
   * Keep rules whose `@media`/`@supports` condition is known not to apply.
   * Off by default: showing a rule that a media query excluded as the winner is
   * the exact kind of confident wrong answer this project avoids. Rules whose
   * conditions are *indeterminate* are always kept, and flagged upstream.
   */
  readonly includeExcluded?: boolean;
}

/**
 * Flatten a matched rule set into cascade input.
 *
 * Ordering is assigned here rather than taken from the index because the
 * cascade needs a unique position per declaration, and because the style
 * attribute has to land after every rule.
 */
export function toCascadeDeclarations(
  rules: ElementRuleSet,
  options: CascadeInputOptions = {},
): CascadeDeclaration[] {
  const wanted = options.pseudoElement ?? null;
  const includeExcluded = options.includeExcluded ?? false;
  const declarations: CascadeDeclaration[] = [];
  let order = 0;

  for (const match of rules.matched) {
    if (match.pseudoElement !== wanted) continue;
    if (!includeExcluded && match.conditionState === 'excluded') continue;

    for (const declaration of match.rule.declarations) {
      declarations.push({
        property: declaration.property,
        value: declaration.value,
        important: declaration.important,
        elementAttached: false,
        layerOrder: match.rule.layer?.order ?? null,
        specificity: match.specificity,
        order,
        ruleId: match.rule.id,
      });
      order += 1;
    }
  }

  // A pseudo-element has no style attribute of its own.
  if (wanted === null) {
    for (const declaration of rules.inline) {
      declarations.push({
        property: declaration.property,
        value: declaration.value,
        important: declaration.important,
        elementAttached: true,
        layerOrder: null,
        specificity: INLINE_SPECIFICITY,
        order,
        ruleId: null,
      });
      order += 1;
    }
  }

  return declarations;
}

/** A rule set plus its resolved cascade, which is what a panel needs to render. */
export interface ElementCascade {
  readonly rules: ElementRuleSet;
  readonly cascade: CascadeResult;
  /** Mirrors {@link ElementRuleSet.unreadableSheetCount}; the UI must not hide it. */
  readonly unreadableSheetCount: number;
  /** True when at least one contributing selector could only be scored approximately. */
  readonly approximate: boolean;
}

/** Resolve an already-collected rule set. */
export function explainCascade(
  rules: ElementRuleSet,
  options: CascadeInputOptions & ResolveOptions = {},
): ElementCascade {
  const wanted = options.pseudoElement ?? null;
  const inputs = toCascadeDeclarations(rules, options);
  const resolveOptions: ResolveOptions = options.isValid ? { isValid: options.isValid } : {};

  const approximate = rules.matched.some(
    (match) => match.pseudoElement === wanted && !match.matched.exact,
  );

  return {
    rules,
    cascade: resolveCascade(inputs, resolveOptions),
    unreadableSheetCount: rules.unreadableSheetCount,
    approximate,
  };
}

/**
 * The whole story for one element, against a prebuilt index.
 *
 * Kept separate from index building on purpose: the index is the expensive
 * half, and a hover handler should be re-running only this.
 */
export function explainElementCascade(
  element: Element,
  index: StyleIndex,
  options: CascadeInputOptions & ResolveOptions = {},
): ElementCascade {
  return explainCascade(collectElementRules(element, index), options);
}
