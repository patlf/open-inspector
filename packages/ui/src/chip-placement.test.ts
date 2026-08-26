import { describe, expect, it } from 'vitest';
import { placeChip } from './chip-placement.js';
import type { Rect } from '@open-inspector/core';

const viewport = { width: 1280, height: 800 };
const chip = { width: 200, height: 20 };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe('placeChip', () => {
  it('sits above the element when there is room', () => {
    const placement = placeChip(rect(100, 300, 400, 200), chip, viewport);

    expect(placement.side).toBe('above');
    expect(placement.y).toBe(276); // 300 - 20 - 4
    expect(placement.x).toBe(100);
  });

  it('flips below for an element at the top of the page', () => {
    // The masthead is the first thing anyone hovers; getting this wrong means
    // the label is clipped on the very first interaction.
    const placement = placeChip(rect(0, 0, 1280, 80), chip, viewport);

    expect(placement.side).toBe('below');
    expect(placement.y).toBe(84);
  });

  it('clamps to the left edge for a negatively positioned element', () => {
    const placement = placeChip(rect(-50, 300, 400, 100), chip, viewport);

    expect(placement.x).toBe(4);
  });

  it('clamps to the right edge for an element near the far side', () => {
    const placement = placeChip(rect(1200, 300, 200, 100), chip, viewport);

    expect(placement.x).toBe(1076); // 1280 - 200 - 4
  });

  it('keeps the chip on screen when the element is taller than the viewport', () => {
    // No room above, and "below" would be past the fold.
    const placement = placeChip(rect(0, -200, 1280, 4000), chip, viewport);

    expect(placement.y).toBeGreaterThanOrEqual(4);
    expect(placement.y + chip.height).toBeLessThanOrEqual(viewport.height);
  });

  it('never places the chip outside the viewport horizontally', () => {
    const cases: Rect[] = [
      rect(-1000, 100, 50, 50),
      rect(5000, 100, 50, 50),
      rect(0, 100, 1280, 50),
    ];

    for (const target of cases) {
      const placement = placeChip(target, chip, viewport);
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.x + chip.width).toBeLessThanOrEqual(viewport.width);
    }
  });

  it('handles a chip wider than the viewport without going negative', () => {
    const wide = { width: 2000, height: 20 };
    const placement = placeChip(rect(100, 300, 200, 100), wide, viewport);

    expect(placement.x).toBe(4);
  });
});
