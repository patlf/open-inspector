import { round } from '../geometry/rect.js';

/**
 * WCAG 2.x contrast mathematics.
 *
 * Deliberately DOM-free: everything here is arithmetic over plain colour
 * records, so it can be pinned against published reference values in unit
 * tests. An accessibility tool that reports wrong numbers is worse than no
 * tool, so the constants below are spelled out rather than inlined, and the
 * tests assert the well-known pairs (#000 on #fff is exactly 21:1).
 */

/** An sRGB colour with 0–255 channels — the space computed styles report in. */
export interface Srgb {
  r: number;
  g: number;
  b: number;
}

/** An sRGB colour carrying alpha in 0–1. Text colours are routinely translucent. */
export interface SrgbAlpha extends Srgb {
  alpha: number;
}

/** WCAG's two text-size buckets. The threshold rule lives in {@link isLargeText}. */
export type TextSize = 'normal' | 'large';

/** The two conformance levels that define text-contrast minimums. */
export type WcagLevel = 'AA' | 'AAA';

/** Minimum contrast ratios from WCAG 2.2 SC 1.4.3 (AA) and 1.4.6 (AAA). */
export const WCAG_MINIMUM_RATIOS = {
  AA: { normal: 4.5, large: 3 },
  AAA: { normal: 7, large: 4.5 },
} as const;

/**
 * The lowest ratio any WCAG text criterion ever asks for.
 *
 * Below this a sample fails every level at every size, which is what the scan
 * uses to separate "critical" from merely "serious".
 */
export const LOWEST_WCAG_TEXT_RATIO = 3;

/** CSS defines 1pt as exactly 4/3px, so WCAG's point thresholds convert exactly. */
const PT_TO_PX = 4 / 3;

/** 18pt. */
export const LARGE_TEXT_MIN_PX = 18 * PT_TO_PX;

/** 14pt — only counts as large when the text is also bold. */
export const LARGE_BOLD_TEXT_MIN_PX = 14 * PT_TO_PX;

/**
 * CSS `bold` is 700. Tools that use 600 here silently downgrade the
 * requirement for semibold text, which is one of the most common ways a
 * contrast checker disagrees with an auditor.
 */
export const BOLD_MIN_WEIGHT = 700;

/**
 * Slack for the font-size comparison.
 *
 * `14pt` computes to 18.666…px but engines report computed font sizes rounded
 * to four decimals ("18.6667px"), and a truncating engine would report
 * "18.6666px". A bare `>=` would then misclassify genuine 14pt bold text. The
 * tolerance is a rounding allowance, not a fudge factor: it is far smaller
 * than any real size difference.
 */
const SIZE_TOLERANCE_PX = 5e-4;

/**
 * Clamp into range, mapping NaN/Infinity to `min`.
 *
 * A single unparsable channel would otherwise turn every downstream ratio into
 * NaN, and a NaN ratio silently compares `false` against every threshold —
 * i.e. it would look like a failing grade rather than a broken input.
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/**
 * Linearize one gamma-encoded sRGB channel.
 *
 * The 0.04045 / 12.92 split and the 2.4 exponent with the 0.055 offset are the
 * sRGB transfer function as WCAG 2.1/2.2 restate it. WCAG 2.0 printed 0.03928
 * for the split; the difference is immaterial because no integer 0–255 channel
 * falls between the two thresholds (10/255 is below both, 11/255 above both).
 */
