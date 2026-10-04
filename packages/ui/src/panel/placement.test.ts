import { describe, expect, it } from 'vitest';
import {
  DOCK_ZONE,
  MARGIN,
  clampFloating,
  clampHeight,
  clampWidth,
  dropPlacement,
  nearestSide,
} from './placement.js';

const viewport = { width: 1280, height: 800 };

describe('clampFloating', () => {
  it('leaves a position that is on screen alone', () => {
    expect(clampFloating(300, 120, 348, viewport)).toEqual({ x: 300, y: 120 });
  });

  it('pulls a panel back inside the margins', () => {
    expect(clampFloating(-50, -10, 348, viewport)).toEqual({ x: MARGIN, y: MARGIN });
    expect(clampFloating(5000, 5000, 348, viewport)).toEqual({
      x: 1280 - 348 - MARGIN,
      y: 800 - 200 - MARGIN,
    });
  });

  it('brings back a position saved in a bigger window', () => {
    const small = { width: 700, height: 500 };
    const { x, y } = clampFloating(1100, 600, 348, small);
    expect(x + 348).toBeLessThanOrEqual(small.width - MARGIN);
    expect(y).toBeLessThan(small.height);
  });
});

describe('dropPlacement', () => {
  it('floats where it was let go', () => {
    expect(dropPlacement(640, 400, 100, { width: 348, height: 420 }, viewport)).toEqual({
      dock: null,
      x: 400,
      y: 100,
      width: 348,
      height: 420,
    });
  });

  it('decides the dock itself, even when handed a whole floating placement', () => {
    const floating = { dock: null, x: 300, y: 100, width: 348, height: null };
    expect(dropPlacement(2, 300, 100, floating, viewport).dock).toBe('left');
  });

  it('docks when dropped against a side edge', () => {
    const size = { width: 348, height: null };
    expect(dropPlacement(DOCK_ZONE - 1, 0, 100, size, viewport).dock).toBe('left');
    expect(dropPlacement(1280 - 4, 900, 100, size, viewport).dock).toBe('right');
  });
});

describe('clampHeight', () => {
  it('keeps a height that fits, and fits one that does not', () => {
    expect(clampHeight(400, 100, viewport)).toBe(400);
    expect(clampHeight(5000, 100, viewport)).toBe(800 - 100 - MARGIN);
  });

  it('never goes below the floor while there is room for it', () => {
    expect(clampHeight(50, 100, viewport)).toBe(200);
  });
});

describe('nearestSide', () => {
  it('is the dock when docked, and the closer half when floating', () => {
    const at = (dock: 'left' | null, x: number) => ({ dock, x, y: 12, width: 348, height: null });
    expect(nearestSide(at('left', 900), viewport)).toBe('left');
    expect(nearestSide(at(null, 100), viewport)).toBe('left');
    expect(nearestSide(at(null, 800), viewport)).toBe('right');
  });
});

describe('clampWidth', () => {
  it('keeps the panel between its limits and inside a narrow window', () => {
    expect(clampWidth(100, viewport)).toBe(300);
    expect(clampWidth(2000, viewport)).toBe(720);
    expect(clampWidth(600, { width: 500, height: 800 })).toBe(452);
  });
});
