import { cascade } from '@open-inspector/core';
import { afterEach, describe, expect, it } from 'vitest';
import { collectElementData } from './collect.js';

/**
 * The panel's collector against a real engine.
 *
 * Each case pairs what the panel reports with what Chromium itself computed,
 * so the test is "we agree with the browser" rather than "we agree with a
 * fixture we wrote ourselves".
 */

const mounted: Element[] = [];

function mount(css: string, html: string): HTMLElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);

  mounted.push(style, host);
  return host;
}

function collect(element: Element) {
  const styleIndex = cascade.buildStyleIndex(
    Array.from(document.styleSheets, (sheet) => ({ sheet, kind: null })),
  );
  return collectElementData(element, window, { styleIndex });
}

/** The winning value the panel lists for a property, across all matched rules. */
function winningValue(data: ReturnType<typeof collect>, property: string): string | undefined {
  for (const rule of data.rules) {
    for (const declaration of rule.declarations) {
      if (declaration.property === property && declaration.winning) return declaration.value;
    }
  }
  return undefined;
}

afterEach(() => {
  for (const node of mounted.splice(0)) node.remove();
});

describe('matched rules agree with the engine', () => {
  it('reverses layer order for !important, as the browser does', () => {
    const host = mount(
      `@layer base, theme;
       @layer base { .target { color: rgb(255, 0, 0) !important; } }
       @layer theme { .target { color: rgb(0, 0, 255) !important; } }`,
      '<p class="target">text</p>',
    );
    const target = host.querySelector('.target')!;

    // Earlier layer wins for important declarations.
    expect(getComputedStyle(target).color).toBe('rgb(255, 0, 0)');
    expect(winningValue(collect(target), 'color')).toBe('rgb(255, 0, 0)');
  });

  it('lets unlayered normal styles beat a more specific layered rule', () => {
    const host = mount(
      `@layer base { #id.target { margin-top: 3px; } }
       .target { margin-top: 7px; }`,
      '<div id="id" class="target"></div>',
    );
    const target = host.querySelector('.target')!;

    expect(getComputedStyle(target).marginTop).toBe('7px');
    expect(winningValue(collect(target), 'margin-top')).toBe('7px');
  });

  it('marks the declaration that lost on specificity as not winning', () => {
    const host = mount(
      `.a { padding-left: 1px; } .a.b { padding-left: 9px; }`,
      '<div class="a b"></div>',
    );
    const target = host.querySelector('.a')!;
    const data = collect(target);

    const losing = data.rules
      .flatMap((rule) => rule.declarations)
      .filter((declaration) => declaration.property === 'padding-left' && !declaration.winning);

    expect(getComputedStyle(target).paddingLeft).toBe('9px');
    expect(winningValue(data, 'padding-left')).toBe('9px');
    expect(losing.map((declaration) => declaration.value)).toEqual(['1px']);
  });
});

describe('geometry and type from real layout', () => {
  it('reads the box model the browser laid out', () => {
    const host = mount(
      `.box { box-sizing: content-box; width: 100px; height: 40px; padding: 4px 6px; border: 2px solid; margin: 10px; }`,
      '<div class="box"></div>',
    );
    const data = collect(host.querySelector('.box')!);

    expect(data.dimensions).toBe('116 × 52');
  });

  it('does not claim a font rendered when it is not installed', () => {
    const host = mount(
      `.t { font-family: "Definitely Not Installed 9f3a", monospace; font-size: 20px; }`,
      '<p class="t">The quick brown fox</p>',
    );
    const data = collect(host.querySelector('.t')!);

    expect(data.typography.stack[0]).toContain('Definitely Not Installed');
    expect(data.typography.rendered ?? '').not.toContain('Definitely Not Installed');
  });

  it('summarises a real grid', () => {
    const host = mount(
      `.grid { display: grid; width: 600px; grid-template-columns: repeat(3, 1fr); gap: 12px; }`,
      '<div class="grid"><i></i><i></i><i></i></div>',
    );
    const data = collect(host.querySelector('.grid')!);

    expect(data.layout.display).toContain('grid');
    expect(data.layout.summary ?? '').toMatch(/3/);
  });
});
