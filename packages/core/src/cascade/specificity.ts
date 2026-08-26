/**
 * Selector tokenizing and specificity scoring.
 *
 * `getMatchedCSSRules` was removed from browsers and its replacement lives
 * behind the DevTools protocol, which a page-level inspector cannot reach. So
 * the only route to "which rule won" is to walk the CSSOM and score selector
 * text ourselves. That makes this the file most likely to be subtly wrong, and
 * the reason the tokenizer is exported rather than hidden: the trap cases
 * (`:where()`, `:not()`, `:nth-child(… of …)`, namespaces, legacy
 * pseudo-elements) are far easier to pin down one token at a time.
 */

/**
 * The four columns browsers compare, in order: the style attribute, ids,
 * classes/attributes/pseudo-classes, and types/pseudo-elements.
 *
 * The first column only ever holds 0 or 1 — it exists so an inline declaration
 * can be sorted against a selector with the same comparison function instead of
 * a special case at every call site.
 */
export type Specificity = readonly [inline: number, id: number, classes: number, types: number];

/** A selector that contributes nothing, e.g. `*` or `:where(#a)`. */
export const ZERO_SPECIFICITY: Specificity = [0, 0, 0, 0];

/** What a `style` attribute declaration scores when shown next to selectors. */
export const INLINE_SPECIFICITY: Specificity = [1, 0, 0, 0];

/**
 * How deep the scorer follows selectors nested inside `:is()`, `:not()` and
 * friends before giving up. Real stylesheets never come close; hand-written
 * pathological input can, and unbounded recursion in a hover handler is a
 * frozen tab.
 */
const MAX_NESTED_SELECTOR_DEPTH = 8;

/** Kinds of simple selector the tokenizer distinguishes. */
export type SelectorTokenKind =
  | 'type'
  | 'universal'
  | 'id'
  | 'class'
  | 'attribute'
  | 'pseudo-class'
  | 'pseudo-element'
  | 'nesting'
  | 'combinator';

/** One simple selector or combinator, with the offsets it occupied in the source. */
export interface SelectorToken {
  readonly kind: SelectorTokenKind;
  /** The identifier without punctuation: `hero` for `#hero`, `is` for `:is(…)`. */
  readonly name: string;
  /** Raw text inside `(…)` for functional pseudos, or inside `[…]`. Empty otherwise. */
  readonly argument: string;
  /** Exact source text, so callers can slice a selector apart without re-serializing it. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * `:where()` is the only construct in CSS whose arguments are worth exactly
 * nothing, which is the whole reason it exists.
 */
const ZERO_WEIGHT_PSEUDOS = new Set(['where']);

/**
 * Pseudo-classes that score as their most specific argument and contribute
 * nothing themselves. `:not()` and `:has()` behave identically to `:is()` here,
 * which surprises people who expect `:not()` to be free.
 */
const ARGUMENT_ONLY_PSEUDOS = new Set([
  'is',
  'not',
  'has',
  'matches',
  'any',
  '-webkit-any',
  '-moz-any',
]);

/**
 * Pseudo-classes that count as a pseudo-class *and* add their argument's
 * specificity on top. Shadow-DOM selectors are the practical case.
 */
const SELF_PLUS_ARGUMENT_PSEUDOS = new Set(['host', 'host-context']);

/** `:nth-child(2n of .row)` scores the pseudo-class plus the `of` selector. */
const NTH_WITH_OF_PSEUDOS = new Set(['nth-child', 'nth-last-child']);

/**
 * The four pseudo-elements that predate `::`. Written with one colon they are
 * still pseudo-elements and belong in the type column, not the class column —
 * a classic off-by-one in hand-rolled specificity calculators.
 */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

/**
 * CSS identifiers are far wider than `[a-z-]`: everything above U+007F is an
 * identifier character, which is why emoji class names work.
 */
function isIdentifierChar(char: string): boolean {
  if (char === '') return false;
  if (char >= 'a' && char <= 'z') return true;
  if (char >= 'A' && char <= 'Z') return true;
  if (char >= '0' && char <= '9') return true;
  if (char === '-' || char === '_') return true;
  return char.charCodeAt(0) > 0x7f;
}

/** Index just past the identifier starting at `start`; equals `start` if there is none. */
function readIdentifier(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    const char = source.charAt(index);
    // A backslash escape covers whatever follows it, including `.` and `:`.
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (!isIdentifierChar(char)) break;
    index += 1;
  }
  return index;
}

/**
 * Index just past the `close` that balances the `open` at `start`.
 *
 * Quotes are honoured, so `[title="a)b"]` and `:not([data-x=')'])` do not end
 * early. An unterminated group consumes the rest of the string rather than
 * spinning — malformed selector text must not hang the inspector.
 */
