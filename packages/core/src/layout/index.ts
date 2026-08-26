/**
 * Barrel for the layout module.
 *
 * Re-exported as a namespace from the package root, because several modules
 * legitimately share type names — StyleSheetLike, UnreadableStyleSheet,
 * FontFaceSource — and a flat re-export would collide.
 */
export * from './authored-intent.js';
export * from './breakpoints.js';
export * from './container.js';
export * from './css-text.js';
export * from './spacing-scale.js';
