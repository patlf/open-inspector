import {
  cascade,
  edit,
  describeElement,
  formatDimensions,
  probeAtPoint,
  readBoxModel,
  ancestorTrail,
  stepTree,
  type TreeDirection,
} from '@open-inspector/core';
import { createOverlay, type Overlay } from './overlay.js';
import { createPanel, type PanelHandle } from './panel/mount.jsx';
import { collectElementData } from './panel/collect.js';
import { createPageScanner, type ContrastAudit, type PageScanner } from './panel/page.js';
import { saveViaAnchor } from './panel/download.js';
import type { EditEntry, PageData, PanelData } from './panel/view-model.js';

/**
 * How long the pointer must rest before the expensive analysis runs.
 *
 * Long enough that sweeping the pointer across a page never triggers a
 * document-wide walk; short enough that stopping on something you care about
 * feels immediate.
 */
const SETTLE_DELAY_MS = 250;

/**
 * Builds the panel's data for an element.
 *
 * Injected rather than imported so the interaction loop can be exercised with
 * fixtures, and so the engine can grow without this file changing.
 */
export type PanelDataSource = (element: Element, view: Window) => PanelData;

export interface InspectorSession {
  readonly active: boolean;
  /** True while the pointer picks elements and page clicks are captured. */
  readonly picking: boolean;
  readonly pinned: boolean;
  activate(): void;
  deactivate(): void;
  toggle(): boolean;
  /** Arm or disarm the picker without closing the panel. */
  setPicking(picking: boolean): void;
  destroy(): void;
}

export interface SessionOptions {
  doc?: Document;
  win?: Window;
  /** Override how element data is produced. Defaults to the built-in collector. */
  collect?: PanelDataSource;
  /** Set false to run overlay-only, with no panel. */
  panel?: boolean;
  /**
   * Starts a download.
   *
   * Supplied by the extension, because Chrome silently drops downloads
   * initiated from a content script's isolated world. Defaults to clicking an
   * anchor, which is correct everywhere else.
   */
  save?: (href: string, filename: string) => void;
  /**
   * Asks for a viewport width, or restores the window when given null.
   *
   * Supplied by the extension: `windows.update` is a background-worker API and
   * no content script can reach it. Absent everywhere else, which is why the
   * responsive control hides itself rather than pretending to work. The
   * current inner width goes along because the worker needs both numbers to
   * work out how much of the window is browser chrome.
   */
  resize?: (
    viewportWidth: number | null,
    innerWidth: number,
  ) => void | Promise<string | null>;
  /** Called after the session deactivates, including via Escape. */
  onDeactivate?: () => void;
}

/** A short human label for an element in the change list. */
function describeForList(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
  return text ? `<${tag}> ${text}` : `<${tag}>`;
}

/**
 * Page events captured while the picker is armed.
 *
 * Without this, clicking a link to inspect it navigates away instead. They
 * come off the moment the picker is disarmed.
 */
const SUPPRESSED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'auxclick'] as const;

/**
 * Drive the overlay and panel from pointer movement.
 *
 * Everything expensive is throttled to one animation frame. A `pointermove`
 * handler that measures on every event fires far more often than the display
 * can show, and jank on the host page is exactly what makes people uninstall
 * an inspector.
 *
 * No extension APIs are used here, which is what lets the whole interaction
 * loop be tested outside a browser extension.
 */
