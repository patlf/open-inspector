import { cssPath } from './css-path.js';

/**
 * Live CSS overrides.
 *
 * Edits are applied as inline styles on the element, which is the only lever
 * that reliably wins without touching the page's stylesheets. Three properties
 * shape the design:
 *
 * 1. **Exactly revertible.** Every override records the element's prior inline
 *    value *and priority*, so undo restores the page to the state it was in —
 *    including the case where the page already had an inline style of its own.
 *    Blanket-clearing `element.style` would silently delete the page's work.
 *
 * 2. **Honest about rejection.** `setProperty` ignores values the engine
 *    cannot parse, without complaint. Every write is read back; a value that
 *    did not take is reported as rejected rather than shown as applied.
 *
 * 3. **Session-only.** Nothing is persisted and nothing is written to the
 *    page's stylesheets. A reload discards every edit, which is the behaviour
 *    people expect from a devtool and the only one compatible with a tool that
 *    never stores anything.
 */

export type OverrideOutcome = 'applied' | 'rejected' | 'unchanged';

export interface Override {
  property: string;
  /** What the user asked for. */
  value: string;
  /** The element's own inline value before we touched it; `''` if none. */
  previousValue: string;
  /** The prior `!important` state, preserved so undo is exact. */
  previousPriority: string;
  /**
   * The computed value before the edit.
   *
   * Distinct from `previousValue`, which is the *inline* value and is usually
   * empty. This is what the element actually looked like, and it is the only
   * thing that makes a change list readable: "padding: 40px" tells you nothing
   * without "was 32px 24px 96px" beside it.
   */
  previousComputed: string;
}

export interface ElementOverrides {
  element: Element;
  selector: string;
  overrides: Override[];
}

export interface OverrideStore {
  /** Apply one declaration. Reports whether the engine accepted it. */
  set(element: Element, property: string, value: string): OverrideOutcome;
  /** Revert one declaration to whatever the page had. */
  clear(element: Element, property: string): void;
  /** Revert every declaration on one element. */
  clearElement(element: Element): void;
  /** Revert everything, everywhere. */
  clearAll(): void;
  /** Overrides currently applied to this element. */
  forElement(element: Element): Override[];
  /** Every element with edits, in the order they were first edited. */
  all(): ElementOverrides[];
  /** Total number of applied declarations. */
  count(): number;
  /** The edits as a CSS stylesheet, ready to paste. */
  toCss(): string;
  /**
   * The edits written as an instruction for a coding assistant.
   *
   * A stylesheet alone loses the context that makes the change actionable:
   * which element, what it looked like before, and that these are the only
   * changes wanted. This carries all three.
   */
  toPrompt(): string;
}

