import type { PanelHandle, PanelOptions } from '../panel/mount.jsx';
import type { PageData, PanelData } from '../panel/view-model.js';
import type { BoxFocus } from '../overlay.js';
import { DEFAULT_SETTINGS, type InspectorSettings } from '../settings.js';
import {
  isActionMessage,
  type ActionMessage,
  type EditingSnapshot,
  type RemoteContrastAudit,
  type RemotePort,
  type StateMessage,
} from './protocol.js';

/** The panel side asking to be sent everything again, as it does when it connects. */
export const SYNC_MESSAGE = { type: 'open-inspector:sync' } as const;

/**
 * How often state may cross the port. The session repaints on every frame
 * the pointer moves, and the panel on the other side needs nowhere near
 * that: a tenth of a second reads as live, and keeps a large page's data
 * from being copied sixty times a second.
 */
const SEND_INTERVAL_MS = 80;

const REGIONS = new Set(['margin', 'border', 'padding', 'content']);
const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const STEPS = new Set(['parent', 'child', 'previous', 'next']);

const isString = (value: unknown): value is string => typeof value === 'string';

/** Longer than anything worth typing into the tree's search. */
const MAX_QUERY_LENGTH = 200;
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

function isBoxFocus(value: unknown): value is BoxFocus {
  if (typeof value !== 'object' || value === null) return false;
  const { region, side } = value as { region?: unknown; side?: unknown };
  return REGIONS.has(region as string) && (side === null || SIDES.has(side as string));
}

/**
 * A panel that draws nothing here and is drawn somewhere else.
 *
 * It stands where the in-page panel would — the session builds it from the
 * same options and calls it the same way — and turns every call into state
 * sent over the port. Requests coming back become calls on those same
 * options, so the session cannot tell which kind of panel it has: the one
 * place that mutates the page is still the one place.
 */