export function createInspectorSession(options: SessionOptions = {}): InspectorSession {
  const doc = options.doc ?? document;
  const win = options.win ?? doc.defaultView ?? window;

  const wantsPanel = options.panel !== false;

  let overlay: Overlay | null = null;
  let panel: PanelHandle | null = null;
  let active = false;
  let destroyed = false;
  let frameHandle: number | null = null;
  let frameQueued = false;
  let pointerX = 0;
  let pointerY = 0;
  let previousCursor: string | null = null;
  let pinnedElement: Element | null = null;

  /**
   * Whether the pointer is currently choosing elements.
   *
   * Separate from `active` on purpose. While picking, the page cannot be
   * clicked — every pointer event is captured so that clicking selects instead
   * of navigating. That makes the page unusable, which is fine for a second
   * and intolerable for a minute. Disarming keeps the panel and the held
   * element exactly where they are and hands the page back.
   */
  let picking = true;

  /** Built once per session: walking every rule in every sheet is not cheap. */
  let styleIndex: cascade.StyleIndex | null = null;
  let scanner: PageScanner | null = null;
  let settleTimer: number | null = null;
  let currentElement: Element | null = null;
  let pageData: PageData | undefined;

  /**
   * Live CSS edits.
   *
   * Owned by the session rather than the panel, so there is exactly one place
   * that mutates the page and exactly one place that can put it back. Created
   * lazily: a read-only session should not carry an override store around.
   */
  let overrides: edit.OverrideStore | null = null;
  let viewportWidth: number | null = null;
  /** What the viewport actually became. Not always what was asked for. */
  let viewportActual: number | null = null;
  let viewportSettle: number | null = null;
  /** The last page-wide contrast audit, or null until one is asked for. */
  let contrastAudit: ContrastAudit | null = null;
  /** Bumped per request, so a late measurement cannot overwrite a newer one. */
  let viewportGeneration = 0;
  /** Why the last resize did not happen, in the browser's own words. */
  let viewportError: string | null = null;
  /** The viewport width at the moment of the request, to tell a clamp from a no-op. */
  let viewportBefore: number | null = null;
  let dropViewportListener: (() => void) | null = null;

  /**
   * Forced pseudo-states.
   *
   * Built lazily and once: constructing it walks every rule in every sheet to
   * find the ones mentioning `:hover` and friends, which is the same cost as
   * the style index and must not happen per hover.
   */
  let pseudoStates: edit.PseudoStateController | null = null;

  function ensurePseudoStates(): edit.PseudoStateController {
    pseudoStates ??= edit.createPseudoStateController(doc);
    return pseudoStates;
  }

  function ensureOverrides(): edit.OverrideStore {
    overrides ??= edit.createOverrideStore();
    return overrides;
  }

  function ensureStyleIndex(): cascade.StyleIndex {
    // The index classifies each sheet; `null` asks it to work the kind out
    // from the sheet itself rather than us guessing.
    styleIndex ??= cascade.buildStyleIndex(
      Array.from(doc.styleSheets, (sheet) => ({ sheet, kind: null })),
    );
    return styleIndex;
  }

  function ensureOverlay(): Overlay {
    overlay ??= createOverlay(doc);
    return overlay;
  }

  /** Freeze on the element being edited; the pointer must stop moving it. */
  function holdCurrentElement(): void {
    if (pinnedElement || !currentElement) return;
    pinnedElement = currentElement;
    panel?.setPinned(true);
  }

  /**
   * Resize the window so the page gets a given viewport width.
   *
   * The window is wider than its viewport by the scrollbar and whatever the
   * window manager adds, and that difference is not a constant — it varies by
   * platform, by theme and by whether a scrollbar is showing. Measuring it
   * rather than assuming it is the only way the number the user picked is the
   * number the page sees.
   */
  function setViewport(width: number | null): void {
    if (!options.resize) return;

    const view = doc.defaultView;
    if (!view) return;

    viewportWidth = width;
    viewportActual = null;
    viewportError = null;
    viewportBefore = view.innerWidth;

    const generation = viewportGeneration + 1;
    const outcome = options.resize(width, view.innerWidth);

    // The extension answers with the browser's reason when it refuses. A
    // silent failure here is indistinguishable from a button that does
    // nothing, which is exactly how it looked before.
    void Promise.resolve(outcome)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
      .then((reason) => {
        if (typeof reason !== 'string' || generation !== viewportGeneration) return;
        viewportError = reason;
        scheduleRender();
      });

    // "auto" is measured too: restoring can be refused just as shrinking can.
    measureViewport(view);
    scheduleRender();
  }

  /**
   * Read back the width the browser settled on.
   *
   * Asking is not getting: every platform enforces a minimum window width, and
   * on macOS it lands somewhere around 570px — so the 375 preset cannot be
   * honoured there and clicking it would otherwise leave the panel claiming a
   * width the page never had. Reporting the real number is the difference
   * between a limitation and a lie.
   */
  function measureViewport(view: Window): void {
    // Clicking through presets quickly leaves earlier measurements in flight.
    // Without a generation check the slowest one wins and the panel reports a
    // width belonging to a request the user already moved on from — which is
    // how "1440" came to sit next to a readout of 1470.
    cancelViewportMeasurement(view);
    const generation = (viewportGeneration += 1);

    const read = (): void => {
      if (generation !== viewportGeneration) return;
      cancelViewportMeasurement(view);
      viewportActual = view.innerWidth;
      scheduleRender();
    };

    /**
     * Measure when the resizing stops, not when it starts.
     *
     * A window manager does not jump to the new size. Un-maximizing on macOS
     * animates, firing a run of resize events, and reading the first of them
     * caught the window mid-flight — which is how asking for 1440 came back
     * reporting 1469. Each event pushes the read further out; the measurement
     * happens once they go quiet.
     */
    const onResize = (): void => {
      if (generation !== viewportGeneration) return;
      if (viewportSettle !== null) view.clearTimeout(viewportSettle);
      viewportSettle = view.setTimeout(() => view.requestAnimationFrame(read), 140);
    };

    view.addEventListener('resize', onResize);
    dropViewportListener = () => view.removeEventListener('resize', onResize);

    // A request the window manager ignores raises no event at all, so this
    // first deadline is the one that fires when nothing moves.
    viewportSettle = view.setTimeout(read, 600);
  }

  function cancelViewportMeasurement(view: Window): void {
    if (viewportSettle !== null) {
      view.clearTimeout(viewportSettle);
      viewportSettle = null;
    }
    dropViewportListener?.();
    dropViewportListener = null;
  }

  function editingApi() {
    return {
      apply(property: string, value: string): boolean {
        const target = pinnedElement ?? currentElement;
        if (!target) return false;

        const outcome = ensureOverrides().set(target, property, value);
        if (outcome === 'rejected') return false;

        // Repaint so the panel shows the page's new computed values, not the
        // ones it read before the edit landed.
        scheduleRender();
        return true;
      },

      revert(property: string): void {
        const target = pinnedElement ?? currentElement;
        if (!target) return;
        ensureOverrides().clear(target, property);
        scheduleRender();
      },

      revertOn(selector: string, property: string): void {
        // The change list spans elements, so a row there is addressed by its
        // selector rather than by whatever happens to be selected now.
        const entry = overrides?.all().find((candidate) => candidate.selector === selector);
        if (!entry) return;
        overrides?.clear(entry.element, property);
        scheduleRender();
      },

      revertAll(): void {
        ensureOverrides().clearAll();
        scheduleRender();
      },

      get editedProperties(): ReadonlySet<string> {
        const target = pinnedElement ?? currentElement;
        if (!target || !overrides) return new Set<string>();
        return new Set(overrides.forElement(target).map((override) => override.property));
      },

      /**
       * Checked against the value, not merely against `display` being edited.
       * Someone who set `display: flex` by hand has not hidden anything, and a
       * button that claimed otherwise would un-hide by reverting their edit.
       */
      get hidden(): boolean {
        const target = pinnedElement ?? currentElement;
        if (!target || !overrides) return false;
        return overrides
          .forElement(target)
          .some((override) => override.property === 'display' && override.value === 'none');
      },

      toggleHidden(): void {
        const target = pinnedElement ?? currentElement;
        if (!target) return;

        // Hiding implies holding: the element is about to stop being under the
        // pointer, and losing the selection to a repaint would strand it
        // hidden with no way back.
        holdCurrentElement();

        const store = ensureOverrides();
        const already = store
          .forElement(target)
          .some((override) => override.property === 'display' && override.value === 'none');

        if (already) store.clear(target, 'display');
        else store.set(target, 'display', 'none');

        scheduleRender();
      },

      setViewport: options.resize ? setViewport : null,

      get viewportWidth(): number | null {
        return viewportWidth;
      },

      get viewportActual(): number | null {
        return viewportActual;
      },

      get viewportError(): string | null {
        return viewportError;
      },

      get contrastAudit(): ContrastAudit | null {
        return contrastAudit;
      },

      runContrastAudit(): void {
        scanner ??= createPageScanner({ doc, view: win, ignore: isOurs });
        contrastAudit = scanner.auditContrast();
        scheduleRender();
      },

      /** Jump to a failing element from the audit list. */
      selectElement(element: Element): void {
        selectElement(element);
      },

      /**
       * True when the window ended up exactly where it started.
       *
       * "Clamped to 500px" and "did not move at all" both show up as a width
       * larger than the one requested, and they mean completely different
       * things: the first is a limit, the second is a failure. Without this
       * the panel reported the second as though it were the first, which is
       * how a button that does nothing came to look like a button working
       * within its limits.
       */
      get viewportUnchanged(): boolean {
        return (
          viewportWidth !== null &&
          viewportActual !== null &&
          viewportBefore !== null &&
          viewportActual === viewportBefore &&
          Math.abs(viewportActual - viewportWidth) > 2
        );
      },

      togglePseudoState(state: string): void {
        const target = pinnedElement ?? currentElement;
        if (!target) return;

        const controller = ensurePseudoStates();
        const next = controller.forced(target);
        const value = state as edit.PseudoState;

        if (next.has(value)) next.delete(value);
        else next.add(value);

        controller.force(target, next);
        // Forcing changes computed style, so the panel must re-read.
        scheduleRender();
      },

      save: options.save ?? saveViaAnchor(doc),

      onBeginEdit: holdCurrentElement,
    };
  }

  /**
   * Make an element the selection, wherever it came from.
   *
   * Breadcrumb clicks and arrow keys both land here, and both imply holding:
   * you navigated deliberately, so the pointer must not take it back.
   */
  function selectElement(element: Element): void {
    if (!element.isConnected) return;
    pinnedElement = element;
    currentElement = element;
    panel?.setPinned(true);
    scheduleSettledScan(element);
    scheduleRender();
  }

  /** Jump to an ancestor by its distance from the current element. */
  function selectAncestor(depth: number): void {
    const anchor = pinnedElement ?? currentElement;
    if (!anchor || depth <= 0) return;

    const trail = ancestorTrail(anchor, { ignore: isOurs });
    const target = trail.find((crumb) => crumb.depth === depth);
    if (target) selectElement(target.element);
  }

  function stepSelection(direction: TreeDirection): void {
    const anchor = pinnedElement ?? currentElement;
    if (!anchor) return;

    const next = stepTree(anchor, direction, { ignore: isOurs });
    if (next) selectElement(next);
  }

  function ensurePanel(): PanelHandle | null {
    if (!wantsPanel) return null;
    panel ??= createPanel({
      doc,
      editing: editingApi(),
      onTogglePicking: () => setPicking(!picking),
      onSelectAncestor: selectAncestor,
      onStep: stepSelection,
      onClose: () => deactivate(),
      onPinnedChange: (isPinned) => {
        if (!isPinned) {
          pinnedElement = null;
          scheduleRender();
        }
      },
    });
    return panel;
  }

  /** Ours, so the probe must look straight through it. */
  function isOurs(element: Element): boolean {
    if (overlay?.owns(element)) return true;
    if (panel?.owns(element)) return true;
    return false;
  }

  /** Update the panel without drawing anything over the page. */
  function showPanelOnly(element: Element): void {
    const surface = ensurePanel();
    if (!surface) return;
    surface.update(buildData(element, null));
  }

  /** Paint the overlay and panel for one element. Must stay cheap. */
  function show(element: Element, boundary: PanelData['boundary']): void {
    const descriptor = describeElement(element);

    ensureOverlay().show({
      box: readBoxModel(element, win),
      selectorLabel: descriptor.selectorLabel,
      dimensions: formatDimensions(descriptor.width, descriptor.height),
      boundary,
    });

    const surface = ensurePanel();
    if (!surface) return;

    surface.update(buildData(element, boundary));
  }

  function buildData(element: Element, boundary: PanelData['boundary']): PanelData {
    const collect = options.collect;
    const data = collect
      ? collect(element, win)
      : collectElementData(element, win, { styleIndex: ensureStyleIndex(), ignore: isOurs });

    data.boundary = boundary;

    if (pseudoStates) {
      data.pseudoStates = {
        all: [...edit.FORCEABLE_STATES],
        available: [...pseudoStates.support.available],
        active: [...pseudoStates.forced(element)],
        unreadableSheets: pseudoStates.support.unreadableSheets,
      };
    } else {
      // Advertise the controls before the controller exists; building it is
      // deferred until someone actually forces a state.
      data.pseudoStates = {
        all: [...edit.FORCEABLE_STATES],
        available: [...edit.FORCEABLE_STATES],
        active: [],
        unreadableSheets: 0,
      };
    }

    if (overrides && overrides.count() > 0) {
      data.edits = overrides.all().flatMap((entry): EditEntry[] =>
        entry.overrides.map((override) => ({
          selector: entry.selector,
          element: describeForList(entry.element),
          property: override.property,
          value: override.value,
          previous: override.previousComputed,
          onCurrentElement: entry.element === element,
        })),
      );
      data.editsCss = overrides.toCss();
      data.editsPrompt = overrides.toPrompt();
    }

    // Page-wide findings persist across hovers: the palette does not change
    // because the pointer moved. Breakpoints refresh on the next settle.
    if (pageData) {
      data.page = pageData;
      data.exports = pageData.exports;
    }

    return data;
  }

  /**
   * Run the document-wide analysis once the pointer stops.
   *
   * Kept off the hover path entirely: a palette scan walks thousands of
   * elements, and doing that per pointer move would make the host page stutter
   * — the exact failure that gets an inspector uninstalled.
   */
  function scheduleSettledScan(element: Element): void {
    if (!wantsPanel) return;
    if (settleTimer !== null) win.clearTimeout(settleTimer);

    settleTimer = win.setTimeout(() => {
      settleTimer = null;
      if (!active || !element.isConnected) return;

      /**
       * Work out which states the page styles, here rather than on first click.
       *
       * Built lazily it used to answer "all of them" until someone pressed a
       * toggle, at which point the truthful — usually much shorter — list
       * arrived and the row visibly rearranged under the pointer. Worse, the
       * state just forced could land outside it and its own toggle would go
       * disabled, with no way left to turn it off.
       *
       * This walk costs one pass over the document's rules, which is why it
       * rides along with the page scan instead of blocking the first paint.
       */
      ensurePseudoStates();

      scanner ??= createPageScanner({ doc, view: win, ignore: isOurs });
      pageData = scanner.scan(element);

      // Repaint with the deep findings merged in.
      if (currentElement) show(currentElement, null);
    }, SETTLE_DELAY_MS);
  }

  function render(): void {
    // Disarmed: keep showing the held element's data, but paint nothing over
    // the page. The user asked for the page back.
    if (!picking && pinnedElement) {
      if (pinnedElement.isConnected) {
        overlay?.hide();
        showPanelOnly(pinnedElement);
      }
      return;
    }

    if (pinnedElement) {
      if (pinnedElement.isConnected) {
        if (currentElement !== pinnedElement) {
          currentElement = pinnedElement;
          scheduleSettledScan(pinnedElement);
        }
        show(pinnedElement, null);
        return;
      }
      // The pinned element was removed from the page — fall back to following
      // the pointer rather than showing stale measurements forever.
      pinnedElement = null;
      panel?.setPinned(false);
    }

    const result = probeAtPoint(pointerX, pointerY, { ignore: isOurs });

    if (!result) {
      ensureOverlay().hide();
      return;
    }

    if (currentElement !== result.element) {
      currentElement = result.element;
      scheduleSettledScan(result.element);
    }

    show(result.element, result.boundary);
  }

  function scheduleRender(): void {
    if (frameQueued) return;
    frameQueued = true;
    frameHandle = win.requestAnimationFrame(() => {
      frameQueued = false;
      frameHandle = null;
      if (active) render();
    });
  }

  function cancelPendingRender(): void {
    if (frameHandle !== null) win.cancelAnimationFrame(frameHandle);
    frameHandle = null;
    frameQueued = false;
    if (settleTimer !== null) win.clearTimeout(settleTimer);
    settleTimer = null;
  }

  function onPointerMove(event: Event): void {
    // A held selection is held: hover-following resumes only once released.
    if (pinnedElement) return;
    const pointer = event as PointerEvent;
    pointerX = pointer.clientX;
    pointerY = pointer.clientY;
    scheduleRender();
  }

  // Scrolling and resizing move elements without moving the pointer, so the
  // overlay has to re-measure at the last known coordinates.
  function onViewportChange(): void {
    scheduleRender();
  }

/** Arrow keys that move the selection around the tree. */
  const TREE_KEYS: Record<string, TreeDirection> = {
    ArrowUp: 'parent',
    ArrowDown: 'child',
    ArrowLeft: 'previous',
    ArrowRight: 'next',
  };

  function onKeyDown(event: Event): void {
    const key = (event as KeyboardEvent).key;

    /**
     * Arrow keys walk the DOM — unless the user is typing.
     *
     * Focus inside a shadow root reports the *host* as the document's active
     * element, so this is how the panel's own inputs are detected from out
     * here. Without the check, arrow-stepping a padding value would also move
     * the selection out from under the edit.
     */
    const focusInPanel = panel?.owns(doc.activeElement ?? doc.body) ?? false;
    const direction = TREE_KEYS[key];

    if (direction && !focusInPanel && (pinnedElement ?? currentElement)) {
      event.preventDefault();
      event.stopPropagation();
      stepSelection(direction);
      return;
    }

    if (key !== 'Escape') return;

    /**
     * Escape unwinds one step at a time, never more.
     *
     * Release the selection, then give the page back, then close. Jumping
     * straight to closed throws away whatever the user was reading, which is
     * the one thing they cannot get back with another keystroke.
     */
    if (pinnedElement) {
      pinnedElement = null;
      panel?.setPinned(false);
      scheduleRender();
    } else if (picking) {
      setPicking(false);
    } else {
      deactivate();
    }
  }

  /**
   * Swallow page interactions while inspecting.
   *
   * Without this, inspecting a link or a submit button navigates away the
   * moment you try to pin it — which is most of the interesting elements on
   * most pages. Clicks landing on our own panel pass through untouched, since
   * that surface is meant to be operated.
   */
  function onPageInteraction(event: Event): void {
    const target = event.target;
    if (target instanceof Element && isOurs(target)) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.type !== 'click') return;

    /**
     * Clicking selects and *locks* the highlight there.
     *
     * The overlay stays drawn on the chosen element while you work in the
     * panel — the colours are the whole point of having selected it, and
     * losing them the instant you look away makes the box model unreadable.
     * Hover-following stops, so a stray mouse movement cannot steal the
     * selection.
     *
     * Clicking the same element again releases it; clicking a different one
     * moves the selection. Escape releases too. The picker stays armed
     * throughout, so switching elements is one click, not two.
     */
    /**
     * Probe where the click actually landed, not where the pointer was last
     * seen moving.
     *
     * While a selection is held, `pointermove` returns early so the highlight
     * cannot drift — which leaves `pointerX`/`pointerY` frozen at wherever the
     * pointer was when the selection was made. Reusing them here selects
     * whatever happens to sit at that stale coordinate instead of the thing
     * under the cursor.
     */
    const pointer = event as MouseEvent;
    const x = Number.isFinite(pointer.clientX) ? pointer.clientX : pointerX;
    const y = Number.isFinite(pointer.clientY) ? pointer.clientY : pointerY;

    const result = probeAtPoint(x, y, { ignore: isOurs });
    if (!result) return;

    // Keep the tracked position honest for whatever renders next.
    pointerX = x;
    pointerY = y;

    const sameElement = pinnedElement === result.element;
    pinnedElement = sameElement ? null : result.element;
    currentElement = result.element;
    panel?.setPinned(pinnedElement !== null);
    scheduleRender();
  }

  /** Listeners that exist for as long as the panel is open. */
  function addSessionListeners(): void {
    doc.addEventListener('keydown', onKeyDown, true);
    // Capture phase catches scrolling inside nested containers, not just the
    // document — a modal's inner scroll would otherwise leave the overlay
    // stranded where the element used to be.
    win.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
    win.addEventListener('resize', onViewportChange, { passive: true });
  }

  function removeSessionListeners(): void {
    doc.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('scroll', onViewportChange, true);
    win.removeEventListener('resize', onViewportChange);
  }

  /** Listeners that only exist while the picker is armed. */
  function addPickingListeners(): void {
    doc.addEventListener('pointermove', onPointerMove, { passive: true });
    for (const type of SUPPRESSED_EVENTS) {
      doc.addEventListener(type, onPageInteraction, true);
    }
  }

  function removePickingListeners(): void {
    doc.removeEventListener('pointermove', onPointerMove);
    for (const type of SUPPRESSED_EVENTS) {
      doc.removeEventListener(type, onPageInteraction, true);
    }
  }

  /**
   * Arm or disarm the picker.
   *
   * Disarming is what makes the page usable again: the capture-phase listeners
   * come off, the crosshair goes away, and the highlight is hidden so nothing
   * is painted over the content. The panel keeps showing whatever was last
   * selected, so the CSS stays readable and editable.
   */
  function setPicking(next: boolean): void {
    if (!active || picking === next) return;
    picking = next;

    if (picking) {
      pinnedElement = null;
      doc.documentElement.style.cursor = 'crosshair';
      addPickingListeners();
    } else {
      removePickingListeners();
      doc.documentElement.style.cursor = previousCursor ?? '';
      overlay?.hide();
    }

    panel?.setPicking(picking);
    scheduleRender();
  }

  function activate(): void {
    // Destruction is terminal. A superseded session that could reactivate
    // would attach a second overlay to a page that already has a live one.
    if (destroyed || active) return;
    active = true;

    previousCursor = doc.documentElement.style.cursor;
    doc.documentElement.style.cursor = 'crosshair';
    picking = true;

    addSessionListeners();
    addPickingListeners();
    ensureOverlay();
    ensurePanel();
  }

  function deactivate(): void {
    if (!active) return;
    active = false;

    cancelPendingRender();
    removeSessionListeners();
    removePickingListeners();
    picking = false;
    overlay?.hide();
    pinnedElement = null;
    currentElement = null;

    /**
     * Undo every mutation, keep every cache.
     *
     * Closing the inspector has to leave the page exactly as it was — edits
     * reverted, forced states cleared, injected stylesheet gone. These used to
     * live in `destroy` only, which meant closing the panel left the page
     * quietly modified and the README's promise untrue.
     *
     * The caches (style index, page scan) are not mutations and survive, so
     * reopening on the same page does not pay for the document walk twice.
     */
    contrastAudit = null;
    overrides?.clearAll();
    pseudoStates?.destroy();
    pseudoStates = null;

    // A window left at 375px wide is the most annoying thing this could
    // possibly leave behind, so it goes back with everything else.
    if (viewportWidth !== null) setViewport(null);
    cancelViewportMeasurement(win);
    viewportError = null;

    panel?.destroy();
    panel = null;

    doc.documentElement.style.cursor = previousCursor ?? '';
    previousCursor = null;

    options.onDeactivate?.();
  }

  return {
    get active() {
      return active;
    },
    get picking() {
      return picking;
    },
    setPicking,
    get pinned() {
      return pinnedElement !== null;
    },
    activate,
    deactivate,
    toggle() {
      if (active) deactivate();
      else activate();
      return active;
    },
    destroy() {
      deactivate();
      destroyed = true;
      overlay?.destroy();
      overlay = null;
      panel?.destroy();
      panel = null;
      // deactivate() has already put the page back; this drops the caches.
      overrides = null;
      styleIndex = null;
      scanner = null;
      pageData = undefined;
    },
  };
}
