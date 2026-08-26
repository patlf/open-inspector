import { describe, expect, it } from 'vitest';
import type { ColorSource, ColorUsage } from './element-colors.js';
import type { SourceCounts } from './palette.js';
import {
  buildPalette,
  classifyColorRole,
  collectPalette,
  walkColorUsages,
} from './palette.js';
import { parseColor } from './parse.js';

/** Build `count` identical usages of a colour, so frequency is easy to state. */
function usages(css: string, source: ColorSource, count: number): ColorUsage[] {
  const color = parseColor(css);
  if (!color) throw new Error(`test colour did not parse: ${css}`);

  return Array.from({ length: count }, () => ({
    color,
    property: source === 'text' ? 'color' : 'background-color',
    source,
    raw: css,
  }));
}

function counts(overrides: Partial<SourceCounts>): SourceCounts {
  return { text: 0, background: 0, border: 0, outline: 0, shadow: 0, gradient: 0, ...overrides };
}

function styleOf(properties: Partial<CSSStyleDeclaration>): CSSStyleDeclaration {
  return properties as CSSStyleDeclaration;
}

describe('classifyColorRole', () => {
  it('names a colour after the kind of declaration it appears in most', () => {
    expect(classifyColorRole({ sources: counts({ text: 40 }), share: 0.5, chroma: 0.01 })).toBe(
      'text',
    );
    expect(
      classifyColorRole({ sources: counts({ background: 40 }), share: 0.5, chroma: 0.01 }),
    ).toBe('background');
    expect(classifyColorRole({ sources: counts({ border: 40 }), share: 0.5, chroma: 0.01 })).toBe(
      'border',
    );
  });

  it('groups gradients with backgrounds, and outlines and shadows with borders', () => {
    expect(
      classifyColorRole({ sources: counts({ gradient: 9, text: 4 }), share: 0.5, chroma: 0.01 }),
    ).toBe('background');
    expect(
      classifyColorRole({
        sources: counts({ outline: 5, shadow: 5, background: 4 }),
        share: 0.5,
        chroma: 0.01,
      }),
    ).toBe('border');
  });

  it('calls a saturated, rarely used colour an accent whatever it is painted on', () => {
    expect(
      classifyColorRole({ sources: counts({ background: 6 }), share: 0.02, chroma: 0.2 }),
    ).toBe('accent');
  });

  it('does not call a saturated colour an accent when the whole page is made of it', () => {
    expect(
      classifyColorRole({ sources: counts({ background: 600 }), share: 0.6, chroma: 0.2 }),
    ).toBe('background');
  });

  it('does not call a rare grey an accent', () => {
    expect(classifyColorRole({ sources: counts({ border: 2 }), share: 0.01, chroma: 0.005 })).toBe(
      'border',
    );
  });

  it('breaks ties towards the more informative attribution', () => {
    expect(
      classifyColorRole({ sources: counts({ text: 3, background: 3, border: 3 }), share: 0.5, chroma: 0 }),
    ).toBe('text');
    expect(
      classifyColorRole({ sources: counts({ background: 3, border: 3 }), share: 0.5, chroma: 0 }),
    ).toBe('background');
  });
});

