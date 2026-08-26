import { round } from '../geometry/rect.js';
import { NAMED_COLOR_HEX } from './named-colors.js';

/**
 * A colour normalized to sRGB.
 *
 * Channels are 0-255 and alpha is 0-1 — the shape `getComputedStyle` speaks and
 * the shape a swatch needs. Channels stay fractional (two decimals) on purpose:
 * a colour that arrived as `oklch()` does not land on integers, and rounding to
 * integers before the perceptual maths would quantize away differences the
 * clustering is supposed to judge.
 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Hue 0-360, saturation and lightness 0-100, alpha 0-1. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
  a: number;
}

/**
 * OKLab. `l` is 0-1; `a` and `b` are unbounded but sit within roughly ±0.4 for
 * sRGB. Note that `a` here is the green-red axis, *not* alpha — alpha is
 * dropped because every perceptual operation in this module works on the
 * composited colour, where alpha has already been resolved.
 */
export interface Oklab {
  l: number;
  a: number;
  b: number;
}

/** OKLCH: `l` 0-1, `c` 0-~0.4, hue 0-360, alpha 0-1. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
  a: number;
}

/** The four strings a colour row in the UI shows. */
export interface ColorFormats {
  hex: string;
  rgb: string;
  hsl: string;
  oklch: string;
}

/** Knobs the parser needs but cannot derive from the string alone. */
export interface ParseColorOptions {
  /**
   * Value substituted for the `currentColor` keyword. Chrome resolves
   * `currentColor` before it reaches computed style, but Firefox leaves it in
   * `box-shadow`, and raw author CSS is full of it. Without this the keyword is
   * unparseable — which is the honest answer, not black.
   */
  currentColor?: Rgba;
}

/** The `transparent` keyword: transparent black, per CSS Color 4. */
export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Alpha at or above this counts as opaque.
 *
 * Compositing accumulates float error, so `a === 1` fails for chains that are
 * mathematically opaque. Anything above this is invisible to an 8-bit display.
 */
export const OPAQUE_ALPHA = 0.999;

const HEX_PATTERN = /^[0-9a-f]+$/;
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;
const ANGLE_PATTERN = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/;

/** `100%` of chroma in `oklch()` / of the a-b axes in `oklab()`, per CSS Color 4. */
const OKLAB_PERCENT_BASIS = 0.4;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Clamp into gamut and round, so two spellings of one colour compare equal. */
function makeRgba(r: number, g: number, b: number, a: number): Rgba {
  return {
    r: round(clamp(r, 0, 255), 2),
    g: round(clamp(g, 0, 255), 2),
    b: round(clamp(b, 0, 255), 2),
    a: round(clamp(a, 0, 1), 4),
  };
}

/** True when a colour hides whatever is behind it. */
export function isOpaque(color: Rgba): boolean {
  return color.a >= OPAQUE_ALPHA;
}

/**
 * Parse one component of a colour function.
 *
 * `none` becomes 0. That is right for the used value (CSS treats missing
 * components as 0 outside interpolation) and it keeps a single missing channel
 * from discarding an otherwise readable colour.
 */
function parseComponent(text: string, percentBasis: number): number | null {
  if (text === 'none') return 0;

  const isPercent = text.endsWith('%');
  const numeric = isPercent ? text.slice(0, -1) : text;
  if (!NUMBER_PATTERN.test(numeric)) return null;

  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) return null;

  return isPercent ? (value / 100) * percentBasis : value;
}

/** Absent alpha means opaque; unreadable alpha means the whole colour is unreadable. */
function parseAlpha(text: string | null): number | null {
  if (text === null || text === '') return 1;
  const value = parseComponent(text, 1);
  return value === null ? null : clamp(value, 0, 1);
}

/** Hue accepts every CSS angle unit and wraps into 0-360, including negatives. */
function parseHue(text: string): number | null {
  if (text === 'none') return 0;

  const match = ANGLE_PATTERN.exec(text);
  const numeric = match?.[1];
  if (numeric === undefined) return null;

  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) return null;

  const unit = match?.[2] ?? 'deg';
  const degrees =
    unit === 'rad'
      ? (value * 180) / Math.PI
      : unit === 'grad'
        ? value * 0.9
        : unit === 'turn'
          ? value * 360
          : value;

  return ((degrees % 360) + 360) % 360;
}

