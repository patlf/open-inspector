import { beforeEach, describe, expect, it } from 'vitest';
import { serializeElement, styleToJsxObject } from './serialize.js';

function fixture(html: string): Element {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild;
  if (!element) throw new Error('fixture produced no element');
  return element;
}

describe('serializeElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('produces markup a person would have written', () => {
    const { text } = serializeElement(fixture('<div class="card"><p>Hello</p></div>'));

    expect(text).toBe('<div class="card">\n  <p>Hello</p>\n</div>');
  });

  it('keeps a short single child on one line', () => {
    expect(serializeElement(fixture('<p>Hi</p>')).text).toBe('<p>Hi</p>');
  });

  it('drops framework bookkeeping', () => {
    // These describe the running app, not the design. Pasting them into a
    // codebase would be actively wrong.
    const { text } = serializeElement(
      fixture('<div data-reactid="7" ng-repeat="x" data-v-1a2b3c class="real">hi</div>'),
    );

    expect(text).toContain('class="real"');
    expect(text).not.toContain('data-reactid');
    expect(text).not.toContain('ng-repeat');
    expect(text).not.toContain('data-v-');
  });

  it('drops the inspector own attributes', () => {
    const { text } = serializeElement(
      fixture('<div data-open-inspector-force="hover" id="x">hi</div>'),
    );

    expect(text).not.toContain('open-inspector');
    expect(text).toContain('id="x"');
  });

  it('drops inline styles by default and keeps them on request', () => {
    // Inline style is usually script residue rather than authored design.
    const element = fixture('<div style="color: red" class="c">hi</div>');

    expect(serializeElement(element).text).not.toContain('style');
    expect(serializeElement(element, { keepInlineStyles: true }).text).toContain('style="color: red"');
  });

  it('skips scripts and styles entirely', () => {
    const { text } = serializeElement(
      fixture('<div><script>alert(1)</script><style>.a{}</style><p>keep</p></div>'),
    );

    expect(text).not.toContain('alert');
    expect(text).not.toContain('.a{}');
    expect(text).toContain('<p>keep</p>');
  });

  it('writes void elements without a closing tag', () => {
    expect(serializeElement(fixture('<img src="a.png" alt="">')).text).toBe(
      '<img src="a.png" alt="">',
    );
  });

  it('writes boolean attributes bare but keeps other empty ones explicit', () => {
    // `alt=""` says "decorative on purpose"; collapsing it to `alt` reads as
    // an oversight. `disabled=""` is just noise.
    expect(serializeElement(fixture('<input disabled="" alt="">')).text).toContain('disabled');
    expect(serializeElement(fixture('<input disabled="" alt="">')).text).not.toContain('disabled="');
    expect(serializeElement(fixture('<img alt="">')).text).toContain('alt=""');
  });

  it('collapses runs of whitespace in text', () => {
    const { text } = serializeElement(fixture('<p>  lots   of\n   space  </p>'));
    expect(text).toBe('<p>lots of space</p>');
  });

  it('escapes text that would otherwise be markup', () => {
    expect(serializeElement(fixture('<p>a &lt; b &amp; c</p>')).text).toContain('a &lt; b &amp; c');
  });

  it('stops at the depth limit and says so', () => {
    const { text, truncated } = serializeElement(
      fixture('<div><div><div><div>deep</div></div></div></div>'),
      { maxDepth: 2 },
    );

    expect(truncated).toBe(true);
    expect(text).toContain('…');
  });

  it('stops at the element budget rather than serializing a whole page', () => {
    const items = Array.from({ length: 50 }, (_, i) => `<li>${i}</li>`).join('');
    const { truncated } = serializeElement(fixture(`<ul>${items}</ul>`), { maxElements: 10 });

    expect(truncated).toBe(true);
  });
});

describe('serializeElement: jsx', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renames the attributes JSX spells differently', () => {
    const { text } = serializeElement(
      fixture('<label class="a" for="x" tabindex="0">hi</label>'),
      { dialect: 'jsx' },
    );

    expect(text).toContain('className="a"');
    expect(text).toContain('htmlFor="x"');
    expect(text).toContain('tabIndex="0"');
  });

  it('self-closes void elements', () => {
    // ` />` is the conventional JSX form, and what Prettier produces.
    expect(serializeElement(fixture('<br>'), { dialect: 'jsx' }).text).toBe('<br />');
  });

  it('turns inline style into an object', () => {
    const { text } = serializeElement(fixture('<div style="color: red">hi</div>'), {
      dialect: 'jsx',
      keepInlineStyles: true,
    });

    expect(text).toContain("style={{ color: 'red' }}");
  });

  it('escapes braces in text, which JSX would treat as an expression', () => {
    const { text } = serializeElement(fixture('<p>{value}</p>'), { dialect: 'jsx' });

    expect(text).not.toMatch(/>\{value\}</);
    expect(text).toContain("{'{'}");
  });
});

describe('styleToJsxObject', () => {
  it('camel-cases property names', () => {
    expect(styleToJsxObject('background-color: red; margin-top: 4px')).toBe(
      "{{ backgroundColor: 'red', marginTop: '4px' }}",
    );
  });

  it('leaves custom properties alone', () => {
    // React passes `--x` through verbatim; camel-casing it would break it.
    expect(styleToJsxObject('--brand: #fff')).toBe("{{ '--brand': '#fff' }}");
  });

  it('escapes quotes inside values', () => {
    expect(styleToJsxObject(`content: 'x'`)).toContain("\\'x\\'");
  });

  it('returns an empty object for empty input', () => {
    expect(styleToJsxObject('')).toBe('{{}}');
  });
});
