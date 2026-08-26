import { describe, expect, it, vi } from 'vitest';
import {
  buildFontShorthand,
  createCanvasMeasurer,
  createEmptyFontProbes,
  createFontDetector,
  createFontFaceChecker,
  detectRenderedFamily,
  isGenericFamily,
  normalizeFamily,
  parseFontStack,
  quoteFamily,
  readLoadedFamilies,
} from './rendered-family.js';
import type { FontProbes, MeasureText } from './rendered-family.js';

/**
 * A fake font system. Widths are per-character so the sample string length
 * drops out of the comparisons; families absent from the table are absent from
 * the machine, exactly like a real fallback.
 */
function createFakeMeasurer(installed: Record<string, number>): MeasureText {
  return (text, font) => {
    const stack = parseFontStack(font.replace(/^[\d.]+px\s+/, ''));
    for (const family of stack) {
      const width = installed[family.toLowerCase()];
      if (width !== undefined) return width * text.length;
    }
    return null;
  };
}

const SYSTEM: Record<string, number> = {
  monospace: 10,
  serif: 8,
  'sans-serif': 9,
};

function probesWith(
  installed: Record<string, number>,
  overrides: Partial<FontProbes> = {},
): FontProbes {
  return {
    loadedFamilies: new Set(),
    checkFamily: null,
    measureText: createFakeMeasurer({ ...SYSTEM, ...installed }),
    ...overrides,
  };
}

describe('parseFontStack', () => {
  it('splits and unquotes an authored stack', () => {
    expect(parseFontStack('Inter, "Segoe UI", system-ui, sans-serif')).toEqual([
      'Inter',
      'Segoe UI',
      'system-ui',
      'sans-serif',
    ]);
  });

  it('does not split on a comma inside a quoted family name', () => {
    expect(parseFontStack('"Ampersand, Bold", serif')).toEqual(['Ampersand, Bold', 'serif']);
  });

  it('unwraps escapes and collapses interior whitespace', () => {
    expect(parseFontStack('  Segoe   UI ,  \\"Odd\\" Name ')).toEqual(['Segoe UI', '"Odd" Name']);
  });

  it('drops empty entries from trailing or doubled commas', () => {
    expect(parseFontStack('Inter,, ,sans-serif,')).toEqual(['Inter', 'sans-serif']);
  });

  it('returns nothing for absent values', () => {
    expect(parseFontStack(null)).toEqual([]);
    expect(parseFontStack('')).toEqual([]);
  });
});

describe('quoteFamily', () => {
  it('leaves generics bare, since quoting turns them into face names', () => {
    expect(quoteFamily('sans-serif')).toBe('sans-serif');
    expect(quoteFamily('Monospace')).toBe('monospace');
  });

  it('leaves plain identifiers and multi-word identifiers unquoted', () => {
    expect(quoteFamily('Inter')).toBe('Inter');
    expect(quoteFamily('Segoe UI')).toBe('Segoe UI');
    expect(quoteFamily('-apple-system')).toBe('-apple-system');
  });

  it('quotes names a bare identifier cannot express', () => {
    expect(quoteFamily('72 Sans')).toBe('"72 Sans"');
    expect(quoteFamily('Foo "Bar"')).toBe('"Foo \\"Bar\\""');
  });
});

describe('buildFontShorthand', () => {
  it('races the candidate against the sentinel as its fallback', () => {
    expect(buildFontShorthand('Segoe UI', 'monospace')).toBe('72px Segoe UI, monospace');
    expect(buildFontShorthand('72 Sans', 'serif')).toBe('72px "72 Sans", serif');
  });

  it('never lists the sentinel twice', () => {
    expect(buildFontShorthand('monospace', 'monospace')).toBe('72px monospace');
  });
});

describe('normalizeFamily / isGenericFamily', () => {
  it('folds case and whitespace', () => {
    expect(normalizeFamily('  Segoe   UI ')).toBe('segoe ui');
  });

  it('knows the modern generics as well as the classic ones', () => {
    expect(isGenericFamily('system-ui')).toBe(true);
    expect(isGenericFamily('ui-monospace')).toBe(true);
    expect(isGenericFamily('Sans-Serif')).toBe(true);
    expect(isGenericFamily('Inter')).toBe(false);
  });
});

