import { beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedBackground } from './assess.js';
import { parseHexColor } from './css-color.js';
import type { ContrastScanOptions, VisibilityVerdict } from './scan.js';
import {
  classifySeverity,
  classifyVisibility,
  collapseWhitespace,
  directText,
  scanContrast,
} from './scan.js';

/**
 * happy-dom does not compute layout or cascade styles, so every DOM read the
 * scan performs is stubbed from `data-*` attributes. That is the point of the
 * injection seams: the walk logic is what is under test here.
 */
function fakeStyle(element: Element): CSSStyleDeclaration {
  const values: Record<string, string> = {
    color: element.getAttribute('data-color') ?? 'rgb(0, 0, 0)',
    display: element.getAttribute('data-display') ?? 'block',
    visibility: element.getAttribute('data-visibility') ?? 'visible',
    opacity: element.getAttribute('data-opacity') ?? '1',
    fontSize: element.getAttribute('data-size') ?? '16px',
    fontWeight: element.getAttribute('data-weight') ?? '400',
    'content-visibility': element.getAttribute('data-content-visibility') ?? 'visible',
  };

  return {
    ...values,
    getPropertyValue: (property: string): string => values[property] ?? '',
  } as unknown as CSSStyleDeclaration;
}

function fakeBackground(element: Element): ResolvedBackground {
  const raw = element.getAttribute('data-bg');
  if (raw === 'gradient') {
    return { kind: 'indeterminate', reason: 'gradient', detail: 'linear-gradient(...)' };
  }
  const parsed = parseHexColor(raw ?? '#ffffff');
  if (!parsed) throw new Error(`bad background fixture: ${String(raw)}`);
  return { kind: 'solid', color: { r: parsed.r, g: parsed.g, b: parsed.b } };
}

function fakeVisibility(element: Element, style: CSSStyleDeclaration): VisibilityVerdict {
  const size = element.hasAttribute('data-zero-size') ? 0 : 20;
  return classifyVisibility({
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    contentVisibility: style.getPropertyValue('content-visibility'),
    width: size === 0 ? 0 : 100,
    height: size,
  });
}

