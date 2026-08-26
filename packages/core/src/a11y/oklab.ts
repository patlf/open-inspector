import { round } from '../geometry/rect.js';
import type { Srgb } from './contrast.js';

/**
 * Just enough OKLab to move a colour along its lightness axis.
 *
 * This is a deliberate local implementation rather than a dependency on the
 * colour module: the remediation search needs exactly two operations, and
 * duplicating ~30 lines of matrix arithmetic is cheaper than coupling the a11y
 * module to a package it otherwise has nothing to do with.
 *
 * Why OKLab and not HSL: HSL "lightness" is a crude function of max/min
 * channel, so darkening a yellow in HSL swings its hue and chroma visibly.
 * OKLab's L is perceptually uniform, so holding `a` and `b` fixed while moving
 * L is exactly "same hue and chroma, different lightness" — the polar OKLCH
 * form of the same point, since C and h are just the polar coordinates of
 * (a, b).
 */

interface Oklab {
  l: number;
  a: number;
  b: number;
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/** sRGB transfer function, as used for colour-space conversion (not WCAG luminance). */
function toLinear(channel: number): number {
  const c = clampChannel(channel) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return c * 255;
}

function toOklab(color: Srgb): Oklab {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);

  const longCone = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mediumCone = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const shortCone = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    l: 0.2104542553 * longCone + 0.793617785 * mediumCone - 0.0040720468 * shortCone,
    a: 1.9779984951 * longCone - 2.428592205 * mediumCone + 0.4505937099 * shortCone,
    b: 0.0259040371 * longCone + 0.7827717662 * mediumCone - 0.808675766 * shortCone,
  };
}

/**
 * OKLab back to 8-bit sRGB.
 *
 * Out-of-gamut results are clamped per channel, which changes the colour
 * rather than failing. That is acceptable only because every caller in this
 * module re-measures the contrast of the clamped result instead of trusting
 * the requested lightness — a clamped suggestion that no longer passes must
 * never be reported as passing.
 */
function fromOklab(color: Oklab): Srgb {
  const longCone = (color.l + 0.3963377774 * color.a + 0.2158037573 * color.b) ** 3;
  const mediumCone = (color.l - 0.1055613458 * color.a - 0.0638541728 * color.b) ** 3;
  const shortCone = (color.l - 0.0894841775 * color.a - 1.291485548 * color.b) ** 3;

  // `round` (not `Math.round`) because it normalises -0, which would otherwise
  // leak into equality checks and serialized output as "-0".
  const channel = (linear: number): number => clampChannel(round(fromLinear(linear), 0));

  return {
    r: channel(4.0767416621 * longCone - 3.3077115913 * mediumCone + 0.2309699292 * shortCone),
    g: channel(-1.2684380046 * longCone + 2.6097574011 * mediumCone - 0.3413193965 * shortCone),
    b: channel(-0.0041960863 * longCone - 0.7034186147 * mediumCone + 1.707614701 * shortCone),
  };
}

/** Perceptual lightness of a colour: 0 for black, 1 for white. */
export function oklabLightness(color: Srgb): number {
  return toOklab(color).l;
}

/**
 * Rebuild a colour at a different perceptual lightness, keeping chroma and hue.
 *
 * Returns integer channels because the result is meant to be pasted into CSS;
 * rounding here (rather than at display time) means the ratio the caller
 * measures is the ratio of the colour it will actually ship.
 *
 * Two consequences of holding chroma fixed. Extreme lightnesses on a saturated
 * hue leave the sRGB gamut and get clamped, so the returned colour's actual
 * lightness may differ from the one requested — always re-measure, never
 * assume. And `lightness: 0` on a chromatic colour is *not* black: L=0 with a
 * non-zero (a, b) is an out-of-gamut point that clamps to a very dark version
 * of the hue. That is the desirable behaviour here (the suggestion stays on
 * brand), but it means the endpoints of a lightness sweep are "darkest/lightest
 * of this hue", not black and white.
 */
export function withOklabLightness(color: Srgb, lightness: number): Srgb {
  const base = toOklab(color);
  const target = Number.isFinite(lightness) ? Math.min(1, Math.max(0, lightness)) : base.l;
  return fromOklab({ l: target, a: base.a, b: base.b });
}
