/**
 * Which elements have JavaScript wired to them, and what it is.
 *
 * Two readers, because no one place can see it all:
 *
 * - **Inline handlers** — `on*` attributes and `javascript:` links — are part
 *   of the DOM, so any world can read them, including the content script's.
 * - **Everything a page script attached** — an `onclick` property, a React or
 *   Vue prop, a jQuery binding — lives on JavaScript objects in the page's
 *   own world, which an extension's isolated world cannot see. That half runs
 *   there, as `probeHandlersInPage`, and reports back over DOM events.
 *
 * What neither can see is a plain `addEventListener` call. The browser keeps
 * those listeners where only DevTools' `getEventListeners()` reaches, so a
 * page that wires everything that way shows little here. The panel says so
 * rather than implying the list is complete.
 */

/** Where a handler was found. */
export type HandlerSource = 'attribute' | 'link' | 'property' | 'react' | 'vue' | 'jquery';

export const HANDLER_SOURCES: readonly HandlerSource[] = [
  'attribute',
  'link',
  'property',
  'react',
  'vue',
  'jquery',
];

export interface ScriptHandler {
  /** The DOM event, as the browser names it: `click`, `dblclick`. */
  event: string;
  via: HandlerSource;
  /** The function's name; empty for an anonymous one or an inline attribute. */
  name: string;
  /** Its source, cut to a preview. */
  source: string;
  /** For a delegated jQuery handler: the selector it filters on. */
  selector?: string | undefined;
}

/** Enough of a function to recognise it; the whole of one can be a bundle. */
export const MAX_HANDLER_SOURCE = 600;
/** Per element. More than this is a framework's machinery, not a reading. */
export const MAX_HANDLERS = 40;

/** `on*` attributes and `javascript:` links. Readable from any world. */
export function inlineHandlers(element: Element): ScriptHandler[] {
  const found: ScriptHandler[] = [];

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    // A handler attribute is one the element has a handler property for:
    // `onclick` is, a data-ish `one` or `only` is not.
    if (!name.startsWith('on') || name.length < 3 || !(name in element)) continue;
    found.push({
      event: name.slice(2),
      via: 'attribute',
      name: '',
      source: attribute.value.slice(0, MAX_HANDLER_SOURCE),
    });
  }

  const href = element.getAttribute('href');
  if (href && /^\s*javascript:/i.test(href)) {
    found.push({ event: 'click', via: 'link', name: '', source: href.trim().slice(0, MAX_HANDLER_SOURCE) });
  }

  return found.slice(0, MAX_HANDLERS);
}

/**
 * The page world's report for one element, checked.
 *
 * It arrives from the page's own world, so it is the page's to forge: a page
 * that wanted to could dispatch the same event with anything in it. Nothing
 * here is trusted beyond being shown as text — every field is type-checked,
 * every string capped, an unknown source dropped — and the panel renders it
 * as text, never as markup.
 */