export function createRemoteSurface(port: RemotePort, options: PanelOptions): PanelHandle {
  let data: PanelData | null = null;
  let pinned = false;
  let picking = true;
  let confirmClose: number | null = null;
  let theme = options.theme ?? DEFAULT_SETTINGS.theme;
  let active = true;

  /** The page data last sent, by identity: it is replaced, never mutated, when it changes. */
  let sentPage: PageData | null | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  /** Audit failures by id, so a click on one over there can select it here. */
  let auditElements = new Map<number, Element>();

  function snapshot(): EditingSnapshot | null {
    const editing = options.editing;
    if (!editing) return null;

    let contrastAudit: RemoteContrastAudit | null = null;
    if (editing.contrastAudit) {
      auditElements = new Map();
      contrastAudit = {
        ...editing.contrastAudit,
        failures: editing.contrastAudit.failures.map(({ element, ...failure }, index) => {
          auditElements.set(index, element);
          return { ...failure, elementId: index };
        }),
      };
    }

    return {
      editedProperties: [...editing.editedProperties],
      hidden: editing.hidden,
      canSetViewport: editing.setViewport !== null,
      viewportWidth: editing.viewportWidth,
      viewportActual: editing.viewportActual,
      viewportError: editing.viewportError,
      viewportUnchanged: editing.viewportUnchanged,
      contrastAudit,
    };
  }

  function send(everything = false): void {
    timer = null;
    last = Date.now();

    const page = data?.page ?? null;
    const message: StateMessage = {
      type: 'open-inspector:state',
      active,
      data: null,
      pinned,
      picking,
      confirmClose,
      editing: active ? snapshot() : null,
      settingsSaved: options.settingsSaved ?? false,
      theme,
    };
    if (data && active) {
      const { page: _page, ...rest } = data;
      message.data = rest;
    }
    if (everything || page !== sentPage) {
      message.page = page;
      sentPage = page;
    }
    port.postMessage(message);
  }

  /** Coalesce a burst of repaints into one message, sent at most every interval. */
  function schedule(): void {
    if (timer !== null) return;
    timer = setTimeout(send, Math.max(0, SEND_INTERVAL_MS - (Date.now() - last)));
  }

  function now(): void {
    if (timer !== null) clearTimeout(timer);
    send();
  }

  function handle(message: ActionMessage): void {
    const [a, b] = message.args;
    const editing = options.editing;
    const structure = options.structure;

    if (message.target === 'panel') {
      switch (message.method) {
        case 'close':
          options.onClose();
          return;
        case 'cancelClose':
          options.onCancelClose?.();
          return;
        case 'togglePicking':
          options.onTogglePicking?.();
          return;
        case 'unpin':
          pinned = false;
          options.onPinnedChange?.(false);
          return;
        case 'changeSettings':
          // The session merges and normalizes whatever arrives, so a
          // malformed field falls back to its default rather than through.
          if (typeof a === 'object' && a !== null) {
            options.onChangeSettings?.(a as Partial<InspectorSettings>);
          }
          return;
        case 'selectAncestor':
          if (isId(a)) options.onSelectAncestor?.(a);
          return;
        case 'step':
          if (isString(a) && STEPS.has(a)) {
            options.onStep?.(a as 'parent' | 'child' | 'previous' | 'next');
          }
          return;
      }
      return;
    }

    if (message.target === 'editing' && editing) {
      switch (message.method) {
        case 'apply':
          if (isString(a) && isString(b)) editing.apply(a, b);
          return;
        case 'revert':
          if (isString(a)) editing.revert(a);
          return;
        case 'revertOn':
          if (isString(a) && isString(b)) editing.revertOn(a, b);
          return;
        case 'revertAll':
          editing.revertAll();
          return;
        case 'togglePseudoState':
          if (isString(a)) editing.togglePseudoState(a);
          return;
        case 'save':
          if (isString(a) && isString(b)) editing.save(a, b);
          return;
        case 'toggleHidden':
          editing.toggleHidden();
          return;
        case 'setViewport':
          if (a === null || (typeof a === 'number' && Number.isFinite(a))) editing.setViewport?.(a);
          return;
        case 'runContrastAudit':
          editing.runContrastAudit();
          return;
        case 'selectElement': {
          const element = isId(a) ? auditElements.get(a) : undefined;
          if (element?.isConnected) editing.selectElement(element);
          return;
        }
        case 'focusBox':
          if (a === null || isBoxFocus(a)) editing.focusBox(a);
          return;
        case 'onBeginEdit':
          editing.onBeginEdit();
          return;
      }
      return;
    }

    if (message.target === 'structure' && structure) {
      switch (message.method) {
        case 'setOpen':
          if (isBoolean(a)) structure.setOpen(a);
          return;
        case 'setExpanded':
          if (isId(a) && isBoolean(b)) structure.setExpanded(a, b);
          return;
        case 'showMore':
          if (isId(a)) structure.showMore(a);
          return;
        case 'preview':
          if (a === null || isId(a)) structure.preview(a);
          return;
        case 'select':
          if (isId(a)) structure.select(a);
          return;
        case 'setAllExpanded':
          if (isBoolean(a)) structure.setAllExpanded(a);
          return;
        case 'setScriptOnly':
          if (isBoolean(a)) structure.setScriptOnly(a);
          return;
        case 'setQuery':
          // Capped: it is matched against every element on the page.
          if (isString(a)) structure.setQuery(a.slice(0, MAX_QUERY_LENGTH));
          return;
      }
    }
  }

  const stopListening = port.onMessage((message) => {
    if (isActionMessage(message)) {
      handle(message);
      return;
    }
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === SYNC_MESSAGE.type
    ) {
      if (timer !== null) clearTimeout(timer);
      send(true);
    }
  });

  send(true);

  return {
    update(next) {
      data = next;
      schedule();
    },
    get pinned() {
      return pinned;
    },
    setPinned(next) {
      pinned = next;
      schedule();
    },
    setPicking(next) {
      picking = next;
      schedule();
    },
    setConfirmClose(next) {
      if (confirmClose === next) return;
      confirmClose = next;
      now();
    },
    // Nothing of it is in the page, so there is nothing to raise, place or own.
    raise() {},
    setPlacement() {},
    setTheme(next) {
      if (theme === next) return;
      theme = next;
      now();
    },
    owns() {
      return false;
    },
    destroy() {
      active = false;
      data = null;
      now();
      stopListening();
    },
  };
}