function linearizeChannel(channel: number): number {
  const c = clamp(channel, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance: 0 for black, 1 for white.
 *
 * The coefficients are WCAG's own (0.2126 / 0.7152 / 0.0722), which are the
 * Rec.709 primaries rounded to four places — not the more precise numbers APCA
 * uses. Mixing the two sets is a real source of off-by-0.01 ratios, so each
 * model keeps its own.
 */
export function relativeLuminance(color: Srgb): number {
  return (
    0.2126 * linearizeChannel(color.r) +
    0.7152 * linearizeChannel(color.g) +
    0.0722 * linearizeChannel(color.b)
  );
}

/**
 * WCAG contrast ratio, 1–21.
 *
 * Order-independent by construction — the formula asks for lighter over
 * darker, and callers should not have to know which of their two colours that
 * is.
 */
export function contrastRatio(a: Srgb, b: Srgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Composite a translucent colour over an opaque one.
 *
 * Done on gamma-encoded channels, not linear ones, because that is what
 * browsers do when compositing ordinary sRGB content — matching the pixels the
 * user actually sees matters more here than being physically correct. Mixing
 * in linear light would report a different (and, for mid-alphas, noticeably
 * more optimistic) ratio than the screen shows.
 */
export function compositeOver(foreground: SrgbAlpha, background: Srgb): Srgb {
  const alpha = clamp(foreground.alpha, 0, 1);
  const mix = (over: number, under: number): number =>
    clamp(over, 0, 255) * alpha + clamp(under, 0, 255) * (1 - alpha);

  return {
    r: mix(foreground.r, background.r),
    g: mix(foreground.g, background.g),
    b: mix(foreground.b, background.b),
  };
}

/**
 * Reduce a possibly-translucent foreground to the opaque colour on screen.
 *
 * Exists so the compositing step cannot be forgotten: every ratio in this
 * package goes through here first. A fully transparent foreground collapses to
 * the background and yields a ratio of 1, which is the honest answer — the
 * text is invisible.
 */
export function flattenForeground(foreground: Srgb | SrgbAlpha, background: Srgb): Srgb {
  if ('alpha' in foreground) return compositeOver(foreground, background);
  return { r: foreground.r, g: foreground.g, b: foreground.b };
}

/**
 * WCAG "large scale" text: at least 18pt, or at least 14pt when bold.
 *
 * Implemented against the px equivalents (24px / 18.667px) because that is
 * what computed styles give us. Two things other tools get wrong: applying the
 * 14pt threshold to non-bold text, and treating semibold (600) as bold.
 */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  const size = Number.isFinite(fontSizePx) ? fontSizePx : 0;
  const weight = Number.isFinite(fontWeight) ? fontWeight : 400;

  if (size >= LARGE_TEXT_MIN_PX - SIZE_TOLERANCE_PX) return true;
  return weight >= BOLD_MIN_WEIGHT && size >= LARGE_BOLD_TEXT_MIN_PX - SIZE_TOLERANCE_PX;
}

/** {@link isLargeText} as the labelled bucket the thresholds are keyed by. */
export function classifyTextSize(fontSizePx: number, fontWeight: number): TextSize {
  return isLargeText(fontSizePx, fontWeight) ? 'large' : 'normal';
}

/** The minimum ratio a sample of this size must reach at this level. */
export function requiredRatio(textSize: TextSize, level: WcagLevel): number {
  return WCAG_MINIMUM_RATIOS[level][textSize];
}

/** Font size and weight, already resolved to numbers. */
export interface TextStyle {
  fontSizePx: number;
  /** Numeric CSS weight (100–1000). Use `normalizeFontWeight` for raw strings. */
  fontWeight: number;
}

/** A measured pair plus its WCAG verdicts. */
export interface ContrastGrade {
  /** Rounded to 2dp for display. Never grade against this — see `ratioExact`. */
  ratio: number;
  /**
   * The unrounded ratio, which is what the pass/fail flags are computed from.
   * 4.4972 displays as "4.5" but does not meet 4.5:1; tools that grade the
   * rounded number hand out passes that auditors then revoke.
   */
  ratioExact: number;
  textSize: TextSize;
  requiredAA: number;
  requiredAAA: number;
  passesAA: boolean;
  passesAAA: boolean;
  /** The foreground actually measured, after compositing. */
  effectiveForeground: Srgb;
  background: Srgb;
}

/**
 * Grade a foreground/background pair for a given text style.
 *
 * Accepts a translucent foreground and composites it internally, so there is
 * no way to accidentally grade the uncomposited colour. The background must
 * already be opaque — resolving a translucent stack down to one colour is the
 * background resolver's job, and is exactly the case where the honest answer
 * is often "indeterminate".
 */
export function gradeContrast(
  foreground: Srgb | SrgbAlpha,
  background: Srgb,
  text: TextStyle,
): ContrastGrade {
  const effectiveForeground = flattenForeground(foreground, background);
  const ratioExact = contrastRatio(effectiveForeground, background);
  const textSize = classifyTextSize(text.fontSizePx, text.fontWeight);
  const requiredAA = requiredRatio(textSize, 'AA');
  const requiredAAA = requiredRatio(textSize, 'AAA');

  return {
    ratio: round(ratioExact),
    ratioExact,
    textSize,
    requiredAA,
    requiredAAA,
    passesAA: ratioExact >= requiredAA,
    passesAAA: ratioExact >= requiredAAA,
    effectiveForeground,
    background,
  };
}

/**
 * APCA (0.1.9 / W3 "G-4g") constants.
 *
 * Pinned as a named table because APCA is only meaningful with the exact
 * published values; a transcription slip produces plausible-looking numbers
 * that are wrong. The two anchors in the tests (#000 on #fff = Lc 106.04,
 * #fff on #000 = Lc -107.88) are the standard verification pair and will catch
 * any drift in this table.
 */
const APCA = {
  exponent: 2.4,
  redCoefficient: 0.2126729,
  greenCoefficient: 0.7151522,
  blueCoefficient: 0.072175,
  blackThreshold: 0.022,
  blackClamp: 1.414,
  normalBackgroundExponent: 0.56,
  normalTextExponent: 0.57,
  reverseBackgroundExponent: 0.65,
  reverseTextExponent: 0.62,
  scale: 1.14,
  lowOffset: 0.027,
  lowClip: 0.1,
  minimumDeltaY: 0.0005,
} as const;

/**
 * APCA screen luminance.
 *
 * Note the differences from {@link relativeLuminance}: a plain 2.4 power with
 * no linear toe, more precise primaries, and a soft clamp near black. They are
 * different perceptual models, not two spellings of one — never feed one's
 * output into the other's formula.
 */
function apcaScreenLuminance(color: Srgb): number {
  const channel = (value: number): number => (clamp(value, 0, 255) / 255) ** APCA.exponent;
  const y =
    APCA.redCoefficient * channel(color.r) +
    APCA.greenCoefficient * channel(color.g) +
    APCA.blueCoefficient * channel(color.b);

  return y < APCA.blackThreshold ? y + (APCA.blackThreshold - y) ** APCA.blackClamp : y;
}

/**
 * APCA lightness contrast (Lc), roughly -108…+106.
 *
 * INFORMATIVE ONLY — this is not a WCAG grade and must never be presented as
 * one. APCA is polarity-sensitive: the sign tells you which way round the pair
 * is (positive = dark text on a light background), and the argument order
 * therefore matters, unlike {@link contrastRatio}. Values inside the low-clip
 * band return exactly 0 rather than a misleadingly small number.
 *
 * There is no official Lc → "AA/AAA" mapping; APCA's own guidance ties minimum
 * Lc to font size and weight through a lookup table that is still changing.
 * We report the number and let the UI label it as advisory.
 */
export function apcaLc(textColor: Srgb, backgroundColor: Srgb): number {
  const textY = apcaScreenLuminance(textColor);
  const backgroundY = apcaScreenLuminance(backgroundColor);

  if (Math.abs(backgroundY - textY) < APCA.minimumDeltaY) return 0;

  if (backgroundY > textY) {
    const sapc =
      (backgroundY ** APCA.normalBackgroundExponent - textY ** APCA.normalTextExponent) *
      APCA.scale;
    return sapc < APCA.lowClip ? 0 : (sapc - APCA.lowOffset) * 100;
  }

  const sapc =
    (backgroundY ** APCA.reverseBackgroundExponent - textY ** APCA.reverseTextExponent) *
    APCA.scale;
  return sapc > -APCA.lowClip ? 0 : (sapc + APCA.lowOffset) * 100;
}
