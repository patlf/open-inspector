import type { Rect } from '@open-inspector/core';

export interface Viewport {
  width: number;
  height: number;
}

export interface ChipSize {
  width: number;
  height: number;
}

export interface ChipPlacement {
  x: number;
  y: number;
  /** Where the chip ended up relative to the element it labels. */
  side: 'above' | 'below';
}

/** Gap between the chip and the element it labels, and from the viewport edge. */
const GAP = 4;

/**
 * Decide where the label chip sits.
 *
 * Prefers directly above the element's margin box. Flips below when there is
 * no room above — which is the common case for elements at the top of the page,
 * including the ones people reach for first. Always clamps into the viewport so
 * the label never renders off-screen for a wide or edge-hugging element.
 *
 * Pure, so the flip and clamp rules are testable without a layout engine.
 */
export function placeChip(target: Rect, chip: ChipSize, viewport: Viewport): ChipPlacement {
  const above = target.y - chip.height - GAP;
  const below = target.y + target.height + GAP;

  const fitsAbove = above >= GAP;
  const fitsBelow = below + chip.height <= viewport.height - GAP;

  let y: number;
  let side: ChipPlacement['side'];

  if (fitsAbove) {
    y = above;
    side = 'above';
  } else if (fitsBelow) {
    y = below;
    side = 'below';
  } else {
    // Element taller than the viewport: pin inside its top edge rather than
    // letting the chip drift off-screen entirely.
    y = Math.max(GAP, Math.min(target.y + GAP, viewport.height - chip.height - GAP));
    side = 'below';
  }

  const maxX = Math.max(GAP, viewport.width - chip.width - GAP);
  const x = Math.min(Math.max(target.x, GAP), maxX);

  return { x, y, side };
}
