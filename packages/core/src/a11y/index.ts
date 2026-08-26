/**
 * Barrel for the a11y module.
 *
 * Re-exported as a namespace from the package root, because several modules
 * legitimately share type names — StyleSheetLike, UnreadableStyleSheet,
 * FontFaceSource — and a flat re-export would collide.
 */
export * from './assess.js';
export * from './contrast.js';
export * from './css-color.js';
export * from './oklab.js';
export * from './scan.js';