describe('buildPalette', () => {
  it('counts usages and sorts by frequency', () => {
    const entries = buildPalette([
      ...usages('#ff0000', 'background', 2),
      ...usages('#0000ff', 'text', 5),
    ]);

    expect(entries.map((entry) => entry.formats.hex)).toEqual(['#0000ff', '#ff0000']);
    expect(entries[0]?.count).toBe(5);
    expect(entries[0]?.sources).toEqual(counts({ text: 5 }));
  });

  it('merges perceptually identical colours and keeps the most-used as representative', () => {
    // A page with a dozen hand-tuned greys should not produce a dozen rows.
    const entries = buildPalette([
      ...usages('#333333', 'text', 5),
      ...usages('#343434', 'text', 2),
      ...usages('#323232', 'border', 1),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.formats.hex).toBe('#333333');
    expect(entries[0]?.count).toBe(8);
    expect(entries[0]?.mergedCount).toBe(2);
    expect(entries[0]?.members).toEqual([
      { hex: '#333333', count: 5 },
      { hex: '#343434', count: 2 },
      { hex: '#323232', count: 1 },
    ]);
    expect(entries[0]?.sources).toEqual(counts({ text: 7, border: 1 }));
  });

  it('keeps colours a person would call different apart', () => {
    const entries = buildPalette([
      ...usages('#333333', 'text', 5),
      ...usages('#888888', 'text', 5),
      ...usages('#0055ff', 'background', 5),
    ]);

    expect(entries).toHaveLength(3);
  });

  it('never merges across alpha, however close the colours look', () => {
    // A hairline divider and body text are not the same colour, even though
    // alpha is not a perceptual axis and OKLab cannot see the difference.
    const entries = buildPalette([
      ...usages('#000000', 'text', 4),
      ...usages('#0000001a', 'border', 3),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.formats.hex)).toEqual(['#000000', '#0000001a']);
  });

  it('honours a custom merge distance', () => {
    const input = [...usages('#333333', 'text', 5), ...usages('#888888', 'text', 4)];

    expect(buildPalette(input, { mergeDistance: 0 })).toHaveLength(2);
    expect(buildPalette(input, { mergeDistance: 0.5 })).toHaveLength(1);
  });

  it('drops fully transparent colours unless asked for them', () => {
    const input = [
      ...usages('rgba(0, 0, 0, 0)', 'background', 50),
      ...usages('#ff0000', 'background', 2),
    ];

    expect(buildPalette(input).map((entry) => entry.formats.hex)).toEqual(['#ff0000']);
    expect(buildPalette(input, { includeTransparent: true })).toHaveLength(2);
  });

  it('gives the UI every string and structured form it needs', () => {
    const entries = buildPalette(usages('#ff0000', 'background', 1));
    const entry = entries[0];

    expect(entry?.formats).toEqual({
      hex: '#ff0000',
      rgb: 'rgb(255, 0, 0)',
      hsl: 'hsl(0, 100%, 50%)',
      oklch: 'oklch(0.628 0.258 29.2)',
    });
    expect(entry?.hsl).toMatchObject({ h: 0, s: 100, l: 50 });
    expect(entry?.oklch.c).toBeCloseTo(0.2577, 3);
    expect(entry?.color).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('is deterministic when counts tie', () => {
    const first = buildPalette([...usages('#ff0000', 'text', 2), ...usages('#0000ff', 'text', 2)]);
    const second = buildPalette([...usages('#0000ff', 'text', 2), ...usages('#ff0000', 'text', 2)]);

    expect(first.map((entry) => entry.formats.hex)).toEqual(second.map((entry) => entry.formats.hex));
  });

  it('returns nothing for no input', () => {
    expect(buildPalette([])).toEqual([]);
  });
});

describe('walkColorUsages', () => {
  function mount(html: string): Element {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
  }

  it('counts a colour once per occurrence and records where it came from', () => {
    const root = mount('<p>hello</p>');

    const walk = walkColorUsages(root, {
      readStyle: (element) =>
        styleOf(
          element.tagName === 'P'
            ? { color: 'rgb(255, 0, 0)', backgroundColor: 'rgb(0, 0, 255)' }
            : {},
        ),
    });

    expect(walk.elementsScanned).toBe(2);
    expect(walk.truncated).toBe(false);
    expect(walk.usages.map((usage) => usage.source)).toEqual(['text', 'background']);

    root.remove();
  });

  it('only counts text colour on elements that render text', () => {
    const root = mount('<div><span>hi</span></div>');

    const walk = walkColorUsages(root, {
      readStyle: () => styleOf({ color: 'rgb(255, 0, 0)' }),
    });

    // Three elements inherit the colour; one of them actually paints text.
    expect(walk.elementsScanned).toBe(3);
    expect(walk.usages).toHaveLength(1);

    root.remove();
  });

  it('skips non-rendered elements and their subtrees', () => {
    const root = mount('<style>.a { color: red }</style><script>const a = 1;</script><b>x</b>');

    const walk = walkColorUsages(root, {
      readStyle: () => styleOf({ color: 'rgb(255, 0, 0)' }),
    });

    expect(walk.elementsScanned).toBe(2);

    root.remove();
  });

  it('stops at the element budget and admits it', () => {
    const root = mount('<i></i>'.repeat(30));

    const walk = walkColorUsages(root, {
      maxElements: 5,
      readStyle: () => styleOf({ backgroundColor: 'rgb(255, 0, 0)' }),
    });

    expect(walk.elementsScanned).toBe(5);
    expect(walk.truncated).toBe(true);

    root.remove();
  });

  it('does not claim truncation when the budget exactly fits', () => {
    const root = mount('<i></i><i></i>');

    const walk = walkColorUsages(root, {
      maxElements: 3,
      readStyle: () => styleOf({ backgroundColor: 'rgb(255, 0, 0)' }),
    });

    expect(walk.elementsScanned).toBe(3);
    expect(walk.truncated).toBe(false);

    root.remove();
  });

  it('skips an excluded element together with its subtree', () => {
    const root = mount('<div id="overlay"><span>x</span><span>y</span></div><em>z</em>');

    const walk = walkColorUsages(root, {
      shouldSkip: (element) => element.id === 'overlay',
      readStyle: () => styleOf({ backgroundColor: 'rgb(255, 0, 0)' }),
    });

    expect(walk.elementsScanned).toBe(2);

    root.remove();
  });

  it('descends into open shadow roots, and stays out when told to', () => {
    const root = mount('<div id="host"></div>');
    const host = root.querySelector('#host');
    host?.attachShadow({ mode: 'open' }).appendChild(document.createElement('span'));

    const readStyle = (): CSSStyleDeclaration => styleOf({ backgroundColor: 'rgb(255, 0, 0)' });

    expect(walkColorUsages(root, { readStyle }).elementsScanned).toBe(3);
    expect(
      walkColorUsages(root, { readStyle, pierceShadowRoots: false }).elementsScanned,
    ).toBe(2);

    root.remove();
  });

  it('counts declarations it could not read', () => {
    const root = mount('<p>hi</p>');

    const walk = walkColorUsages(root, {
      readStyle: (element) => styleOf(element.tagName === 'P' ? { color: 'color(display-p3 1 0 0)' } : {}),
    });

    expect(walk.unreadable).toBe(1);
    expect(walk.usages).toEqual([]);

    root.remove();
  });

  it('accepts a document as its root and skips the head', () => {
    const walk = walkColorUsages(document, {
      readStyle: () => styleOf({}),
    });

    expect(walk.elementsScanned).toBeGreaterThan(0);
    expect(walk.truncated).toBe(false);
  });
});

describe('collectPalette', () => {
  it('walks, clusters and reports the whole picture in one call', () => {
    const container = document.createElement('div');
    // A body-text grey drifting across two hand-tuned shades, plus one button
    // in the brand colour: the shape of a real page, at small scale.
    const paragraphs = Array.from(
      { length: 20 },
      (_unused, index) => `<p class="${index % 4 === 0 ? 'b' : 'a'}">line ${index}</p>`,
    ).join('');
    container.innerHTML = `${paragraphs}<div class="panel"></div>`;
    document.body.appendChild(container);

    const result = collectPalette(container, {
      readStyle: (element) => {
        if (element.classList.contains('panel')) {
          return styleOf({ backgroundColor: 'rgb(0, 85, 255)' });
        }
        if (element.tagName === 'P') {
          const shade = element.classList.contains('b') ? '#343434' : '#333333';
          return styleOf({ color: shade, backgroundColor: 'rgba(0, 0, 0, 0)' });
        }
        return styleOf({});
      },
    });

    expect(result.elementsScanned).toBe(22);
    expect(result.truncated).toBe(false);
    expect(result.unreadable).toBe(0);
    expect(result.totalUsages).toBe(21);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ count: 20, role: 'text', mergedCount: 1 });
    expect(result.entries[0]?.formats.hex).toBe('#333333');
    expect(result.entries[0]?.members).toEqual([
      { hex: '#333333', count: 15 },
      { hex: '#343434', count: 5 },
    ]);
    expect(result.entries[1]).toMatchObject({ count: 1, role: 'accent' });
    expect(result.entries[1]?.formats.hex).toBe('#0055ff');

    container.remove();
  });

  it('does not call a colour an accent just because it is saturated', () => {
    // The accent rule needs a page to be rare *on*. On a three-element subtree
    // a blue panel is a quarter of everything, so "background" is the honest
    // answer — and this pins that boundary so nobody loosens it by accident.
    const container = document.createElement('div');
    container.innerHTML = '<p>one</p><div class="panel"></div>';
    document.body.appendChild(container);

    const result = collectPalette(container, {
      readStyle: (element) =>
        styleOf(
          element.classList.contains('panel')
            ? { backgroundColor: 'rgb(0, 85, 255)' }
            : { color: '#333333' },
        ),
    });

    expect(result.entries.find((entry) => entry.formats.hex === '#0055ff')?.role).toBe(
      'background',
    );

    container.remove();
  });

  it('reports truncation through to the caller', () => {
    const container = document.createElement('div');
    container.innerHTML = '<i></i>'.repeat(10);
    document.body.appendChild(container);

    const result = collectPalette(container, {
      maxElements: 4,
      readStyle: () => styleOf({ backgroundColor: 'rgb(255, 0, 0)' }),
    });

    expect(result.truncated).toBe(true);
    expect(result.elementsScanned).toBe(4);
    expect(result.entries[0]?.count).toBe(4);

    container.remove();
  });
});