interface ColorFunction {
  name: string;
  args: string[];
  /** Text after the `/`, when the modern alpha form was used. */
  slashAlpha: string | null;
}

/**
 * Split `name(a, b, c / d)` into its parts.
 *
 * Both the legacy comma form and the modern space form are accepted from the
 * same code path because Chrome switched serialization mid-stream: the same
 * property returns `rgba(0, 0, 0, 0.5)` in one version and `rgb(0 0 0 / 0.5)`
 * in the next. Nested parentheses are not handled — computed colour values
 * never contain them, and the token scanner splits function calls apart before
 * they reach here.
 */
function splitColorFunction(text: string): ColorFunction | null {
  const open = text.indexOf('(');
  if (open <= 0 || !text.endsWith(')')) return null;

  const body = text.slice(open + 1, -1);
  const slash = body.indexOf('/');
  const head = slash < 0 ? body : body.slice(0, slash);

  return {
    name: text.slice(0, open).trim(),
    args: head.split(/[\s,]+/).filter((part) => part.length > 0),
    slashAlpha: slash < 0 ? null : body.slice(slash + 1).trim(),
  };
}

/**
 * Pull the three components plus alpha out of a colour function.
 *
 * The legacy forms put alpha in a fourth positional argument; the modern ones
 * put it after a slash. Both at once is invalid CSS, and the slash wins.
 */
function takeComponents(fn: ColorFunction): { parts: [string, string, string]; alpha: string | null } | null {
  if (fn.args.length < 3 || fn.args.length > 4) return null;

  const [first, second, third, fourth] = fn.args;
  if (first === undefined || second === undefined || third === undefined) return null;

  return { parts: [first, second, third], alpha: fn.slashAlpha ?? fourth ?? null };
}

function parseHex(text: string): Rgba | null {
  const digits = text.slice(1);
  if (!HEX_PATTERN.test(digits)) return null;

  const pair = (index: number): number => Number.parseInt(digits.slice(index, index + 2), 16);
  const single = (index: number): number => {
    const digit = digits.slice(index, index + 1);
    return Number.parseInt(digit + digit, 16);
  };

  switch (digits.length) {
    case 3:
      return makeRgba(single(0), single(1), single(2), 1);
    case 4:
      return makeRgba(single(0), single(1), single(2), single(3) / 255);
    case 6:
      return makeRgba(pair(0), pair(2), pair(4), 1);
    case 8:
      return makeRgba(pair(0), pair(2), pair(4), pair(6) / 255);
    default:
      // 5 and 7 digits are not a shorthand for anything; guessing which digits
      // the author meant would be inventing a colour.
      return null;
  }
}

/** Parse three components against one percentage basis, all-or-nothing. */
function parseTriple(
  parts: [string, string, string],
  percentBasis: number,
): [number, number, number] | null {
  const first = parseComponent(parts[0], percentBasis);
  const second = parseComponent(parts[1], percentBasis);
  const third = parseComponent(parts[2], percentBasis);
  if (first === null || second === null || third === null) return null;
  return [first, second, third];
}

function parseRgbFunction(fn: ColorFunction): Rgba | null {
  const taken = takeComponents(fn);
  if (!taken) return null;

  const channels = parseTriple(taken.parts, 255);
  const a = parseAlpha(taken.alpha);
  if (channels === null || a === null) return null;

  return makeRgba(channels[0], channels[1], channels[2], a);
}

