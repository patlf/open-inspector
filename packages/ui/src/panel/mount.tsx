import { render } from 'preact';
import { lockHost, raiseToTopLayer } from '../host.js';
import { Panel } from './Panel.jsx';
import { EditingContext, type EditingApi } from './editing.jsx';
import { PANEL_STYLES } from './panel-styles.js';
import { BOX_DIAGRAM_STYLES } from './box-diagram.jsx';
import type { PanelData } from './view-model.js';

const HOST_TAG = 'open-inspector-panel';
const TOP_LAYER_Z_INDEX = '2147483647';

export interface PanelHandle {
  update(data: PanelData | null): void;
  /** True when the panel is frozen on one element. */
  readonly pinned: boolean;
  setPinned(pinned: boolean): void;
  /** Reflect whether the picker is armed. */
  setPicking(picking: boolean): void;
  /** Ask before closing: the number of edits closing would revert, or null. */
  setConfirmClose(pending: number | null): void;
  /** Move back above anything that entered the top layer after us. */
  raise(): void;
  /** True if the element belongs to the panel — used to avoid inspecting ourselves. */
  owns(element: Element): boolean;
  destroy(): void;
}

export interface PanelOptions {
  doc?: Document;
  onClose: () => void;
  /** The close confirmation was dismissed. */
  onCancelClose?: () => void;
  onPinnedChange?: (pinned: boolean) => void;
  /** The Inspect button was pressed. */
  onTogglePicking?: () => void;
  /** A breadcrumb entry was clicked; depth 0 is the current element. */
  onSelectAncestor?: (depth: number) => void;
  /** A tree step arrow was pressed. */
  onStep?: (direction: 'parent' | 'child' | 'previous' | 'next') => void;
  /** Omit to render a read-only panel. */
  editing?: EditingApi;
}

/**
 * Lock the host's geometry with inline `!important`.
 *
 * Unlike the overlay, this host must accept pointer events — it is an
 * interactive surface. Everything else is the same defensive treatment: a
 * page rule like `body * { position: static !important }` would otherwise drop
 * the panel into the document flow.
 */
function lockHostGeometry(host: HTMLElement): void {
  const rules: Record<string, string> = {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    margin: '0',
    padding: '0',
    border: '0',
    display: 'block',
    'z-index': TOP_LAYER_Z_INDEX,
    isolation: 'isolate',
    filter: 'none',
    transform: 'none',
    opacity: '1',
    visibility: 'visible',
  };

  lockHost(host, rules);
}

function applyStyles(shadow: ShadowRoot): void {
  const css = `${PANEL_STYLES}\n${BOX_DIAGRAM_STYLES}`;

  if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
    return;
  }

  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
}

/**
 * Mount the inspector panel into its own shadow tree.
 *
 * Open rather than closed, unlike the overlay: Preact needs to be able to find
 * its own render root across updates, and the panel has no secrets — the page
 * gains nothing from being able to read a UI built entirely out of data the
 * page already owns.
 */
export function createPanel(options: PanelOptions): PanelHandle {
  const doc = options.doc ?? document;

  const host = doc.createElement(HOST_TAG);
  lockHostGeometry(host as HTMLElement);

  const shadow = host.attachShadow({ mode: 'open' });
  applyStyles(shadow);

  const root = doc.createElement('div');
  shadow.appendChild(root);

  let data: PanelData | null = null;
  let pinned = false;
  let picking = true;
  let side: 'left' | 'right' = 'right';
  let confirmClose: number | null = null;
  let attached = false;

  function paint(): void {
    if (!attached || !host.isConnected) {
      doc.documentElement.appendChild(host);
      attached = true;
      raiseToTopLayer(host as HTMLElement);
    }

    render(
      <EditingContext.Provider value={options.editing ?? null}>
      <Panel
        data={data}
        pinned={pinned}
        picking={picking}
        side={side}
        onTogglePicking={() => options.onTogglePicking?.()}
        onSelectAncestor={(depth) => options.onSelectAncestor?.(depth)}
        onStep={(direction) => options.onStep?.(direction)}
        onFlip={() => {
          side = side === 'right' ? 'left' : 'right';
          paint();
        }}
        onClose={options.onClose}
        confirmClose={confirmClose}
        onCancelClose={() => options.onCancelClose?.()}
      />
      </EditingContext.Provider>,
      root,
    );
  }

  paint();

  return {
    update(next) {
      data = next;
      paint();
    },
    get pinned() {
      return pinned;
    },
    setPinned(next) {
      pinned = next;
      paint();
    },
    setPicking(next) {
      picking = next;
      paint();
    },
    setConfirmClose(next) {
      if (confirmClose === next) return;
      confirmClose = next;
      paint();
    },
    raise() {
      if (attached && host.isConnected) raiseToTopLayer(host as HTMLElement);
    },
    owns(element) {
      return element === host || host.contains(element);
    },
    destroy() {
      render(null, root);
      host.remove();
      attached = false;
    },
  };
}
