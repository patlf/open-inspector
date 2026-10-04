import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { PANEL_TABS, type PanelData, type PanelTab, type TreeInfo } from './view-model.js';
import { SearchContext } from './search.jsx';
import { useEditing } from './editing.jsx';
import { Group } from './primitives.jsx';
import { Icon, TAB_ICONS } from './icons.jsx';
import { StructureTree, type StructureApi } from './structure-tree.jsx';
import { SettingsSection } from './settings-view.jsx';
import { SvgPasteSection } from './svg-tool.jsx';
import { ScriptSection } from './script-section.jsx';
import type { InspectorSettings, PanelPlacement, ThemeSetting } from '../settings.js';
import {
  DEFAULT_WIDTH,
  MARGIN,
  MAX_WIDTH,
  MIN_FLOATING_HEIGHT,
  MIN_WIDTH,
  clampFloating,
  clampHeight,
  clampWidth,
  dropPlacement,
  nearestSide,
  type Viewport,
} from './placement.js';
import {
  AssetsSection,
  MarkupSection,
  ColorSection,
  ExportSection,
  LayoutSection,
  PseudoRulesSection,
  RulesSection,
  SourceSection,
  StylesSection,
  TypeSection,
} from './sections.jsx';

export interface PanelProps {
  data: PanelData | null;
  /** Select an ancestor by its distance from the current element. */
  onSelectAncestor: (depth: number) => void;
  /** Step to the parent, first child, or a sibling. */
  onStep: (direction: 'parent' | 'child' | 'previous' | 'next') => void;
  /** The structure drawer's controls; absent, the drawer is not offered. */
  structure?: StructureApi | undefined;
  /** A setting was changed in the panel; absent, there is no settings view. */
  onChangeSettings?: ((next: Partial<InspectorSettings>) => void) | undefined;
  /** Whether a change is kept beyond this session. */
  settingsSaved?: boolean | undefined;
  /** True when the panel is frozen on one element. */
  pinned: boolean;
  /** True while the picker is armed and the page is being captured. */
  picking: boolean;
  onTogglePicking: () => void;
  onClose: () => void;
  /** Docked to a side, or floating where it was dropped. */
  placement: PanelPlacement;
  /** Light, dark, or the system's; absent, the system's. */
  theme?: ThemeSetting | undefined;
  /** The window the panel is in, for its size. */
  view: Window;
  /**
   * The panel was moved, docked or resized. `commit` is false while a drag is
   * under way and true once it settles — the moment worth saving.
   */
  onPlace: (next: PanelPlacement, commit: boolean) => void;
  /** Closing would revert this many edits and is waiting to be confirmed; null when not asking. */
  confirmClose?: number | null;
  onCancelClose?: () => void;
  /** Opens the page that turns on the Firefox DevTools tab; absent elsewhere. */
  onSetUpDevtools?: (() => void) | undefined;
  /**
   * Fill the host rather than float over a page: the panel as a DevTools
   * tab, which owns its own space. Nothing to dock, drag, resize or
   * collapse there, so those controls are left out.
   */
  embedded?: boolean;
}

/**
 * Where the coffee link points.
 *
 * Change the handle here and nowhere else. A plain link, never the hosted
 * badge image — an <img> pointed at buymeacoffee.com would be a request the
 * extension makes on every render, which is precisely the thing this project
 * promises never to do, and the panel's own CSP would block it anyway.
 */
const SUPPORT_URL = 'https://buymeacoffee.com/openinspector';

/**
 * A quiet footer.
 *
 * Deliberately the least prominent thing on screen: no badge, no colour until
 * hovered, no count of how many coffees. A tool that asks for money louder
 * than it reports its findings has its priorities backwards.
 */
