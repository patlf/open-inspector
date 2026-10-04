import { render } from 'preact';
import { edit } from '@open-inspector/core';
import { Panel } from '../panel/Panel.jsx';
import { EditingContext, type EditingApi } from '../panel/editing.jsx';
import type { StructureApi } from '../panel/structure-tree.jsx';
import { applyStyles } from '../panel/mount.jsx';
import { DEFAULT_SETTINGS } from '../settings.js';
import type { ContrastAudit } from '../panel/page.js';
import type { PageData, PanelData } from '../panel/view-model.js';
import {
  isStateMessage,
  type ActionTarget,
  type EditingSnapshot,
  type RemotePort,
  type StateMessage,
} from './protocol.js';
import { SYNC_MESSAGE } from './surface.js';

export interface RemotePanelOptions {
  /**
   * Start the inspector in the page. Absent, the panel can only say how to
   * start it, which is the case when nothing on this side is allowed to.
   */
  onStart?: () => void;
  /** Shown while the inspector is not running, under the start button if there is one. */
  startHint?: string;
}

export interface RemotePanelHandle {
  /**
   * What the not-running screen offers: a start button only when starting
   * from here can work, and words for when it cannot.
   */
  setIdle(idle: { canStart: boolean; hint: string }): void;
  /** The inspector is gone from the page — closed, navigated away — so show how to start it. */
  reset(): void;
  destroy(): void;
}

/**
 * The panel, drawn from state that arrives over a port: the DevTools half of
 * {@link createRemoteSurface}.
 *
 * It renders the same component the page does, embedded, and hands it the
 * same interfaces — editing, structure, the callbacks — rebuilt here as
 * messages. Where the panel needs an answer at once, as `apply` does to
 * mark a value invalid, the answer is worked out here the same way the page
 * would (`acceptsDeclaration` is the engine's own check), and the request
 * goes on to the page to be applied there.
 */
export function mountRemotePanel(
  host: HTMLElement,
  port: RemotePort,
  options: RemotePanelOptions = {},
): RemotePanelHandle {
  const shadow = host.attachShadow({ mode: 'open' });
  applyStyles(shadow);
  const root = document.createElement('div');
  shadow.appendChild(root);

  let state: StateMessage | null = null;
  let page: PageData | null = null;
  let hint = options.startHint ?? '';
  let canStart = options.onStart !== undefined;

  const call = (target: ActionTarget, method: string, ...args: unknown[]): void => {
    port.postMessage({ type: 'open-inspector:action', target, method, args });
  };

  /**
   * Stand-ins for the page's elements in the contrast audit. The panel only
   * ever hands one back, to select it, so each is an empty object that
   * remembers the id the page gave it.
   */
  const elementIds = new WeakMap<object, number>();
  function standIn(id: number): Element {
    const token = {};
    elementIds.set(token, id);
    return token as Element;
  }

  const structure: StructureApi = {
    setOpen: (open) => call('structure', 'setOpen', open),
    setExpanded: (id, expanded) => call('structure', 'setExpanded', id, expanded),
    showMore: (id) => call('structure', 'showMore', id),
    preview: (id) => call('structure', 'preview', id),
    select: (id) => call('structure', 'select', id),
    setAllExpanded: (expanded) => call('structure', 'setAllExpanded', expanded),
    setScriptOnly: (on) => call('structure', 'setScriptOnly', on),
    setQuery: (query) => call('structure', 'setQuery', query),
  };

  function editingFrom(snapshot: EditingSnapshot): EditingApi {
    const audit: ContrastAudit | null = snapshot.contrastAudit
      ? {
          ...snapshot.contrastAudit,
          failures: snapshot.contrastAudit.failures.map(({ elementId, ...failure }) => ({
            ...failure,
            element: standIn(elementId),
          })),
        }
      : null;

    return {
      apply(property, value) {
        const trimmed = value.trim();
        const accepted = trimmed === '' || edit.acceptsDeclaration(property, trimmed);
        if (accepted) call('editing', 'apply', property, value);
        return accepted;
      },
      revert: (property) => call('editing', 'revert', property),
      revertOn: (selector, property) => call('editing', 'revertOn', selector, property),
      revertAll: () => call('editing', 'revertAll'),
      togglePseudoState: (pseudo) => call('editing', 'togglePseudoState', pseudo),
      save: (href, filename) => call('editing', 'save', href, filename),
      editedProperties: new Set(snapshot.editedProperties),
      hidden: snapshot.hidden,
      toggleHidden: () => call('editing', 'toggleHidden'),
      setViewport: snapshot.canSetViewport ? (width) => call('editing', 'setViewport', width) : null,
      viewportWidth: snapshot.viewportWidth,
      viewportActual: snapshot.viewportActual,
      viewportError: snapshot.viewportError,
      viewportUnchanged: snapshot.viewportUnchanged,
      contrastAudit: audit,
      runContrastAudit: () => call('editing', 'runContrastAudit'),
      selectElement: (element) => {
        const id = elementIds.get(element);
        if (id !== undefined) call('editing', 'selectElement', id);
      },
      focusBox: (focus) => call('editing', 'focusBox', focus),
      onBeginEdit: () => call('editing', 'onBeginEdit'),
    };
  }

  function paint(): void {
    if (!state?.active) {
      render(<Idle hint={hint} onStart={canStart ? options.onStart : undefined} />, root);
      return;
    }

    const data: PanelData | null = state.data ? { ...state.data, page: page ?? undefined } : null;
    render(
      <EditingContext.Provider value={state.editing ? editingFrom(state.editing) : null}>
        <Panel
          embedded
          data={data}
          pinned={state.pinned}
          picking={state.picking}
          placement={DEFAULT_SETTINGS.panel}
          theme={state.theme}
          view={window}
          onPlace={() => {}}
          onTogglePicking={() => call('panel', 'togglePicking')}
          onSelectAncestor={(depth) => call('panel', 'selectAncestor', depth)}
          onStep={(direction) => call('panel', 'step', direction)}
          structure={structure}
          onChangeSettings={(next) => call('panel', 'changeSettings', next)}
          settingsSaved={state.settingsSaved}
          onClose={() => call('panel', 'close')}
          confirmClose={state.confirmClose}
          onCancelClose={() => call('panel', 'cancelClose')}
        />
      </EditingContext.Provider>,
      root,
    );
  }

  const stop = port.onMessage((message) => {
    if (!isStateMessage(message)) return;
    state = message;
    if (message.page !== undefined) page = message.page;
    paint();
  });

  paint();
  // Ask for everything, page data included: this side may be new to a
  // session that has been running for a while.
  port.postMessage(SYNC_MESSAGE);

  return {
    setIdle(next) {
      canStart = next.canStart;
      hint = next.hint;
      paint();
    },
    reset() {
      state = null;
      page = null;
      paint();
    },
    destroy() {
      stop();
      render(null, root);
    },
  };
}

/** What the tab shows while the inspector is not running in the page. */
function Idle({ hint, onStart }: { hint: string; onStart?: (() => void) | undefined }) {
  return (
    <div class="panel" data-side="embedded">
      <div class="main">
        <header class="head">
          <div class="head-top">
            <span class="selector">Open Inspector</span>
          </div>
        </header>
        <div class="body">
          <p class="onboard">The inspector is not running on this page.</p>
          {onStart ? (
            <p>
              <button type="button" class="primary-btn" onClick={onStart}>
                Start inspecting
              </button>
            </p>
          ) : null}
          {hint ? <p class="onboard-note">{hint}</p> : null}
        </div>
      </div>
    </div>
  );
}