function skipBalanced(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote = '';
  let index = start;

  while (index < source.length) {
    const char = source.charAt(index);

    if (quote !== '') {
      if (char === '\\') index += 2;
      else {
        if (char === quote) quote = '';
        index += 1;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === open) {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      index += 1;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }

  return source.length;
}

/**
 * Split a selector list on its top-level commas.
 *
 * Commas inside `:is(a, b)`, `[title="a,b"]` and `:nth-child(2n of .a, .b)` are
 * not separators, so a plain `String.split(',')` mis-scores every stylesheet
 * that uses modern selectors.
 */
export function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let parens = 0;
  let brackets = 0;
  let quote = '';
  let start = 0;

  for (let index = 0; index < selectorText.length; index += 1) {
    const char = selectorText.charAt(index);

    if (quote !== '') {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '(') parens += 1;
    else if (char === ')') parens = Math.max(0, parens - 1);
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);
    else if (char === ',' && parens === 0 && brackets === 0) {
      parts.push(selectorText.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(selectorText.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

/**
 * Break a single complex selector into simple selectors and combinators.
 *
 * Descendant combinators are synthesized from whitespace runs, so
 * `a  >  b` and `a>b` tokenize identically. Anything unparseable is skipped a
 * character at a time instead of aborting: a selector this code cannot read is
 * still a selector the browser matched, and dropping the whole stylesheet over
 * one exotic construct is the worse failure.
 */
export function tokenizeSelector(selector: string): SelectorToken[] {
  const tokens: SelectorToken[] = [];
  let pendingDescendantAt = -1;
  let index = 0;

  const pushSimple = (token: SelectorToken): void => {
    // Whitespace around an explicit combinator is not a descendant combinator,
    // so `a > b` and `a>b` have to tokenize identically.
    const previous = tokens[tokens.length - 1];
    if (pendingDescendantAt >= 0 && previous && previous.kind !== 'combinator') {
      tokens.push({
        kind: 'combinator',
        name: '',
        argument: '',
        text: ' ',
        start: pendingDescendantAt,
        end: token.start,
      });
    }
    pendingDescendantAt = -1;
    tokens.push(token);
  };

  const pushCombinator = (text: string, start: number, end: number): void => {
    pendingDescendantAt = -1;
    tokens.push({ kind: 'combinator', name: '', argument: '', text, start, end });
  };

  while (index < selector.length) {
    const char = selector.charAt(index);

    if (isWhitespace(char)) {
      if (pendingDescendantAt < 0) pendingDescendantAt = index;
      index += 1;
      continue;
    }

    if (char === '>' || char === '+' || char === '~') {
      pushCombinator(char, index, index + 1);
      index += 1;
      continue;
    }

    // `||` is the column combinator; a single `|` is a namespace separator and
    // is handled inside the type-selector branch.
    if (char === '|' && selector.charAt(index + 1) === '|') {
      pushCombinator('||', index, index + 2);
      index += 2;
      continue;
    }

    // Callers are expected to split selector lists first. A stray comma is
    // treated as a separator rather than folded into the compound.
    if (char === ',') {
      pendingDescendantAt = -1;
      index += 1;
      continue;
    }

    if (char === '#' || char === '.') {
      const end = readIdentifier(selector, index + 1);
      if (end === index + 1) {
        index += 1;
        continue;
      }
      pushSimple({
        kind: char === '#' ? 'id' : 'class',
        name: selector.slice(index + 1, end),
        argument: '',
        text: selector.slice(index, end),
        start: index,
        end,
      });
      index = end;
      continue;
    }

    if (char === '[') {
      const end = skipBalanced(selector, index, '[', ']');
      const inner = selector.slice(index + 1, Math.max(index + 1, end - 1));
      pushSimple({
        kind: 'attribute',
        name: inner.slice(0, readIdentifier(inner, 0)),
        argument: inner,
        text: selector.slice(index, end),
        start: index,
        end,
      });
      index = end;
      continue;
    }

    if (char === ':') {
      let cursor = index + 1;
      let doubleColon = false;
      if (selector.charAt(cursor) === ':') {
        doubleColon = true;
        cursor += 1;
      }
      const nameEnd = readIdentifier(selector, cursor);
      const name = selector.slice(cursor, nameEnd).toLowerCase();
      cursor = nameEnd;

      let argument = '';
      if (selector.charAt(cursor) === '(') {
        const end = skipBalanced(selector, cursor, '(', ')');
        argument = selector.slice(cursor + 1, Math.max(cursor + 1, end - 1));
        cursor = end;
      }

      if (name === '') {
        index = Math.max(cursor, index + 1);
        continue;
      }

      pushSimple({
        kind: doubleColon || LEGACY_PSEUDO_ELEMENTS.has(name) ? 'pseudo-element' : 'pseudo-class',
        name,
        argument,
        text: selector.slice(index, cursor),
        start: index,
        end: cursor,
      });
      index = cursor;
      continue;
    }

    if (char === '&') {
      pushSimple({
        kind: 'nesting',
        name: '&',
        argument: '',
        text: '&',
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }

    // A type selector, optionally namespace-qualified: `circle`, `svg|circle`,
    // `*|a`, `|a`. The namespace prefix itself never contributes specificity.
    let cursor = index;
    let universal = false;
    let name = '';

    const readNamePart = (): void => {
      if (selector.charAt(cursor) === '*') {
        universal = true;
        name = '*';
        cursor += 1;
        return;
      }
      const end = readIdentifier(selector, cursor);
      universal = false;
      name = selector.slice(cursor, end);
      cursor = end;
    };

    readNamePart();
    if (selector.charAt(cursor) === '|' && selector.charAt(cursor + 1) !== '|') {
      cursor += 1;
      readNamePart();
    }

    if (cursor === index || (name === '' && !universal)) {
      index = Math.max(cursor, index + 1);
      continue;
    }

    pushSimple({
      kind: universal ? 'universal' : 'type',
      name,
      argument: '',
      text: selector.slice(index, cursor),
      start: index,
      end: cursor,
    });
    index = cursor;
  }

  return tokens;
}

/** Lexicographic comparison over the four columns. Positive when `a` wins. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let column = 0; column < 4; column += 1) {
    const left = a[column] ?? 0;
    const right = b[column] ?? 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

/** Render as `0,1,2,1` — the form DevTools and every CSS article use. */
export function formatSpecificity(specificity: Specificity): string {
  return specificity.join(',');
}

/** The strongest of several selectors, which is what `:is()` and `&` resolve to. */
export function maxSpecificity(values: readonly Specificity[]): Specificity {
  let best: Specificity = ZERO_SPECIFICITY;
  for (const value of values) {
    if (compareSpecificity(value, best) > 0) best = value;
  }
  return best;
}

/** Knobs the scorer needs that cannot be derived from the selector alone. */
export interface SpecificityOptions {
  /**
   * What `&` contributes. A nested rule's `&` scores as `:is(<parent list>)`,
   * which is unknowable from the child selector by itself; without this the
   * `&` is scored as zero and the result is reported as inexact.
   */
  readonly nesting?: Specificity;
}

/** A selector-list part with its score, and whether that score is exact. */
export interface SelectorScore {
  readonly selector: string;
  readonly specificity: Specificity;
  /**
   * `false` when the number is a floor rather than the real value — an
   * unresolved `&`, or nesting deeper than the scorer follows. Surfacing this
   * beats quietly reporting a wrong winner.
   */
  readonly exact: boolean;
}

interface Counts {
  id: number;
  classes: number;
  types: number;
  exact: boolean;
}

function addTo(counts: Counts, value: Specificity): void {
  counts.id += value[1];
  counts.classes += value[2];
  counts.types += value[3];
}

/**
 * Find the selector after a top-level `of` in `:nth-child(2n of .row)`.
 *
 * Returns `null` for the plain `An+B` form. The `of` has to be matched as a
 * whole word at depth zero, or `:nth-child(2n of :is(.of))` splits in the
 * wrong place.
 */
function splitNthOf(argument: string): string | null {
  let depth = 0;
  let quote = '';

  for (let index = 0; index < argument.length; index += 1) {
    const char = argument.charAt(index);

    if (quote !== '') {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === 'o' || char === 'O')) {
      const next = argument.charAt(index + 1);
      if (next !== 'f' && next !== 'F') continue;
      const before = index === 0 ? ' ' : argument.charAt(index - 1);
      const after = argument.charAt(index + 2);
      if (isWhitespace(before) && isWhitespace(after)) {
        const rest = argument.slice(index + 2).trim();
        return rest.length > 0 ? rest : null;
      }
    }
  }

  return null;
}

function scoreListInto(
  list: string,
  options: SpecificityOptions,
  depth: number,
  counts: Counts,
): void {
  if (depth >= MAX_NESTED_SELECTOR_DEPTH) {
    counts.exact = false;
    return;
  }

  let best: Specificity = ZERO_SPECIFICITY;
  let exact = true;

  for (const part of splitSelectorList(list)) {
    const sub: Counts = { id: 0, classes: 0, types: 0, exact: true };
    scoreSelectorInto(part, options, depth + 1, sub);
    if (!sub.exact) exact = false;
    const value: Specificity = [0, sub.id, sub.classes, sub.types];
    if (compareSpecificity(value, best) > 0) best = value;
  }

  if (!exact) counts.exact = false;
  addTo(counts, best);
}

function scorePseudoClassInto(
  token: SelectorToken,
  options: SpecificityOptions,
  depth: number,
  counts: Counts,
): void {
  const { name, argument } = token;

  if (ZERO_WEIGHT_PSEUDOS.has(name)) return;

  if (ARGUMENT_ONLY_PSEUDOS.has(name)) {
    if (argument.trim() !== '') scoreListInto(argument, options, depth, counts);
    return;
  }

  if (SELF_PLUS_ARGUMENT_PSEUDOS.has(name)) {
    counts.classes += 1;
    if (argument.trim() !== '') scoreListInto(argument, options, depth, counts);
    return;
  }

  if (NTH_WITH_OF_PSEUDOS.has(name)) {
    counts.classes += 1;
    const ofSelector = splitNthOf(argument);
    if (ofSelector !== null) scoreListInto(ofSelector, options, depth, counts);
    return;
  }

  counts.classes += 1;
}

function scoreSelectorInto(
  selector: string,
  options: SpecificityOptions,
  depth: number,
  counts: Counts,
): void {
  for (const token of tokenizeSelector(selector)) {
    switch (token.kind) {
      case 'id':
        counts.id += 1;
        break;
      case 'class':
      case 'attribute':
        counts.classes += 1;
        break;
      case 'type':
      case 'pseudo-element':
        counts.types += 1;
        break;
      case 'universal':
      case 'combinator':
        break;
      case 'nesting': {
        const nesting = options.nesting;
        if (nesting) addTo(counts, nesting);
        else counts.exact = false;
        break;
      }
      case 'pseudo-class':
        scorePseudoClassInto(token, options, depth, counts);
        break;
    }
  }
}

/**
 * Score one complex selector (no top-level commas — use
 * {@link scoreSelectorList} for those).
 */
export function scoreSelector(selector: string, options: SpecificityOptions = {}): SelectorScore {
  const counts: Counts = { id: 0, classes: 0, types: 0, exact: true };
  scoreSelectorInto(selector, options, 0, counts);
  return {
    selector: selector.trim(),
    specificity: [0, counts.id, counts.classes, counts.types],
    exact: counts.exact,
  };
}

/**
 * Score every part of a selector list separately.
 *
 * A selector list has no single specificity — `#a, p` is `1,0,0` for one
 * element and `0,0,1` for another. The caller has to pick the part that
 * actually matched, so all of them are returned.
 */
export function scoreSelectorList(
  selectorText: string,
  options: SpecificityOptions = {},
): SelectorScore[] {
  return splitSelectorList(selectorText).map((part) => scoreSelector(part, options));
}

/** Convenience for the common "one selector, just give me the number" case. */
export function computeSpecificity(
  selector: string,
  options: SpecificityOptions = {},
): Specificity {
  return scoreSelector(selector, options).specificity;
}

/** A selector split into the part `matches()` accepts and its pseudo-element. */
export interface PseudoElementSplit {
  /** Never empty: a bare `::before` yields `*`. */
  readonly base: string;
  /** Normalized to double-colon form (`::before`), or `null`. */
  readonly pseudoElement: string | null;
}

/**
 * Separate a trailing pseudo-element from the selector.
 *
 * `element.matches('.btn::before')` is specified to return false, so rules
 * targeting generated content would silently vanish from the results. Matching
 * the base and reporting the pseudo-element alongside is how DevTools shows
 * them, and it is the only way to surface `content` rules at all.
 */
export function splitPseudoElement(selector: string): PseudoElementSplit {
  const tokens = tokenizeSelector(selector);
  const pseudo = tokens.find((token) => token.kind === 'pseudo-element');

  if (!pseudo) {
    const base = selector.trim();
    return { base: base === '' ? '*' : base, pseudoElement: null };
  }

  const base = selector.slice(0, pseudo.start).trim();
  return {
    base: base === '' ? '*' : base,
    pseudoElement: `::${pseudo.name}`,
  };
}

/**
 * Rewrite a nested rule's `&` into `:is(<parent>)`.
 *
 * Browsers report nested rules with `&` in `selectorText`, and
 * `element.matches('& .title')` throws. Substituting `:is()` is exact rather
 * than approximate: both take the specificity of the most specific parent
 * selector.
 */
export function resolveNestingSelector(selector: string, parentSelectorText: string): string {
  const tokens = tokenizeSelector(selector);
  if (!tokens.some((token) => token.kind === 'nesting')) return selector;

  const replacement = `:is(${parentSelectorText})`;
  let out = '';
  let cursor = 0;

  for (const token of tokens) {
    if (token.kind !== 'nesting') continue;
    out += selector.slice(cursor, token.start) + replacement;
    cursor = token.end;
  }

  return out + selector.slice(cursor);
}
