import type { ColorToken, FontToken, NamedToken, SizeToken } from './types.js';

/**
 * Deterministic token naming.
 *
 * Names have to be stable: someone exports CSS variables, hand-edits the
 * result, re-exports after a tweak, and diffs the two. If names shifted with
 * usage counts or iteration order, every diff would be noise. So names derive
 * only from the token's own value, with collisions broken by a numeric suffix
 * in a fixed order.
 */

/** Named hue buckets, in degrees. Ranges are closed at the lower bound. */
const HUE_NAMES: ReadonlyArray<{ max: number; name: string }> = [
  { max: 15, name: 'red' },
  { max: 45, name: 'orange' },
  { max: 70, name: 'yellow' },
  { max: 100, name: 'lime' },
  { max: 160, name: 'green' },
  { max: 195, name: 'teal' },
  { max: 240, name: 'blue' },
  { max: 270, name: 'indigo' },
  { max: 300, name: 'violet' },
  { max: 330, name: 'magenta' },
  { max: 360, name: 'red' },
];

/**
 * Tailwind-style lightness steps, darkest first.
 *
 * The convention is that the number rises as the colour darkens: 50 is the
 * palest tint, 950 nearly black. Getting this backwards produces names that
 * are actively misleading — a `blue-900` that is pale.
 */
const LIGHTNESS_STEPS = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50];

/**
 * Below this RGB spread, a colour is a neutral.
 *
 * HSL saturation is unusable for this: it divides by lightness, so a very pale
 * or very dark grey with a two-point channel spread reports 12% saturation and
 * would be named `blue-100`. Absolute spread does not have that failure mode.
 */
const NEUTRAL_RGB_SPREAD = 12;

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into 0-255 channels. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, '');

  const expand = (value: string): string =>
    value.length === 3 || value.length === 4
      ? value
          .slice(0, 3)
          .split('')
          .map((char) => char + char)
          .join('')
      : value.slice(0, 6);

  const full = expand(cleaned);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Standard sRGB to HSL. Hue is 0-360, saturation and lightness 0-100. */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l: l * 100 };

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;

  return { h, s: s * 100, l: l * 100 };
}

function hueName(h: number): string {
  const normalized = ((h % 360) + 360) % 360;
  for (const bucket of HUE_NAMES) {
    if (normalized < bucket.max) return bucket.name;
  }
  return 'red';
}

/**
 * Map lightness to the nearest Tailwind-ish step.
 *
 * The array runs darkest-first, so lightness maps straight onto the index:
 * `l = 0` picks 950, `l = 100` picks 50.
 */
export function lightnessStep(l: number): number {
  const index = Math.round((l / 100) * (LIGHTNESS_STEPS.length - 1));
  return LIGHTNESS_STEPS[Math.max(0, Math.min(LIGHTNESS_STEPS.length - 1, index))] ?? 500;
}

/**
 * A descriptive name for one colour, from the colour alone.
 *
 * Greys are named by lightness rather than hue — calling a near-neutral
 * `blue-200` because it has a two-degree cast is technically defensible and
 * practically useless.
 */
export function nameColor(token: ColorToken): string {
  if (token.name) return slug(token.name);

  const rgb = hexToRgb(token.hex);
  if (!rgb) return 'color';

  const { h, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const step = lightnessStep(l);
  const spread = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);

  if (spread <= NEUTRAL_RGB_SPREAD) {
    if (l >= 99) return 'white';
    if (l <= 1) return 'black';
    return `gray-${step}`;
  }

  return `${hueName(h)}-${step}`;
}

/** Lowercase, hyphenated, safe for CSS custom properties and JSON keys. */
export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Assign unique names, appending `-2`, `-3` … on collision.
 *
 * Order in, order out: the caller controls precedence by sorting beforehand,
 * so the first occurrence keeps the clean name.
 */
export function uniquify<T>(items: T[], name: (item: T) => string): Array<NamedToken<T>> {
  const seen = new Map<string, number>();

  return items.map((token) => {
    const base = name(token) || 'token';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { name: count === 0 ? base : `${base}-${count + 1}`, token };
  });
}

export function nameColors(colors: ColorToken[]): Array<NamedToken<ColorToken>> {
  return uniquify(colors, nameColor);
}

export function nameFonts(fonts: FontToken[]): Array<NamedToken<FontToken>> {
  return uniquify(fonts, (font) => slug(font.family));
}

/**
 * Name a numeric scale positionally: `1`, `2`, `3` …
 *
 * Sorted ascending first so the names track magnitude rather than the order
 * the scanner happened to find them in.
 */
export function nameScale(sizes: SizeToken[]): Array<NamedToken<SizeToken>> {
  const sorted = [...sizes].sort((a, b) => a.px - b.px);
  return sorted.map((token, index) => ({ name: String(index + 1), token }));
}
