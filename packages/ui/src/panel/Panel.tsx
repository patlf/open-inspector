import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { PANEL_TABS, type PanelData, type PanelTab, type TreeInfo } from './view-model.js';
import { SearchContext } from './search.jsx';
import { useEditing } from './editing.jsx';
import { Group } from './primitives.jsx';
import { Icon, TAB_ICONS } from './icons.jsx';
import {
  AssetsSection,
  MarkupSection,
  ColorSection,
  ExportSection,
  LayoutSection,
  PseudoRulesSection,
  RulesSection,
  StylesSection,
  TypeSection,
} from './sections.jsx';

export interface PanelProps {
  data: PanelData | null;
  /** Select an ancestor by its distance from the current element. */
  onSelectAncestor: (depth: number) => void;
  /** Step to the parent, first child, or a sibling. */
  onStep: (direction: 'parent' | 'child' | 'previous' | 'next') => void;
  /** True when the panel is frozen on one element. */
  pinned: boolean;
  /** True while the picker is armed and the page is being captured. */
  picking: boolean;
  onTogglePicking: () => void;
  onClose: () => void;
  /** Which edge the panel is docked to. */
  side: 'left' | 'right';
  onFlip: () => void;
  /** Closing would revert this many edits and is waiting to be confirmed; null when not asking. */
  confirmClose?: number | null;
  onCancelClose?: () => void;
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
}: {
  tree: TreeInfo;
  onSelectAncestor: (depth: number) => void;
  onStep: PanelProps['onStep'];
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

/** Narrowest width the rows still lay out in; widest before it stops being a side panel. */
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 348;

/**
 * Remembered for as long as the page is open, and no longer.
 *
 * Persisting it would mean either the page's own localStorage — writing to
 * storage we do not own — or the `storage` permission, which the manifest
 * does not have and the egress guard would reject. A width that survives
 * closing and reopening the panel on the same page covers the actual need.
 */
let rememberedWidth = DEFAULT_WIDTH;

function clampWidth(width: number, view: Window | null): number {
  const room = (view?.innerWidth ?? MAX_WIDTH + 48) - 48;
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, MAX_WIDTH, room)));
}

/**
 * The inner edge, as a handle.
 *
 * A fixed 348px panel regularly sat on top of the very element being read,
 * and flipping sides only helps if the other side is empty. Dragging the edge
 * (or arrow keys while it has focus) trades panel width for page.
 */
function ResizeHandle({
  side,
  width,
  onResize,
}: {
  side: 'left' | 'right';
  width: number;
  onResize: (width: number) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);

  function widthAt(clientX: number): number {
    const view = handle.current?.ownerDocument.defaultView ?? null;
    const edge = side === 'right' ? (view?.innerWidth ?? 0) - clientX - 12 : clientX - 12;
    return clampWidth(edge, view);
  }

  return (
    <div
      ref={handle}
      class="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        event.preventDefault();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        target.dataset['dragging'] = 'true';
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onResize(widthAt(event.clientX));
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        delete event.currentTarget.dataset['dragging'];
      }}
      onDblClick={() => onResize(DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        // Growing means moving the inner edge away from the panel's own side.
        const grows = (event.key === 'ArrowLeft') === (side === 'right');
        const step = event.shiftKey ? 48 : 16;
        const view = handle.current?.ownerDocument.defaultView ?? null;
        onResize(clampWidth(width + (grows ? step : -step), view));
      }}
    />
  );
}

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
  children,
}: {
  tab: PanelTab;
  /** Pending edits, counted on the Styles tab where the Changes list lives. */
  edits: number;
  onSelect: (tab: PanelTab) => void;
  /** Controls pinned to the foot of the rail. */
  children?: ComponentChildren;
}) {
  const strip = useRef<HTMLElement>(null);

  function move(event: KeyboardEvent): void {
    const index = PANEL_TABS.findIndex((entry) => entry.id === tab);
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
    <aside class="rail">
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
            tabIndex={entry.id === tab ? 0 : -1}
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
  side,
  onFlip,
  onSelectAncestor,
  onStep,
  confirmClose = null,
  onCancelClose,
}: PanelProps) {
  const [tab, setTab] = useState<PanelTab>('styles');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [width, setWidthState] = useState(rememberedWidth);
  const body = useRef<HTMLDivElement>(null);

  const setWidth = (next: number) => {
    rememberedWidth = next;
    setWidthState(next);
  };

  const style = { width: `${width}px` };
  const edits = data?.edits?.length ?? 0;
  const closeTitle = edits > 0 ? `Close — reverts ${plural(edits, 'change')} (Esc)` : 'Close (Esc)';

  const keysButton = (
    <button
      type="button"
      class="icon-btn"
      aria-pressed={showKeys}
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts"
      onClick={() => setShowKeys(!showKeys)}
    >
      <Icon name="help" size={15} />
    </button>
  );

  const confirmBar =
    confirmClose !== null ? (
      <ConfirmClose pending={confirmClose} onConfirm={onClose} onCancel={() => onCancelClose?.()} />
    ) : null;

  if (!data) {
    return (
      <div class="panel" data-side={side} style={style}>
        <ResizeHandle side={side} width={width} onResize={setWidth} />
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
        title="Show the inspector panel"
        onClick={() => setCollapsed(false)}
      >
        <Icon name={side === 'right' ? 'expand' : 'collapse'} size={12} />
        Inspector
      </button>
    );
  }

  return (
    <div class="panel" data-side={side} style={style}>
      <ResizeHandle side={side} width={width} onResize={setWidth} />
      <Rail
        tab={tab}
        edits={edits}
        onSelect={(next) => {
          // Re-selecting Styles is how you get back to the Changes list.
          if (next === tab) body.current?.scrollTo?.({ top: 0 });
          setTab(next);
        }}
      >
        {keysButton}
        <button
          type="button"
          class="icon-btn"
          aria-label="Move the panel to the other side"
          title="Move the panel to the other side"
          onClick={onFlip}
        >
          <Icon name="flip" size={15} />
        </button>
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
              <button
                type="button"
                class="icon-btn"
                aria-label="Collapse"
                title="Collapse to the edge — the page underneath stays inspectable"
                onClick={() => setCollapsed(true)}
              >
                <Icon name={side === 'right' ? 'collapse' : 'expand'} />
              </button>
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
            <Breadcrumb tree={data.tree} onSelectAncestor={onSelectAncestor} onStep={onStep} />
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
          <CoverageHint onCollapse={() => setCollapsed(true)} />
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
            <>
              <StylesSection data={data} />
              <RulesSection data={data} />
              <PseudoRulesSection data={data} />
            </>
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
          {tab === 'export' ? <ExportSection data={data} /> : null}
        </div>
        </SearchContext.Provider>
        <Footer />
      </div>
    </div>
  );
}
