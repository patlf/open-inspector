import { beforeEach, describe, expect, it } from 'vitest';
import { createOverrideStore, toKebabProperty } from './overrides.js';
import { cssPath } from './css-path.js';

function el(html: string): HTMLElement {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error('fixture is not an element');
  return element;
}

describe('toKebabProperty', () => {
  it('accepts both spellings a caller might use', () => {
    expect(toKebabProperty('marginTop')).toBe('margin-top');
    expect(toKebabProperty('margin-top')).toBe('margin-top');
    expect(toKebabProperty('backgroundColor')).toBe('background-color');
  });
});

describe('createOverrideStore', () => {
  let store: ReturnType<typeof createOverrideStore>;

  beforeEach(() => {
    document.body.innerHTML = '';
    store = createOverrideStore();
  });

  it('applies a declaration to the element', () => {
    const target = el('<div></div>');

    expect(store.set(target, 'color', 'red')).toBe('applied');
    expect(target.style.getPropertyValue('color')).toBe('red');
    expect(store.count()).toBe(1);
  });

  it('wins over the page by using !important', () => {
    // A page rule with !important would otherwise beat a plain inline value,
    // and the edit would appear to do nothing.
    const target = el('<div></div>');
    store.set(target, 'color', 'red');

    expect(target.style.getPropertyPriority('color')).toBe('important');
  });

  it('reverts to nothing when the page had no inline style', () => {
    const target = el('<div></div>');
    store.set(target, 'color', 'red');
    store.clear(target, 'color');

    expect(target.style.getPropertyValue('color')).toBe('');
    expect(store.count()).toBe(0);
  });

  it('leaves no empty style attribute behind', () => {
    // `style=""` is visually identical to no attribute, but it is a mark the
    // tool left on a page it was only meant to read — and it turns up in
    // anyone who copies the HTML afterwards.
    const target = el('<div></div>');
    store.set(target, 'color', 'red');
    expect(target.hasAttribute('style')).toBe(true);

    store.clear(target, 'color');
    expect(target.hasAttribute('style')).toBe(false);
  });

  it('keeps the style attribute when the page put something there', () => {
    const target = el('<div style="margin: 4px"></div>');
    store.set(target, 'color', 'red');
    store.clear(target, 'color');

    expect(target.style.getPropertyValue('margin')).toBe('4px');
    expect(target.hasAttribute('style')).toBe(true);
  });

  it('restores the page own inline value, priority included', () => {
    // Blanket-clearing element.style would delete the page's own work.
    const target = el('<div style="color: blue !important; margin: 4px"></div>');

    store.set(target, 'color', 'red');
    expect(target.style.getPropertyValue('color')).toBe('red');

    store.clear(target, 'color');
    expect(target.style.getPropertyValue('color')).toBe('blue');
    expect(target.style.getPropertyPriority('color')).toBe('important');
    // The untouched declaration survives.
    expect(target.style.getPropertyValue('margin')).toBe('4px');
  });

  it('does not record its own earlier edit as the value to restore', () => {
    // The second edit must still remember the *page's* original, not the first
    // edit — otherwise undo leaves our own value behind.
    const target = el('<div style="color: blue"></div>');

    store.set(target, 'color', 'red');
    store.set(target, 'color', 'green');
    store.clear(target, 'color');

    expect(target.style.getPropertyValue('color')).toBe('blue');
  });

  it('rejects a value the engine will not accept, leaving the page untouched', () => {
    // The validator is injected because test DOMs do not parse CSS. Production
    // uses CSS.supports; see acceptsDeclaration.
    const strict = createOverrideStore({
      accepts: (_property, value) => value !== 'not-a-colour-at-all',
    });
    const target = el('<div style="color: blue"></div>');

    expect(strict.set(target, 'color', 'not-a-colour-at-all')).toBe('rejected');
    expect(target.style.getPropertyValue('color')).toBe('blue');
    expect(strict.count()).toBe(0);
  });

  it('does not mistake a silently dropped write for success', () => {
    /**
     * The bug this pins down: with a read-back check, an element that already
     * had `color: blue` inline would still report `blue` after a rejected
     * write, which is indistinguishable from the value having been applied.
     * Validating first removes the ambiguity entirely.
     */
    const strict = createOverrideStore({ accepts: () => false });
    const target = el('<div style="color: blue"></div>');

    expect(strict.set(target, 'color', 'red')).toBe('rejected');
    expect(target.style.getPropertyValue('color')).toBe('blue');
    expect(strict.forElement(target)).toEqual([]);
  });

  it('treats an emptied field as a revert', () => {
    const target = el('<div></div>');
    store.set(target, 'color', 'red');

    expect(store.set(target, 'color', '   ')).toBe('unchanged');
    expect(target.style.getPropertyValue('color')).toBe('');
    expect(store.count()).toBe(0);
  });

  it('clears every override on one element', () => {
    const target = el('<div></div>');
    store.set(target, 'color', 'red');
    store.set(target, 'padding', '10px');

    store.clearElement(target);

    expect(store.forElement(target)).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it('clears everything across elements', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const a = document.querySelector('#a') as HTMLElement;
    const b = document.querySelector('#b') as HTMLElement;

    store.set(a, 'color', 'red');
    store.set(b, 'color', 'blue');
    expect(store.count()).toBe(2);

    store.clearAll();

    expect(store.count()).toBe(0);
    expect(a.style.getPropertyValue('color')).toBe('');
    expect(b.style.getPropertyValue('color')).toBe('');
    expect(store.all()).toEqual([]);
  });

  it('lists overrides per element with a selector', () => {
    const target = el('<div id="hero"></div>');
    store.set(target, 'color', 'red');

    const [entry] = store.all();
    expect(entry?.selector).toContain('#hero');
    expect(entry?.overrides.map((override) => override.property)).toEqual(['color']);
  });
});

describe('toCss', () => {
  it('is empty when nothing has been edited', () => {
    expect(createOverrideStore().toCss()).toBe('');
  });

  it('emits a paste-ready block per element, properties sorted', () => {
    document.body.innerHTML = '<div id="card"></div>';
    const target = document.querySelector('#card') as HTMLElement;
    const store = createOverrideStore();

    store.set(target, 'padding', '20px');
    store.set(target, 'color', 'red');

    const css = store.toCss();

    expect(css).toContain('div#card {');
    // Sorted, so re-exporting after a tweak produces a readable diff.
    expect(css.indexOf('color:')).toBeLessThan(css.indexOf('padding:'));
    expect(css).toContain('  color: red;');
    expect(css).toContain('  padding: 20px;');
  });

  it('says plainly that the edits are not saved', () => {
    document.body.innerHTML = '<div id="x"></div>';
    const store = createOverrideStore();
    store.set(document.querySelector('#x') as HTMLElement, 'color', 'red');

    expect(store.toCss()).toContain('not saved anywhere');
  });
});

describe('cssPath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses an id when there is one', () => {
    document.body.innerHTML = '<section><div id="hero"></div></section>';
    expect(cssPath(document.querySelector('#hero') as Element)).toContain('#hero');
  });

  it('distinguishes identical siblings by position', () => {
    document.body.innerHTML = '<ul><li class="row"></li><li class="row"></li><li class="row"></li></ul>';
    const items = document.querySelectorAll('li');
    const second = items[1];
    expect(second).toBeDefined();
    if (!second) return;

    const selector = cssPath(second);
    expect(selector).toContain('nth-of-type(2)');
    expect(document.querySelectorAll(selector).length).toBe(1);
  });

  it('truncates enormous utility class lists', () => {
    document.body.innerHTML =
      '<div class="flex items-center gap-4 rounded-lg bg-white p-6 shadow-sm"></div>';
    const selector = cssPath(document.querySelector('div') as Element);

    // Three classes, not seven — long enough to disambiguate, short enough to read.
    expect(selector.split('.').length - 1).toBeLessThanOrEqual(3);
  });

  it('produces a selector that actually finds the element again', () => {
    document.body.innerHTML = `
      <main><section><article class="card"><p>one</p></article>
      <article class="card"><p>two</p></article></section></main>`;
    const paragraphs = document.querySelectorAll('p');
    const target = paragraphs[1];
    expect(target).toBeDefined();
    if (!target) return;

    const selector = cssPath(target);
    expect(document.querySelector(selector)).toBe(target);
  });
});
