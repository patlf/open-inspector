import { describe, expect, it, vi } from 'vitest';
import type { BoxModel, EdgeSizes } from '@open-inspector/core';
import { createOverlay, describeFocus, edgeProperty } from './overlay.js';

const rect = { x: 0, y: 0, width: 0, height: 0 };
const zero: EdgeSizes = { top: 0, right: 0, bottom: 0, left: 0 };

function box(edges: Partial<BoxModel['edges']>): BoxModel {
  return {
    margin: rect,
    border: rect,
    padding: rect,
    content: { x: 0, y: 0, width: 187.333, height: 76.78 },
    edges: { margin: zero, border: zero, padding: zero, ...edges },
  };
}

describe('edgeProperty', () => {
  it('names the longhand, and a border edge by its width', () => {
    expect(edgeProperty('padding', 'top')).toBe('padding-top');
    expect(edgeProperty('border', 'left')).toBe('border-left-width');
  });
});

describe('describeFocus', () => {
  it('writes one edge as its longhand', () => {
    const model = box({ padding: { top: 16, right: 8, bottom: 16, left: 8 } });
    expect(describeFocus(model, { region: 'padding', side: 'top' })).toBe('padding-top: 16px');
  });

  it('writes a zero edge without a unit, as CSS would', () => {
    expect(describeFocus(box({}), { region: 'margin', side: 'left' })).toBe('margin-left: 0');
  });

  it('collapses a band to its shortest shorthand', () => {
    const even = box({ margin: { top: 8, right: 8, bottom: 8, left: 8 } });
    const pairs = box({ margin: { top: 8, right: 16, bottom: 8, left: 16 } });
    const three = box({ margin: { top: 4, right: 16, bottom: 8, left: 16 } });
    const four = box({ margin: { top: 1, right: 2, bottom: 3, left: 4 } });

    expect(describeFocus(even, { region: 'margin', side: null })).toBe('margin: 8px');
    expect(describeFocus(pairs, { region: 'margin', side: null })).toBe('margin: 8px 16px');
    expect(describeFocus(three, { region: 'margin', side: null })).toBe('margin: 4px 16px 8px');
    expect(describeFocus(four, { region: 'margin', side: null })).toBe('margin: 1px 2px 3px 4px');
  });

  it('calls the border band border-width', () => {
    const model = box({ border: { top: 2, right: 2, bottom: 2, left: 2 } });
    expect(describeFocus(model, { region: 'border', side: null })).toBe('border-width: 2px');
  });

  it('gives the content box its size', () => {
    expect(describeFocus(box({}), { region: 'content', side: null })).toBe('content: 187.33 × 76.78');
  });
});

describe('the chip', () => {
  it('leads with the JS mark only for an element with handlers', () => {
    // The overlay's root is closed; keep hold of it as it is made.
    const attach = vi.spyOn(HTMLElement.prototype, 'attachShadow');
    const overlay = createOverlay();
    const shadow = attach.mock.results[0]?.value as ShadowRoot;
    attach.mockRestore();
    const mark = () => shadow.querySelector<SVGElement>('.chip .js')?.style.display;

    overlay.show({ box: box({}), selectorLabel: 'button#go', dimensions: '80 × 24', script: true });
    expect(mark()).toBe('block');

    overlay.show({ box: box({}), selectorLabel: 'p', dimensions: '80 × 24' });
    expect(mark()).toBe('none');
    overlay.destroy();
  });
});
