/**
 * Barrel for the assets module.
 *
 * Re-exported as a namespace from the package root, because several modules
 * legitimately share type names — StyleSheetLike, UnreadableStyleSheet,
 * FontFaceSource — and a flat re-export would collide.
 */
export * from './collect.js';
export * from './css-values.js';
export * from './fonts.js';
export * from './images.js';
export * from './media.js';
export * from './reference.js';
export * from './registry.js';
export * from './srcset.js';
export * from './svg.js';
export * from './types.js';
export * from './url.js';
export * from './walk.js';
