import { beforeEach, describe, expect, it } from 'vitest';
import { createStructureModel } from './structure.js';
import type { StructureInfo } from './view-model.js';

function at(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  return element;
}

/** Row labels, indented by depth, for comparing listings at a glance. */
function outline(info: StructureInfo): string[] {
  return info.rows.map((row) => `${'  '.repeat(row.depth)}${row.label}`);
}

function idOf(info: StructureInfo, label: string): number {
  const row = info.rows.find((candidate) => candidate.label === label);
  if (!row) throw new Error(`no row ${label}`);
  return row.id;
}

describe('createStructureModel', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <main id="m">
        <ul id="list"><li id="a">one</li><li id="b">two</li><li id="c">three</li></ul>
      </main>
    `;
  });

  it('opens at the page content, with html and body expanded', () => {
    const model = createStructureModel(document);

    expect(outline(model.build(null))).toEqual(['html', '  head', '  body', '    main#m']);
  });

  it('expands and collapses by id', () => {
    const model = createStructureModel(document);
    const main = idOf(model.build(null), 'main#m');

    model.setExpanded(main, true);
    expect(outline(model.build(null))).toContain('      ul#list');

    model.setExpanded(main, false);
    expect(outline(model.build(null))).not.toContain('      ul#list');
  });

  it('keeps a node’s id across builds, so rows keep their identity', () => {
    const model = createStructureModel(document);
    const first = idOf(model.build(null), 'main#m');

    expect(idOf(model.build(null), 'main#m')).toBe(first);
  });

  it('reveals a selection by expanding everything above it and marking it selected', () => {
    const model = createStructureModel(document);
    const before = model.build(null).revealed;

    model.reveal(at('#b'));
    const info = model.build(at('#b'));

    expect(outline(info)).toContain('        li#b');
    expect(info.selectedId).toBe(idOf(info, 'li#b'));
    expect(info.revealed).toBe(before + 1);
  });

  it('marks nothing selected when the selection’s row is not listed', () => {
    const model = createStructureModel(document);

    expect(model.build(at('#b')).selectedId).toBeNull();
  });

  it('lists past the child limit when that is where the selection is', () => {
    const model = createStructureModel(document, { childLimit: 1 });

    model.reveal(at('#c'));
    const labels = outline(model.build(at('#c'))).map((label) => label.trim());

    expect(labels).toContain('li#c');
    expect(labels).not.toContain('1 more');
  });

  it('lists another batch on request', () => {
    const model = createStructureModel(document, { childLimit: 1 });
    model.reveal(at('#a'));
    const list = idOf(model.build(null), 'ul#list');

    expect(outline(model.build(null)).map((label) => label.trim())).toContain('2 more');

    model.showMore(list);
    const labels = outline(model.build(null)).map((label) => label.trim());
    expect(labels).toContain('li#b');
    expect(labels).toContain('1 more');
  });

  it('resolves a row id to its element, and a shadow root to its host', () => {
    const host = at('#m');
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>inside</p>';
    const model = createStructureModel(document);
    model.setExpanded(idOf(model.build(null), 'main#m'), true);
    const info = model.build(null);

    expect(model.elementFor(idOf(info, 'main#m'))).toBe(host);
    expect(model.elementFor(idOf(info, '#shadow-root (open)'))).toBe(host);
  });

  it('keeps the inspector’s own UI out of the tree', () => {
    document.body.insertAdjacentHTML('beforeend', '<open-inspector-panel></open-inspector-panel>');
    const model = createStructureModel(document, {
      ignore: (element) => element.tagName === 'OPEN-INSPECTOR-PANEL',
    });

    expect(outline(model.build(null)).join('\n')).not.toContain('open-inspector-panel');
  });

  it('lists only what a search matches, flat, collapsed or not, and the tree again when cleared', () => {
    const model = createStructureModel(document);

    model.setQuery('  li#b ');
    const found = model.build(null);
    expect(outline(found)).toEqual(['li#b']);
    expect(found.query).toBe('li#b');

    model.setQuery('three');
    expect(outline(model.build(null))).toEqual(['li#c']);

    model.setQuery('');
    expect(outline(model.build(null))).toEqual(['html', '  head', '  body', '    main#m']);
  });

  it('narrows a search to elements with handlers while the JS filter is on', () => {
    const model = createStructureModel(document, { hasScript: (element) => element.id === 'a' });

    // `ul#list` too: its id holds the letters.
    model.setQuery('li');
    expect(outline(model.build(null))).toEqual(['ul#list', 'li#a', 'li#b', 'li#c']);

    model.setScriptOnly(true);
    expect(outline(model.build(null))).toEqual(['li#a']);
  });
});
