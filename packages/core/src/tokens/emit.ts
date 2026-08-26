import { nameColors, nameFonts, nameScale, slug } from './naming.js';
import type { TokenSet } from './types.js';

/**
 * Emitters: `TokenSet` in, text out.
 *
 * Every one of these is pure and deterministic, which is what lets their exact
 * output be asserted in tests rather than smoke-checked.
 */

function header(set: TokenSet, comment: (text: string) => string): string[] {
  const lines = ['Extracted with Open Inspector'];
  if (set.source) lines.push(set.source);
  return lines.map(comment);
}

function px(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(3))}px`;
}

function rem(token: { px: number; rem?: number | undefined }): string {
  const value = token.rem ?? token.px / 16;
  return `${Number(value.toFixed(4))}rem`;
}

/** Quote a family only when it needs it. */
function familyValue(family: string): string {
  return /^[a-zA-Z][a-zA-Z0-9\s-]*$/.test(family) && family.includes(' ')
    ? `"${family}"`
    : family;
}

export function emitCssVariables(set: TokenSet): string {
  const lines = [...header(set, (text) => `/* ${text} */`), ':root {'];

  for (const { name, token } of nameColors(set.colors)) {
    lines.push(`  --color-${name}: ${token.hex};`);
  }
  for (const { name, token } of nameFonts(set.fonts)) {
    lines.push(`  --font-${name}: ${familyValue(token.family)};`);
  }
  for (const { name, token } of nameScale(set.fontSizes)) {
    lines.push(`  --text-${name}: ${rem(token)};`);
  }
  for (const { name, token } of nameScale(set.spacing)) {
    lines.push(`  --space-${name}: ${px(token.px)};`);
  }
  for (const { name, token } of nameScale(set.radii ?? [])) {
    lines.push(`  --radius-${name}: ${px(token.px)};`);
  }
  for (const [index, shadow] of (set.shadows ?? []).entries()) {
    lines.push(`  --shadow-${index + 1}: ${shadow.value};`);
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export function emitScssVariables(set: TokenSet): string {
  const lines = header(set, (text) => `// ${text}`);

  for (const { name, token } of nameColors(set.colors)) {
    lines.push(`$color-${name}: ${token.hex};`);
  }
  for (const { name, token } of nameFonts(set.fonts)) {
    lines.push(`$font-${name}: ${familyValue(token.family)};`);
  }
  for (const { name, token } of nameScale(set.fontSizes)) {
    lines.push(`$text-${name}: ${rem(token)};`);
  }
  for (const { name, token } of nameScale(set.spacing)) {
    lines.push(`$space-${name}: ${px(token.px)};`);
  }

  return `${lines.join('\n')}\n`;
}

export function emitJson(set: TokenSet): string {
  const output = {
    color: Object.fromEntries(nameColors(set.colors).map(({ name, token }) => [name, token.hex])),
    font: Object.fromEntries(nameFonts(set.fonts).map(({ name, token }) => [name, token.family])),
    fontSize: Object.fromEntries(nameScale(set.fontSizes).map(({ name, token }) => [name, rem(token)])),
    space: Object.fromEntries(nameScale(set.spacing).map(({ name, token }) => [name, px(token.px)])),
    ...(set.radii?.length
      ? { radius: Object.fromEntries(nameScale(set.radii).map(({ name, token }) => [name, px(token.px)])) }
      : {}),
  };

  return `${JSON.stringify(output, null, 2)}\n`;
}

/**
 * W3C Design Tokens Community Group format.
 *
 * The `$value` / `$type` shape is what Style Dictionary and Figma Variables
 * import, which is the whole reason to emit it.
 */
export function emitW3cTokens(set: TokenSet): string {
  const wrap = (type: string, entries: Array<[string, string]>) => ({
    $type: type,
    ...Object.fromEntries(entries.map(([name, value]) => [name, { $value: value }])),
  });

  const output = {
    color: wrap(
      'color',
      nameColors(set.colors).map(({ name, token }) => [name, token.hex] as [string, string]),
    ),
    fontFamily: wrap(
      'fontFamily',
      nameFonts(set.fonts).map(({ name, token }) => [name, token.family] as [string, string]),
    ),
    fontSize: wrap(
      'dimension',
      nameScale(set.fontSizes).map(({ name, token }) => [name, rem(token)] as [string, string]),
    ),
    spacing: wrap(
      'dimension',
      nameScale(set.spacing).map(({ name, token }) => [name, px(token.px)] as [string, string]),
    ),
  };

  return `${JSON.stringify(output, null, 2)}\n`;
}

/** Tailwind's default spacing scale, in px, so we can reuse its key names. */
const TAILWIND_SPACING = new Map<number, string>([
  [0, '0'],
  [1, 'px'],
  [2, '0.5'],
  [4, '1'],
  [6, '1.5'],
  [8, '2'],
  [10, '2.5'],
  [12, '3'],
  [14, '3.5'],
  [16, '4'],
  [20, '5'],
  [24, '6'],
  [28, '7'],
  [32, '8'],
  [40, '10'],
  [48, '12'],
  [64, '16'],
  [80, '20'],
  [96, '24'],
]);

