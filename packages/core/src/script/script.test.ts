import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_HANDLER_SOURCE,
  inlineHandlers,
  listenForHandlers,
  mergeHandlers,
  parseHandlers,
  probeHandlersInPage,
  type ScriptHandler,
} from './handlers.js';
import { pageScripts } from './scripts.js';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { jQuery?: unknown }).jQuery;
});

function element(html: string): Element {
  document.body.innerHTML = html;
  const found = document.body.firstElementChild;
  if (!found) throw new Error('no element');
  return found;
}

describe('inlineHandlers', () => {
  it('reads on* attributes and javascript: links', () => {
    const link = element('<a href=" javascript:void 0" onmouseover="hint()">x</a>');
    expect(inlineHandlers(link)).toEqual([
      { event: 'mouseover', via: 'attribute', name: '', source: 'hint()' },
      { event: 'click', via: 'link', name: '', source: 'javascript:void 0' },
    ]);
  });

  it('ignores attributes that only start with "on"', () => {
    expect(inlineHandlers(element('<div on="x" one="y">x</div>'))).toEqual([]);
    expect(inlineHandlers(element('<a href="/once">x</a>'))).toEqual([]);
  });
});

describe('parseHandlers', () => {
  it('keeps well-formed entries and caps their text', () => {
    const long = 'x'.repeat(MAX_HANDLER_SOURCE + 50);
    const detail = JSON.stringify([
      { event: 'click', via: 'react', name: 'open', source: long },
      { event: 'click', via: 'jquery', name: '', source: '', selector: '.row' },
    ]);
    const handlers = parseHandlers(detail);
    expect(handlers).toHaveLength(2);
    expect(handlers[0]?.source).toHaveLength(MAX_HANDLER_SOURCE);
    expect(handlers[1]?.selector).toBe('.row');
  });

  it('drops what the page could forge: unknown sources, odd event names, non-strings', () => {
    const detail = JSON.stringify([
      { event: 'click', via: 'eval', name: '', source: '' },
      { event: '<img>', via: 'react', name: '', source: '' },
      { event: 'click', via: 'react', name: 42, source: {} },
    ]);
    expect(parseHandlers(detail)).toEqual([{ event: 'click', via: 'react', name: '', source: '' }]);
    expect(parseHandlers('not json')).toEqual([]);
    expect(parseHandlers({ event: 'click' })).toEqual([]);
  });
});

describe('mergeHandlers', () => {
  it('counts a compiled onclick attribute once, as the attribute', () => {
    const inline: ScriptHandler[] = [{ event: 'click', via: 'attribute', name: '', source: 'go()' }];
    const fromPage: ScriptHandler[] = [
      { event: 'click', via: 'property', name: 'onclick', source: 'function onclick(event) { go() }' },
      { event: 'input', via: 'property', name: 'sync', source: 'function sync() {}' },
    ];
    expect(mergeHandlers(inline, fromPage).map((handler) => `${handler.via}:${handler.event}`)).toEqual([
      'attribute:click',
      'property:input',
    ]);
  });
});

describe('probeHandlersInPage', () => {
  function probe(): WeakMap<Element, ScriptHandler[]> {
    const found = new WeakMap<Element, ScriptHandler[]>();
    const stop = listenForHandlers(window, 'oi-test-handlers', found);
    probeHandlersInPage('oi-test-handlers', 1000);
    stop();
    return found;
  }

  it('reports properties, React and Vue props, and jQuery bindings, by element', () => {
    document.body.innerHTML =
      '<button id="prop"></button><button id="react"></button><button id="vue"></button><p id="jq"></p><p id="none"></p>';
    const byId = (id: string): Element => document.getElementById(id) as Element;

    (byId('prop') as HTMLElement).onclick = function saveDraft() {};
    Object.assign(byId('react'), {
      __reactProps$abc: { onDoubleClick: function openRow() {}, onClickCapture: () => {}, title: 'x' },
    });
    Object.assign(byId('vue'), { _vei: { onInputOnce: { value: function sync() {} } } });
    (window as unknown as { jQuery: unknown }).jQuery = {
      _data: (el: Element) =>
        el.id === 'jq' ? { click: [{ handler: function pick() {}, selector: '.row' }] } : undefined,
    };

    const found = probe();
    expect(found.get(byId('prop'))?.map((h) => [h.event, h.via, h.name])).toEqual([
      ['click', 'property', 'saveDraft'],
    ]);
    expect(found.get(byId('react'))?.map((h) => [h.event, h.via, h.name])).toEqual([
      ['dblclick', 'react', 'openRow'],
      ['click', 'react', 'onClickCapture'],
    ]);
    expect(found.get(byId('vue'))?.map((h) => [h.event, h.via, h.name])).toEqual([['input', 'vue', 'sync']]);
    expect(found.get(byId('jq'))?.[0]).toMatchObject({ event: 'click', via: 'jquery', name: 'pick', selector: '.row' });
    expect(found.has(byId('none'))).toBe(false);
  });

  it('reaches into open shadow roots and reports the element inside', () => {
    const host = element('<div></div>');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button></button>';
    const inner = root.querySelector('button') as HTMLButtonElement;
    inner.onclick = function inside() {};

    expect(probe().get(inner)?.[0]?.name).toBe('inside');
  });

  it('skips the inspector’s own elements', () => {
    const own = element('<open-inspector-panel></open-inspector-panel>') as HTMLElement;
    own.onclick = () => {};
    expect(probe().has(own)).toBe(false);
  });

  it('stops at the element budget', () => {
    document.body.innerHTML = '<i></i><i></i><i></i>';
    for (const item of Array.from(document.querySelectorAll('i'))) (item as HTMLElement).onclick = () => {};
    const found = new WeakMap<Element, ScriptHandler[]>();
    const stop = listenForHandlers(window, 'oi-budget', found);
    // html, head, body, then the first <i>.
    expect(probeHandlersInPage('oi-budget', 4)).toBe(1);
    stop();
  });
});

describe('pageScripts', () => {
  it('lists external scripts by file and inline ones with their text', () => {
    document.head.innerHTML =
      '<script src="/assets/app.4f2a.js" type="module" async></script><script>let a = "é";</script><script type="application/ld+json">{}</script>';
    expect(pageScripts(document)).toEqual([
      { name: 'app.4f2a.js', url: '/assets/app.4f2a.js', kind: 'module', async: true, defer: false },
      { name: 'inline', kind: 'classic', async: false, defer: false, text: 'let a = "é";', bytes: 13 },
      { name: 'inline', kind: 'json', async: false, defer: false, text: '{}', bytes: 2 },
    ]);
  });
});
