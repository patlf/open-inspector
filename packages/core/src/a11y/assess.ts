import { round } from '../geometry/rect.js';
import type { ContrastGrade, Srgb, SrgbAlpha, TextSize, WcagLevel } from './contrast.js';
import { apcaLc, classifyTextSize, contrastRatio, gradeContrast, requiredRatio } from './contrast.js';
import { formatHexColor } from './css-color.js';
import { oklabLightness, withOklabLightness } from './oklab.js';

/**
 * Turn one text sample into a contrast verdict.
 *
 * The load-bearing product decision in this file is that "I don't know" is a
 * first-class outcome. Text over a gradient, a photo, or a video has no single
 * background colour; competitors pick the top-left pixel or the last solid
 * ancestor and report a number that is confidently wrong. We return an
 * indeterminate verdict with the reason instead.
 */

/** Why a contrast verdict could not be computed. */
export type IndeterminateReason =
  | 'gradient'
  | 'background-image'
  | 'media-element'
  | 'canvas'
  | 'transparent-to-root'
  | 'mix-blend-mode'
  | 'filter'
  | 'unparsable-color'
  | 'multiple-backgrounds'
  | 'unknown';

/**
 * What a background resolver hands us.
 *
 * Kept as a plain two-case union so the resolver can live in another module
 * (or be supplied by the host app) without this one depending on it. `color`
 * must already be opaque — flattening a translucent stack is the resolver's
 * job, and is precisely where it should be returning `indeterminate` instead.
 */
export type ResolvedBackground =
  | { kind: 'solid'; color: Srgb }
  | { kind: 'indeterminate'; reason: IndeterminateReason; detail: string | null };

/** Everything needed to grade one text sample. */
export interface ContrastRequest {
  /** May be translucent; it is composited over the background before grading. */
  foreground: Srgb | SrgbAlpha;
  background: ResolvedBackground;
  fontSizePx: number;
  /** Numeric CSS weight. Pass raw strings through {@link normalizeFontWeight}. */
  fontWeight: number;
}

/** Which way a suggested colour moved along the lightness axis. */
export type LightnessDirection = 'lighter' | 'darker';

/**
 * A concrete fix, or an honest admission that lightness alone cannot fix it.
 *
 * `unreachable` happens for real: mid-grey text on a mid-grey background can
 * never reach 7:1 no matter how it is lightened or darkened, because both
 * endpoints (black and white) fall short. Reporting the best achievable value
 * is more useful than reporting nothing.
 */
export type Remediation =
  | {
      kind: 'lightness';
      color: Srgb;
      hex: string;
      /** Measured ratio of the suggested colour — never the requested target. */
      ratio: number;
      direction: LightnessDirection;
      /** How far the colour moved in OKLab L (0–1). */
      deltaLightness: number;
    }
  | {
      kind: 'unreachable';
      target: number;
      best: { color: Srgb; hex: string; ratio: number; direction: LightnessDirection };
    };

/** A sample that could be graded. */
export interface AssessedContrast extends ContrastGrade {
  status: 'assessed';
  /**
   * APCA Lc, informative only — not a WCAG grade. Sign encodes polarity.
   * See {@link apcaLc}.
   */
  apcaLc: number;
  /** `null` when the sample already meets the requested level. */
  remediation: Remediation | null;
}

/** A sample whose background (or colour) could not be read. */
export interface IndeterminateContrast {
  status: 'indeterminate';
  reason: IndeterminateReason;
  detail: string | null;
  /** Still known: the size bucket and thresholds depend only on the font. */
  textSize: TextSize;
  requiredAA: number;
  requiredAAA: number;
}

export type ContrastVerdict = AssessedContrast | IndeterminateContrast;

const NAMED_WEIGHTS: ReadonlyMap<string, number> = new Map([
  ['normal', 400],
  ['bold', 700],
]);

/**
 * Coerce a `font-weight` into a number.
 *
 * `getComputedStyle` returns a number for `font-weight` in every current
 * engine, so the keyword handling here is for authored values and test
 * fixtures. `bolder` / `lighter` are relative to the parent and cannot be
 * resolved from one declaration alone; they fall back to 400, which is the
 * conservative choice — it keeps the stricter "normal text" threshold rather
 * than granting the large-text discount on a guess.
 */
export function normalizeFontWeight(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 400;
  if (!value) return 400;

  const text = value.trim().toLowerCase();
  const named = NAMED_WEIGHTS.get(text);
  if (named !== undefined) return named;

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 400;
}

/** Coarse sweep resolution before bisection. Fine enough to not skip a narrow passing band. */
const SEARCH_SAMPLES = 48;

/** Bisection steps. 20 halvings of a <=1.0 interval land well inside 8-bit precision. */
const REFINE_STEPS = 20;

interface Candidate {
  color: Srgb;
  ratio: number;
  lightness: number;
}

function candidateAt(base: Srgb, background: Srgb, lightness: number): Candidate {
  const color = withOklabLightness(base, lightness);
  return { color, ratio: contrastRatio(color, background), lightness };
}

