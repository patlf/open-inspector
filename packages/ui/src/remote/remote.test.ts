import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelOptions } from '../panel/mount.jsx';
import type { EditingApi } from '../panel/editing.jsx';
import type { PanelData } from '../panel/view-model.js';
import { isActionMessage, type RemotePort, type StateMessage } from './protocol.js';
import { createRemoteSurface, SYNC_MESSAGE } from './surface.js';
import { mountRemotePanel } from './client.jsx';

/**
 * Two ends of a port, delivering synchronously and through JSON, which is
 * the least a real port does: anything that does not survive serializing
 * would not survive the trip.
 */
function portPair(): [RemotePort, RemotePort, unknown[], unknown[]] {
  const toA = new Set<(message: unknown) => void>();
  const toB = new Set<(message: unknown) => void>();
  const sentByA: unknown[] = [];
  const sentByB: unknown[] = [];
  const end = (
    inbox: Set<(message: unknown) => void>,
    outbox: Set<(message: unknown) => void>,
    log: unknown[],
  ): RemotePort => ({
    postMessage(message) {
      log.push(message);
      const copy: unknown = JSON.parse(JSON.stringify(message));
      for (const listener of outbox) listener(copy);
    },
    onMessage(listener) {
      inbox.add(listener);
      return () => inbox.delete(listener);
    },
  });
  return [end(toA, toB, sentByA), end(toB, toA, sentByB), sentByA, sentByB];
}

function fakeEditing(): EditingApi {
  return {
    apply: vi.fn(() => true),
    revert: vi.fn(),
    revertOn: vi.fn(),
    revertAll: vi.fn(),
    togglePseudoState: vi.fn(),
    save: vi.fn(),
    editedProperties: new Set(['color']),
    hidden: false,
    toggleHidden: vi.fn(),
    setViewport: null,
    viewportWidth: null,
    viewportActual: null,
    viewportError: null,
    viewportUnchanged: false,
    contrastAudit: null,
    runContrastAudit: vi.fn(),
    selectElement: vi.fn(),
    focusBox: vi.fn(),
    onBeginEdit: vi.fn(),
  };
}

function fakeOptions(editing = fakeEditing()): PanelOptions & { editing: EditingApi } {
  return {
    onClose: vi.fn(),
    onTogglePicking: vi.fn(),
    onSelectAncestor: vi.fn(),
    onStep: vi.fn(),
    onChangeSettings: vi.fn(),
    editing,
    structure: {
      setOpen: vi.fn(),
      setExpanded: vi.fn(),
      showMore: vi.fn(),
      preview: vi.fn(),
      select: vi.fn(),
      setAllExpanded: vi.fn(),
      setScriptOnly: vi.fn(),
      setQuery: vi.fn(),
    },
  };
}

const states = (log: unknown[]): StateMessage[] =>
  log.filter((message): message is StateMessage => (message as StateMessage).type === 'open-inspector:state');

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('isActionMessage', () => {
  it('lets through only known methods on known targets', () => {
    expect(isActionMessage({ type: 'open-inspector:action', target: 'editing', method: 'apply', args: [] })).toBe(true);
    expect(isActionMessage({ type: 'open-inspector:action', target: 'editing', method: 'constructor', args: [] })).toBe(false);
    expect(isActionMessage({ type: 'open-inspector:action', target: 'window', method: 'close', args: [] })).toBe(false);
    expect(isActionMessage({ type: 'open-inspector:action', target: 'panel', method: 'close' })).toBe(false);
  });
});

