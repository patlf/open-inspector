import { beforeEach, describe, expect, it } from 'vitest';
import { elementLabel, walkElements } from './walk.js';

const OPTIONS = { maxElements: 100, pierceShadowRoots: true };

function labels(elements: readonly Element[]): string[] {
  return elements.map((element) => element.tagName.toLowerCase());
}

describe('walkElements', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('visits in document order', () => {
    document.body.innerHTML = '<section><h1></h1><p><em></em></p></section><footer></footer>';
    const result = walkElements(document.body, OPTIONS);

    expect(labels(result.elements)).toEqual(['body', 'section', 'h1', 'p', 'em', 'footer']);
    expect(result.truncated).toBe(false);
  });

  it('includes an element root itself, but not a document root', () => {
    document.body.innerHTML = '<div><span></span></div>';
    const fragment = document.createDocumentFragment();
    fragment.append(document.createElement('b'));

    expect(labels(walkElements(document.body.firstElementChild!, OPTIONS).elements)).toEqual([
      'div',
      'span',
    ]);
    expect(labels(walkElements(fragment, OPTIONS).elements)).toEqual(['b']);
  });

  it('descends into open shadow roots, where components keep their images', () => {
    document.body.innerHTML = '<my-card></my-card>';
    const host = document.body.firstElementChild!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<img><picture></picture>';

    const result = walkElements(document.body, OPTIONS);
    expect(labels(result.elements)).toEqual(['body', 'my-card', 'img', 'picture']);
    expect(result.shadowRootsEntered).toBe(1);
  });

  it('leaves closed shadow roots alone, because they are undetectable', () => {
    document.body.innerHTML = '<my-card></my-card>';
    document.body.firstElementChild!.attachShadow({ mode: 'closed' }).innerHTML = '<img>';

    const result = walkElements(document.body, OPTIONS);
    expect(result.shadowRootsEntered).toBe(0);
    expect(labels(result.elements)).toEqual(['body', 'my-card']);
  });

  it('can be told not to pierce', () => {
    document.body.innerHTML = '<my-card></my-card>';
    document.body.firstElementChild!.attachShadow({ mode: 'open' }).innerHTML = '<img>';

    const result = walkElements(document.body, { ...OPTIONS, pierceShadowRoots: false });
    expect(labels(result.elements)).toEqual(['body', 'my-card']);
  });

  it('stops at the budget and admits it', () => {
    document.body.innerHTML = '<i></i>'.repeat(20);
    const result = walkElements(document.body, { ...OPTIONS, maxElements: 5 });

    expect(result.elements).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it('skips an ignored element together with its subtree', () => {
    // This is what keeps an inspector's own overlay out of its own report.
    document.body.innerHTML = '<div id="keep"><span></span></div><div id="overlay"><img></div>';
    const result = walkElements(document.body, {
      ...OPTIONS,
      ignore: (element) => element.id === 'overlay',
    });

    expect(labels(result.elements)).toEqual(['body', 'div', 'span']);
  });
});

describe('elementLabel', () => {
  it('renders tag, id and classes', () => {
    const element = document.createElement('img');
    element.id = 'hero';
    element.className = 'rounded shadow';
    expect(elementLabel(element)).toBe('img#hero.rounded.shadow');
  });

  it('reads classes off an SVG element without treating className as a string', () => {
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('class', 'icon');
    expect(elementLabel(use)).toBe('use.icon');
  });
});
