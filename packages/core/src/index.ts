/**
 * @open-inspector/core — the inspection engine.
 *
 * Pure TypeScript: takes a DOM, returns data. No `chrome.*`, no `browser.*`,
 * no network. That boundary is what lets this run in unit tests, in a future
 * CLI, and in a Playwright plugin without carrying an extension along with it.
 *
 * @module
 */

export type {
  BoxModel,
  EdgeSizes,
  ElementDescriptor,
  ProbeBoundary,
  ProbeResult,
  Rect,
} from './types.js';

export {
  insetRect,
  isEmptyRect,
  outsetRect,
  parsePx,
  round,
  toRect,
} from './geometry/rect.js';

export {
  buildBoxModel,
  readBoxModel,
  readEdgeSizes,
  type BoxEdges,
} from './geometry/box-model.js';

export { createHitTester, type HitTester, type HitTestOptions } from './probe/hit-test.js';
export { MAX_SHADOW_DEPTH, pierceShadowRoots } from './probe/pierce.js';
export { detectBoundary } from './probe/boundary.js';
export { buildSelectorLabel, describeElement, formatDimensions } from './probe/describe.js';
export { probeAtPoint, type ProbeOptions } from './probe/probe.js';
export {
  ancestorTrail,
  readTreePosition,
  stepTree,
  DEFAULT_TRAIL_DEPTH,
  type TreeCrumb,
  type TreeDirection,
  type TreeOptions,
  type TreePosition,
} from './probe/tree.js';

/**
 * The analysis modules, exported as namespaces.
 *
 * Namespaced rather than flattened because several of them legitimately define
 * the same type names — `StyleSheetLike`, `UnreadableStyleSheet`,
 * `FontFaceSource` — each shaped for its own job. Flattening would force
 * arbitrary renames on modules that are correct as they stand, and
 * `color.collectPalette(...)` reads better than `collectPalette(...)` anyway.
 */
export * as color from './color/index.js';
export * as typography from './typography/index.js';
export * as layout from './layout/index.js';
export * as cascade from './cascade/index.js';
export * as assets from './assets/index.js';
export * as a11y from './a11y/index.js';
export * as tokens from './tokens/index.js';
export * as edit from './edit/index.js';
export * as markup from './markup/index.js';
