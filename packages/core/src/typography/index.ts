/**
 * Barrel for the typography module.
 *
 * Re-exported as a namespace from the package root, because several modules
 * legitimately share type names — StyleSheetLike, UnreadableStyleSheet,
 * FontFaceSource — and a flat re-export would collide.
 */
export * from './font-faces.js';
export * from './read.js';
export * from './rendered-family.js';
export * from './scale.js';
