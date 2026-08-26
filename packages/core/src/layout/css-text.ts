/**
 * String-level CSS handling shared by the layout analyses.
 *
 * Nothing here touches the DOM or the CSSOM: track lists, selector lists and
 * media conditions all arrive as text, and all three break the same way under
 * naive parsing. Keeping the scanner in one place means a fix for
 * `[title="a,b"]` also fixes `repeat(2, 1fr)`.
 */

const WHITESPACE = /\s/;
const FUNCTION_NAME = /^[a-z][a-z0-9-]*$/;

/** Which delimiter a caller wants to split on. */
export type CssSeparator = 'comma' | 'whitespace';

/** A parsed CSS function call, with its arguments already split. */
export interface CssFunction {
  /** Lowercased, e.g. `minmax`. */
  name: string;
  /** Top-level arguments, trimmed. Nested functions stay intact as text. */
  args: string[];
  /** The trimmed original, so callers can echo exactly what was authored. */
  raw: string;
}

/**
 * Split on separators that sit outside every paren, bracket and string.
 *
 * `value.split(',')` corrupts every value worth inspecting: `repeat(2, 1fr)`
 * hides a comma inside a function, `:is(a, b)` inside a pseudo-class,
 * `[title="a,b"]` inside a string. Splitting on whitespace has the same problem
 * with `minmax(240px, 1fr)` and `[line-a line-b]`. Empty fragments are dropped,
 * so a trailing separator never yields a phantom entry.
 */
export function splitTopLevel(input: string, separator: CssSeparator = 'whitespace'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let current = '';

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) parts.push(trimmed);
    current = '';
  };

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      // CSS identifiers escape delimiters as `\,` — the next character is
      // literal no matter what it is.
      current += char;
      escaped = true;
      continue;
    }
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')' || char === ']') {
      // Clamp rather than go negative: malformed CSS reaches us via
      // `cssText` from other people's stylesheets, and an unbalanced `)`
      // must not make every later separator invisible.
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    const splitsHere =
      depth === 0 && (separator === 'comma' ? char === ',' : WHITESPACE.test(char));
    if (splitsHere) {
      flush();
      continue;
    }

    current += char;
  }

  flush();
  return parts;
}

/**
 * Index of the `)` that closes the paren at `openIndex`, or -1.
 *
 * Quote-aware, because `url("a)b")` would otherwise close early.
 */
function findMatchingParen(input: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < input.length; index += 1) {
    const char = input[index];
    if (char === undefined) break;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * Read a value as a single function call, or `null` when it is not one.
 *
 * The `null` cases matter: `min(1px) max(2px)` also starts with a name and ends
 * with `)`, but its first paren closes early — that is two values, not one
 * function, and treating it as `min(...)` would silently swallow the second.
 */
export function unwrapFunction(value: string): CssFunction | null {
  const raw = value.trim();
  const open = raw.indexOf('(');
  if (open <= 0 || !raw.endsWith(')')) return null;

  const name = raw.slice(0, open).trim().toLowerCase();
  if (!FUNCTION_NAME.test(name)) return null;
  if (findMatchingParen(raw, open) !== raw.length - 1) return null;

  return { name, args: splitTopLevel(raw.slice(open + 1, -1), 'comma'), raw };
}

/** A CSS length converted to pixels, with a flag for conversions we had to assume. */
export interface CssLength {
  px: number;
  /** Lowercased unit as authored, e.g. `em`. `0` with no unit reports `px`. */
  unit: string;
  /**
   * True when the pixel figure depends on context we guessed (a root font size)
   * rather than on the value alone.
   */
  approximate: boolean;
}

const ABSOLUTE_UNITS: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 25.4 / 4,
};

const LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;

/**
 * Parse a CSS length into pixels, or `null` when the value is not a length.
 *
 * Distinct from `parsePx` in `geometry/rect.ts` on purpose: that one answers
 * "how many pixels is this used value" and folds anything unparseable to 0,
 * which is the right call for box-model arithmetic. Here the question is "is
 * this a length at all, and in what unit was it written" — `1fr`, `auto` and
 * `50%` must come back as `null` so callers can say so instead of reporting a
 * confident 0. Font-relative units resolve against `rootFontSize` because that
 * is exactly how media queries define them; the result is flagged approximate.
 */
export function parseCssLength(value: string, rootFontSize = 16): CssLength | null {
  const match = LENGTH.exec(value.trim());
  if (!match) return null;

  const [, digits, rawUnit] = match;
  if (digits === undefined) return null;

  const amount = Number.parseFloat(digits);
  if (!Number.isFinite(amount)) return null;

  const unit = (rawUnit ?? '').toLowerCase();
  if (unit === '') return { px: amount, unit: 'px', approximate: false };

  if (unit === 'em' || unit === 'rem') {
    return { px: amount * rootFontSize, unit, approximate: true };
  }

  const factor = ABSOLUTE_UNITS[unit];
  if (factor === undefined) return null;

  return { px: amount * factor, unit, approximate: unit !== 'px' };
}

/**
 * Join a list into an English phrase: `a`, `a and b`, `a, b and c`.
 *
 * Every explanation in this module ends up in a sentence a developer reads, so
 * the comma-splice version ("2 columns: 240px, flexible") is worth avoiding.
 */
export function joinWithAnd(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  const head = parts.slice(0, -1).join(', ');
  return `${head} and ${parts[parts.length - 1] ?? ''}`;
}
