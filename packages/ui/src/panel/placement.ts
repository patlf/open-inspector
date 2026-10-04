import type { PanelPlacement } from '../settings.js';

/**
 * Where the panel may go, as pure arithmetic on a viewport.
 *
 * Kept apart from the component so the rules — how far it may be dragged,
 * when a drop docks it, which side it belongs to — can be tested without a
 * layout engine.
 */

/** Narrowest width the rows still lay out in; widest before it stops being a side panel. */
export const MIN_WIDTH = 300;
export const MAX_WIDTH = 720;
export const DEFAULT_WIDTH = 348;

/** The gap kept between the panel and the viewport's edges. */
export const MARGIN = 12;

/** A drop with the pointer this close to a side edge docks the panel there. */
export const DOCK_ZONE = 24;

/** Height a floating panel keeps at the least: its header and a few rows. */
export const MIN_FLOATING_HEIGHT = 200;

export interface Viewport {
  width: number;
  height: number;
}

/**
 * A dragged height, kept between the floor and the room below the panel's top.
 * Saved in a taller window, it shrinks to fit rather than running off screen.
 */
export function clampHeight(height: number, top: number, viewport: Viewport): number {
  const room = viewport.height - top - MARGIN;
  return Math.round(Math.max(Math.min(MIN_FLOATING_HEIGHT, room), Math.min(height, room)));
}

export function clampWidth(width: number, viewport: Viewport): number {
  const room = viewport.width - 48;
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, MAX_WIDTH, room)));
}

/** The side a panel is docked to, or the one a floating panel is nearer. */
export function nearestSide(placement: PanelPlacement, viewport: Viewport): 'left' | 'right' {
  if (placement.dock) return placement.dock;
  return placement.x + placement.width / 2 < viewport.width / 2 ? 'left' : 'right';
}

/**
 * Keep a floating panel on screen.
 *
 * Saved positions come from whatever window size the panel was last used at;
 * reopened in a smaller one, a panel left in the corner would otherwise open
 * with its header out of reach and no way to drag it back.
 */
export function clampFloating(
  x: number,
  y: number,
  width: number,
  viewport: Viewport,
): { x: number; y: number } {
  const maxX = Math.max(MARGIN, viewport.width - width - MARGIN);
  const maxY = Math.max(MARGIN, viewport.height - MIN_FLOATING_HEIGHT - MARGIN);
  return {
    x: Math.round(Math.min(Math.max(x, MARGIN), maxX)),
    y: Math.round(Math.min(Math.max(y, MARGIN), maxY)),
  };
}

/**
 * Where a drag ends up.
 *
 * Dropped with the pointer against a side edge, it docks there, full height,
 * the way it opens by default. Anywhere else it floats where it was let go.
 */
export function dropPlacement(
  pointerX: number,
  x: number,
  y: number,
  size: { width: number; height: number | null },
  viewport: Viewport,
): PanelPlacement {
  const position = clampFloating(x, y, size.width, viewport);
  const dock =
    pointerX <= DOCK_ZONE ? 'left' : pointerX >= viewport.width - DOCK_ZONE ? 'right' : null;
  // Only the size is taken from `size`: callers pass a whole placement, and its
  // own `dock` must not overwrite the one this drop decided.
  return { dock, ...position, width: size.width, height: size.height };
}