function options(overrides: Partial<ContrastScanOptions> = {}): ContrastScanOptions {
  return {
    resolveBackground: fakeBackground,
    getStyle: fakeStyle,
    classifyElementVisibility: fakeVisibility,
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('collapseWhitespace', () => {
  it('flattens newlines and runs of spaces', () => {
    expect(collapseWhitespace('  hello \n\t world  ')).toBe('hello world');
    expect(collapseWhitespace(' ')).toBe('');
  });
});

describe('directText', () => {
  it('ignores text owned by descendants', () => {
    document.body.innerHTML = '<p id="p">Hello <b id="b">World</b>!</p>';
    const paragraph = document.getElementById('p');
    const bold = document.getElementById('b');
    expect(paragraph && directText(paragraph)).toBe('Hello !');
    expect(bold && directText(bold)).toBe('World');
  });

  it('treats a whitespace-only wrapper as textless', () => {
    document.body.innerHTML = '<div id="d">\n  <span>x</span>\n</div>';
    const wrapper = document.getElementById('d');
    expect(wrapper && directText(wrapper)).toBe('');
  });
});

describe('classifyVisibility', () => {
  const base = {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    contentVisibility: 'visible',
    width: 100,
    height: 20,
  };

  it('prunes subtrees that can never render', () => {
    expect(classifyVisibility({ ...base, display: 'none' })).toBe('hidden-subtree');
    expect(classifyVisibility({ ...base, opacity: '0' })).toBe('hidden-subtree');
    expect(classifyVisibility({ ...base, contentVisibility: 'hidden' })).toBe('hidden-subtree');
  });

  it('only skips the element itself when a descendant could still show', () => {
    // `visibility` is inherited but revertible: a child may set `visible`.
    expect(classifyVisibility({ ...base, visibility: 'hidden' })).toBe('hidden');
    expect(classifyVisibility({ ...base, visibility: 'collapse' })).toBe('hidden');
    // A zero-sized box can still have overflowing or absolutely positioned children.
    expect(classifyVisibility({ ...base, width: 0 })).toBe('hidden');
    expect(classifyVisibility({ ...base, height: 0 })).toBe('hidden');
  });

  it('passes ordinary rendered boxes', () => {
    expect(classifyVisibility(base)).toBe('visible');
    expect(classifyVisibility({ ...base, opacity: '0.01' })).toBe('visible');
  });

  it('does not treat an unparsable opacity as invisible', () => {
    expect(classifyVisibility({ ...base, opacity: '' })).toBe('visible');
  });
});

describe('classifySeverity', () => {
  it('calls anything below 3:1 critical regardless of size', () => {
    expect(classifySeverity(1, 3)).toBe('critical');
    expect(classifySeverity(2.99, 4.5)).toBe('critical');
  });

  it('calls a normal-text miss serious', () => {
    expect(classifySeverity(4.4, 4.5)).toBe('serious');
  });

  it('reserves moderate for samples that clear AA but were scanned at AAA', () => {
    expect(classifySeverity(5, 4.5)).toBe('moderate');
  });
});

describe('scanContrast', () => {
  it('finds text-bearing elements and grades them', () => {
    document.body.innerHTML = `
      <p data-color="#777777" data-bg="#ffffff">low contrast</p>
      <p data-color="#000000" data-bg="#ffffff">high contrast</p>
    `;

    const result = scanContrast(document.body, options());

    expect(result.assessed).toBe(2);
    expect(result.passes).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.text).toBe('low contrast');
    expect(result.failures[0]?.verdict.ratio).toBe(4.48);
    expect(result.failures[0]?.required).toBe(4.5);
    expect(result.failures[0]?.severity).toBe('serious');
    expect(result.truncated).toBe(false);
  });

  it('grades a wrapper and its child separately, not the wrapper twice', () => {
    document.body.innerHTML =
      '<div data-color="#999999" data-bg="#ffffff">outer <span data-color="#000000" data-bg="#ffffff">inner</span></div>';

    const result = scanContrast(document.body, options());

    expect(result.assessed).toBe(2);
    expect(result.failures.map((finding) => finding.text)).toEqual(['outer']);
  });

  it('skips elements with no direct text of their own', () => {
    document.body.innerHTML = '<div data-bg="#ffffff"><p data-color="#000000">ok</p></div>';
    const result = scanContrast(document.body, options());
    expect(result.assessed).toBe(1);
  });

  it('never reads script, style or title text', () => {
    document.body.innerHTML = `
      <style data-color="#ffffff" data-bg="#ffffff">.a { color: red }</style>
      <script data-color="#ffffff" data-bg="#ffffff">var a = 1;</script>
      <noscript data-color="#ffffff" data-bg="#ffffff">enable js</noscript>
    `;
    const result = scanContrast(document.body, options());
    expect(result.assessed).toBe(0);
    expect(result.failures).toHaveLength(0);
  });

  it('prunes display:none subtrees but keeps walking past visibility:hidden', () => {
    document.body.innerHTML = `
      <div data-display="none"><p data-color="#eeeeee" data-bg="#ffffff">gone</p></div>
      <div data-visibility="hidden">
        <p data-visibility="visible" data-color="#eeeeee" data-bg="#ffffff">revealed</p>
      </div>
    `;

    const result = scanContrast(document.body, options());

    expect(result.failures.map((finding) => finding.text)).toEqual(['revealed']);
  });

  it('skips zero-sized and fully transparent text without calling it a failure', () => {
    document.body.innerHTML = `
      <p data-zero-size data-color="#eeeeee" data-bg="#ffffff">collapsed</p>
      <p data-color="transparent" data-bg="#ffffff">invisible</p>
    `;

    const result = scanContrast(document.body, options());

    expect(result.failures).toHaveLength(0);
    expect(result.assessed).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(2);
  });

  it('reports an indeterminate background instead of guessing one', () => {
    document.body.innerHTML = '<p data-color="#ffffff" data-bg="gradient">over a gradient</p>';

    const result = scanContrast(document.body, options());

    expect(result.failures).toHaveLength(0);
    expect(result.indeterminate).toHaveLength(1);
    expect(result.indeterminate[0]?.reason).toBe('gradient');
    expect(result.indeterminate[0]?.text).toBe('over a gradient');
  });

  it('reports a colour it cannot parse as indeterminate too', () => {
    document.body.innerHTML = '<p data-color="oklch(0.7 0.15 250)" data-bg="#ffffff">modern</p>';

    const result = scanContrast(document.body, options());

    expect(result.indeterminate[0]?.reason).toBe('unparsable-color');
    expect(result.indeterminate[0]?.detail).toBe('oklch(0.7 0.15 250)');
  });

  it('applies the large-text threshold from the element font', () => {
    document.body.innerHTML = `
      <p data-size="24px" data-color="#777777" data-bg="#ffffff">large</p>
      <p data-size="18.6667px" data-weight="700" data-color="#777777" data-bg="#ffffff">bold large</p>
      <p data-size="18.6667px" data-weight="600" data-color="#777777" data-bg="#ffffff">semibold</p>
    `;

    const result = scanContrast(document.body, options());

    // 4.48:1 clears the 3:1 large-text bar but not the 4.5:1 normal one.
    expect(result.passes).toBe(2);
    expect(result.failures.map((finding) => finding.text)).toEqual(['semibold']);
  });

  it('sorts by how far each sample misses its own requirement', () => {
    document.body.innerHTML = `
      <p data-color="#949494" data-bg="#ffffff">mild</p>
      <p data-color="#eeeeee" data-bg="#ffffff">severe</p>
      <p data-color="#cccccc" data-bg="#ffffff">middling</p>
    `;

    const result = scanContrast(document.body, options());

    expect(result.failures.map((finding) => finding.text)).toEqual([
      'severe',
      'middling',
      'mild',
    ]);
    expect(result.failures[0]?.severity).toBe('critical');
  });

  it('ranks a large-text miss below a normal-text miss at the same ratio', () => {
    document.body.innerHTML = `
      <p data-size="32px" data-color="#949494" data-bg="#ffffff">heading</p>
      <p data-size="14px" data-color="#949494" data-bg="#ffffff">body</p>
    `;

    const result = scanContrast(document.body, options());

    // Same 3.0-ish ratio, but the heading only needs 3:1 — so it may even pass.
    expect(result.failures[0]?.text).toBe('body');
  });

  it('stops at the element budget and says so', () => {
    document.body.innerHTML = Array.from(
      { length: 20 },
      (_unused, index) => `<p data-color="#eeeeee" data-bg="#ffffff">row ${index}</p>`,
    ).join('');

    const result = scanContrast(document.body, options({ maxElements: 5 }));

    expect(result.visited).toBe(5);
    expect(result.budget).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.failures.length).toBeLessThanOrEqual(5);
  });

  it('does not claim truncation when the budget was merely reached exactly', () => {
    // Two elements to visit: the root `body` counts against the budget too.
    document.body.innerHTML = '<p data-color="#eeeeee" data-bg="#ffffff">only</p>';
    const result = scanContrast(document.body, options({ maxElements: 2 }));
    expect(result.visited).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  it('walks open shadow roots', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p data-color="#eeeeee" data-bg="#ffffff">inside shadow</p>';

    const pierced = scanContrast(document.body, options());
    expect(pierced.failures.map((finding) => finding.text)).toEqual(['inside shadow']);

    const flat = scanContrast(document.body, options({ pierceShadow: false }));
    expect(flat.failures).toHaveLength(0);
  });

  it('includes the root element itself when given one', () => {
    document.body.innerHTML = '<p id="only" data-color="#eeeeee" data-bg="#ffffff">root text</p>';
    const paragraph = document.getElementById('only');
    if (!paragraph) throw new Error('fixture missing');

    const result = scanContrast(paragraph, options());
    expect(result.failures).toHaveLength(1);
  });

  it('grades against AAA when asked', () => {
    document.body.innerHTML = '<p data-color="#767676" data-bg="#ffffff">borderline</p>';

    const aa = scanContrast(document.body, options());
    const aaa = scanContrast(document.body, options({ level: 'AAA' }));

    expect(aa.failures).toHaveLength(0);
    expect(aaa.failures).toHaveLength(1);
    expect(aaa.failures[0]?.severity).toBe('moderate');
    expect(aaa.failures[0]?.required).toBe(7);
  });

  it('attaches a usable descriptor and remediation to each failure', () => {
    document.body.innerHTML =
      '<p id="lede" class="intro" data-color="#777777" data-bg="#ffffff">needs work</p>';

    const result = scanContrast(document.body, options());
    const finding = result.failures[0];
    if (!finding) throw new Error('expected a failure');

    expect(finding.descriptor.selectorLabel).toBe('p#lede.intro');
    expect(finding.element.id).toBe('lede');
    expect(finding.verdict.remediation?.kind).toBe('lightness');
  });

  it('truncates long text samples', () => {
    document.body.innerHTML = `<p data-color="#eeeeee" data-bg="#ffffff">${'x'.repeat(200)}</p>`;
    const result = scanContrast(document.body, options({ maxTextLength: 20 }));
    expect(result.failures[0]?.text).toHaveLength(20);
    expect(result.failures[0]?.text.endsWith('…')).toBe(true);
  });
});
