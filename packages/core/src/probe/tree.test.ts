import { beforeEach, describe, expect, it } from 'vitest';
import { ancestorTrail, readTreePosition, stepTree } from './tree.js';

function fixture(html: string): void {
  document.body.innerHTML = html;
}

function at(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  return element;
}

describe('ancestorTrail', () => {
  beforeEach(() => fixture('<main><section><article id="card"><p>text</p></article></section></main>'));

  it('runs from the element upward, nearest first', () => {
    const trail = ancestorTrail(at('#card')).map((crumb) => crumb.label);

    expect(trail[0]).toBe('article#card');
    expect(trail[1]).toBe('section');
    expect(trail[2]).toBe('main');
    expect(trail).toContain('body');
  });

  it('stops at the depth limit rather than running to the root', () => {
    expect(ancestorTrail(at('p'), { maxDepth: 2 })).toHaveLength(2);
  });

  it('omits the inspector own UI', () => {
    // The panel and overlay are appended to documentElement, so they would
    // otherwise show up in the trail of anything near the top of the tree.
    fixture('<open-inspector-panel><div id="inner"></div></open-inspector-panel>');
    const trail = ancestorTrail(at('#inner'), {
      ignore: (element) => element.tagName === 'OPEN-INSPECTOR-PANEL',
    });

    expect(trail.map((crumb) => crumb.label)).not.toContain('open-inspector-panel');
  });
});

describe('readTreePosition', () => {
  beforeEach(() =>
    fixture(`
      <ul id="list">
        <li id="a">one</li>
        <li id="b">two</li>
        <li id="c">three</li>
      </ul>
    `),
  );

  it('reports where an element sits among its siblings', () => {
    const position = readTreePosition(at('#b'));

    expect(position.siblingIndex).toBe(2);
    expect(position.siblingCount).toBe(3);
    expect((position.previousSibling as Element).id).toBe('a');
    expect((position.nextSibling as Element).id).toBe('c');
  });

  it('reports no previous sibling for the first child', () => {
    // `indexOf - 1` would be -1 and wrap round to the last element.
    const position = readTreePosition(at('#a'));

    expect(position.previousSibling).toBeNull();
    expect((position.nextSibling as Element).id).toBe('b');
  });

  it('reports no next sibling for the last child', () => {
    expect(readTreePosition(at('#c')).nextSibling).toBeNull();
  });

  it('counts children and finds the first', () => {
    const position = readTreePosition(at('#list'));

    expect(position.childCount).toBe(3);
    expect((position.firstChild as Element).id).toBe('a');
  });

  it('does not count the inspector own elements as siblings', () => {
    fixture('<div id="parent"><span id="real"></span><open-inspector-overlay></open-inspector-overlay></div>');
    const position = readTreePosition(at('#real'), {
      ignore: (element) => element.tagName.startsWith('OPEN-INSPECTOR'),
    });

    expect(position.siblingCount).toBe(1);
    expect(position.nextSibling).toBeNull();
  });
});

describe('stepTree', () => {
  beforeEach(() =>
    fixture('<main><section id="s"><p id="p1">a</p><p id="p2">b</p></section></main>'),
  );

  it('steps to the parent', () => {
    expect((stepTree(at('#p1'), 'parent') as Element).id).toBe('s');
  });

  it('steps to the first child', () => {
    expect((stepTree(at('#s'), 'child') as Element).id).toBe('p1');
  });

  it('steps between siblings', () => {
    expect((stepTree(at('#p1'), 'next') as Element).id).toBe('p2');
    expect((stepTree(at('#p2'), 'previous') as Element).id).toBe('p1');
  });

  it('returns null at an edge rather than silently staying put', () => {
    // The caller needs to be able to tell "nowhere to go" from "went nowhere".
    expect(stepTree(at('#p1'), 'previous')).toBeNull();
    expect(stepTree(at('#p2'), 'next')).toBeNull();
    expect(stepTree(at('#p1'), 'child')).toBeNull();
  });

  it('has nowhere to go above the document element', () => {
    expect(stepTree(document.documentElement, 'parent')).toBeNull();
  });
});