describe('detectRenderedFamily', () => {
  it('names the installed family, not the first entry of the stack', () => {
    const result = detectRenderedFamily(
      ['Inter', 'system-ui', 'sans-serif'],
      probesWith({ inter: 7, 'system-ui': 11 }),
    );

    expect(result.rendered).toBe('Inter');
    expect(result.method).toBe('canvas-metrics');
    expect(result.availability[0]).toEqual({
      family: 'Inter',
      available: true,
      evidence: 'canvas-metrics',
    });
  });

  it('falls through to the next family when the first is not installed', () => {
    const result = detectRenderedFamily(
      ['Inter', 'system-ui', 'sans-serif'],
      probesWith({ 'system-ui': 11 }),
    );

    expect(result.rendered).toBe('system-ui');
    expect(result.availability.map((entry) => entry.available)).toEqual([false, true, true]);
  });

  it('lands on the generic when nothing in the stack is installed', () => {
    const result = detectRenderedFamily(['Inter', 'Helvetica Neue', 'sans-serif'], probesWith({}));

    expect(result.rendered).toBe('sans-serif');
    expect(result.method).toBe('canvas-metrics');
  });

  it('detects a family that is metrically identical to one sentinel', () => {
    // Helvetica matching the sans-serif width is the classic false negative;
    // the serif and monospace sentinels still separate it.
    const result = detectRenderedFamily(['Helvetica', 'sans-serif'], probesWith({ helvetica: 9 }));

    expect(result.rendered).toBe('Helvetica');
  });

  it('reports null rather than guessing when nothing can be measured', () => {
    const result = detectRenderedFamily(['Inter', 'sans-serif'], createEmptyFontProbes());

    expect(result.rendered).toBeNull();
    expect(result.method).toBe('unknown');
    expect(result.availability[0]?.evidence).toBe('indeterminate');
  });

  it('suppresses the answer when an undetectable family sits ahead of a known one', () => {
    // Arial is definitely present, but Mystery might be too — and if it is, it
    // is what rendered. Naming Arial here would be the bug this module exists
    // to prevent.
    const probes: FontProbes = {
      loadedFamilies: new Set(['arial']),
      checkFamily: null,
      measureText: null,
    };

    const result = detectRenderedFamily(['Mystery', 'Arial'], probes);

    expect(result.rendered).toBeNull();
    expect(result.availability[1]?.available).toBe(true);
  });

  it('trusts a loaded @font-face without measuring that family', () => {
    const measureText = vi.fn(createFakeMeasurer(SYSTEM));
    const result = detectRenderedFamily(['Inter', 'sans-serif'], {
      loadedFamilies: new Set(['inter']),
      checkFamily: null,
      measureText,
    });

    expect(result.rendered).toBe('Inter');
    expect(result.method).toBe('font-face');
    // The rest of the stack is still evaluated for the availability list; the
    // point is that the webfont itself cost no canvas work.
    expect(measureText.mock.calls.some(([, font]) => font.includes('Inter'))).toBe(false);
  });

  it('ignores a @font-face declaration that has not finished loading', () => {
    // `loadedFamilies` only ever contains loaded faces, so an unloaded webfont
    // has to be resolved by measurement like any other missing family.
    const result = detectRenderedFamily(['Inter', 'sans-serif'], probesWith({}));

    expect(result.rendered).toBe('sans-serif');
  });

  it('uses the FontFaceSet fast path when it is trustworthy', () => {
    const result = detectRenderedFamily(['Inter', 'sans-serif'], {
      loadedFamilies: new Set(),
      checkFamily: (family) => family === 'Inter',
      measureText: null,
    });

    expect(result.rendered).toBe('Inter');
    expect(result.method).toBe('font-face');
  });

  it('never asks the FontFaceSet about a generic keyword', () => {
    const checkFamily = vi.fn(() => false);
    detectRenderedFamily(['sans-serif'], probesWith({}, { checkFamily }));

    expect(checkFamily).not.toHaveBeenCalled();
  });

  it('treats an unsupported modern generic as unavailable', () => {
    // A UA that does not know `ui-rounded` drops it from the stack entirely.
    const result = detectRenderedFamily(['ui-rounded', 'sans-serif'], probesWith({}));

    expect(result.availability[0]).toEqual({
      family: 'ui-rounded',
      available: false,
      evidence: 'canvas-metrics',
    });
    expect(result.rendered).toBe('sans-serif');
  });

  it('keeps a classic generic available even when every sentinel measures alike', () => {
    // Some systems map serif, sans-serif and monospace onto one physical face.
    const flat = probesWith({ monospace: 10, serif: 10, 'sans-serif': 10 });
    const result = detectRenderedFamily(['serif'], flat);

    expect(result.rendered).toBe('serif');
    expect(result.availability[0]?.evidence).toBe('generic');
    // Nothing was actually detected — the answer comes from the CSS guarantee.
    expect(result.method).toBe('unknown');
  });

  it('reports canvas metrics for a generic-only stack it could measure', () => {
    const result = detectRenderedFamily(['monospace'], probesWith({}));

    expect(result.rendered).toBe('monospace');
    expect(result.method).toBe('canvas-metrics');
  });

  it("copies the stack rather than aliasing the caller's array", () => {
    const stack = ['Inter', 'sans-serif'];
    const result = detectRenderedFamily(stack, probesWith({ inter: 7 }));

    stack.push('mutated');
    expect(result.stack).toEqual(['Inter', 'sans-serif']);
  });
});