function Footer() {
  return (
    <footer class="foot">
      <span class="foot-name">Open Inspector</span>
      <a
        class="foot-link"
        href={SUPPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Opens buymeacoffee.com in a new tab"
      >
        {/* Drawn inline like every icon here; the hosted badge image would be
            a request. */}
        <Icon name="coffee" size={13} />
        Buy me a coffee
      </a>
    </footer>
  );
}

/**
 * The one control the panel always shows.
 *
 * Always labelled "Inspect" to assistive tech and always in the same place,
 * because the first question anyone asks of a new panel is which thing to
 * click. Before anything is selected it is a labelled button, where there is
 * room and the question is most pressing; once an element is held it shrinks
 * to an icon, tinted while picking, so the selector beside it keeps its width.
 */
function InspectButton({
  picking,
  onToggle,
  compact = false,
}: {
  picking: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      class={compact ? 'primary-btn icon-btn' : 'primary-btn'}
      data-compact={compact}
      aria-pressed={picking}
      aria-label={compact ? 'Inspect' : undefined}
      title={
        picking
          ? 'Picking elements. The page cannot be clicked. Press to stop and use the page normally.'
          : 'Not picking — the page works normally. Press to choose another element.'
      }
      onClick={onToggle}
    >
      <Icon name="pointer" />
      {compact ? null : (
        <>
          Inspect
          <span class="state">{picking ? 'on' : 'off'}</span>
        </>
      )}
    </button>
  );
}

/**
 * The ancestor path, plus arrows for stepping.
 *
 * This is the only way to reach an element that has no pixels of its own — a
 * wrapper with no padding is entirely covered by its children, so hit-testing
 * can never land on it. Before this existed, a large part of any page simply
 * could not be selected.
 *
 * One row: the steps lead, because they are the controls, and the trail takes
 * the rest. The trail keeps its end in view — the selected element is the one
 * crumb that must never be scrolled off.
 */
function Breadcrumb({
  tree,
  onSelectAncestor,
  onStep,
  structureOpen,
  onToggleStructure,
}: {
  tree: TreeInfo;
  onSelectAncestor: (depth: number) => void;
  onStep: PanelProps['onStep'];
  structureOpen: boolean;
  /** Absent when there is no drawer to toggle. */
  onToggleStructure?: (() => void) | undefined;
}) {
  const trail = useRef<HTMLElement>(null);

  // After every render, not just a new selection: resizing the panel also
  // changes how much of the path fits.
  useEffect(() => {
    const node = trail.current;
    if (!node) return;
    node.scrollLeft = node.scrollWidth;
    node.dataset['clipped'] = String(node.scrollLeft > 0);
  });

  return (
    <div class="crumbs">
      <div class="crumb-steps">
        <button
          type="button"
          class="step"
          disabled={!tree.canParent}
          aria-label="Parent"
          title="Parent (↑)"
          onClick={() => onStep('parent')}
        >
          <Icon name="up" size={12} />
        </button>
        <button
          type="button"
          class="step"
          disabled={!tree.canChild}
          aria-label="First child"
          title={`First of ${tree.childCount} children (↓)`}
          onClick={() => onStep('child')}
        >
          <Icon name="down" size={12} />
        </button>
        <button
          type="button"
          class="step"
          disabled={!tree.canPrevious}
          aria-label="Previous sibling"
          title="Previous sibling (←)"
          onClick={() => onStep('previous')}
        >
          <Icon name="left" size={12} />
        </button>
        <button
          type="button"
          class="step"
          disabled={!tree.canNext}
          aria-label="Next sibling"
          title="Next sibling (→)"
          onClick={() => onStep('next')}
        >
          <Icon name="right" size={12} />
        </button>
        {/* With the steps, because it is another way of moving around the
            same tree — the one that reaches anything in two clicks. */}
        {onToggleStructure ? (
          <button
            type="button"
            class="step"
            aria-pressed={structureOpen}
            // Only while there is a drawer to point at: an id that is not in
            // the document is an invalid reference.
            aria-controls={structureOpen ? 'oi-structure' : undefined}
            aria-label="Structure"
            title={structureOpen ? 'Hide the document tree' : 'Show the document tree'}
            onClick={onToggleStructure}
          >
            <Icon name="tree" size={12} />
          </button>
        ) : null}
      </div>

      <nav class="crumb-trail" aria-label="Ancestors" ref={trail}>
        {tree.trail.map((crumb, index) => (
          <span key={`${crumb.depth}:${crumb.label}`} class="crumb-item">
            {index > 0 ? <span class="crumb-sep">›</span> : null}
            <button
              type="button"
              class="crumb"
              // The last entry is the element itself, not somewhere to go.
              aria-current={crumb.depth === 0}
              disabled={crumb.depth === 0}
              title={crumb.depth === 0 ? 'Selected' : `Select ${crumb.label}`}
              onClick={() => onSelectAncestor(crumb.depth)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      {/* Position only. The child count lives on the ↓ button's title, where
          it answers the question that button raises; spelled out here it took
          the width the path needed. */}
      <span class="crumb-count" title={`Position among ${tree.siblingCount} siblings`}>
        {tree.siblingIndex}/{tree.siblingCount}
      </span>
    </div>
  );
}

/**
 * Widths worth checking, and why these.
 *
 * Not a device list. Devices change every year and their names age badly;
 * these are the widths where layouts actually break — the common phone, the
 * tablet portrait that trips `md:`, the small laptop, and a wide desktop.
 */
const VIEWPORT_PRESETS: ReadonlyArray<{ width: number; label: string }> = [
  { width: 375, label: '375' },
  { width: 768, label: '768' },
  { width: 1024, label: '1024' },
  { width: 1440, label: '1440' },
];

/**
 * Resize the window to a viewport width.
 *
 * A real resize, not a simulation. The alternative — constraining the page
 * inside a narrow box — is what it looks like from the outside, but media
 * queries evaluate against the viewport, so a page in a 375px-wide box still
 * renders its desktop layout and the preview lies. Moving the actual window
 * is the only way the breakpoints fire, and it costs no permission: the
 * `windows` API needs none.
 */
function ViewportControl() {
  const editing = useEditing();
  if (!editing?.setViewport) return null;

  const { setViewport, viewportWidth, viewportActual, viewportError, viewportUnchanged } = editing;

  // Off by a pixel or two is rounding; off by a hundred is a refusal.
  const clamped =
    viewportWidth !== null && viewportActual !== null && Math.abs(viewportActual - viewportWidth) > 2;

  return (
    <div
      class="viewport"
      role="group"
      aria-label="Viewport width"
      data-clamped={clamped}
      title={
        clamped
          ? `Asked for ${viewportWidth}px; the browser would not go below ${viewportActual}px. Window managers enforce a minimum width, and no extension can override it.`
          : undefined
      }
    >
      <button
        type="button"
        class="viewport-btn"
        data-resting="true"
        aria-pressed={viewportWidth === null}
        title="Leave the window at whatever size it is"
        onClick={() => setViewport(null)}
      >
        auto
      </button>
      {VIEWPORT_PRESETS.map((preset) => (
        <button
          key={preset.width}
          type="button"
          class="viewport-btn"
          aria-pressed={viewportWidth === preset.width}
          title={`Resize the window so the page gets ${preset.width}px of viewport`}
          onClick={() => setViewport(preset.width)}
        >
          {preset.label}
        </button>
      ))}
      {viewportError ? (
        <span class="viewport-actual" data-error="true" title={viewportError}>
          refused
        </span>
      ) : viewportUnchanged ? (
        <span
          class="viewport-actual"
          data-error="true"
          title={`The window is still ${viewportActual}px wide. It did not move, and the browser reported no error.`}
        >
          unchanged
        </span>
      ) : clamped ? (
        <span class="viewport-actual" aria-label={`actually ${viewportActual} pixels`}>
          →{viewportActual}
        </span>
      ) : null}
    </div>
  );
}

function ViewportGroup() {
  const editing = useEditing();
  if (!editing?.setViewport) return null;
  return (
    <Group title="Viewport">
      <ViewportControl />
    </Group>
  );
}

/**
 * Say when the panel is covering the viewport it was asked to preview.
 *
 * This used to collapse the panel on its own below 900px. It solved the
 * overlap and created something worse: the panel vanishing on a button press
 * reads as a crash, and the control for getting the width back went with it —
 * leaving no visible way out of a 375px window. Stating the problem and
 * leaving the choice is the smaller sin.
 */
function CoverageHint({ onCollapse }: { onCollapse: () => void }) {
  const editing = useEditing();

  if (editing?.viewportError) {
    return (
      <p class="coverage-hint" data-error="true">
        The browser would not resize the window: {editing.viewportError}
      </p>
    );
  }

  if (editing?.viewportUnchanged) {
    return (
      <p class="coverage-hint" data-error="true">
        The window did not move, and the browser reported no error. The usual cause is a stale
        background worker: reload the extension at <code>chrome://extensions</code>, then try
        again.
      </p>
    );
  }

  const width = editing?.viewportActual ?? editing?.viewportWidth ?? null;
  if (width === null || width >= 900) return null;

  return (
    <p class="coverage-hint">
      The panel covers most of {width}px.{' '}
      <button type="button" class="link-btn" onClick={onCollapse}>
        Collapse it
      </button>{' '}
      to see the page; the edge tab brings it back.
    </p>
  );
}

/**
 * Take the element out of the layout, revertibly.
 *
 * `display: none` rather than `visibility: hidden` on purpose: the question
 * this answers is almost always "what is underneath the sticky header", and
 * leaving the space occupied answers it badly. It goes through the same
 * override store as every other edit, so it appears in Changes and is undone
 * by closing the inspector.
 */
function HideButton() {
  const editing = useEditing();
  if (!editing) return null;

  return (
    <button
      type="button"
      class="icon-btn hide-btn"
      aria-pressed={editing.hidden}
      title={
        editing.hidden
          ? 'Show this element again — the display override is reverted'
          : 'Hide this element with display: none. Revertible, and listed under Changes.'
      }
      onClick={editing.toggleHidden}
    >
      <Icon name={editing.hidden ? 'eyeOff' : 'eye'} size={13} />
      {/* An unlabelled eye could mean hide, preview, watch or reveal. */}
      <span class="btn-label">{editing.hidden ? 'Show' : 'Hide'}</span>
    </button>
  );
}

function boundaryLabel(data: PanelData): string | null {
  if (!data.boundary) return null;

  switch (data.boundary.kind) {
    case 'iframe':
      return data.boundary.sameOrigin
        ? 'iframe — frames can’t be inspected yet; open it in its own tab'
        : 'cross-origin iframe — the browser will not let any extension read this';
    case 'opaque-custom-element':
      return 'probably a closed shadow root — nothing can read inside it';
    case 'canvas':
      return 'canvas — pixels, no DOM to inspect';
  }
}

/**
 * Every key the inspector answers to, in one place.
 *
 * The arrows are the feature most worth knowing — they are the only way to
 * reach a wrapper whose children cover it — and they used to live only in
 * tooltips. They also take over the page's arrow keys while the panel is open,
 * which nobody should have to discover by accident.
 */
const SHORTCUTS: ReadonlyArray<{ keys: string; action: string }> = [
  { keys: 'hover', action: 'inspect what is under the pointer' },
  { keys: 'click', action: 'hold it and give the page back' },
  { keys: '↑ ↓', action: 'parent · first child' },
  { keys: '← →', action: 'previous · next sibling' },
  { keys: 'Esc', action: 'release, stop picking, then close' },
  { keys: 'Alt+Shift+I', action: 'toggle the inspector' },
];

function ShortcutList() {
  return (
    <ul class="onboard-keys">
      {SHORTCUTS.map((shortcut) => (
        <li key={shortcut.keys}>
          <b>{shortcut.keys}</b> {shortcut.action}
        </li>
      ))}
    </ul>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Closing is about to throw edits away — say so, and offer the way out.
 *
 * Escape or the close button a second time confirms; the page is only ever
 * put back, never saved, so there is nothing to choose between but "now" and
 * "not yet".
 */
function ConfirmClose({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="confirm-close" role="alertdialog" aria-label="Close the inspector?">
      <p>
        Closing reverts <b>{plural(pending, 'change')}</b> on this page. Copy {pending === 1 ? 'it' : 'them'}{' '}
        from Changes first if you want to keep {pending === 1 ? 'it' : 'them'}.
      </p>
      <div class="confirm-actions">
        <button type="button" class="confirm-yes" onClick={onConfirm}>
          Revert &amp; close
        </button>
        <button type="button" onClick={onCancel}>
          Keep open
        </button>
      </div>
    </div>
  );
}

function viewportOf(view: Window): Viewport {
  return { width: view.innerWidth, height: view.innerHeight };
}

/** A size change from one of the handles. `height: null` runs the panel to the bottom margin. */
type PanelSize = { width?: number; height?: number | null };

/**
 * An edge or corner of the panel, as a handle.
 *
 * A fixed 348px panel regularly sat on top of the very element being read,
 * and flipping sides only helps if the other side is empty. The side handle
 * trades width for page — the inner edge when docked, the right one when
 * floating. The bottom one does the same with height, and the corner does
 * both at once. Side and bottom also answer arrow keys while focused; the
 * corner adds nothing a keyboard needs, so it is left out of the tab order.
 */
function ResizeHandle({
  kind,
  edge,
  width,
  height,
  onResize,
}: {
  kind: 'side' | 'bottom' | 'corner';
  /** The edge the width is measured from: where a side or corner handle sits. */
  edge: 'left' | 'right';
  width: number;
  /** The height the panel has now, however it got it. */
  height: number;
  onResize: (size: PanelSize, commit: boolean) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  /** The panel's box when the drag began; sizes are measured from its far edges. */
  const start = useRef<DOMRect | null>(null);
  /**
   * Where the press landed, and whether the pointer has left it since.
   *
   * A press that never moves is a click, and must not resize anything. The
   * handle is a few pixels thick, so measuring a size from wherever the click
   * landed nudged the panel — and moved the edge out from under the pointer,
   * so the second click of a double-click landed outside it.
   */
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  function viewport(): Viewport {
    const view = handle.current?.ownerDocument.defaultView;
    return view ? viewportOf(view) : { width: MAX_WIDTH + 48, height: 0 };
  }

  function sizeAt(clientX: number, clientY: number): PanelSize {
    const box = start.current;
    if (!box) return {};
    const size: PanelSize = {};
    if (kind !== 'bottom') {
      size.width = clampWidth(edge === 'left' ? box.right - clientX : clientX - box.left, viewport());
    }
    if (kind !== 'side') size.height = clampHeight(clientY - box.top, box.top, viewport());
    return size;
  }

  const reset: PanelSize =
    kind === 'side'
      ? { width: DEFAULT_WIDTH }
      : kind === 'bottom'
        ? { height: null }
        : { width: DEFAULT_WIDTH, height: null };

  const label = kind === 'bottom' ? 'Panel height' : 'Panel width';
  const pointer = {
    onPointerDown: (event: PointerEvent) => {
      event.preventDefault();
      const target = event.currentTarget as HTMLElement;
      start.current = target.parentElement?.getBoundingClientRect() ?? null;
      press.current = { x: event.clientX, y: event.clientY, moved: false };
      target.setPointerCapture(event.pointerId);
      target.dataset['dragging'] = 'true';
    },
    onPointerMove: (event: PointerEvent) => {
      const at = press.current;
      if (!at || !(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return;
      if (!at.moved && Math.hypot(event.clientX - at.x, event.clientY - at.y) < 2) return;
      at.moved = true;
      onResize(sizeAt(event.clientX, event.clientY), false);
    },
    onPointerUp: (event: PointerEvent) => {
      const target = event.currentTarget as HTMLElement;
      target.releasePointerCapture(event.pointerId);
      delete target.dataset['dragging'];
      if (press.current?.moved) onResize(sizeAt(event.clientX, event.clientY), true);
      start.current = null;
      press.current = null;
    },
    onDblClick: () => onResize(reset, true),
  };

  if (kind === 'corner') {
    return (
      <div
        ref={handle}
        class="resize-corner"
        aria-hidden="true"
        title="Drag to resize · double-click to reset"
        {...pointer}
      >
        {/* Three single-pixel dimples in the corner's 2×2 grid, the empty cell
            away from the corner, so the grip points at where it pulls. Each
            is a shade pixel with a light one below and right of it, which is
            what reads as pressed in. */}
        <svg class="corner-grip" viewBox="0 0 5 5" width="5" height="5">
          <rect class="grip-light" x="4" y="1" width="1" height="1" />
          <rect class="grip-light" x="4" y="4" width="1" height="1" />
          <rect class="grip-light" x="1" y="4" width="1" height="1" />
          <rect class="grip-shade" x="3" y="0" width="1" height="1" />
          <rect class="grip-shade" x="3" y="3" width="1" height="1" />
          <rect class="grip-shade" x="0" y="3" width="1" height="1" />
        </svg>
      </div>
    );
  }

  return (
    <div
      ref={handle}
      class={kind === 'bottom' ? 'resize-bottom' : 'resize-handle'}
      role="separator"
      aria-orientation={kind === 'bottom' ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={kind === 'bottom' ? height : width}
      aria-valuemin={kind === 'bottom' ? MIN_FLOATING_HEIGHT : MIN_WIDTH}
      aria-valuemax={kind === 'bottom' ? undefined : MAX_WIDTH}
      tabIndex={0}
      title={
        kind === 'bottom'
          ? 'Drag to resize · double-click to fill the height'
          : 'Drag to resize · double-click to reset'
      }
      {...pointer}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        if (kind === 'bottom') {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          event.stopPropagation();
          const top = start.current?.top ?? handle.current?.parentElement?.getBoundingClientRect().top ?? 0;
          const next = height + (event.key === 'ArrowDown' ? step : -step);
          onResize({ height: clampHeight(next, top, viewport()) }, true);
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        // Growing means moving the handle away from the rest of the panel.
        const grows = (event.key === 'ArrowLeft') === (edge === 'left');
        onResize({ width: clampWidth(width + (grows ? step : -step), viewport()) }, true);
      }}
    />
  );
}

/** Controls a press on which is theirs, not the start of a drag. */
const NOT_A_DRAG = 'button, input, select, textarea, a, [role="separator"]';

/**
 * Dragging the panel by its rail.
 *
 * A few pixels of travel before it counts, so a click on the rail — to
 * start a double-click, say — never nudges the panel. While it
 * moves, every position is reported uncommitted; the drop is the one that is
 * saved, and dropping against a side edge docks the panel there.
 */
function usePanelDrag(
  placement: PanelPlacement,
  view: Window,
  onPlace: PanelProps['onPlace'],
  panel: { current: HTMLDivElement | null },
) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  );

  const offsets = (event: PointerEvent) => {
    const start = drag.current;
    return start ? { left: start.left + event.clientX - start.x, top: start.top + event.clientY - start.y } : null;
  };

  return {
    dragging,
    handlers: {
      onPointerDown(event: PointerEvent) {
        if (event.button !== 0 || (event.target as Element | null)?.closest?.(NOT_A_DRAG)) return;
        const box = panel.current?.getBoundingClientRect();
        if (!box) return;
        drag.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top, moved: false };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent) {
        const start = drag.current;
        const at = offsets(event);
        if (!start || !at) return;
        if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return;
        if (!start.moved) {
          start.moved = true;
          setDragging(true);
        }
        const position = clampFloating(at.left, at.top, placement.width, viewportOf(view));
        onPlace({ ...placement, dock: null, ...position }, false);
      },
      onPointerUp(event: PointerEvent) {
        const start = drag.current;
        const at = offsets(event);
        drag.current = null;
        const target = event.currentTarget as HTMLElement;
        if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
        if (!start?.moved || !at) return;
        setDragging(false);
        onPlace(dropPlacement(event.clientX, at.left, at.top, placement, viewportOf(view)), true);
      },
      onDblClick(event: MouseEvent) {
        if ((event.target as Element | null)?.closest?.(NOT_A_DRAG)) return;
        onPlace({ ...placement, dock: nearestSide(placement, viewportOf(view)) }, true);
      },
    },
  };
}

type DragHandlers = ReturnType<typeof usePanelDrag>['handlers'];

/** How long the pointer rests on a rail button before its label shows: the hover delay in panel-styles. */
const LABEL_DELAY_MS = 150;
/** How long after leaving a labelled button the next label still shows at once. */
const LABEL_WARM_MS = 300;

/**
 * The section rail, following the WAI-ARIA tabs pattern.
 *
 * Seven text tabs never fit a 348px panel, and a strip that scrolls hides
 * whichever tab you most need. A vertical rail of icons holds all seven with
 * room to spare; each names itself on hover and focus, and to assistive tech
 * through its label.
 *
 * One tab stop for the whole rail, arrows to move between tabs (up/down along
 * the rail, and left/right as well, since that is what a tab strip taught
 * everyone), Home/End to jump.
 */
function Rail({
  tab,
  edits,
  onSelect,
  drag,
  children,
}: {
  tab: PanelTab;
  /** Pending edits, counted on the Styles tab where the Changes list lives. */
  edits: number;
  onSelect: (tab: PanelTab) => void;
  /** Its empty space is what the panel is dragged by; absent where it cannot move. */
  drag?: Partial<DragHandlers> | undefined;
  /** Controls pinned to the foot of the rail. */
  children?: ComponentChildren;
}) {
  const strip = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const label = useRef({ enteredAt: 0, coolDown: 0 });
  useEffect(() => () => clearTimeout(label.current.coolDown), []);

  /**
   * The rail button a pointer event crossed into or out of, or null when it
   * only moved within one (between the icon and its button, say).
   */
  function crossed(event: PointerEvent): HTMLElement | null {
    const button = (event.target as Element).closest<HTMLElement>('.tab, .rail-foot .icon-btn');
    return button && !button.contains(event.relatedTarget as Node | null) ? button : null;
  }

  function enter(event: PointerEvent): void {
    if (!crossed(event)) return;
    clearTimeout(label.current.coolDown);
    label.current.enteredAt = event.timeStamp;
  }

  /**
   * Leaving a button whose label was up warms the rail, so the next label
   * skips its delay and its fade. The data attribute is set directly: it is
   * presentation only, and not worth a render on every pointer move.
   */
  function leave(event: PointerEvent): void {
    const node = rail.current;
    if (!node || !crossed(event)) return;
    const shown =
      node.dataset['warm'] === 'true' || event.timeStamp - label.current.enteredAt >= LABEL_DELAY_MS;
    if (!shown) return;
    node.dataset['warm'] = 'true';
    label.current.coolDown = window.setTimeout(() => delete node.dataset['warm'], LABEL_WARM_MS);
  }

  /**
   * The rail's one tab stop. With the settings view open no rail tab is
   * selected, and a strip with no stop cannot be reached from the keyboard.
   */
  const stop = PANEL_TABS.some((entry) => entry.id === tab) ? tab : PANEL_TABS[0]!.id;

  function move(event: KeyboardEvent): void {
    const index = PANEL_TABS.findIndex((entry) => entry.id === stop);
    const last = PANEL_TABS.length - 1;
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const next =
      forward ? (index + 1) % PANEL_TABS.length
      : back ? (index - 1 + PANEL_TABS.length) % PANEL_TABS.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;

    // The session's tree navigation listens for arrows too; this one is ours.
    event.preventDefault();
    event.stopPropagation();
    const id = PANEL_TABS[next]!.id;
    onSelect(id);
    strip.current?.querySelector<HTMLElement>(`#oi-tab-${id}`)?.focus();
  }

  return (
    <aside class="rail" ref={rail} onPointerOver={enter} onPointerOut={leave} {...drag}>
      <nav
        class="tabs"
        role="tablist"
        aria-label="Inspector sections"
        aria-orientation="vertical"
        ref={strip}
        onKeyDown={move}
      >
        {PANEL_TABS.map((entry) => (
          <button
            key={entry.id}
            id={`oi-tab-${entry.id}`}
            type="button"
            role="tab"
            class="tab"
            aria-selected={entry.id === tab}
            aria-controls="oi-tabpanel"
            tabIndex={entry.id === stop ? 0 : -1}
            onClick={() => onSelect(entry.id)}
          >
            <Icon name={TAB_ICONS[entry.id]} size={15} />
            <span class="tab-label">{entry.label}</span>
            {/* Edits made from any tab stay visible from every tab. The rail is
                always on screen, and the Changes list heads the Styles tab. */}
            {entry.id === 'styles' && edits > 0 ? (
              <span class="tab-count" aria-label={`, ${plural(edits, 'change')}`}>
                {edits}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <div class="rail-foot">{children}</div>
    </aside>
  );
}

export function Panel({
  data,
  picking,
  onTogglePicking,
  onClose,
  placement,
  theme = 'system',
  view,
  onPlace,
  onSelectAncestor,
  onStep,
  structure,
  onChangeSettings,
  settingsSaved = false,
  confirmClose = null,
  onCancelClose,
  onSetUpDevtools,
  embedded = false,
}: PanelProps) {
  const [tab, setTab] = useState<PanelTab>('styles');
  /** Where the settings button returns to when pressed again. */
  const lastContentTab = useRef<PanelTab>('styles');
  /** Markup pasted into the SVG tab, kept while the panel is open. */
  const [pastedSvg, setPastedSvg] = useState('');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = usePanelDrag(placement, view, onPlace, frame);
  const dragging = embedded ? false : drag.dragging;
  const dragHandlers = embedded ? {} : drag.handlers;

  const viewport = viewportOf(view);
  const side = nearestSide(placement, viewport);
  const width = clampWidth(placement.width, viewport);
  const floating = placement.dock === null;
  const position = floating ? clampFloating(placement.x, placement.y, width, viewport) : null;
  const top = position?.y ?? MARGIN;
  /** A dragged height, or all the room down to the bottom margin. */
  const height =
    placement.height === null
      ? viewport.height - top - MARGIN
      : clampHeight(placement.height, top, viewport);
  const style: Record<string, string> = { width: `${width}px` };
  if (position) {
    style['left'] = `${position.x}px`;
    style['top'] = `${position.y}px`;
  }
  if (placement.height !== null) {
    style['height'] = `${height}px`;
    style['bottom'] = 'auto';
  }

  /** Frame attributes both the onboarding and the full panel share. */
  const frameProps = {
    ref: frame,
    class: 'panel',
    'data-side': embedded ? 'embedded' : (placement.dock ?? 'float'),
    // Absent for the system's: the stylesheet follows prefers-color-scheme then.
    'data-theme': theme === 'system' ? undefined : theme,
    'data-dragging': dragging,
    style: embedded ? {} : style,
  };
  const edge = placement.dock === 'right' ? 'left' : 'right';
  const resize = (size: PanelSize, commit: boolean) => onPlace({ ...placement, ...size }, commit);
  const resizeHandle = embedded ? null : (
    <>
      <ResizeHandle kind="side" edge={edge} width={width} height={height} onResize={resize} />
      <ResizeHandle kind="bottom" edge={edge} width={width} height={height} onResize={resize} />
      {/* The bottom-right corner, where it is the inner one. Docked right,
          that corner is pinned to the window and could not widen anything. */}
      {placement.dock === 'right' ? null : (
        <ResizeHandle kind="corner" edge={edge} width={width} height={height} onResize={resize} />
      )}
    </>
  );
  const edits = data?.edits?.length ?? 0;
  const closeTitle = edits > 0 ? `Close — reverts ${plural(edits, 'change')} (Esc)` : 'Close (Esc)';

  const keysButton = (
    <button
      type="button"
      class="icon-btn"
      aria-pressed={showKeys}
      onClick={() => setShowKeys(!showKeys)}
    >
      <Icon name="help" size={15} />
      <span class="tab-label">Keyboard shortcuts</span>
    </button>
  );

  const confirmBar =
    confirmClose !== null ? (
      <ConfirmClose pending={confirmClose} onConfirm={onClose} onCancel={() => onCancelClose?.()} />
    ) : null;

  if (!data) {
    return (
      <div {...frameProps}>
        {resizeHandle}
        <div class="main">
          <header class="head">
            <div class="head-top">
              <span class="selector">Open Inspector</span>
              <div class="head-actions">
                <InspectButton picking={picking} onToggle={onTogglePicking} />
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  title="Close (Esc)"
                  onClick={onClose}
                >
                  <Icon name="close" />
                </button>
              </div>
            </div>
          </header>
          <div class="body">
            <p class="onboard">Move the pointer over the page.</p>
            <ShortcutList />
            <p class="onboard-note">
              Nothing leaves this tab. Edits are applied to the live page only, and closing the
              inspector puts every one of them back.
            </p>
          </div>
          <Footer />
        </div>
      </div>
    );
  }

  const note = boundaryLabel(data);

  if (collapsed) {
    return (
      <button
        type="button"
        class="panel-tab"
        data-side={side}
        data-theme={theme === 'system' ? undefined : theme}
        title="Show the inspector panel"
        onClick={() => setCollapsed(false)}
      >
        <Icon name={side === 'right' ? 'expand' : 'collapse'} size={12} />
        Inspector
      </button>
    );
  }

  return (
    <div {...frameProps}>
      {resizeHandle}
      <Rail
        tab={tab}
        edits={edits}
        drag={dragHandlers}
        onSelect={(next) => {
          // Re-selecting Styles is how you get back to the Changes list.
          if (next === tab) body.current?.scrollTo?.({ top: 0 });
          lastContentTab.current = next;
          setTab(next);
        }}
      >
        {keysButton}
        {embedded ? null : (
          <button
            type="button"
            class="icon-btn"
            onClick={() =>
              onPlace(
                { ...placement, dock: floating ? side : side === 'right' ? 'left' : 'right' },
                true,
              )
            }
          >
            <Icon name="flip" size={15} />
            <span class="tab-label">
              {floating ? `Dock the panel to the ${side}` : 'Move the panel to the other side'}
            </span>
          </button>
        )}
        {onChangeSettings ? (
          <button
            type="button"
            id="oi-tab-settings"
            class="icon-btn"
            aria-pressed={tab === 'settings'}
            aria-controls="oi-tabpanel"
            onClick={() => setTab(tab === 'settings' ? lastContentTab.current : 'settings')}
          >
            <Icon name="settings" size={15} />
            <span class="tab-label">Settings</span>
          </button>
        ) : null}
      </Rail>

      <div class="main">
        <header class="head">
          <div class="head-top">
            <span class="selector" title={data.selectorLabel}>
              {data.selectorLabel}
            </span>
            {/* Beside the selector, because it describes the element the same
                way — and it is wanted on every tab, not just Styles. */}
            <span class="dims" title="Rendered size on screen">
              {data.dimensions}
            </span>
            <div class="head-actions">
              <InspectButton picking={picking} onToggle={onTogglePicking} compact />
              {embedded ? null : (
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Collapse"
                  title="Collapse to the edge — the page underneath stays inspectable"
                  onClick={() => setCollapsed(true)}
                >
                  <Icon name={side === 'right' ? 'collapse' : 'expand'} />
                </button>
              )}
              <button
                type="button"
                class="icon-btn"
                data-pending={edits > 0}
                aria-label={closeTitle}
                title={closeTitle}
                onClick={onClose}
              >
                <Icon name="close" />
              </button>
            </div>
          </div>
          {confirmBar}
          {showKeys ? <ShortcutList /> : null}
          {note ? <p class="boundary-note">{note}</p> : null}
          {data.tree ? (
            <Breadcrumb
              tree={data.tree}
              onSelectAncestor={onSelectAncestor}
              onStep={onStep}
              structureOpen={data.structure !== undefined}
              onToggleStructure={
                structure ? () => structure.setOpen(data.structure === undefined) : undefined
              }
            />
          ) : null}
          {/* Under the path it expands on, and above every tab, so a row
              clicked here shows its styles directly below. */}
          {data.structure && structure ? (
            <StructureTree
              info={data.structure}
              api={structure}
              onOpenScript={() => {
                lastContentTab.current = 'js';
                setTab('js');
              }}
            />
          ) : null}
          <div class="toolbar">
            <label class="search-box">
              <Icon name="search" size={12} />
              <input
                type="search"
                class="search"
                placeholder="Filter"
                aria-label="Filter properties, values, rules, palette and assets"
                title="Filter properties, values, matched rules, palette and assets"
                value={query}
                spellcheck={false}
                autocomplete="off"
                onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  // Escape closes the inspector everywhere else; here it just
                  // clears the box, which is what every search field does.
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery('');
                }}
              />
            </label>
            <HideButton />
          </div>
          {/* Covering the page is a floating panel's problem, not a tab's. */}
          {embedded ? null : <CoverageHint onCollapse={() => setCollapsed(true)} />}
        </header>

        <SearchContext.Provider value={query}>
        <div
          class="body"
          id="oi-tabpanel"
          role="tabpanel"
          aria-labelledby={`oi-tab-${tab}`}
          ref={body}
          data-searching={query.trim() !== ''}
        >
          {tab === 'styles' ? (
            data.source ? (
              <SourceSection data={data} />
            ) : (
              <>
                <StylesSection data={data} />
                <RulesSection data={data} />
                <PseudoRulesSection data={data} />
              </>
            )
          ) : null}
          {tab === 'color' ? <ColorSection data={data} /> : null}
          {tab === 'type' ? <TypeSection data={data} /> : null}
          {tab === 'layout' ? (
            <>
              {/* Lives with the breakpoints it exists to test, not in the
                  header: it is an occasional control, and a permanent header
                  row cost every tab 30px before any content. */}
              <ViewportGroup />
              <LayoutSection data={data} />
            </>
          ) : null}
          {tab === 'assets' ? <AssetsSection data={data} /> : null}
          {tab === 'markup' ? <MarkupSection data={data} /> : null}
          {tab === 'js' ? <ScriptSection data={data} /> : null}
          {tab === 'export' ? <ExportSection data={data} /> : null}
          {tab === 'svg' ? <SvgPasteSection text={pastedSvg} onText={setPastedSvg} /> : null}
          {tab === 'settings' && onChangeSettings && data.settings ? (
            <SettingsSection
              settings={data.settings}
              saved={settingsSaved}
              onChange={onChangeSettings}
              onSetUpDevtools={onSetUpDevtools}
            />
          ) : null}
        </div>
        </SearchContext.Provider>
        <Footer />
      </div>
    </div>
  );
}
