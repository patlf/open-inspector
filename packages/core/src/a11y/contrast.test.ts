import { describe, expect, it } from 'vitest';
import { round } from '../geometry/rect.js';
import type { Srgb } from './contrast.js';
import {
  apcaLc,
  classifyTextSize,
  compositeOver,
  contrastRatio,
  flattenForeground,
  gradeContrast,
  isLargeText,
  LARGE_BOLD_TEXT_MIN_PX,
  LARGE_TEXT_MIN_PX,
  relativeLuminance,
  requiredRatio,
} from './contrast.js';
import { parseHexColor } from './css-color.js';

/** Fixture helper: hex string to opaque colour, loud on a typo. */
function hex(value: string): Srgb {
  const parsed = parseHexColor(value);
  if (!parsed) throw new Error(`bad colour fixture: ${value}`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

const BLACK = hex('#000000');
const WHITE = hex('#ffffff');

describe('relativeLuminance', () => {
  it('anchors at 0 and 1', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 12);
  });

  it('uses the linear branch below the 0.04045 threshold', () => {
    // 10/255 = 0.0392 sits under the split; 11/255 = 0.0431 sits over it.
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(relativeLuminance({ r: 11, g: 11, b: 11 })).toBeCloseTo(
      ((11 / 255 + 0.055) / 1.055) ** 2.4,
      12,
    );
  });

  it('weights green most heavily', () => {
    expect(relativeLuminance(hex('#00ff00'))).toBeCloseTo(0.7152, 6);
    expect(relativeLuminance(hex('#ff0000'))).toBeCloseTo(0.2126, 6);
    expect(relativeLuminance(hex('#0000ff'))).toBeCloseTo(0.0722, 6);
  });

  it('clamps garbage channels instead of producing NaN', () => {
    expect(relativeLuminance({ r: Number.NaN, g: -5, b: 900 })).toBeCloseTo(0.0722, 6);
  });
});

describe('contrastRatio', () => {
  it('is exactly 21:1 for black on white', () => {
    expect(round(contrastRatio(BLACK, WHITE))).toBe(21);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 9);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio(hex('#3366cc'), hex('#3366cc'))).toBeCloseTo(1, 12);
  });

  it('does not depend on argument order', () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(contrastRatio(WHITE, BLACK));
  });

  it('matches published reference values', () => {
    expect(round(contrastRatio(hex('#777777'), WHITE))).toBe(4.48);
    expect(round(contrastRatio(hex('#767676'), WHITE))).toBe(4.54);
    expect(round(contrastRatio(hex('#0000ff'), WHITE))).toBe(8.59);
  });
});

describe('compositeOver', () => {
  it('returns the background at alpha 0 and the foreground at alpha 1', () => {
    expect(compositeOver({ ...BLACK, alpha: 0 }, WHITE)).toEqual(WHITE);
    expect(compositeOver({ ...BLACK, alpha: 1 }, WHITE)).toEqual(BLACK);
  });

  it('blends on gamma-encoded channels, matching what the browser paints', () => {
    expect(compositeOver({ r: 0, g: 0, b: 0, alpha: 0.5 }, WHITE)).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
    });
  });

  it('clamps a nonsense alpha rather than extrapolating', () => {
    expect(compositeOver({ ...BLACK, alpha: 5 }, WHITE)).toEqual(BLACK);
    expect(compositeOver({ ...BLACK, alpha: Number.NaN }, WHITE)).toEqual(WHITE);
  });
});

describe('flattenForeground', () => {
  it('passes an opaque colour through untouched', () => {
    expect(flattenForeground(hex('#123456'), WHITE)).toEqual(hex('#123456'));
  });

  it('collapses fully transparent text onto the background, giving a 1:1 ratio', () => {
    const flattened = flattenForeground({ ...BLACK, alpha: 0 }, WHITE);
    expect(contrastRatio(flattened, WHITE)).toBeCloseTo(1, 12);
  });
});