describe('createFontDetector', () => {
  it('measures each family once across repeated stacks', () => {
    const measureText = vi.fn(createFakeMeasurer({ ...SYSTEM, inter: 7 }));
    const detector = createFontDetector({
      loadedFamilies: new Set(),
      checkFamily: null,
      measureText,
    });

    detector.detect(['Inter', 'sans-serif']);
    const callsAfterFirst = measureText.mock.calls.length;

    detector.detect(['Inter', 'sans-serif']);
    detector.detect(['sans-serif', 'Inter']);

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(measureText.mock.calls.length).toBe(callsAfterFirst);
  });

  it('returns the same result object for an identical stack', () => {
    const detector = createFontDetector(probesWith({ inter: 7 }));
    expect(detector.detect(['Inter'])).toBe(detector.detect(['Inter']));
  });
});

describe('createFontFaceChecker', () => {
  it('disables itself when the engine answers true for a family that cannot exist', () => {
    // Some engines report every family as checkable because the last-resort
    // font can render the sample. A fast path that never says no is worse than
    // none, so it is refused outright.
    expect(createFontFaceChecker({ check: () => true })).toBeNull();
  });

  it('wraps a well-behaved check()', () => {
    const check = createFontFaceChecker({
      check: (font: string) => font.includes('Inter'),
    });

    expect(check).not.toBeNull();
    expect(check?.('Inter')).toBe(true);
    expect(check?.('Nope')).toBe(false);
  });

  it('refuses an implementation that throws on calibration', () => {
    expect(
      createFontFaceChecker({
        check: () => {
          throw new Error('SyntaxError');
        },
      }),
    ).toBeNull();
  });

  it('is null when the document has no FontFaceSet at all', () => {
    expect(createFontFaceChecker(undefined)).toBeNull();
  });
});

describe('readLoadedFamilies', () => {
  it('keeps only faces that have finished loading, unquoted and folded', () => {
    const faces = [
      { family: '"Inter Display"', status: 'loaded' },
      { family: 'Lazy', status: 'unloaded' },
      { family: 'Broken', status: 'error' },
      { family: 'Recoleta', status: 'loaded' },
    ];
    const fonts = {
      forEach: (callback: (face: FontFace) => void) => {
        for (const face of faces) callback(face as unknown as FontFace);
      },
    } as unknown as FontFaceSet;

    expect([...readLoadedFamilies(fonts)]).toEqual(['inter display', 'recoleta']);
  });

  it('returns an empty set when there is no FontFaceSet', () => {
    expect(readLoadedFamilies(undefined).size).toBe(0);
  });
});

describe('createCanvasMeasurer', () => {
  it('is null when no 2D context can be obtained', () => {
    const doc = {
      createElement: () => ({ getContext: () => null }),
    } as unknown as Document;

    expect(createCanvasMeasurer(doc)).toBeNull();
  });

  it('is null when creating the canvas throws', () => {
    const doc = {
      createElement: () => {
        throw new Error('no canvas');
      },
    } as unknown as Document;

    expect(createCanvasMeasurer(doc)).toBeNull();
  });

  it('refuses to report a width when the context rejected the font shorthand', () => {
    // Assigning an invalid `font` is a silent no-op in canvas. Without the
    // readback guard every family would measure identically to the last valid
    // one and the whole stack would look unavailable.
    const context = {
      measureText: (text: string) => ({ width: text.length }),
    };
    Object.defineProperty(context, 'font', {
      get: () => '10px sans-serif',
      set: () => undefined,
    });

    const doc = {
      createElement: () => ({ getContext: () => context }),
    } as unknown as Document;

    const measure = createCanvasMeasurer(doc);
    expect(measure).not.toBeNull();
    expect(measure?.('abc', '72px Inter, monospace')).toBeNull();
  });

  it('measures when the shorthand took effect', () => {
    const context = {
      font: '10px sans-serif',
      measureText: (text: string) => ({ width: text.length * 3 }),
    };
    const doc = {
      createElement: () => ({ getContext: () => context }),
    } as unknown as Document;

    expect(createCanvasMeasurer(doc)?.('abcd', '72px Inter, monospace')).toBe(12);
  });
});