describe('createRemoteSurface', () => {
  it('sends its state, and the page data only when it changes', () => {
    vi.useFakeTimers();
    const [page, , sent] = portPair();
    const surface = createRemoteSurface(page, fakeOptions());

    const pageData = { palette: [] } as unknown as NonNullable<PanelData['page']>;
    const data = { selectorLabel: 'button#go', page: pageData } as unknown as PanelData;
    surface.update(data);
    surface.update({ ...data, selectorLabel: 'button#go.again' });
    vi.runAllTimers();

    const all = states(sent);
    const last = all[all.length - 1];
    expect(last?.active).toBe(true);
    expect(last?.data?.selectorLabel).toBe('button#go.again');
    expect(last?.data).not.toHaveProperty('page');
    expect(last?.page).toBe(pageData);
    expect(last?.editing?.editedProperties).toEqual(['color']);

    // The same page again: not resent.
    surface.update({ ...data, selectorLabel: 'button#go' });
    vi.runAllTimers();
    expect(states(sent).at(-1)).not.toHaveProperty('page');

    // A theme chosen in settings reaches the other side too.
    expect(states(sent).at(-1)?.theme).toBe('system');
    surface.setTheme('light');
    expect(states(sent).at(-1)?.theme).toBe('light');
  });

  it('turns requests into the same callbacks, and drops malformed ones', () => {
    const [page, devtools] = portPair();
    const options = fakeOptions();
    createRemoteSurface(page, options);

    const call = (target: string, method: string, ...args: unknown[]) =>
      devtools.postMessage({ type: 'open-inspector:action', target, method, args });

    call('panel', 'togglePicking');
    call('panel', 'step', 'parent');
    call('panel', 'step', 'sideways');
    call('editing', 'apply', 'color', 'red');
    call('editing', 'apply', 'color', 42);
    call('editing', 'focusBox', { region: 'padding', side: 'top' });
    call('editing', 'focusBox', { region: 'everywhere', side: null });
    call('structure', 'select', 7);
    call('structure', 'select', '7');
    call('structure', 'setQuery', 'card');
    call('structure', 'setQuery', 7);
    call('structure', 'setQuery', 'x'.repeat(500));

    expect(options.onTogglePicking).toHaveBeenCalledTimes(1);
    expect(options.onStep).toHaveBeenCalledTimes(1);
    expect(options.onStep).toHaveBeenCalledWith('parent');
    expect(options.editing.apply).toHaveBeenCalledTimes(1);
    expect(options.editing.apply).toHaveBeenCalledWith('color', 'red');
    expect(options.editing.focusBox).toHaveBeenCalledTimes(1);
    expect(options.structure?.select).toHaveBeenCalledTimes(1);
    expect(options.structure?.select).toHaveBeenCalledWith(7);
    expect(options.structure?.setQuery).toHaveBeenCalledTimes(2);
    expect(options.structure?.setQuery).toHaveBeenNthCalledWith(1, 'card');
    expect(options.structure?.setQuery).toHaveBeenNthCalledWith(2, 'x'.repeat(200));
  });

  it('hands an audit failure over by id and selects its element when asked', () => {
    const [page, devtools, sent] = portPair();
    const target = document.createElement('p');
    document.body.appendChild(target);
    const editing = fakeEditing();
    editing.contrastAudit = {
      failures: [{ element: target, label: 'p', text: 'x', ratio: 2, required: 4.5, severity: 'fail', suggestion: null }],
      indeterminate: 0,
      passes: 0,
      assessed: 1,
      truncated: false,
    } as unknown as EditingApi['contrastAudit'];
    const surface = createRemoteSurface(page, fakeOptions(editing));
    surface.setConfirmClose(1); // sends at once

    const audit = states(sent).at(-1)?.editing?.contrastAudit;
    expect(audit?.failures[0]).toMatchObject({ elementId: 0, label: 'p' });
    expect(audit?.failures[0]).not.toHaveProperty('element');

    devtools.postMessage({ type: 'open-inspector:action', target: 'editing', method: 'selectElement', args: [0] });
    expect(editing.selectElement).toHaveBeenCalledWith(target);
  });

  it('resends everything when the other side asks, and says when it is gone', () => {
    const [page, devtools, sent] = portPair();
    const surface = createRemoteSurface(page, fakeOptions());
    devtools.postMessage(SYNC_MESSAGE);
    expect(states(sent).at(-1)).toHaveProperty('page');

    surface.destroy();
    expect(states(sent).at(-1)?.active).toBe(false);
  });
});

describe('mountRemotePanel', () => {
  it('shows how to start until the inspector runs, then the panel, whose controls reach the page', () => {
    const [page, devtools] = portPair();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onStart = vi.fn();
    const handle = mountRemotePanel(host, devtools, { onStart, startHint: 'Or press Alt+Shift+I.' });
    const shadow = host.shadowRoot as ShadowRoot;

    expect(shadow.textContent).toContain('not running');
    shadow.querySelector<HTMLButtonElement>('.primary-btn')?.click();
    expect(onStart).toHaveBeenCalledTimes(1);

    // Where starting from here cannot work, no button: only how to start.
    handle.setIdle({ canStart: false, hint: 'Press Alt+Shift+I on the page.' });
    expect(shadow.querySelector('.primary-btn')).toBeNull();
    expect(shadow.textContent).toContain('Press Alt+Shift+I on the page.');
    handle.setIdle({ canStart: true, hint: '' });

    const options = fakeOptions();
    createRemoteSurface(page, options);
    // Running, nothing under the pointer yet: the panel's own first screen.
    expect(shadow.querySelector('.panel[data-side="embedded"]')).not.toBeNull();
    expect(shadow.textContent).toContain('Move the pointer over the page');

    shadow.querySelector<HTMLButtonElement>('.primary-btn')?.click();
    expect(options.onTogglePicking).toHaveBeenCalledTimes(1);
  });
});
