import type { Srgb, SrgbAlpha } from './contrast.js';

/**
 * A deliberately narrow CSS colour reader.
 *
 * Full CSS colour parsing (named colours, `hsl()`, `oklch()`, `color()`,
 * relative colour syntax) belongs to the colour module, not here. This file
 * exists so the a11y module has *no* dependency on it: it covers the two forms
 * `getComputedStyle` actually returns for `color` / `background-color` in every
 * shipping engine — `rgb(...)` / `rgba(...)` — plus hex, which is what
 * fixtures and tests are written in.
 *
 * Anything else returns `null`, which callers must turn into an explicit
 * "indeterminate" result. Guessing a colour we could not read would be a
 * confidently wrong accessibility verdict, which is the one failure mode this
 * package refuses.
 */

const HEX_PATTERN = /^#?([0-9a-f]+)$/i;
const RGB_FUNCTION_PATTERN = /^rgba?\(([^)]*)\)$/i;

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
 *
 * Alpha is normalised to 0–1 here so callers never have to remember whether a
 * given hex form carried one. Lengths other than 3/4/6/8 are rejected rather
 * than zero-padded: `#12345` is a typo, not a colour.
 */
export function parseHexColor(value: string): SrgbAlpha | null {
  const digits = HEX_PATTERN.exec(value.trim())?.[1];
  if (!digits) return null;

  const length = digits.length;
  if (length !== 3 && length !== 4 && length !== 6 && length !== 8) return null;

  const shorthand = length === 3 || length === 4;
  const size = shorthand ? 1 : 2;

  const channelAt = (index: number): number => {
    const part = digits.slice(index * size, index * size + size);
    const parsed = Number.parseInt(shorthand ? part + part : part, 16);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const hasAlpha = length === 4 || length === 8;
  return {
    r: channelAt(0),
    g: channelAt(1),
    b: channelAt(2),
    alpha: hasAlpha ? channelAt(3) / 255 : 1,
  };
}

/** Format an opaque colour as `#rrggbb`, rounding and clamping channels first. */
export function formatHexColor(color: Srgb): string {
  const hex = (channel: number): string => {
    const value = Number.isFinite(channel) ? Math.round(channel) : 0;
    const clamped = value < 0 ? 0 : value > 255 ? 255 : value;
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

function parseChannel(part: string | undefined): number | null {
  if (part === undefined) return null;
  const numeric = Number.parseFloat(part);
  if (!Number.isFinite(numeric)) return null;
  // `rgb(100% 0% 0%)` is legal and percentages are relative to 255, not 100.
  const value = part.endsWith('%') ? (numeric / 100) * 255 : numeric;
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function parseAlphaPart(part: string | undefined): number | null {
  if (part === undefined) return 1;
  const numeric = Number.parseFloat(part);
  if (!Number.isFinite(numeric)) return null;
  return clampUnit(part.endsWith('%') ? numeric / 100 : numeric);
}

/**
 * Read a computed `color` / `background-color` string.
 *
 * Accepts both the legacy comma form (`rgba(0, 0, 0, .5)`) and the modern
 * space form with a slash-separated alpha (`rgb(0 0 0 / 50%)`); Chromium
 * switched between them for some properties, and an inspector that only knew
 * one would silently lose colours. The keyword `transparent` is recognised
 * because it is a real authored value even though computed styles normally
 * expand it.
 *
 * Returns `null` for anything it does not understand — including `oklch()` and
 * `color(display-p3 …)` — so the caller reports "indeterminate" rather than a
 * fabricated ratio.
 */
export function parseCssColor(value: string | null | undefined): SrgbAlpha | null {
  if (!value) return null;

  const text = value.trim();
  if (text === '') return null;
  if (text.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  if (text.startsWith('#')) return parseHexColor(text);

  const body = RGB_FUNCTION_PATTERN.exec(text)?.[1];
  if (body === undefined) return null;

  const parts = body
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((part) => part.length > 0);
  if (parts.length < 3 || parts.length > 4) return null;

  const r = parseChannel(parts[0]);
  const g = parseChannel(parts[1]);
  const b = parseChannel(parts[2]);
  const alpha = parseAlphaPart(parts[3]);
  if (r === null || g === null || b === null || alpha === null) return null;

  return { r, g, b, alpha };
}
