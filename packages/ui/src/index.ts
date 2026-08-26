/**
 * @open-inspector/ui — shadow-DOM-isolated UI surfaces.
 *
 * Everything here renders into its own shadow tree. Nothing in this package
 * writes to the host page's DOM outside its own host element, or reads the
 * page's styles — that is the engine's job.
 *
 * @module
 */

export { createOverlay, type Overlay, type OverlayTarget } from './overlay.js';
export {
  createInspectorSession,
  type InspectorSession,
  type PanelDataSource,
  type SessionOptions,
} from './session.js';
export {
  placeChip,
  type ChipPlacement,
  type ChipSize,
  type Viewport,
} from './chip-placement.js';
export { OVERLAY_STYLES } from './overlay-styles.js';

export { createPanel, type PanelHandle, type PanelOptions } from './panel/mount.jsx';
export { collectElementData, type CollectOptions } from './panel/collect.js';
export * from './panel/view-model.js';
export {
  assetUrlList,
  downloadAsset,
  safeFilename,
  saveViaAnchor,
  withExtension,
  type DownloadTarget,
  type Saver,
} from './panel/download.js';
