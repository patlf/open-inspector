import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInspectorSession } from './session.js';

describe('createInspectorSession', () => {
  let session: ReturnType<typeof createInspectorSession>;

  beforeEach(() => {
    document.documentElement.style.cursor = '';
    session = createInspectorSession();
  });

  afterEach(() => {
    session.destroy();
    vi.restoreAllMocks();
  });

  it('starts inactive', () => {
    expect(session.active).toBe(false);
  });

  it('toggles between states and reports the state it landed in', () => {
    expect(session.toggle()).toBe(true);
    expect(session.active).toBe(true);

    expect(session.toggle()).toBe(false);
    expect(session.active).toBe(false);
  });

  it('is idempotent on repeated activate', () => {
    const addListener = vi.spyOn(document, 'addEventListener');

    session.activate();
    const afterFirst = addListener.mock.calls.length;
    session.activate();

    expect(addListener.mock.calls.length).toBe(afterFirst);
  });

  it('removes every listener it added on deactivate', () => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');

    session.activate();
    session.deactivate();

    const addedTypes = added.mock.calls.map(([type]) => type).sort();
    const removedTypes = removed.mock.calls.map(([type]) => type).sort();

    expect(removedTypes).toEqual(addedTypes);
  });

  it('sets a crosshair cursor while active and restores the previous value', () => {
    document.documentElement.style.cursor = 'progress';
    const restorable = createInspectorSession();

    restorable.activate();
    expect(document.documentElement.style.cursor).toBe('crosshair');

    restorable.deactivate();
    expect(document.documentElement.style.cursor).toBe('progress');

    restorable.destroy();
  });

  it('gives the page back on the first Escape, and closes on the second', () => {
    /**
     * Two stages on purpose. While picking, every page click is captured so
     * that clicking selects instead of navigating — which makes the page
     * unusable. The common need is "stop capturing my clicks", not "throw away
     * the element I am reading", so the first Escape disarms and the second
     * closes.
     */
    session.activate();
    expect(session.picking).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(session.picking).toBe(false);
    expect(session.active).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(session.active).toBe(false);
  });

  it('stops capturing page events once the picker is disarmed', () => {
    const removed = vi.spyOn(document, 'removeEventListener');
    session.activate();

    session.setPicking(false);

    // The capture-phase suppressors are what make the page unclickable.
    const removedTypes = removed.mock.calls.map(([type]) => type);
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'auxclick']) {
      expect(removedTypes).toContain(type);
    }
    // Escape must still work, so its listener stays.
    expect(removedTypes).not.toContain('keydown');
  });

  it('re-arms without closing', () => {
    session.activate();
    session.setPicking(false);
    session.setPicking(true);

    expect(session.picking).toBe(true);
    expect(session.active).toBe(true);
  });

  it('ignores other keys', () => {
    session.activate();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(session.active).toBe(true);
  });

  it('notifies the caller only once it actually closes', () => {
    const onDeactivate = vi.fn();
    const watched = createInspectorSession({ onDeactivate });

    watched.activate();

    // First Escape only disarms; the session is still open.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDeactivate).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDeactivate).toHaveBeenCalledTimes(1);

    watched.destroy();
  });

  it('coalesces a burst of pointer moves into a single frame', () => {
    // The whole point of the rAF throttle: many events, one measurement.
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    session.activate();

    for (let i = 0; i < 25; i += 1) {
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: i, clientY: i }));
    }

    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('does not schedule work while inactive', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }));

    expect(raf).not.toHaveBeenCalled();
  });

  it('cancels a queued frame when deactivated mid-flight', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);

    session.activate();
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }));
    session.deactivate();

    expect(cancel).toHaveBeenCalledWith(42);
  });

  it('cannot be reactivated after destroy', () => {
    // A superseded content-script instance must stay dead. If it could
    // reactivate, a repeat injection would leave the tab with two overlays.
    session.activate();
    session.destroy();

    session.activate();
    expect(session.active).toBe(false);

    expect(session.toggle()).toBe(false);
    expect(session.active).toBe(false);
  });

  it('does not attach a new overlay after destroy', () => {
    session.activate();
    session.destroy();

    session.activate();
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }));

    expect(document.querySelector('open-inspector-overlay')).toBeNull();
  });

  it('removes the overlay host from the page on destroy', () => {
    session.activate();
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }));
    session.destroy();

    expect(document.querySelector('open-inspector-overlay')).toBeNull();
  });
});

describe('responsive preview', () => {
  it('hides the control entirely when nothing can resize the window', () => {
    // The playground has no extension behind it, and a preset row that
    // silently did nothing would be worse than no row at all.
    const plain = createInspectorSession();
    plain.activate();
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }));

    const root = document.querySelector('open-inspector-panel')?.shadowRoot;
    expect(root?.querySelector('.viewport-btn')).toBeNull();

    plain.destroy();
  });
});
