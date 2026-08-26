/**
 * Barrel for the tokens module.
 *
 * Pure text transformers: a TokenSet in, an export format out. Nothing here
 * touches the DOM, which is what makes every emitter's output exactly
 * assertable rather than smoke-tested.
 */

export * from './types.js';
export * from './naming.js';
export * from './emit.js';
