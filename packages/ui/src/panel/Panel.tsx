import { useState } from 'preact/hooks';
import { PANEL_TABS, type PanelData, type PanelTab, type TreeInfo } from './view-model.js';
import { SearchContext } from './search.jsx';
import { useEditing } from './editing.jsx';
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
        Buy me a coffee
      </a>
    </footer>
  );
}

/**
 * The one control the panel always shows.
 *
 * Kept as a filled primary button in both states, and always labelled
 * "Inspect", because the first question anyone asks of a new panel is which
 * thing to click. A control that renames itself between states answers that
 * question differently each time; this one just reports whether it is on.
 */
function InspectButton({ picking, onToggle }: { picking: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      class="primary-btn"
      aria-pressed={picking}
      title={
        picking
          ? 'Picking elements. The page cannot be clicked. Press to stop and use the page normally.'
          : 'Not picking — the page works normally. Press to choose another element.'
      }
      onClick={onToggle}
    >
      Inspect
      <span class="state">{picking ? 'on' : 'off'}</span>
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
 */
function Breadcrumb({
  tree,
  dimensions,
  onSelectAncestor,
  onStep,
}: {
  tree: TreeInfo;
  /** Shown beside the step arrows: it describes the element, like the trail does. */
  dimensions: string;
  onSelectAncestor: (depth: number) => void;
  onStep: PanelProps['onStep'];
}) {
  return (
    <div class="crumbs">
      <nav class="crumb-trail" aria-label="Ancestors">
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

      <div class="crumb-steps">
        <button
          type="button"
          class="step"
          disabled={!tree.canParent}
          title="Parent (↑)"
          onClick={() => onStep('parent')}
        >
          ↑
        </button>
        <button
          type="button"
          class="step"
          disabled={!tree.canChild}
          title={`First of ${tree.childCount} children (↓)`}
          onClick={() => onStep('child')}
        >
          ↓
        </button>
        <button
          type="button"
          class="step"
          disabled={!tree.canPrevious}
          title="Previous sibling (←)"
          onClick={() => onStep('previous')}
        >
          ←
        </button>
        <button
          type="button"
          class="step"
          disabled={!tree.canNext}
          title="Next sibling (→)"
          onClick={() => onStep('next')}
        >
          →
        </button>
        <span class="crumb-count" title="Position among siblings · child count">
          {tree.siblingIndex}/{tree.siblingCount}
          {tree.childCount > 0 ? ` · ${tree.childCount} in` : ''}
        </span>
        <span class="dims" title="Rendered size on screen">
          {dimensions}
        </span>
      </div>
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
      <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
        <path
          d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
        />
        <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4" />
        {editing.hidden ? (
          <path d="M3 17 17 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        ) : null}
      </svg>
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
        ? 'iframe — inspecting inside frames arrives in M5'
        : 'cross-origin iframe — the browser will not let any extension read this';
    case 'opaque-custom-element':
      return 'probably a closed shadow root — nothing can read inside it';
    case 'canvas':
      return 'canvas — pixels, no DOM to inspect';
  }
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
}: PanelProps) {
  const [tab, setTab] = useState<PanelTab>('styles');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  if (!data) {
    return (
      <div class="panel" data-side={side}>
        <header class="head">
          <div class="head-top">
            <span class="selector">Open Inspector</span>
            <div class="head-actions">
              <InspectButton picking={picking} onToggle={onTogglePicking} />
              <button type="button" class="icon-btn" title="Close (Esc)" onClick={onClose}>
                ✕
              </button>
            </div>
          </div>
        </header>
        <div class="body">
          <p class="onboard">Move the pointer over the page.</p>
          <ul class="onboard-keys">
            <li>
              <b>hover</b> to inspect
            </li>
            <li>
              <b>click</b> to choose it and give the page back
            </li>
            <li>
              <b>Esc</b> to stop picking, again to close
            </li>
          </ul>
        </div>
        <Footer />
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
        Inspector
      </button>
    );
  }

  return (
    <div class="panel" data-side={side}>
      <header class="head">
        <div class="head-top">
          <span class="selector" title={data.selectorLabel}>
            {data.selectorLabel}
          </span>
          <div class="head-actions">
            <InspectButton picking={picking} onToggle={onTogglePicking} />
            <button
              type="button"
              class="icon-btn"
              title="Move the panel to the other side"
              onClick={onFlip}
            >
              {side === 'right' ? '←' : '→'}
            </button>
            <button
              type="button"
              class="icon-btn"
              title="Collapse to the edge — the page underneath stays inspectable"
              onClick={() => setCollapsed(true)}
            >
              {side === 'right' ? '›' : '‹'}
            </button>
            <button type="button" class="icon-btn" title="Close (Esc)" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        {note ? <p class="boundary-note">{note}</p> : null}
        {data.tree ? (
          <Breadcrumb
            tree={data.tree}
            dimensions={data.dimensions}
            onSelectAncestor={onSelectAncestor}
            onStep={onStep}
          />
        ) : null}
        <div class="toolbar">
          <input
            type="search"
            class="search"
            placeholder="Filter…"
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
          <HideButton />
        </div>
        <div class="toolbar toolbar-page">
          <span class="toolbar-label">viewport</span>
          <ViewportControl />
        </div>
        <CoverageHint onCollapse={() => setCollapsed(true)} />
      </header>

      <nav class="tabs" role="tablist">
        {PANEL_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            class="tab"
            aria-selected={entry.id === tab}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <SearchContext.Provider value={query}>
      <div class="body" role="tabpanel" data-searching={query.trim() !== ''}>
        {tab === 'styles' ? (
          <>
            <StylesSection data={data} />
            <RulesSection data={data} />
            <PseudoRulesSection data={data} />
          </>
        ) : null}
        {tab === 'color' ? <ColorSection data={data} /> : null}
        {tab === 'type' ? <TypeSection data={data} /> : null}
        {tab === 'layout' ? <LayoutSection data={data} /> : null}
        {tab === 'assets' ? <AssetsSection data={data} /> : null}
        {tab === 'markup' ? <MarkupSection data={data} /> : null}
        {tab === 'export' ? <ExportSection data={data} /> : null}
      </div>
      </SearchContext.Provider>
      <Footer />
    </div>
  );
}
