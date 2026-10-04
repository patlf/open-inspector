/**
 * The panel drawn away from the page it inspects — a DevTools tab — with the
 * session still in the page. See protocol.ts.
 */

export * from './protocol.js';
export { createRemoteSurface, SYNC_MESSAGE } from './surface.js';
export { mountRemotePanel, type RemotePanelHandle, type RemotePanelOptions } from './client.jsx';