export function parseHandlers(detail: unknown): ScriptHandler[] {
  if (typeof detail !== 'string' || detail.length > MAX_HANDLERS * (MAX_HANDLER_SOURCE + 400)) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const handlers: ScriptHandler[] = [];
  for (const entry of parsed.slice(0, MAX_HANDLERS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { event, via, name, source, selector } = entry as Record<string, unknown>;
    if (typeof event !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(event)) continue;
    if (typeof via !== 'string' || !HANDLER_SOURCES.includes(via as HandlerSource)) continue;
    const handler: ScriptHandler = {
      event,
      via: via as HandlerSource,
      name: typeof name === 'string' ? name.slice(0, 120) : '',
      source: typeof source === 'string' ? source.slice(0, MAX_HANDLER_SOURCE) : '',
    };
    if (typeof selector === 'string' && selector) handler.selector = selector.slice(0, 200);
    handlers.push(handler);
  }
  return handlers;
}

/**
 * One element's handlers from both readers, without counting one twice.
 *
 * An `onclick` attribute is also an `onclick` property once the browser has
 * compiled it, so the page world reports it again; the attribute, which
 * shows the code as written, is the one kept.
 */
export function mergeHandlers(
  inline: readonly ScriptHandler[],
  fromPage: readonly ScriptHandler[],
): ScriptHandler[] {
  const attributeEvents = new Set(
    inline.filter((handler) => handler.via === 'attribute').map((handler) => handler.event),
  );
  return [
    ...inline,
    ...fromPage.filter((handler) => !(handler.via === 'property' && attributeEvents.has(handler.event))),
  ].slice(0, MAX_HANDLERS);
}

/**
 * Report the handlers on every element of the page, from inside the page.
 *
 * **Runs in the page's own world**, passed to `scripting.executeScript` as a
 * function and serialized there — so it is entirely self-contained: no
 * imports, no reference to anything outside its own body. Anything it needs
 * is declared inside it.
 *
 * For each element with a handler it dispatches `eventName` on that element,
 * with the handlers as a JSON string in `detail`. An event is the one thing
 * that crosses from the page's world into the extension's carrying a
 * reference to the element itself; the return value of `executeScript` can
 * only carry data. Composed, so it reaches a listener on the window from
 * inside an open shadow root, whose `composedPath()` starts at the element.
 *
 * Reads only. It takes nothing but function names and source text, and it
 * changes nothing on the page beyond the events it dispatches. Returns how
 * many elements it reported.
 */
export function probeHandlersInPage(eventName: string, maxElements: number): number {
  const SOURCE_LIMIT = 600;
  const PER_ELEMENT = 40;
  const PROPERTY_EVENTS = [
    'click', 'dblclick', 'contextmenu', 'auxclick',
    'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousemove',
    'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
    'touchstart', 'touchend', 'touchmove', 'wheel', 'scroll',
    'keydown', 'keyup', 'keypress',
    'input', 'change', 'submit', 'reset', 'invalid', 'select', 'toggle',
    'focus', 'blur', 'load', 'error',
    'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
    'animationend', 'transitionend',
  ];
  const REACT_NAMES: Record<string, string> = { doubleclick: 'dblclick' };

  type Found = { event: string; via: string; name: string; source: string; selector?: string };

  const describe = (fn: unknown): { name: string; source: string } => {
    if (typeof fn !== 'function') return { name: '', source: '' };
    let source = '';
    try {
      source = Function.prototype.toString.call(fn).slice(0, SOURCE_LIMIT);
    } catch {
      source = '';
    }
    let name = '';
    try {
      name = typeof fn.name === 'string' ? fn.name : '';
    } catch {
      name = '';
    }
    return { name, source };
  };

  // `onClickCapture` → click, `onDoubleClick` → dblclick, Vue's `onClickOnce` → click.
  const eventFromProp = (prop: string): string => {
    const bare = prop.slice(2).replace(/(Capture|Once|Passive)+$/, '').toLowerCase();
    return REACT_NAMES[bare] ?? bare;
  };

  const jQuery = (window as unknown as { jQuery?: { _data?: (el: Element, key: string) => unknown } })
    .jQuery;

  const read = (element: Element): Found[] => {
    const found: Found[] = [];
    const record = element as unknown as Record<string, unknown>;

    for (const event of PROPERTY_EVENTS) {
      const handler = record[`on${event}`];
      if (typeof handler === 'function') found.push({ event, via: 'property', ...describe(handler) });
    }

    for (const key of Object.keys(element)) {
      // React 17+ keeps an element's props under a random-suffixed key; 16 used another name.
      if (key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$')) {
        const props = record[key];
        if (typeof props !== 'object' || props === null) continue;
        for (const [prop, value] of Object.entries(props as Record<string, unknown>)) {
          if (/^on[A-Z]/.test(prop) && typeof value === 'function') {
            found.push({ event: eventFromProp(prop), via: 'react', ...describe(value) });
          }
        }
      }
    }

    // Vue 3 keeps the listeners it attached as invokers on the element.
    const invokers = record['_vei'];
    if (typeof invokers === 'object' && invokers !== null) {
      for (const [prop, invoker] of Object.entries(invokers as Record<string, unknown>)) {
        if (!invoker) continue;
        const value = (invoker as { value?: unknown }).value;
        for (const fn of Array.isArray(value) ? value : [value]) {
          if (typeof fn === 'function') found.push({ event: eventFromProp(prop), via: 'vue', ...describe(fn) });
        }
      }
    }

    if (jQuery && typeof jQuery._data === 'function') {
      let events: unknown;
      try {
        events = jQuery._data(element, 'events');
      } catch {
        events = undefined;
      }
      if (typeof events === 'object' && events !== null) {
        for (const [event, bindings] of Object.entries(events as Record<string, unknown>)) {
          if (!Array.isArray(bindings)) continue;
          for (const binding of bindings) {
            const { handler, selector } = (binding ?? {}) as { handler?: unknown; selector?: unknown };
            const entry: Found = { event, via: 'jquery', ...describe(handler) };
            if (typeof selector === 'string' && selector) entry.selector = selector;
            found.push(entry);
          }
        }
      }
    }

    return found.slice(0, PER_ELEMENT);
  };

  let visited = 0;
  let reported = 0;
  const pending: Array<Document | ShadowRoot> = [document];

  while (pending.length > 0 && visited < maxElements) {
    const root = pending.pop();
    if (!root) break;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    for (let node = walker.nextNode(); node && visited < maxElements; node = walker.nextNode()) {
      const element = node as Element;
      visited += 1;
      // The inspector's own UI, which is not the page's.
      if (element.localName.startsWith('open-inspector-')) continue;
      if (element.shadowRoot) pending.push(element.shadowRoot);

      const found = read(element);
      if (found.length === 0) continue;
      element.dispatchEvent(
        new CustomEvent(eventName, { detail: JSON.stringify(found), composed: true }),
      );
      reported += 1;
    }
  }

  return reported;
}

/**
 * Collect what `probeHandlersInPage` reports, into a map by element.
 *
 * Listens on the window in the capture phase, the first place the event can
 * be caught, and stops it there so the page's own listeners further along do
 * not see it. Call the returned function once the probe has run.
 */
export function listenForHandlers(
  view: Window,
  eventName: string,
  found: WeakMap<Element, ScriptHandler[]>,
): () => void {
  const listener = (event: Event): void => {
    event.stopImmediatePropagation();
    const target = event.composedPath()[0];
    if (!target || typeof (target as Element).getAttribute !== 'function') return;
    const handlers = parseHandlers((event as CustomEvent<unknown>).detail);
    if (handlers.length > 0) found.set(target as Element, handlers);
  };
  view.addEventListener(eventName, listener, true);
  return () => view.removeEventListener(eventName, listener, true);
}
