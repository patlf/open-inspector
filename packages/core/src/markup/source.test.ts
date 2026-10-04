import { beforeEach, describe, expect, it } from 'vitest';
import { SOURCE_LIMIT, dedent, readElementSource } from './source.js';

function at(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  return element;
}

describe('readElementSource', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('has nothing to say about an element that renders', () => {
    document.body.innerHTML = '<div id="box">hi</div>';
    expect(readElementSource(at('#box'))).toBeNull();
  });

  it('reads a style element’s text as CSS', () => {
    document.head.innerHTML = '<style id="s">.a { color: red }</style>';

    expect(readElementSource(at('#s'))).toEqual({
      language: 'css',
      text: '.a { color: red }',
      note: null,
      truncated: false,
    });
  });

  it('falls back to the CSSOM when a library inserted the rules', () => {
    document.head.innerHTML = '<style id="s"></style>';
    (at('#s') as HTMLStyleElement).sheet?.insertRule('.b { margin: 0px; }');

    const read = readElementSource(at('#s'));

    expect(read?.text).toContain('.b');
    expect(read?.note).toMatch(/CSSOM/);
  });

  it('reads an inline script, and only names an external one', () => {
    document.body.innerHTML = `
      <script id="inline">window.x = 1;</script>
      <script id="data" type="application/ld+json">{"a":1}</script>
    `;
    // Detached: happy-dom would otherwise try to load it.
    const external = document.createElement('script');
    external.setAttribute('src', '/app.js');

    expect(readElementSource(at('#inline'))).toMatchObject({
      language: 'javascript',
      text: 'window.x = 1;',
    });
    expect(readElementSource(external)).toMatchObject({ text: '' });
    expect(readElementSource(external)?.note).toMatch(/app\.js.*not fetched/);
    expect(readElementSource(at('#data'))).toMatchObject({ language: 'json', text: '{"a":1}' });
  });

  it('shows a template’s contents as markup', () => {
    document.body.innerHTML = '<template id="t"><p class="row">x</p></template>';
    expect(readElementSource(at('#t'))).toMatchObject({
      language: 'html',
      text: '<p class="row">x</p>',
    });
  });

  it('shows head metadata as the markup it is', () => {
    document.head.innerHTML = '<meta id="m" name="viewport" content="width=device-width">';
    expect(readElementSource(at('#m'))?.text).toBe(
      '<meta id="m" name="viewport" content="width=device-width">',
    );
  });

  it('cuts very long source and says so', () => {
    document.head.innerHTML = `<style id="s">${'a{}'.repeat(SOURCE_LIMIT)}</style>`;
    const read = readElementSource(at('#s'));

    expect(read?.text).toHaveLength(SOURCE_LIMIT);
    expect(read?.truncated).toBe(true);
  });
});

describe('dedent', () => {
  it('drops blank edge lines and the indent every line shares', () => {
    expect(dedent('\n      .a {\n        color: red;\n      }\n    ')).toBe('.a {\n  color: red;\n}');
  });

  it('leaves text with no common indent alone', () => {
    expect(dedent('a\n  b')).toBe('a\n  b');
  });
});
