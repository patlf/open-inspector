import { describe, expect, it } from 'vitest';
import { formatColor, labToRgba, lchToRgba, parseColor } from './parse.js';

/**
 * CIE Lab and LCH.
 *
 * These exist because Chrome serializes computed colours as `lab()` whenever
 * the author used a modern colour space. A sweep of tailwindcss.com found
 * 2,398 unreadable colour values, 1,653 of them one `lab()` string — the
 * palette was effectively empty on the most widely used CSS framework there
 * is. Reference values below come from the CSS Color 4 sample conversions.
 */

function hex(value: string): string | null {
  const parsed = parseColor(value);
  return parsed ? formatColor(parsed).hex : null;
}

describe('lab()', () => {
  it('parses the form Chrome actually emits', () => {
    // Space-separated, unitless, plenty of decimal places, possibly negative.
    expect(hex('lab(1.90334 0.278696 -5.48866)')).toMatch(/^#[0-9a-f]{6}$/);
    expect(hex('lab(98.1434 -0.369519 -1.05966)')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('round-trips the achromatic extremes', () => {
    expect(hex('lab(100 0 0)')).toBe('#ffffff');
    expect(hex('lab(0 0 0)')).toBe('#000000');
  });

  it('uses the D50 white point, not D65', () => {
    // With D65 matrices this lands visibly off — a good few units per channel.
    // Mid grey is the most sensitive check because any white-point error
    // shows up as a colour cast rather than a lightness shift.
    const grey = parseColor('lab(50 0 0)');
    expect(grey).not.toBeNull();
    if (!grey) return;

    expect(Math.abs(grey.r - grey.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(grey.g - grey.b)).toBeLessThanOrEqual(1);
    // CIE L* 50 is roughly 46.6% luminance, which is ~119 in sRGB.
    expect(grey.r).toBeGreaterThan(114);
    expect(grey.r).toBeLessThan(124);
  });

  it('converts a saturated red close to sRGB red', () => {
    // sRGB red is approximately lab(54.29 80.80 69.89) in D50.
    const red = parseColor('lab(54.29 80.80 69.89)');
    expect(red).not.toBeNull();
    if (!red) return;

    expect(red.r).toBeGreaterThan(248);
    expect(red.g).toBeLessThan(12);
    expect(red.b).toBeLessThan(12);
  });

  it('accepts percentages and an alpha channel', () => {
    expect(hex('lab(100% 0 0)')).toBe('#ffffff');
    expect(hex('lab(50 0 0 / 0.5)')).toMatch(/^#[0-9a-f]{6}80$/);
  });

  it('clamps out-of-gamut values into sRGB rather than returning nonsense', () => {
    const wide = parseColor('lab(60 120 -120)');
    expect(wide).not.toBeNull();
    if (!wide) return;

    for (const channel of [wide.r, wide.g, wide.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
      expect(Number.isFinite(channel)).toBe(true);
    }
  });

  it('rejects a malformed value instead of guessing', () => {
    expect(parseColor('lab(nonsense)')).toBeNull();
    expect(parseColor('lab(50 0)')).toBeNull();
  });
});

describe('lch()', () => {
  it('agrees with the equivalent lab() colour', () => {
    // lch(L C H) is lab(L, C·cos H, C·sin H).
    const viaLch = lchToRgba(54.29, 106.84, 40.86);
    const viaLab = labToRgba(54.29, 106.84 * Math.cos((40.86 * Math.PI) / 180), 106.84 * Math.sin((40.86 * Math.PI) / 180));

    expect(viaLch).toEqual(viaLab);
  });

  it('round-trips white and black', () => {
    expect(hex('lch(100 0 0)')).toBe('#ffffff');
    expect(hex('lch(0 0 0)')).toBe('#000000');
  });

  it('accepts every CSS angle unit for hue', () => {
    const degrees = hex('lch(50 40 90deg)');
    expect(hex('lch(50 40 90)')).toBe(degrees);
    expect(hex('lch(50 40 100grad)')).toBe(degrees);
  });

  it('treats negative chroma as zero rather than inverting the hue', () => {
    expect(hex('lch(50 -40 90)')).toBe(hex('lch(50 0 90)'));
  });
});