/** Normalize `marginTop` and `margin-top` to the form the CSSOM expects. */
export function toKebabProperty(property: string): string {
  return property.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Will the engine accept this declaration?
 *
 * Asked *before* writing, deliberately. The obvious alternative — write, then
 * read back and see if it stuck — cannot tell rejection from a no-op: if the
 * element already had `color: blue` inline and the user types nonsense, the
 * write is silently dropped and the read-back still returns `blue`. That looks
 * exactly like success, and the edit would be reported as applied while
 * nothing had changed.
 *
 * `CSS.supports` is the purpose-built API. The detached-element probe is the
 * fallback: a fresh element has no prior value, so any non-empty read-back
 * means the value parsed.
 */
export function acceptsDeclaration(property: string, value: string, doc?: Document): boolean {
  const supports = (globalThis as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS
    ?.supports;

  if (typeof supports === 'function') {
    try {
      return supports(property, value);
    } catch {
      // Malformed property name; fall through to the probe.
    }
  }

  const owner = doc ?? (typeof document === 'undefined' ? null : document);
  if (!owner) return true;

  try {
    const probe = owner.createElement('div');
    probe.style.setProperty(property, value);
    return probe.style.getPropertyValue(property) !== '';
  } catch {
    // Nothing can tell us; let the engine have the last word.
    return true;
  }
}

export interface OverrideStoreOptions {
  /**
   * Validator override.
   *
   * Injected so the rejection path can be tested without depending on the
   * host DOM's CSS parser — test environments generally have none.
   */
  accepts?: (property: string, value: string) => boolean;
}

export function createOverrideStore(options: OverrideStoreOptions = {}): OverrideStore {
  const accepts =
    options.accepts ??
    ((property: string, value: string) => acceptsDeclaration(property, value));

  /**
   * A plain Map, not a WeakMap.
   *
   * The store has to enumerate its own contents to render the change list and
   * emit CSS, which a WeakMap cannot do. Holding references to edited elements
   * is bounded by how many things a person edits by hand, and `clearAll` drops
   * them all.
   */
  const byElement = new Map<Element, Map<string, Override>>();

  /** What the element looked like before we touched it. */
  function readComputed(element: Element, property: string): string {
    try {
      const view = element.ownerDocument?.defaultView;
      if (!view) return '';
      return view.getComputedStyle(element).getPropertyValue(property).trim();
    } catch {
      return '';
    }
  }

  function styleOf(element: Element): CSSStyleDeclaration | null {
    const style = (element as HTMLElement).style;
    return style && typeof style.setProperty === 'function' ? style : null;
  }

  function set(element: Element, rawProperty: string, value: string): OverrideOutcome {
    const style = styleOf(element);
    if (!style) return 'rejected';

    const property = toKebabProperty(rawProperty);
    const existing = byElement.get(element)?.get(property);

    // Record the page's own inline value the first time we touch a property,
    // never on subsequent edits — otherwise the second edit would record our
    // own first edit as the thing to restore.
    const previousValue = existing?.previousValue ?? style.getPropertyValue(property);
    const previousPriority = existing?.previousPriority ?? style.getPropertyPriority(property);
    const previousComputed = existing?.previousComputed ?? readComputed(element, property);

    const trimmed = value.trim();
    if (trimmed === '') {
      clear(element, property);
      return 'unchanged';
    }

    // Checked before touching the element, so a rejected value leaves the page
    // exactly as it was rather than needing to be undone.
    if (!accepts(property, trimmed)) return 'rejected';

    style.setProperty(property, trimmed, 'important');

    const map = byElement.get(element) ?? new Map<string, Override>();
    map.set(property, {
      property,
      value: trimmed,
      previousValue,
      previousPriority,
      previousComputed,
    });
    byElement.set(element, map);

    return 'applied';
  }

  function clear(element: Element, rawProperty: string): void {
    const property = toKebabProperty(rawProperty);
    const map = byElement.get(element);
    const override = map?.get(property);
    const style = styleOf(element);

    if (override && style) {
      style.removeProperty(property);
      // Restore whatever the page itself had inline, if anything.
      if (override.previousValue) {
        style.setProperty(property, override.previousValue, override.previousPriority);
      }

      // Removing the last declaration leaves `style=""` behind. It changes
      // nothing visually, but it is a mark this tool left on a page it was
      // only supposed to read, and it shows up in anyone's copied HTML.
      if (style.length === 0 && element.getAttribute('style') === '') {
        element.removeAttribute('style');
      }
    }

    map?.delete(property);
    if (map && map.size === 0) byElement.delete(element);
  }

  function clearElement(element: Element): void {
    const map = byElement.get(element);
    if (!map) return;
    for (const property of [...map.keys()]) clear(element, property);
  }

  return {
    set,
    clear,
    clearElement,

    clearAll() {
      for (const element of [...byElement.keys()]) clearElement(element);
      byElement.clear();
    },

    forElement(element) {
      return [...(byElement.get(element)?.values() ?? [])];
    },

    all() {
      return [...byElement.entries()].map(([element, map]) => ({
        element,
        selector: cssPath(element),
        overrides: [...map.values()],
      }));
    },

    count() {
      let total = 0;
      for (const map of byElement.values()) total += map.size;
      return total;
    },

    toCss() {
      const blocks: string[] = [];

      for (const entry of this.all()) {
        if (entry.overrides.length === 0) continue;

        const declarations = entry.overrides
          .slice()
          .sort((a, b) => a.property.localeCompare(b.property))
          .map((override) => {
            // The previous value is the whole point of a diff; without it the
            // reader cannot tell a tweak from a rewrite.
            const was = override.previousComputed
              ? `  /* was: ${override.previousComputed} */\n`
              : '';
            return `${was}  ${override.property}: ${override.value};`;
          });

        blocks.push(`${entry.selector} {\n${declarations.join('\n')}\n}`);
      }

      if (blocks.length === 0) return '';
      return `/* Edited with Open Inspector — not saved anywhere */\n${blocks.join('\n\n')}\n`;
    },

    toPrompt() {
      const entries = this.all().filter((entry) => entry.overrides.length > 0);
      if (entries.length === 0) return '';

      const lines: string[] = [
        'I changed these styles in the browser and want the same changes in the code.',
        'Each block lists the element, then every property with its previous value.',
        'Apply them in the stylesheet or component that owns the element — not as',
        'inline styles.',
        '',
      ];

      for (const entry of entries) {
        const descriptor = describeForPrompt(entry.element);
        lines.push(`Element: ${descriptor}`);
        lines.push(`Selector: ${entry.selector}`);

        for (const override of [...entry.overrides].sort((a, b) =>
          a.property.localeCompare(b.property),
        )) {
          const was = override.previousComputed || '(not set)';
          lines.push(`  ${override.property}: ${was}  ->  ${override.value}`);
        }

        lines.push('');
      }

      return `${lines.join('\n').trimEnd()}\n`;
    },
  };
}

/** A short human description of an element, for the prompt header. */
function describeForPrompt(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48);
  return text ? `<${tag}> "${text}"` : `<${tag}>`;
}