describe('isLargeText', () => {
  it('treats 18pt (24px) and up as large at any weight', () => {
    expect(LARGE_TEXT_MIN_PX).toBe(24);
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(32, 100)).toBe(true);
    expect(isLargeText(23.9, 400)).toBe(false);
  });

  it('applies the 14pt (18.667px) threshold only to bold text', () => {
    expect(LARGE_BOLD_TEXT_MIN_PX).toBeCloseTo(18.6667, 4);
    expect(isLargeText(18.6667, 700)).toBe(true);
    expect(isLargeText(18.6667, 400)).toBe(false);
  });

  it('does not treat semibold as bold', () => {
    // The classic off-by-one-step bug: 600 is not `font-weight: bold`.
    expect(isLargeText(20, 600)).toBe(false);
    expect(isLargeText(20, 700)).toBe(true);
  });

  it('absorbs the four-decimal rounding engines apply to computed font sizes', () => {
    expect(isLargeText(18.6666, 700)).toBe(true);
    expect(isLargeText(18.6, 700)).toBe(false);
  });

  it('survives missing numbers', () => {
    expect(isLargeText(Number.NaN, Number.NaN)).toBe(false);
  });
});

describe('requiredRatio', () => {
  it('encodes the four WCAG text minimums', () => {
    expect(requiredRatio('normal', 'AA')).toBe(4.5);
    expect(requiredRatio('large', 'AA')).toBe(3);
    expect(requiredRatio('normal', 'AAA')).toBe(7);
    expect(requiredRatio('large', 'AAA')).toBe(4.5);
  });

  it('agrees with classifyTextSize', () => {
    expect(classifyTextSize(14, 400)).toBe('normal');
    expect(classifyTextSize(24, 400)).toBe('large');
  });
});

describe('gradeContrast', () => {
  it('grades on the unrounded ratio, not the displayed one', () => {
    // #777 on white measures 4.478: it displays as "4.48" and still fails 4.5.
    const grade = gradeContrast(hex('#777777'), WHITE, { fontSizePx: 16, fontWeight: 400 });
    expect(grade.ratio).toBe(4.48);
    expect(grade.ratioExact).toBeLessThan(4.5);
    expect(grade.passesAA).toBe(false);
  });

  it('passes the same pair once it is large text', () => {
    const grade = gradeContrast(hex('#777777'), WHITE, { fontSizePx: 24, fontWeight: 400 });
    expect(grade.textSize).toBe('large');
    expect(grade.requiredAA).toBe(3);
    expect(grade.passesAA).toBe(true);
    // Large AAA is 4.5, which this pair still misses.
    expect(grade.passesAAA).toBe(false);
  });

  it('composites a translucent foreground before measuring', () => {
    const grade = gradeContrast({ ...BLACK, alpha: 0.5 }, WHITE, {
      fontSizePx: 16,
      fontWeight: 400,
    });
    expect(grade.effectiveForeground).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(grade.ratio).toBeCloseTo(3.98, 2);
    expect(grade.passesAA).toBe(false);
  });

  it('grades black on white as passing everything', () => {
    const grade = gradeContrast(BLACK, WHITE, { fontSizePx: 12, fontWeight: 400 });
    expect(grade.passesAA).toBe(true);
    expect(grade.passesAAA).toBe(true);
    expect(grade.ratio).toBe(21);
  });
});

describe('apcaLc', () => {
  it('matches the standard verification pair', () => {
    expect(apcaLc(BLACK, WHITE)).toBeCloseTo(106.04, 1);
    expect(apcaLc(WHITE, BLACK)).toBeCloseTo(-107.88, 1);
  });

  it('is polarity sensitive, unlike the WCAG ratio', () => {
    const forward = apcaLc(hex('#444444'), WHITE);
    const reverse = apcaLc(WHITE, hex('#444444'));
    expect(forward).toBeGreaterThan(0);
    expect(reverse).toBeLessThan(0);
    expect(Math.abs(forward)).not.toBeCloseTo(Math.abs(reverse), 2);
  });

  it('reports exactly zero for indistinguishable pairs', () => {
    expect(apcaLc(hex('#808080'), hex('#808080'))).toBe(0);
    expect(apcaLc(hex('#808080'), hex('#818181'))).toBe(0);
  });
});
