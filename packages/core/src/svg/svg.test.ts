import { describe, expect, it } from 'vitest';
import {
  beautifySvg,
  decodeSvgDataUri,
  formatNumber,
  minifyPathData,
  minifySvg,
  optimizeSvg,
  parseSvg,
  type SvgDocument,
} from './index.js';

function parse(text: string): SvgDocument {
  const result = parseSvg(text);
  if (!result.document) throw new Error(result.error);
  return result.document;
}

const ICON = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Sketch -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns" version="1.1" viewBox="0.000 0.000 24.000 24.000" width="24px" height="24px">
  <metadata>made by hand</metadata>
  <title>Close</title>
  <g>
    <path sketch:type="MSShapeGroup" d="M 6.000,6.000 L 18.000,18.000 L 18.500 6.250" stroke="#FFFFFF" stroke-width="2.00000"/>
  </g>
  <g id="empty"></g>
  <defs></defs>
</svg>`;

describe('parseSvg', () => {
  it('reads elements, attributes, text and comments', () => {
    const document = parse('<svg viewBox="0 0 1 1"><!-- c --><title>Hi &amp; bye</title></svg>');
    const root = document.nodes[0];
    expect(root).toMatchObject({ kind: 'element', name: 'svg' });
    if (root?.kind !== 'element') throw new Error('no root');
    expect(root.attributes).toEqual([{ name: 'viewBox', value: '0 0 1 1' }]);
    expect(root.children.map((child) => child.kind)).toEqual(['comment', 'element']);
  });

  it('says why broken markup cannot be read, instead of repairing it', () => {
    expect(parseSvg('<svg><g></svg>').error).toBe('</svg> closes <g>.');
    expect(parseSvg('<svg><g>').error).toBe('<g> is never closed.');
    expect(parseSvg('<div></div>').error).toMatch(/not an SVG/);
  });

  it('keeps entities and quotes exactly as written', () => {
    const text = `<svg><text x='1' data-q='say "hi"'>a &lt; b</text></svg>`;
    expect(minifySvg(parse(text))).toBe('<svg><text x="1" data-q="say &quot;hi&quot;">a &lt; b</text></svg>');
  });
});

describe('minifySvg', () => {
  it('drops blank text between tags and comments, and nothing else', () => {
    expect(minifySvg(parse('<svg>\n  <!-- c -->\n  <g>\n    <rect width="1"/>\n  </g>\n</svg>'))).toBe(
      '<svg><g><rect width="1"/></g></svg>',
    );
  });

  it('keeps the whitespace inside text, where it renders', () => {
    const text = '<svg><text><tspan>a</tspan> <tspan>b</tspan></text></svg>';
    expect(minifySvg(parse(text))).toBe(text);
  });
});

describe('beautifySvg', () => {
  it('puts one element per line, children indented', () => {
    expect(beautifySvg(parse('<svg><g><rect width="1"/><circle r="2"/></g></svg>'))).toBe(
      ['<svg>', '  <g>', '    <rect width="1"/>', '    <circle r="2"/>', '  </g>', '</svg>'].join('\n'),
    );
  });

  it('leaves text elements on one line, exactly as written', () => {
    expect(beautifySvg(parse('<svg><title>Close</title><text>a <tspan>b</tspan></text></svg>'))).toBe(
      ['<svg>', '  <title>Close</title>', '  <text>a <tspan>b</tspan></text>', '</svg>'].join('\n'),
    );
  });
});

describe('formatNumber', () => {
  it('rounds and drops zeros that carry no value', () => {
    expect(formatNumber(0.5, 3)).toBe('.5');
    expect(formatNumber(-0.25, 3)).toBe('-.25');
    expect(formatNumber(2.0004, 3)).toBe('2');
    expect(formatNumber(-0.0001, 3)).toBe('0');
    expect(formatNumber(12.3456, 2)).toBe('12.35');
  });
});

describe('minifyPathData', () => {
  it('drops separators a sign or a second point already supplies', () => {
    expect(minifyPathData('M 10,10 L -5,-5 L 0.5,0.5', 3)).toBe('M10 10-5-5 .5.5');
  });

  it('omits a repeated command and the line-to after a move-to, never a second move-to', () => {
    expect(minifyPathData('M 1 1 L 2 2 L 3 3 M 4 4 L 5 5', 3)).toBe('M1 1 2 2 3 3M4 4 5 5');
  });

  it('reads arc flags one digit at a time, including when they are run together', () => {
    expect(minifyPathData('a1 1 0 011 1', 3)).toBe('a1 1 0 0 1 1 1');
  });

  it('returns path data it cannot read untouched', () => {
    expect(minifyPathData('M 1 1 L oops', 3)).toBe('M 1 1 L oops');
  });
});

describe('optimizeSvg', () => {
  it('shrinks an exported icon without changing what it draws', () => {
    const out = minifySvg(optimizeSvg(parse(ICON)));

    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
        '<title>Close</title>' +
        '<path d="M6 6 18 18 18.5 6.25" stroke="#fff" stroke-width="2"/>' +
        '<g id="empty"/>' +
        '</svg>',
    );
    expect(out.length).toBeLessThan(ICON.length / 2);
  });

  it('cleans what Illustrator writes into every file', () => {
    const text =
      '<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 24 24" ' +
      'style="enable-background:new 0 0 24 24;" xml:space="preserve"><path d="M0 0h1"/></svg>';
    expect(minifySvg(optimizeSvg(parse(text)))).toBe(
      '<svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h1"/></svg>',
    );
  });

  it('keeps xml:space where there is text for it to govern', () => {
    const text = '<svg xml:space="preserve"><text>a  b</text></svg>';
    expect(minifySvg(optimizeSvg(parse(text)))).toBe(text);
  });

  it('keeps xlink while something still uses it', () => {
    const text =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg>';
    expect(minifySvg(optimizeSvg(parse(text)))).toContain('xmlns:xlink');
  });

  it('leaves translucent colours and references alone', () => {
    const text = '<svg><rect fill="rgba(0, 0, 0, 0.5)" stroke="url(#g)" color="currentColor"/></svg>';
    expect(minifySvg(optimizeSvg(parse(text)))).toBe(
      '<svg><rect fill="rgba(0, 0, 0, 0.5)" stroke="url(#g)" color="currentColor"/></svg>',
    );
  });

  it('honours a precision', () => {
    const out = minifySvg(optimizeSvg(parse('<svg><circle r="1.23456"/></svg>'), { precision: 1 }));
    expect(out).toBe('<svg><circle r="1.2"/></svg>');
  });
});

describe('decodeSvgDataUri', () => {
  it('reads percent-encoded and base64 SVG, and nothing else', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
    expect(decodeSvgDataUri(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)).toBe(markup);
    expect(decodeSvgDataUri(`data:image/svg+xml;base64,${btoa(markup)}`)).toBe(markup);
    expect(decodeSvgDataUri('data:image/png;base64,AAAA')).toBeNull();
    expect(decodeSvgDataUri('https://example.com/a.svg')).toBeNull();
  });
});
