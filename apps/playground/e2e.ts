import { installFixtures } from './fixtures.js';

/**
 * Fixture page for the end-to-end tests.
 *
 * Sets up the DOM cases and nothing else. No inspector session is created
 * here, so the only `<open-inspector-overlay>` on this page is the one the
 * extension injected — which is what lets the assertions be unambiguous.
 */
installFixtures();
