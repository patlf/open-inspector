/**
 * Barrel for the cascade module.
 *
 * Re-exported as a namespace from the package root, because several modules
 * legitimately share type names — StyleSheetLike, UnreadableStyleSheet,
 * FontFaceSource — and a flat re-export would collide.
 */
export * from './collect.js';
export * from './resolve.js';
export * from './specificity.js';
