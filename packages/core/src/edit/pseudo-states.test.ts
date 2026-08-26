import { beforeEach, describe, expect, it } from 'vitest';
import {
  FORCE_ATTRIBUTE,
  FORCEABLE_STATES,
  createPseudoStateController,
  mentionsState,
  rewriteSelector,
} from './pseudo-states.js';

describe('rewriteSelector', () => {
  it('swaps a pseudo-class for the marker attribute', () => {
    expect(rewriteSelector('a:hover', FORCEABLE_STATES)).toBe(
      `a[${FORCE_ATTRIBUTE}~="hover"]`,
    );
  });

  it('does not mangle the longer names', () => {
    // Replacing `:focus` first would turn `:focus-visible` into
    // `[data-…~="focus"]-visible`, which matches nothing and silently breaks
    // every focus-visible rule on the page.
    expect(rewriteSelector('button:focus-visible', FORCEABLE_STATES)).toBe(
      `button[${FORCE_ATTRIBUTE}~="focus-visible"]`,
    );
    expect(rewriteSelector('.a:focus-within', FORCEABLE_STATES)).toBe(
      `.a[${FORCE_ATTRIBUTE}~="focus-within"]`,
    );
  });

  it('handles several states in one selector', () => {
    const result = rewriteSelector('a:hover:focus', FORCEABLE_STATES);
    expect(result).toContain('~="hover"');
    expect(result).toContain('~="focus"');
    expect(result).not.toContain(':hover');
  });

  it('rewrites inside :not() too', () => {
    expect(rewriteSelector('a:not(:hover)', FORCEABLE_STATES)).toBe(
      `a:not([${FORCE_ATTRIBUTE}~="hover"])`,
    );
  });

  it('leaves unrelated pseudo-classes and elements alone', () => {
    expect(rewriteSelector('li:first-child::before', FORCEABLE_STATES)).toBe(
      'li:first-child::before',
    );
    expect(rewriteSelector('input:checked', FORCEABLE_STATES)).toBe('input:checked');
  });

  it('preserves specificity', () => {
    // A pseudo-class and an attribute selector both weigh one class-level
    // unit, so the cascade order is unchanged. If this stopped being true the
    // forced styles would start winning fights the real ones would lose.
    const before = 'nav a.link:hover';
    const after = rewriteSelector(before, FORCEABLE_STATES);

    const classUnits = (selector: string) =>
      (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;

    expect(classUnits(after)).toBe(classUnits(before));
  });
});

describe('mentionsState', () => {
  it('reports each state a selector uses', () => {
    expect(mentionsState('a:hover:focus', FORCEABLE_STATES).sort()).toEqual(['focus', 'hover']);
  });

  it('does not report a prefix match', () => {
    expect(mentionsState('a:focus-visible', FORCEABLE_STATES)).toEqual(['focus-visible']);
  });

  it('returns nothing for a plain selector', () => {
    expect(mentionsState('.card .title', FORCEABLE_STATES)).toEqual([]);
  });
});

describe('createPseudoStateController', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<a id="link" href="#">link</a>';
  });

  function withStyles(css: string): void {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  it('reports which states the page actually styles', () => {
    withStyles('a:hover { color: red } button:focus { outline: 1px solid }');
    const controller = createPseudoStateController(document);

    expect([...controller.support.available].sort()).toEqual(['focus', 'hover']);
    expect(controller.support.ruleCount).toBe(2);
    controller.destroy();
  });

  it('reports nothing to force when the page styles no states', () => {
    withStyles('a { color: blue }');
    const controller = createPseudoStateController(document);

    // The UI needs this to say "this page has no hover styles" rather than
    // offering a toggle that does nothing.
    expect(controller.support.ruleCount).toBe(0);
    expect(controller.support.available.size).toBe(0);
    controller.destroy();
  });

  it('marks the element and injects a stylesheet', () => {
    withStyles('a:hover { color: red }');
    const controller = createPseudoStateController(document);
    const link = document.querySelector('#link') as HTMLElement;

    controller.force(link, new Set(['hover']));

    expect(link.getAttribute(FORCE_ATTRIBUTE)).toBe('hover');
    expect(document.querySelector('style[data-open-inspector]')).not.toBeNull();
    controller.destroy();
  });

  it('carries several states in one attribute', () => {
    withStyles('a:hover { color: red } a:focus { color: green }');
    const controller = createPseudoStateController(document);
    const link = document.querySelector('#link') as HTMLElement;

    controller.force(link, new Set(['hover', 'focus']));

    // `~=` matches one word in a space-separated list, which is why the
    // attribute is written this way rather than as several attributes.
    expect(link.getAttribute(FORCE_ATTRIBUTE)?.split(' ').sort()).toEqual(['focus', 'hover']);
    controller.destroy();
  });

  it('clears the attribute when the set is emptied', () => {
    withStyles('a:hover { color: red }');
    const controller = createPseudoStateController(document);
    const link = document.querySelector('#link') as HTMLElement;

    controller.force(link, new Set(['hover']));
    controller.force(link, new Set());

    expect(link.hasAttribute(FORCE_ATTRIBUTE)).toBe(false);
    expect(controller.forced(link).size).toBe(0);
    controller.destroy();
  });

  it('leaves no trace on destroy', () => {
    withStyles('a:hover { color: red }');
    const controller = createPseudoStateController(document);
    const link = document.querySelector('#link') as HTMLElement;

    controller.force(link, new Set(['hover']));
    controller.destroy();

    expect(link.hasAttribute(FORCE_ATTRIBUTE)).toBe(false);
    expect(document.querySelector('style[data-open-inspector]')).toBeNull();
  });

  it('keeps a media condition around a forced rule', () => {
    // A hover rule that only applies above 768px must keep that condition, or
    // forcing hover would paint desktop styles onto a phone layout.
    withStyles('@media (min-width: 768px) { a:hover { color: red } }');
    const controller = createPseudoStateController(document);

    controller.force(document.querySelector('#link') as HTMLElement, new Set(['hover']));
    const injected = document.querySelector('style[data-open-inspector]')?.textContent ?? '';

    expect(injected).toContain('@media');
    expect(injected).toContain('min-width: 768px');
    controller.destroy();
  });

  it('survives a stylesheet it cannot read', () => {
    withStyles('a:hover { color: red }');

    const sheet = document.createElement('style');
    document.head.appendChild(sheet);
    Object.defineProperty(sheet.sheet as CSSStyleSheet, 'cssRules', {
      get() {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    });

    const controller = createPseudoStateController(document);

    // The readable sheet still works, and the unreadable one is counted so the
    // UI can say the answer is partial.
    expect(controller.support.unreadableSheets).toBe(1);
    expect(controller.support.available.has('hover')).toBe(true);
    controller.destroy();
  });
});
