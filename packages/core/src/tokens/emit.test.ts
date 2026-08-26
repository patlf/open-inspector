import { describe, expect, it } from 'vitest';
import {
  emitCssVariables,
  emitJson,
  emitLlmHandoff,
  emitScssVariables,
  emitTailwindConfig,
  emitW3cTokens,
  emitAll,
} from './emit.js';
import {
  hexToRgb,
  lightnessStep,
  nameColor,
  nameScale,
  rgbToHsl,
  slug,
  uniquify,
} from './naming.js';
import type { TokenSet } from './types.js';

const SET: TokenSet = {
  colors: [
    { hex: '#1d4ed8', role: 'accent', usage: 12 },
    { hex: '#111827', role: 'text', usage: 40 },
    { hex: '#ffffff', role: 'background', usage: 90 },
  ],
  fonts: [{ family: 'Inter', usage: 30 }, { family: 'JetBrains Mono', usage: 4 }],
  fontSizes: [{ px: 16 }, { px: 14 }, { px: 24 }],
  spacing: [{ px: 16 }, { px: 8 }, { px: 24 }],
  radii: [{ px: 4 }],
  shadows: [{ value: '0 1px 2px rgba(0,0,0,0.1)' }],
  source: 'example.com',
};

describe('naming', () => {
  it('parses shorthand and full hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('1d4ed8')).toEqual({ r: 29, g: 78, b: 216 });
    expect(hexToRgb('#ff000080')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('rejects nonsense rather than producing NaN channels', () => {
    expect(hexToRgb('not-a-color')).toBeNull();
    expect(hexToRgb('#12')).toBeNull();
  });

  it('converts to HSL', () => {
    expect(rgbToHsl(255, 0, 0)).toMatchObject({ h: 0, s: 100, l: 50 });
    const grey = rgbToHsl(128, 128, 128);
    expect(grey.s).toBe(0);
    expect(Math.round(grey.l)).toBe(50);
  });

  it('names greys by lightness, not by an incidental hue cast', () => {
    // A near-neutral with a two-degree cast is not "blue-200" in any useful sense.
    expect(nameColor({ hex: '#808080' })).toMatch(/^gray-/);
    expect(nameColor({ hex: '#ffffff' })).toBe('white');
    expect(nameColor({ hex: '#000000' })).toBe('black');
  });

  it('names saturated colours by hue and lightness step', () => {
    expect(nameColor({ hex: '#1d4ed8' })).toMatch(/^blue-\d+$/);
    expect(nameColor({ hex: '#dc2626' })).toMatch(/^red-\d+$/);
  });

  it('raises the step number as the colour darkens', () => {
    // The Tailwind convention: 50 is the palest tint, 950 nearly black.
    // Inverting this produces names that actively mislead — a pale `blue-900`.
    expect(lightnessStep(96)).toBeLessThan(lightnessStep(50));
    expect(lightnessStep(50)).toBeLessThan(lightnessStep(8));

    const pale = nameColor({ hex: '#dbeafe' });
    const dark = nameColor({ hex: '#1e3a8a' });
    expect(Number(pale.split('-')[1])).toBeLessThan(Number(dark.split('-')[1]));
  });

  it('treats near-neutrals as greys, however HSL reports their saturation', () => {
    // #dbe0e3 spans 8/255 across its channels — plainly a grey. HSL divides by
    // lightness and calls it 12% saturated, which would name it `blue-100`.
    expect(nameColor({ hex: '#dbe0e3' })).toMatch(/^gray-/);
    expect(nameColor({ hex: '#14181c' })).toMatch(/^gray-/);
    expect(nameColor({ hex: '#f7f8f9' })).toMatch(/^gray-/);
  });

  it('prefers an explicit name when the caller supplies one', () => {
    expect(nameColor({ hex: '#1d4ed8', name: 'Brand Primary' })).toBe('brand-primary');
  });

  it('breaks collisions deterministically, first occurrence keeping the clean name', () => {
    const named = uniquify([{ v: 'a' }, { v: 'a' }, { v: 'a' }], () => 'gray-500');
    expect(named.map((entry) => entry.name)).toEqual(['gray-500', 'gray-500-2', 'gray-500-3']);
  });

  it('names numeric scales by magnitude, not discovery order', () => {
    const named = nameScale([{ px: 24 }, { px: 4 }, { px: 12 }]);
    expect(named.map((entry) => `${entry.name}:${entry.token.px}`)).toEqual(['1:4', '2:12', '3:24']);
  });

  it('slugs safely for CSS custom property names', () => {
    expect(slug('  Brand "Primary" / Dark  ')).toBe('brand-primary-dark');
  });
});

describe('emitCssVariables', () => {
  it('emits a :root block with every token family', () => {
    const css = emitCssVariables(SET);

    expect(css).toContain(':root {');
    expect(css).toContain('--color-white: #ffffff;');
    expect(css).toContain('--font-inter: Inter;');
    expect(css).toContain('--space-1: 8px;');
    expect(css).toContain('--space-3: 24px;');
    expect(css).toContain('--radius-1: 4px;');
    expect(css).toContain('--shadow-1: 0 1px 2px rgba(0,0,0,0.1);');
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('quotes multi-word families', () => {
    expect(emitCssVariables(SET)).toContain('--font-jetbrains-mono: "JetBrains Mono";');
  });

  it('is deterministic', () => {
    expect(emitCssVariables(SET)).toBe(emitCssVariables(SET));
  });
});

describe('emitTailwindConfig', () => {
  it('reuses Tailwind spacing keys where the values line up', () => {
    const config = emitTailwindConfig(SET);

    // 8px is Tailwind's `2`, 16px is `4`, 24px is `6`.
    expect(config).toContain("2: '8px',");
    expect(config).toContain("4: '16px',");
    expect(config).toContain("6: '24px',");
  });

  it('falls back to a px key for off-scale values', () => {
    const config = emitTailwindConfig({ ...SET, spacing: [{ px: 13 }] });
    expect(config).toContain("'13px': '13px',");
  });

  it('produces a parseable module', () => {
    const config = emitTailwindConfig(SET);
    expect(config.startsWith('/*')).toBe(true);
    expect(config).toContain('module.exports = {');
    expect(config.trimEnd().endsWith('};')).toBe(true);
  });
});

describe('emitJson and emitW3cTokens', () => {
  it('emits valid JSON', () => {
    expect(() => JSON.parse(emitJson(SET))).not.toThrow();
    expect(() => JSON.parse(emitW3cTokens(SET))).not.toThrow();
  });

  it('uses the W3C $value / $type shape', () => {
    const parsed = JSON.parse(emitW3cTokens(SET));
    expect(parsed.color.$type).toBe('color');
    expect(parsed.color.white).toEqual({ $value: '#ffffff' });
    expect(parsed.spacing.$type).toBe('dimension');
  });

  it('omits radius from JSON when there are none', () => {
    const parsed = JSON.parse(emitJson({ ...SET, radii: [] }));
    expect(parsed.radius).toBeUndefined();
  });
});

describe('emitScssVariables', () => {
  it('emits $-prefixed variables', () => {
    const scss = emitScssVariables(SET);
    expect(scss).toContain('$color-white: #ffffff;');
    expect(scss).toContain('$space-1: 8px;');
  });
});

describe('emitLlmHandoff', () => {
  it('leads with an instruction that constrains the model', () => {
    const markdown = emitLlmHandoff(SET);
    expect(markdown).toContain('Use these exact values');
    expect(markdown).toContain('do not invent');
  });

  it('carries roles and usage counts, which is what makes it useful', () => {
    expect(emitLlmHandoff(SET)).toContain('`white` #ffffff — background (90×)');
  });

  it('includes layout notes when present', () => {
    const markdown = emitLlmHandoff({ ...SET, notes: ['3-column auto-fit grid, 24px gaps'] });
    expect(markdown).toContain('## Layout');
    expect(markdown).toContain('- 3-column auto-fit grid, 24px gaps');
  });

  it('stays compact — a context window is not free', () => {
    // Rough proxy for token count. A full computed-style dump would be many
    // times this and would crowd out the code the model should be writing.
    expect(emitLlmHandoff(SET).length).toBeLessThan(1200);
  });

  it('omits empty sections rather than emitting dangling headings', () => {
    const markdown = emitLlmHandoff({ colors: [], fonts: [], fontSizes: [], spacing: [] });
    expect(markdown).not.toContain('**families:**');
    expect(markdown).not.toContain('## Layout');
  });
});

describe('emitAll', () => {
  it('returns every format with a stable id and non-empty text', () => {
    const formats = emitAll(SET);

    expect(formats.map((format) => format.id)).toEqual([
      'css',
      'tailwind',
      'json',
      'w3c',
      'scss',
      'llm',
    ]);
    for (const format of formats) {
      expect(format.text.length).toBeGreaterThan(0);
      expect(format.label).toBeTruthy();
    }
  });

  it('survives a completely empty token set', () => {
    const empty: TokenSet = { colors: [], fonts: [], fontSizes: [], spacing: [] };
    for (const format of emitAll(empty)) {
      expect(typeof format.text).toBe('string');
    }
  });
});
