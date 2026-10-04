import type { PageData, PanelData } from '../panel/view-model.js';
import type { ContrastAudit } from '../panel/page.js';
import type { ThemeSetting } from '../settings.js';

/**
 * The panel, drawn somewhere other than the page it inspects.
 *
 * Everything that reads or changes the page stays where it is: the session,
 * in the page, with its overlay and its override store. Only the drawing
 * moves — to a DevTools tab — and what crosses between the two is the
 * panel's data going one way and the panel's requests coming back the
 * other. The data was already plain (rows, fields, ids), which is what makes
 * this possible without a second engine.
 *
 * Written against a port with two methods, not against any browser's
 * messaging API, so this package keeps its rule of using no extension APIs:
 * the extension adapts `runtime.Port` to it, and tests use a pair of plain
 * objects.
 */
export interface RemotePort {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

/**
 * The live state behind the editing controls, read when the panel is
 * painted. In the page it is read off the session as it is; over a port it
 * has to travel as a snapshot alongside the data it describes.
 */
export interface EditingSnapshot {
  editedProperties: string[];
  hidden: boolean;
  canSetViewport: boolean;
  viewportWidth: number | null;
  viewportActual: number | null;
  viewportError: string | null;
  viewportUnchanged: boolean;
  /** The audit, its elements replaced by ids the page side can resolve. */
  contrastAudit: RemoteContrastAudit | null;
}

export type RemoteContrastAudit = Omit<ContrastAudit, 'failures'> & {
  failures: Array<Omit<ContrastAudit['failures'][number], 'element'> & { elementId: number }>;
};

/** Page side → panel side: everything the panel draws from. */
export interface StateMessage {
  type: 'open-inspector:state';
  /** Whether the inspector is running in the page at all. */
  active: boolean;
  /** The element data, without its page-wide part, which travels only when it changes. */
  data: Omit<PanelData, 'page'> | null;
  /** Present when the page-wide findings changed since the last message; null clears them. */
  page?: PageData | null;
  pinned: boolean;
  picking: boolean;
  confirmClose: number | null;
  editing: EditingSnapshot | null;
  /** Whether settings changes are kept beyond the session. */
  settingsSaved: boolean;
  theme: ThemeSetting;
}

/** The panel's callbacks that can be called from the other side, by name. */
export const PANEL_ACTIONS = [
  'close',
  'cancelClose',
  'togglePicking',
  'unpin',
  'changeSettings',
  'selectAncestor',
  'step',
] as const;

export const EDITING_ACTIONS = [
  'apply',
  'revert',
  'revertOn',
  'revertAll',
  'togglePseudoState',
  'save',
  'toggleHidden',
  'setViewport',
  'runContrastAudit',
  'selectElement',
  'focusBox',
  'onBeginEdit',
] as const;

export const STRUCTURE_ACTIONS = [
  'setOpen',
  'setExpanded',
  'showMore',
  'preview',
  'select',
  'setAllExpanded',
  'setScriptOnly',
  'setQuery',
] as const;

export type ActionTarget = 'panel' | 'editing' | 'structure';

/** Panel side → page side: one call, by name, with plain arguments. */
export interface ActionMessage {
  type: 'open-inspector:action';
  target: ActionTarget;
  method: string;
  args: unknown[];
}

const ACTIONS: Record<ActionTarget, readonly string[]> = {
  panel: PANEL_ACTIONS,
  editing: EDITING_ACTIONS,
  structure: STRUCTURE_ACTIONS,
};

export function isStateMessage(value: unknown): value is StateMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'open-inspector:state'
  );
}

/**
 * Checked, not cast: only a known method on a known target gets through.
 * The arguments are checked again by each handler, which knows their shape.
 */
export function isActionMessage(value: unknown): value is ActionMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<ActionMessage>;
  if (message.type !== 'open-inspector:action' || !Array.isArray(message.args)) return false;
  const target = message.target;
  if (target !== 'panel' && target !== 'editing' && target !== 'structure') return false;
  return typeof message.method === 'string' && ACTIONS[target].includes(message.method);
}
