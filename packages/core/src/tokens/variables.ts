/**
 * The page's own design tokens: custom properties that hold a length.
 *
 * A scale read off computed styles knows a page uses 16px, not that it wrote
 * `var(--space-4)` to get it. What can be known is which of the page's
 * variables come to 16px, and that is usually the name a developer wants:
 * the one to write next time instead of the number.
 *
 * Kept free of the DOM like the rest of this module. The caller lists the
 * declared names and reads each one's value at the root, where a design
 * system declares its tokens; everything here is arithmetic on the text.
 */

/** A custom property whose value at the root is a length. */
export interface LengthVariable {
  /** With its dashes: `--space-4`. */
  name: string;
  px: number;
}

/** The slice of a stylesheet index this reads: each rule's declared property names. */
export interface DeclaringRule {
  readonly declarations: readonly { readonly property: string }[];
}

/** Which scale a variable is offered for. */
export type LengthScaleKind = 'type' | 'spacing';

/**
 * Enough for any real design system. A page that declares thousands — a
 * generated utility sheet — would otherwise cost a style read for each.
 */
export const MAX_LENGTH_VARIABLES = 600;

/** How far apart a variable and a size may be and still be the same length. */
const MATCH_TOLERANCE_PX = 0.05;

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)$/i;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;

/** Every custom property the rules declare, once each, in document order. */
export function declaredCustomProperties(rules: readonly DeclaringRule[]): string[] {
  const names = new Set<string>();
  for (const rule of rules) {
    for (const { property } of rule.declarations) {
      if (property.startsWith('--')) names.add(property);
    }
  }
  return [...names];
}

function lengthPx(text: string, rootFontPx: number): number | null {
  const match = LENGTH.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return match[2]?.toLowerCase() === 'rem' ? value * rootFontPx : value;
}

/**
 * A root-level custom property value as px, or null.
 *
 * Covers the forms design systems write lengths in: `16px`, `1rem`, and one
 * multiplication — `calc(0.25rem * 4)` is what a `var(--spacing) * 4` token
 * computes to once the variable is substituted. `em` is refused: a custom
 * property resolves its ems where it is used, so the root says nothing about
 * them. So is anything else; a guess would put a wrong name on a size.
 */
export function parseLengthPx(value: string, rootFontPx: number): number | null {
  const text = value.trim();
  const direct = lengthPx(text, rootFontPx);
  if (direct !== null) return direct;

  const calc = /^calc\(\s*(.+?)\s*\*\s*(.+?)\s*\)$/i.exec(text);
  if (!calc) return null;
  const [left = '', right = ''] = [calc[1], calc[2]];
  const leftPx = lengthPx(left, rootFontPx);
  if (leftPx !== null && NUMBER.test(right)) return leftPx * Number(right);
  const rightPx = lengthPx(right, rootFontPx);
  if (rightPx !== null && NUMBER.test(left)) return rightPx * Number(left);
  return null;
}

/**
 * The named custom properties whose root value is a non-zero length.
 *
 * `read` returns a property's computed value at the root, an empty string
 * when it is not set there.
 */
export function readLengthVariables(
  names: readonly string[],
  read: (name: string) => string,
  rootFontPx: number,
): LengthVariable[] {
  const variables: LengthVariable[] = [];
  for (const name of names.slice(0, MAX_LENGTH_VARIABLES)) {
    const px = parseLengthPx(read(name), rootFontPx);
    if (px !== null && px !== 0) variables.push({ name, px });
  }
  return variables;
}

/*
 * A length variable is offered for a scale only when its name says it
 * belongs there. A radius or a border width can equal a spacing step, and a
 * `--radius-md` beside 8px of padding would be a wrong answer that looks
 * like a right one.
 */
const TYPE_NAME = /font|text|(^|-)fs(-|$)|type|heading|title|display/i;
const SPACING_NAME = /spac|gap|gutter|margin|padding|inset|(^|-)size/i;
const NOT_SPACING = /font|text|radius|border|stroke|outline|shadow|blur|width|height|line|leading|icon/i;

function belongsTo(name: string, kind: LengthScaleKind): boolean {
  return kind === 'type'
    ? TYPE_NAME.test(name)
    : SPACING_NAME.test(name) && !NOT_SPACING.test(name);
}

/** The variables that name a size on a scale, at most `limit`, in the page's own order. */
export function variablesFor(
  px: number,
  variables: readonly LengthVariable[],
  kind: LengthScaleKind,
  limit = 2,
): string[] {
  return variables
    .filter((variable) => Math.abs(variable.px - px) <= MATCH_TOLERANCE_PX && belongsTo(variable.name, kind))
    .slice(0, limit)
    .map((variable) => variable.name);
}