/** The CSS Color 4 hue-to-RGB reference implementation; s and l are 0-1. */
function hslToRgbChannels(hue: number, s: number, l: number): [number, number, number] {
  const amount = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return l - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function parseHslFunction(fn: ColorFunction): Rgba | null {
  const taken = takeComponents(fn);
  if (!taken) return null;

  const [hueText, saturationText, lightnessText] = taken.parts;
  const hue = parseHue(hueText);
  // Bare numbers are legal in CSS Color 4 and mean percentages.
  const saturation = parseComponent(saturationText, 100);
  const lightness = parseComponent(lightnessText, 100);
  const a = parseAlpha(taken.alpha);
  if (hue === null || saturation === null || lightness === null || a === null) return null;

  const [r, g, b] = hslToRgbChannels(hue, clamp(saturation / 100, 0, 1), clamp(lightness / 100, 0, 1));
  return makeRgba(r * 255, g * 255, b * 255, a);
}

function parseHwbFunction(fn: ColorFunction): Rgba | null {
  const taken = takeComponents(fn);
  if (!taken) return null;

  const [hueText, whiteText, blackText] = taken.parts;
  const hue = parseHue(hueText);
  const whiteness = parseComponent(whiteText, 100);
  const blackness = parseComponent(blackText, 100);
  const a = parseAlpha(taken.alpha);
  if (hue === null || whiteness === null || blackness === null || a === null) return null;

  const white = clamp(whiteness / 100, 0, 1);
  const black = clamp(blackness / 100, 0, 1);

  // Whiteness and blackness summing past 1 is legal and means grey.
  if (white + black >= 1) {
    const grey = (white / (white + black)) * 255;
    return makeRgba(grey, grey, grey, a);
  }

  const base = hslToRgbChannels(hue, 1, 0.5);
  const mix = (channel: number): number => (channel * (1 - white - black) + white) * 255;
  return makeRgba(mix(base[0]), mix(base[1]), mix(base[2]), a);
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/* -------------------------------------------------------------------------- */
/* CIE Lab and LCH                                                            */
/* -------------------------------------------------------------------------- */

/**
 * These are not a nice-to-have.
 *
 * Chrome *serializes computed colours as `lab()`* whenever the author wrote
 * one in a modern colour space. Tailwind v4 authors its whole palette in
 * `oklch()`, so `getComputedStyle` on a Tailwind site hands back `lab(...)`
 * for almost every colour on the page. A reliability sweep of tailwindcss.com
 * found 2,398 colour values rejected as unreadable, 1,653 of them a single
 * `lab()` string — which is to say the palette was very nearly empty on the
 * most widely used CSS framework there is.
 *
 * CSS `lab()` is defined against the **D50** white point, not D65. Using the
 * D65 matrices here produces colours that are subtly but consistently wrong,
 * which is worse than failing to parse.
 */

/** CIE constants: (6/29)³ and (29/3)³. */
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

/** D50 reference white, per CSS Color 4. */
const D50_WHITE: readonly [number, number, number] = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

/**
 * XYZ (D50) straight to linear sRGB.
 *
 * Combines the Bradford chromatic adaptation from D50 to D65 with the
 * XYZ-to-linear-sRGB matrix, exactly as the CSS Color 4 sample code does.
 */
const XYZ_D50_TO_LINEAR_SRGB: readonly (readonly [number, number, number])[] = [
  [3.1341359569958707, -1.6173863321612538, -0.4906619460083532],
  [-0.978795502912089, 1.9161404981986926, 0.0334175996565243],
  [0.07195537988411677, -0.2289768264158322, 1.4053851325241447],
];

/** Convert CIE Lab (D50) to sRGB. `l` is 0-100; `a` and `b` are unbounded. */
export function labToRgba(l: number, a: number, b: number, alpha = 1): Rgba {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const x = fx ** 3 > LAB_EPSILON ? fx ** 3 : (116 * fx - 16) / LAB_KAPPA;
  const y = l > LAB_KAPPA * LAB_EPSILON ? fy ** 3 : l / LAB_KAPPA;
  const z = fz ** 3 > LAB_EPSILON ? fz ** 3 : (116 * fz - 16) / LAB_KAPPA;

  const xyz = [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]] as const;

  const channels = XYZ_D50_TO_LINEAR_SRGB.map(
    (row) => row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2],
  );

  return makeRgba(
    linearToSrgb(channels[0] ?? 0) * 255,
    linearToSrgb(channels[1] ?? 0) * 255,
    linearToSrgb(channels[2] ?? 0) * 255,
    alpha,
  );
}