/**
 * Tailwind config fragment.
 *
 * Spacing values that line up with Tailwind's own scale reuse its key (`4` for
 * 16px), so the output drops into an existing project without inventing a
 * parallel vocabulary. Anything off-scale gets a px key of its own.
 */
export function emitTailwindConfig(set: TokenSet): string {
  const indent = (depth: number): string => '  '.repeat(depth);
  const lines: string[] = [
    ...header(set, (text) => `/* ${text} */`),
    'module.exports = {',
    `${indent(1)}theme: {`,
    `${indent(2)}extend: {`,
  ];

  /**
   * Bare keys where JavaScript allows them.
   *
   * Tailwind's own config writes `4: '1rem'` unquoted, so integer keys stay
   * bare to match. Fractional keys (`0.5`, `1.5`) and anything with a unit
   * must be quoted or the file will not parse.
   */
  const key = (raw: string): string =>
    /^[A-Za-z_$][\w$]*$/.test(raw) || /^\d+$/.test(raw) ? raw : `'${raw}'`;

  const section = (name: string, entries: Array<[string, string]>): void => {
    if (entries.length === 0) return;
    lines.push(`${indent(3)}${name}: {`);
    for (const [rawKey, value] of entries) {
      lines.push(`${indent(4)}${key(rawKey)}: '${value}',`);
    }
    lines.push(`${indent(3)}},`);
  };

  section(
    'colors',
    nameColors(set.colors).map(({ name, token }) => [name, token.hex] as [string, string]),
  );
  section(
    'fontFamily',
    nameFonts(set.fonts).map(({ name, token }) => [name, token.family] as [string, string]),
  );
  section(
    'fontSize',
    nameScale(set.fontSizes).map(({ name, token }) => [`s${name}`, rem(token)] as [string, string]),
  );
  section(
    'spacing',
    [...set.spacing]
      .sort((a, b) => a.px - b.px)
      .map(
        (token) =>
          [TAILWIND_SPACING.get(token.px) ?? `${token.px}px`, px(token.px)] as [string, string],
      ),
  );

  lines.push(`${indent(2)}},`, `${indent(1)}},`, '};');
  return `${lines.join('\n')}\n`;
}

function bullet(label: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return [`- **${label}:** ${values.join(', ')}`];
}

/**
 * Compact markdown for pasting into an AI coding tool.
 *
 * Written to be token-efficient on purpose: a model's context is not free, and
 * a dump of every computed value crowds out the code you actually want it to
 * write. Colours carry their role, scales carry their values, and nothing
 * carries prose.
 */
export function emitLlmHandoff(set: TokenSet): string {
  const lines: string[] = [
    '# Design tokens',
    '',
    `Extracted from a live page${set.source ? ` (${set.source})` : ''}. Use these exact values;`,
    'do not invent intermediate shades or sizes.',
    '',
    '## Colors',
  ];

  for (const { name, token } of nameColors(set.colors)) {
    const role = token.role ? ` — ${token.role}` : '';
    const usage = token.usage ? ` (${token.usage}×)` : '';
    lines.push(`- \`${name}\` ${token.hex}${role}${usage}`);
  }

  lines.push('', '## Type', ...bullet('families', set.fonts.map((font) => font.family)));
  lines.push(
    ...bullet(
      'sizes',
      [...set.fontSizes].sort((a, b) => a.px - b.px).map((token) => px(token.px)),
    ),
  );

  lines.push(
    '',
    '## Spacing',
    ...bullet(
      'scale',
      [...set.spacing].sort((a, b) => a.px - b.px).map((token) => px(token.px)),
    ),
  );

  if (set.radii?.length) {
    lines.push(...bullet('radii', set.radii.map((token) => px(token.px))));
  }

  if (set.notes?.length) {
    lines.push('', '## Layout', ...set.notes.map((note) => `- ${note}`));
  }

  return `${lines.join('\n')}\n`;
}

export interface EmittedFormat {
  id: string;
  label: string;
  text: string;
}

/** Every format, in the order the panel should offer them. */
export function emitAll(set: TokenSet): EmittedFormat[] {
  return [
    { id: 'css', label: 'CSS vars', text: emitCssVariables(set) },
    { id: 'tailwind', label: 'Tailwind', text: emitTailwindConfig(set) },
    { id: 'json', label: 'JSON', text: emitJson(set) },
    { id: 'w3c', label: 'W3C tokens', text: emitW3cTokens(set) },
    { id: 'scss', label: 'SCSS', text: emitScssVariables(set) },
    { id: 'llm', label: 'For AI', text: emitLlmHandoff(set) },
  ];
}

export { slug };
