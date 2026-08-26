import { describe, expect, it } from 'vitest';
import type { Srgb } from './contrast.js';
import { contrastRatio } from './contrast.js';
import { parseHexColor } from './css-color.js';
import type { ResolvedBackground } from './assess.js';
import { assessContrast, normalizeFontWeight, suggestPassingForeground } from './assess.js';

function hex(value: string): Srgb {
  const parsed = parseHexColor(value);
  if (!parsed) throw new Error(`bad colour fixture: ${value}`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

const WHITE = hex('#ffffff');
const BLACK = hex('#000000');

function solid(color: Srgb): ResolvedBackground {
  return { kind: 'solid', color };
}

describe('normalizeFontWeight', () => {
  it('maps the keywords', () => {
    expect(normalizeFontWeight('normal')).toBe(400);
    expect(normalizeFontWeight('bold')).toBe(700);
    expect(normalizeFontWeight('BOLD')).toBe(700);
  });

  it('parses the numeric strings computed styles return', () => {
    expect(normalizeFontWeight('700')).toBe(700);
    expect(normalizeFontWeight(350)).toBe(350);
  });

  it('falls back to 400 for relative keywords and junk, keeping the stricter threshold', () => {
    expect(normalizeFontWeight('bolder')).toBe(400);
    expect(normalizeFontWeight('lighter')).toBe(400);
    expect(normalizeFontWeight('')).toBe(400);
    expect(normalizeFontWeight(null)).toBe(400);
    expect(normalizeFontWeight(undefined)).toBe(400);
    expect(normalizeFontWeight(Number.NaN)).toBe(400);
  });
});

describe('assessContrast', () => {
  it('grades a solid pair and reports the thresholds it used', () => {
    const verdict = assessContrast({
      foreground: hex('#777777'),
      background: solid(WHITE),
      fontSizePx: 16,
      fontWeight: 400,
    });

    expect(verdict.status).toBe('assessed');
    if (verdict.status !== 'assessed') return;

    expect(verdict.ratio).toBe(4.48);
    expect(verdict.textSize).toBe('normal');
    expect(verdict.requiredAA).toBe(4.5);
    expect(verdict.requiredAAA).toBe(7);
    expect(verdict.passesAA).toBe(false);
    expect(verdict.apcaLc).toBeGreaterThan(0);
  });

  it('composites a translucent foreground before grading', () => {
    const verdict = assessContrast({
      foreground: { ...BLACK, alpha: 0.4 },
      background: solid(WHITE),
      fontSizePx: 16,
      fontWeight: 400,
    });

    expect(verdict.status).toBe('assessed');
    if (verdict.status !== 'assessed') return;

    expect(verdict.effectiveForeground.r).toBeCloseTo(153, 6);
    expect(verdict.passesAA).toBe(false);
    // Without compositing this would have graded as 21:1.
    expect(verdict.ratio).toBeLessThan(5);
  });

  it('refuses to guess a background it was told is indeterminate', () => {
    const verdict = assessContrast({
      foreground: WHITE,
      background: {
        kind: 'indeterminate',
        reason: 'gradient',
        detail: 'linear-gradient(90deg, #000, #fff)',
      },
      fontSizePx: 32,
      fontWeight: 400,
    });

    expect(verdict.status).toBe('indeterminate');
    if (verdict.status !== 'indeterminate') return;

    expect(verdict.reason).toBe('gradient');
    expect(verdict.detail).toBe('linear-gradient(90deg, #000, #fff)');
    // The font-derived facts are still known and still worth showing.
    expect(verdict.textSize).toBe('large');
    expect(verdict.requiredAA).toBe(3);
    expect(verdict.requiredAAA).toBe(4.5);
    expect('ratio' in verdict).toBe(false);
  });

  it('omits a remediation when the pair already passes', () => {
    const verdict = assessContrast({
      foreground: BLACK,
      background: solid(WHITE),
      fontSizePx: 16,
      fontWeight: 400,
    });

    expect(verdict.status).toBe('assessed');
    if (verdict.status !== 'assessed') return;
    expect(verdict.remediation).toBeNull();
  });

  it('targets the requested level when suggesting a fix', () => {
    const aa = assessContrast(
      { foreground: hex('#777777'), background: solid(WHITE), fontSizePx: 16, fontWeight: 400 },
      { level: 'AA' },
    );
    const aaa = assessContrast(
      { foreground: hex('#777777'), background: solid(WHITE), fontSizePx: 16, fontWeight: 400 },
      { level: 'AAA' },
    );

    if (aa.status !== 'assessed' || aaa.status !== 'assessed') throw new Error('expected grades');
    if (aa.remediation?.kind !== 'lightness' || aaa.remediation?.kind !== 'lightness') {
      throw new Error('expected lightness suggestions');
    }

    expect(aa.remediation.ratio).toBeGreaterThanOrEqual(4.5);
    expect(aaa.remediation.ratio).toBeGreaterThanOrEqual(7);
    // Reaching AAA needs a bigger move than reaching AA.
    expect(aaa.remediation.deltaLightness).toBeGreaterThan(aa.remediation.deltaLightness);
  });

  it('can skip the remediation search', () => {
    const verdict = assessContrast(
      { foreground: hex('#777777'), background: solid(WHITE), fontSizePx: 16, fontWeight: 400 },
      { suggestFix: false },
    );
    if (verdict.status !== 'assessed') throw new Error('expected a grade');
    expect(verdict.remediation).toBeNull();
  });
});

describe('suggestPassingForeground', () => {
  it('returns null when nothing needs fixing', () => {
    expect(suggestPassingForeground(BLACK, WHITE, 4.5)).toBeNull();
  });

  it('suggests a colour whose measured ratio really does meet the target', () => {
    const remediation = suggestPassingForeground(hex('#777777'), WHITE, 4.5);
    if (remediation?.kind !== 'lightness') throw new Error('expected a lightness suggestion');

    // Re-measure independently: the suggestion must not be a near-miss.
    const achieved = contrastRatio(remediation.color, WHITE);
    expect(achieved).toBeGreaterThanOrEqual(4.5);
    // ...and it must not overshoot: #767676 is the lightest grey clearing
    // 4.5:1 on white, so anything materially darker means the search overshot.
    expect(achieved).toBeLessThan(4.7);
    expect(remediation.direction).toBe('darker');
    expect(remediation.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('moves the smaller distance, which on a dark background means lighter', () => {
    const remediation = suggestPassingForeground(hex('#333333'), BLACK, 4.5);
    if (remediation?.kind !== 'lightness') throw new Error('expected a lightness suggestion');
    expect(remediation.direction).toBe('lighter');
    expect(contrastRatio(remediation.color, BLACK)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps hue and chroma so a brand colour stays recognisable', () => {
    const orange = hex('#ff8800');
    const remediation = suggestPassingForeground(orange, WHITE, 4.5);
    if (remediation?.kind !== 'lightness') throw new Error('expected a lightness suggestion');

    expect(remediation.color.r).toBeGreaterThan(remediation.color.g);
    expect(remediation.color.g).toBeGreaterThan(remediation.color.b);
    expect(contrastRatio(remediation.color, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('stays as close to the original as it can', () => {
    const remediation = suggestPassingForeground(hex('#777777'), WHITE, 4.5);
    if (remediation?.kind !== 'lightness') throw new Error('expected a lightness suggestion');
    // One step lighter must already fail, or the search overshot.
    const overshoot = { r: remediation.color.r + 2, g: remediation.color.g + 2, b: remediation.color.b + 2 };
    expect(contrastRatio(overshoot, WHITE)).toBeLessThan(4.5);
  });

  it('admits when lightness alone cannot reach the target', () => {
    // On mid-grey the best possible is black at ~5.3:1, so AAA normal is out of reach.
    const remediation = suggestPassingForeground(hex('#808080'), hex('#808080'), 7);
    if (remediation?.kind !== 'unreachable') throw new Error('expected an unreachable verdict');

    expect(remediation.target).toBe(7);
    expect(remediation.best.ratio).toBeCloseTo(5.32, 2);
    expect(remediation.best.direction).toBe('darker');
    expect(remediation.best.hex).toBe('#000000');
  });
});