/**
 * Walk lightness from `startL` towards `endL` and return the nearest passing colour.
 *
 * Scans coarsely first and only then bisects, rather than bisecting from the
 * start: contrast is *not* strictly monotonic in lightness once gamut clamping
 * kicks in, and a naive bisection can walk into the wrong half. The bisection
 * invariant is that `pass` is always a colour whose ratio was actually
 * measured at or above the target, so the returned suggestion can never be a
 * near-miss.
 */
function searchTowards(
  base: Srgb,
  background: Srgb,
  target: number,
  startLightness: number,
  endLightness: number,
): Candidate | null {
  let failing = startLightness;
  let passing: Candidate | null = null;

  for (let step = 1; step <= SEARCH_SAMPLES; step += 1) {
    const lightness = startLightness + ((endLightness - startLightness) * step) / SEARCH_SAMPLES;
    const candidate = candidateAt(base, background, lightness);
    if (candidate.ratio >= target) {
      passing = candidate;
      break;
    }
    failing = lightness;
  }

  if (!passing) return null;

  for (let step = 0; step < REFINE_STEPS; step += 1) {
    const midpoint = (failing + passing.lightness) / 2;
    const candidate = candidateAt(base, background, midpoint);
    if (candidate.ratio >= target) passing = candidate;
    else failing = midpoint;
  }

  return passing;
}

/**
 * Nearest colour that reaches `targetRatio`, adjusting lightness only.
 *
 * Hue and chroma are held fixed in OKLab (equivalently: C and h are held fixed
 * in OKLCH), so the suggestion still reads as the same colour — a brand blue
 * stays a brand blue. Both directions are searched and the smaller perceptual
 * move wins, because "make it darker" and "make it lighter" are rarely equally
 * acceptable and the smaller change is the easier sell.
 *
 * Returns `null` when the pair already passes.
 */
export function suggestPassingForeground(
  foreground: Srgb,
  background: Srgb,
  targetRatio: number,
): Remediation | null {
  if (contrastRatio(foreground, background) >= targetRatio) return null;

  const startLightness = oklabLightness(foreground);
  const darker = searchTowards(foreground, background, targetRatio, startLightness, 0);
  const lighter = searchTowards(foreground, background, targetRatio, startLightness, 1);

  const darkerDelta = darker ? startLightness - darker.lightness : Number.POSITIVE_INFINITY;
  const lighterDelta = lighter ? lighter.lightness - startLightness : Number.POSITIVE_INFINITY;

  const winner: { candidate: Candidate; direction: LightnessDirection } | null =
    darker && darkerDelta <= lighterDelta
      ? { candidate: darker, direction: 'darker' }
      : lighter
        ? { candidate: lighter, direction: 'lighter' }
        : null;

  if (winner) {
    return {
      kind: 'lightness',
      color: winner.candidate.color,
      hex: formatHexColor(winner.candidate.color),
      ratio: round(winner.candidate.ratio),
      direction: winner.direction,
      deltaLightness: round(Math.abs(winner.candidate.lightness - startLightness), 4),
    };
  }

  const black = candidateAt(foreground, background, 0);
  const white = candidateAt(foreground, background, 1);
  const best = black.ratio >= white.ratio ? black : white;

  return {
    kind: 'unreachable',
    target: targetRatio,
    best: {
      color: best.color,
      hex: formatHexColor(best.color),
      ratio: round(best.ratio),
      direction: best === black ? 'darker' : 'lighter',
    },
  };
}

/** How the assessment should be graded and what a remediation aims at. */
export interface AssessOptions {
  /** Conformance level the remediation targets. Defaults to `'AA'`. */
  level?: WcagLevel;
  /** Set false to skip the (moderately expensive) remediation search. */
  suggestFix?: boolean;
}

/**
 * Assess one text sample.
 *
 * The indeterminate branch still reports the size bucket and the thresholds,
 * because those depend only on the font — the UI can say "this needed 4.5:1,
 * but the background is a gradient" instead of showing an empty panel.
 */
export function assessContrast(
  request: ContrastRequest,
  options: AssessOptions = {},
): ContrastVerdict {
  const textSize = classifyTextSize(request.fontSizePx, request.fontWeight);

  if (request.background.kind === 'indeterminate') {
    return {
      status: 'indeterminate',
      reason: request.background.reason,
      detail: request.background.detail,
      textSize,
      requiredAA: requiredRatio(textSize, 'AA'),
      requiredAAA: requiredRatio(textSize, 'AAA'),
    };
  }

  const background = request.background.color;
  const grade = gradeContrast(request.foreground, background, {
    fontSizePx: request.fontSizePx,
    fontWeight: request.fontWeight,
  });

  const level = options.level ?? 'AA';
  const target = requiredRatio(textSize, level);
  const wantsFix = options.suggestFix ?? true;

  return {
    ...grade,
    status: 'assessed',
    apcaLc: round(apcaLc(grade.effectiveForeground, background), 1),
    remediation: wantsFix
      ? suggestPassingForeground(grade.effectiveForeground, background, target)
      : null,
  };
}