/** LCH is Lab in polar form: chroma and hue instead of the a/b axes. */
export function lchToRgba(l: number, c: number, h: number, alpha = 1): Rgba {
  const radians = (h * Math.PI) / 180;
  return labToRgba(l, c * Math.cos(radians), c * Math.sin(radians), alpha);
}

/** `100%` on the a/b axes of `lab()`, and on chroma in `lch()`, per CSS Color 4. */
const LAB_AXIS_PERCENT = 125;
const LCH_CHROMA_PERCENT = 150;

function parseLabFunction(fn: ColorFunction): Rgba | null {
  const taken = takeComponents(fn);
  if (!taken) return null;

  const lightness = parseComponent(taken.parts[0], 100);
  const a = parseComponent(taken.parts[1], LAB_AXIS_PERCENT);
  const b = parseComponent(taken.parts[2], LAB_AXIS_PERCENT);
  const alpha = parseAlpha(taken.alpha);
  if (lightness === null || a === null || b === null || alpha === null) return null;

  return labToRgba(Math.max(0, lightness), a, b, alpha);
}

function parseLchFunction(fn: ColorFunction): Rgba | null {
  const taken = takeComponents(fn);
  if (!taken) return null;

  const lightness = parseComponent(taken.parts[0], 100);
  const chroma = parseComponent(taken.parts[1], LCH_CHROMA_PERCENT);
  const hue = parseHue(taken.parts[2]);
  const alpha = parseAlpha(taken.alpha);
  if (lightness === null || chroma === null || hue === null || alpha === null) return null;

  return lchToRgba(Math.max(0, lightness), Math.max(0, chroma), hue, alpha);
}

/**
 * Convert to OKLab.
 *
 * Via linear-light sRGB and Björn Ottosson's LMS matrices. Doing this the lazy
 * way — treating the gamma-encoded channels as if they were linear — produces a
 * space where dark colours are wildly over-separated, which would make the
 * palette clustering split every shade of near-black apart while merging pale
 * greys that read as different.
 *
 * Alpha is deliberately absent from the result: composite first, then measure.
 */
export function toOklab(color: Rgba): Oklab {
  const r = srgbToLinear(clamp(color.r, 0, 255) / 255);
  const g = srgbToLinear(clamp(color.g, 0, 255) / 255);
  const b = srgbToLinear(clamp(color.b, 0, 255) / 255);

  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    l: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  };
}

/**
 * Convert OKLab back to sRGB.
 *
 * Out-of-gamut results are clamped per channel. That is lossy and hue-shifting,
 * but it only bites for colours a screen cannot show anyway; the alternative
 * (gamut mapping by chroma reduction) would report a colour the page never
 * asked for.
 */
export function oklabToRgba(lab: Oklab, alpha = 1): Rgba {
  const long = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const medium = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const short = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;

  const r = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short;
  const g = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short;
  const b = -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short;

  return makeRgba(linearToSrgb(r) * 255, linearToSrgb(g) * 255, linearToSrgb(b) * 255, alpha);
}

/**
 * Convert to OKLCH.
 *
 * Hue is reported as 0 for greys. CSS calls that hue `none`, but a number keeps
 * the type simple and no consumer can act on the difference — chroma is already
 * zero, so any hue paints the same pixel.
 */
export function toOklch(color: Rgba): Oklch {
  const lab = toOklab(color);
  const chroma = Math.hypot(lab.a, lab.b);
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;

  return { l: lab.l, c: chroma, h: hue, a: color.a };
}

/** Build an sRGB colour from OKLCH components (hue in degrees). */
export function oklchToRgba(oklch: Oklch): Rgba {
  const radians = (oklch.h * Math.PI) / 180;
  return oklabToRgba(
    { l: oklch.l, a: oklch.c * Math.cos(radians), b: oklch.c * Math.sin(radians) },
    oklch.a,
  );
}

