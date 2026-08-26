/**
 * Barrel for the color module.
 *
 * Re-exported as a namespace from the package root, because several modules
 * legitimately share type names — StyleSheetLike, UnreadableStyleSheet,
 * FontFaceSource — and a flat re-export would collide.
 */
export * from './element-colors.js';
export * from './named-colors.js';
export * from './palette.js';
export * from './parse.js';
