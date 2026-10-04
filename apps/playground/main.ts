import { installFixtures } from './fixtures.js';
import './inspector.js';

/**
 * Interactive playground for the engine and overlay.
 *
 * The extension shell is deliberately not involved: everything below the
 * message-passing layer runs here unchanged, which makes this the fastest way
 * to see a rendering change.
 *
 * Note this page creates its *own* inspector session. The end-to-end tests use
 * e2e.html instead, which has none — so the only overlay on that page is the
 * one the extension injected.
 *
 * The session lives in inspector.ts, which hot-swaps itself on every change
 * to core or ui. Nothing here may import either package: a second importer
 * with no way to accept the update would make Vite reload the page instead.
 */

installFixtures();