function parseOklchFunction(fn: ColorFunction): Rgba | null {
  const taken = takeComponents(fn);
  if (!taken) return null;

  const [lightnessText, chromaText, hueText] = taken.parts;
  const lightness = parseComponent(lightnessText, 1);
  const chroma = parseComponent(chromaText, OKLAB_PERCENT_BASIS);
  const hue = parseHue(hueText);
  const alpha = parseAlpha(taken.alpha);
  if (lightness === null || chroma === null || hue === null || alpha === null) return null;

  return oklchToRgba({ l: clamp(lightness, 0, 1), c: Math.max(0, chroma), h: hue, a: alpha });
}

function parseOklabFunction(fn: ColorFunction): Rgba | null {
  const taken = takeComponents(fn);
  if (!taken) return null;

  const [lightnessText, aText, bText] = taken.parts;
  const lightness = parseComponent(lightnessText, 1);
  const a = parseComponent(aText, OKLAB_PERCENT_BASIS);
  const b = parseComponent(bText, OKLAB_PERCENT_BASIS);
  const alpha = parseAlpha(taken.alpha);
  if (lightness === null || a === null || b === null || alpha === null) return null;

  return oklabToRgba({ l: clamp(lightness, 0, 1), a, b }, alpha);
}

/**
 * Parse `color(<space> c1 c2 c3 / a)`.
 *
 * Only the sRGB spaces are handled. `display-p3`, `rec2020` and friends need a
 * gamut mapping decision that would change the colour, so they come back as
 * unreadable rather than as a plausible-looking lie — a wide-gamut brand red
 * silently reported as `#ff0000` is exactly the kind of confident wrong answer
 * this project refuses to give.
 */
function parseColorFunction(fn: ColorFunction): Rgba | null {
  const [space, ...rest] = fn.args;
  if (space === undefined) return null;
  if (space !== 'srgb' && space !== 'srgb-linear') return null;

  const components = { name: fn.name, args: rest, slashAlpha: fn.slashAlpha };
  const taken = takeComponents(components);
  if (!taken) return null;

  const channels = parseTriple(taken.parts, 1);
  const alpha = parseAlpha(taken.alpha);
  if (channels === null || alpha === null) return null;

  const encode = (channel: number): number =>
    (space === 'srgb-linear' ? linearToSrgb(clamp(channel, 0, 1)) : channel) * 255;

  return makeRgba(encode(channels[0]), encode(channels[1]), encode(channels[2]), alpha);
}

/**
 * Parse any colour string a computed style or a stylesheet can hand us.
 *
 * Returns `null` for anything it cannot read — including valid CSS it declines
 * to guess at, such as `lab()`, `lch()` and wide-gamut `color()` spaces.
 * Callers are expected to surface that as "unreadable" rather than substituting
 * a default; every consumer in this package counts them.
 */
export function parseColor(
  input: string | null | undefined,
  options: ParseColorOptions = {},
): Rgba | null {
  if (!input) return null;

  const text = input.trim().toLowerCase();
  if (text === '') return null;
  if (text === 'transparent') return TRANSPARENT;
  if (text === 'currentcolor') return options.currentColor ?? null;
  if (text.startsWith('#')) return parseHex(text);

  const fn = splitColorFunction(text);
  if (fn) {
    switch (fn.name) {
      case 'rgb':
      case 'rgba':
        return parseRgbFunction(fn);
      case 'hsl':
      case 'hsla':
        return parseHslFunction(fn);
      case 'hwb':
        return parseHwbFunction(fn);
      case 'oklch':
        return parseOklchFunction(fn);
      case 'oklab':
        return parseOklabFunction(fn);
      case 'lab':
        return parseLabFunction(fn);
      case 'lch':
        return parseLchFunction(fn);
      case 'color':
        return parseColorFunction(fn);
      default:
        return null;
    }
  }

  const named = NAMED_COLOR_HEX[text];
  return named === undefined ? null : parseHex(named);
}

