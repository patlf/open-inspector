import { beforeEach, describe, expect, it } from 'vitest';
import {
  ancestorTrail,
  flattenStructure,
  matchingStructure,
  matchesStructureQuery,
  readTreePosition,
  stepTree,
  structurePath,
  type StructureNode,
  type StructureRow,
} from './tree.js';

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

describe('flattenStructure', () => {
  /** What a row reads as, indented by depth, for comparing whole listings. */
  function outline(rows: StructureRow[]): string[] {
    return rows.map((row) =>
      row.kind === 'more'
        ? `${'  '.repeat(row.depth)}(${row.hidden} more)`
        : `${'  '.repeat(row.depth)}${row.label}${row.text ? ` "${row.text}"` : ''}`,
    );
  }

  function expandedSet(...nodes: StructureNode[]): (node: StructureNode) => boolean {
    const expanded = new Set(nodes);
    return (node) => expanded.has(node);
  }

  beforeEach(() =>
    fixture(`
      <main id="m">
        <ul id="list"><li id="a">one</li><li id="b">two</li><li id="c">three</li></ul>
        <p class="lede  intro">Hello   there</p>
      </main>
    `),
  );

  it('lists only what is expanded, in document order', () => {
    const { rows, truncated } = flattenStructure(at('#m'), { isExpanded: expandedSet(at('#m')) });

    expect(truncated).toBe(false);
    expect(outline(rows)).toEqual(['main#m', '  ul#list', '  p.lede.intro "Hello there"']);
  });

  it('marks rows with children as expandable and reports their state', () => {
    const { rows } = flattenStructure(at('#m'), { isExpanded: expandedSet(at('#m')) });
    const [main, list, paragraph] = rows;

    expect(main).toMatchObject({ expandable: true, expanded: true });
    expect(list).toMatchObject({ expandable: true, expanded: false });
    expect(paragraph).toMatchObject({ expandable: false, expanded: false });
  });

  it('walks nested expansions depth-first', () => {
    const { rows } = flattenStructure(at('#m'), {
      isExpanded: expandedSet(at('#m'), at('#list')),
    });

    expect(outline(rows)).toEqual([
      'main#m',
      '  ul#list',
      '    li#a "one"',
      '    li#b "two"',
      '    li#c "three"',
      '  p.lede.intro "Hello there"',
    ]);
  });

  it('cuts a long child list short and counts the rest', () => {
    const { rows } = flattenStructure(at('#list'), {
      isExpanded: expandedSet(at('#list')),
      childLimit: () => 2,
    });

    expect(outline(rows)).toEqual(['ul#list', '  li#a "one"', '  li#b "two"', '  (1 more)']);
    expect(rows[3]).toMatchObject({ kind: 'more', parent: at('#list') });
  });

  it('stops at the row ceiling and says so', () => {
    const { rows, truncated } = flattenStructure(at('#m'), {
      isExpanded: expandedSet(at('#m'), at('#list')),
      maxRows: 3,
    });

    expect(rows).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it('omits the inspector own UI', () => {
    fixture('<div id="root"><span id="real"></span><open-inspector-panel></open-inspector-panel></div>');
    const { rows } = flattenStructure(at('#root'), {
      isExpanded: expandedSet(at('#root')),
      ignore: (element) => element.tagName.startsWith('OPEN-INSPECTOR'),
    });

    expect(outline(rows)).toEqual(['div#root', '  span#real']);
  });

  it('does not preview the text of scripts and styles', () => {
    fixture('<div id="root"><script>let secret = 1;</script><style>p { color: red }</style></div>');
    const { rows } = flattenStructure(at('#root'), { isExpanded: expandedSet(at('#root')) });

    expect(outline(rows)).toEqual(['div#root', '  script', '  style']);
  });

  it('gives a frame its address, as written or as the browser names it', () => {
    fixture(`
      <div id="root">
        <iframe src="/embed/map?q=1"></iframe>
        <iframe srcdoc="<p>hi</p>"></iframe>
        <iframe></iframe>
      </div>
    `);
    const { rows } = flattenStructure(at('#root'), { isExpanded: expandedSet(at('#root')) });

    expect(rows.slice(1).map((row) => (row.kind === 'more' ? null : row.address))).toEqual([
      '/embed/map?q=1',
      'about:srcdoc',
      'about:blank',
    ]);
    expect(rows[0]).toMatchObject({ address: null });
  });

  it('names the file behind scripts, stylesheet links and style blocks', () => {
    // Never connected to the document, so happy-dom does not try to load them.
    const root = document.createElement('div');
    const add = (tag: string, attributes: Record<string, string>, text = '') => {
      const element = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      element.textContent = text;
      root.appendChild(element);
    };
    add('script', { src: '/assets/app.4f2a.js?v=3' });
    add('script', {}, 'window.x = 1;');
    add('link', { rel: 'stylesheet', href: 'https://cdn.example.com/css/site%20main.css' });
    add('style', { 'data-vite-dev-id': '/src/components/Card.module.css' });
    add('style', {}, '.a {}');
    add('p', {}, 'text');

    const { rows } = flattenStructure(root, { isExpanded: expandedSet(root) });

    expect(rows.slice(1).map((row) => (row.kind === 'more' ? null : row.file))).toEqual([
      { name: 'app.4f2a.js', url: '/assets/app.4f2a.js?v=3' },
      { name: 'inline', url: null },
      { name: 'site main.css', url: 'https://cdn.example.com/css/site%20main.css' },
      { name: 'Card.module.css', url: '/src/components/Card.module.css' },
      { name: 'inline', url: null },
      null,
    ]);
  });

  it('lists an open shadow root ahead of the light-DOM children', () => {
    fixture('<div id="host"><span id="slotted">light</span></div>');
    const host = at('#host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button id="inner">Go</button><slot></slot>';

    const { rows } = flattenStructure(host, { isExpanded: expandedSet(host, shadow) });

    expect(outline(rows)).toEqual([
      'div#host',
      '  #shadow-root (open)',
      '    button#inner "Go"',
      '    slot',
      '  span#slotted "light"',
    ]);
    expect(rows[1]).toMatchObject({ kind: 'shadow-root', node: shadow });
  });
});

describe('structurePath', () => {
  it('runs from the document element down to the parent', () => {
    fixture('<main><section id="s"><p id="p">a</p></section></main>');
    const path = structurePath(at('#p'));

    expect(path[0]).toBe(document.documentElement);
    expect(path.at(-1)).toBe(at('#s'));
    expect(path).toContain(document.body);
    expect(path).not.toContain(at('#p'));
  });

  it('crosses shadow boundaries through the root and its host', () => {
    fixture('<div id="host"></div>');
    const host = at('#host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div id="wrap"><button>Go</button></div>';
    const button = shadow.querySelector('button') as Element;

    const path = structurePath(button);

    expect(path.slice(-3)).toEqual([host, shadow, shadow.querySelector('#wrap')]);
  });

  it('is empty for the document element itself', () => {
    expect(structurePath(document.documentElement)).toEqual([]);
  });
});

describe('matchingStructure', () => {
  beforeEach(() =>
    fixture(`
      <main id="m">
        <ul><li id="a" data-hit>one</li><li id="b">two</li></ul>
        <section><button id="c" data-hit>go</button></section>
        <div id="host"></div>
      </main>
    `),
  );

  const hit = (element: Element): boolean => element.hasAttribute('data-hit');

  it('lists every match in document order, flat, collapsed or not', () => {
    const { rows, truncated } = matchingStructure(at('#m'), hit);

    expect(truncated).toBe(false);
    expect(rows.map((row) => (row.kind === 'more' ? 'more' : `${row.depth} ${row.label}`))).toEqual([
      '0 li#a',
      '0 button#c',
    ]);
    expect(rows.every((row) => row.kind === 'element' && !row.expandable)).toBe(true);
  });

  it('finds matches inside open shadow roots', () => {
    const root = at('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<span id="inner" data-hit>x</span>';

    const labels = matchingStructure(at('#m'), hit).rows.map((row) => row.kind === 'more' ? '' : row.label);
    expect(labels).toEqual(['li#a', 'button#c', 'span#inner']);
  });

  it('reports truncation at the row or visit ceiling', () => {
    expect(matchingStructure(at('#m'), hit, { maxRows: 1 })).toMatchObject({ truncated: true });
    expect(matchingStructure(at('#m'), hit, { maxVisits: 2 }).truncated).toBe(true);
  });

  it('leaves out what the caller ignores', () => {
    const rows = matchingStructure(at('#m'), hit, { ignore: (element) => element.tagName === 'SECTION' }).rows;
    expect(rows.map((row) => (row.kind === 'more' ? '' : row.label))).toEqual(['li#a']);
  });
});

describe('matchesStructureQuery', () => {
  beforeEach(() =>
    fixture(`
      <section id="s">
        <button id="save" class="primary wide">Save   draft</button>
        <p class="note">Nothing <em>here</em></p>
        <style>.note { color: red }</style>
      </section>
    `),
  );

  it('matches what the row shows: tag, id and classes, in any case', () => {
    for (const query of ['button', '#save', '.primary', 'BUTTON#SAVE.primary', 'button.primary', 'wide']) {
      expect(matchesStructureQuery(at('#save'), query), query).toBe(true);
    }
    expect(matchesStructureQuery(at('#save'), 'section')).toBe(false);
  });

  it('matches its own text, whitespace folded, but not text further down', () => {
    expect(matchesStructureQuery(at('#save'), 'save draft')).toBe(true);
    expect(matchesStructureQuery(at('.note'), 'nothing')).toBe(true);
    expect(matchesStructureQuery(at('.note'), 'here')).toBe(false);
    expect(matchesStructureQuery(at('#s'), 'save')).toBe(false);
  });

  it('does not match the source inside a style or script, which its row does not show', () => {
    expect(matchesStructureQuery(at('style'), 'note')).toBe(false);
    expect(matchesStructureQuery(at('style'), 'style')).toBe(true);
  });

  it('matches everything when the query is blank', () => {
    expect(matchesStructureQuery(at('#s'), '   ')).toBe(true);
  });
});