/** Convert to HSL. Hue is 0 for greys, matching how browsers serialize them. */
export function toHsl(color: Rgba): Hsl {
  const r = clamp(color.r, 0, 255) / 255;
  const g = clamp(color.g, 0, 255) / 255;
  const b = clamp(color.b, 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;

  if (chroma === 0) return { h: 0, s: 0, l: lightness * 100, a: color.a };

  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  const hue =
    max === r
      ? ((g - b) / chroma) % 6
      : max === g
        ? (b - r) / chroma + 2
        : (r - g) / chroma + 4;

  return {
    h: ((hue * 60) % 360 + 360) % 360,
    s: clamp(saturation, 0, 1) * 100,
    l: lightness * 100,
    a: color.a,
  };
}

function hexPair(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
}

/**
 * Serialize as `#rrggbb`, or `#rrggbbaa` when the colour is not opaque.
 *
 * Doubles as the identity key for palette clustering, which is why the alpha
 * suffix is omitted for opaque colours: `#ffffff` and `#ffffffff` must not
 * appear as two entries in the palette.
 */
export function toHex(color: Rgba): string {
  const base = `#${hexPair(color.r)}${hexPair(color.g)}${hexPair(color.b)}`;
  return isOpaque(color) ? base : `${base}${hexPair(color.a * 255)}`;
}

/** Serialize the way DevTools does: `rgb(r, g, b)`, or `rgba(...)` with alpha. */
export function formatRgb(color: Rgba): string {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  return isOpaque(color) ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(color.a, 3)})`;
}

/** Serialize as `hsl(h, s%, l%)` / `hsla(...)`, rounded for display only. */
export function formatHsl(color: Rgba): string {
  const hsl = toHsl(color);
  const parts = `${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%`;
  return isOpaque(color) ? `hsl(${parts})` : `hsla(${parts}, ${round(color.a, 3)})`;
}

/** Serialize as `oklch(l c h)`, with the modern `/ alpha` form when translucent. */
export function formatOklch(color: Rgba): string {
  const oklch = toOklch(color);
  const parts = `${round(oklch.l, 3)} ${round(oklch.c, 3)} ${round(oklch.h, 1)}`;
  return isOpaque(color) ? `oklch(${parts})` : `oklch(${parts} / ${round(color.a, 3)})`;
}

/** Every string form a palette row needs, computed once. */
export function formatColor(color: Rgba): ColorFormats {
  return {
    hex: toHex(color),
    rgb: formatRgb(color),
    hsl: formatHsl(color),
    oklch: formatOklch(color),
  };
}

/**
 * Perceptual distance between two colours: Euclidean delta-E in OKLab.
 *
 * Roughly, 0.02 is the threshold where two flat swatches start to look
 * different side by side, and black-to-white is 1.0. Alpha is ignored — a
 * translucent colour has no perceptual identity until it is composited, so
 * callers that care must composite first (or compare alpha separately, which is
 * what the palette does).
 */
export function oklabDistance(first: Rgba, second: Rgba): number {
  const a = toOklab(first);
  const b = toOklab(second);
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

/**
 * Composite `source` over `backdrop` (the Porter-Duff source-over operator).
 *
 * This is the only correct way to answer "what colour is actually there" for a
 * translucent element: averaging the two, or ignoring alpha, gets contrast
 * checks wrong in the exact cases people file bugs about.
 */
export function compositeOver(source: Rgba, backdrop: Rgba): Rgba {
  const alpha = source.a + backdrop.a * (1 - source.a);
  if (alpha <= 0) return { ...TRANSPARENT };

  const blend = (front: number, back: number): number =>
    (front * source.a + back * backdrop.a * (1 - source.a)) / alpha;

  return makeRgba(
    blend(source.r, backdrop.r),
    blend(source.g, backdrop.g),
    blend(source.b, backdrop.b),
    alpha,
  );
}

/**
 * Replace a colour's alpha, keeping its channels.
 *
 * Mainly used to fold an ancestor's `opacity` into its background colour
 * (`withAlpha(bg, bg.a * opacity)`). That is an approximation: `opacity`
 * composites an element *and its subtree* as one group, so it is exact only
 * when nothing else in that subtree paints behind the inspected element —
 * which is the common case, and the caveat is reported by the caller.
 */
export function withAlpha(color: Rgba, alpha: number): Rgba {
  return makeRgba(color.r, color.g, color.b, alpha);
}
