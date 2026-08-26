/**
 * Container anatomy: how an element lays out its children, and how its parent
 * lays out the element.
 *
 * Both halves are needed to explain a layout. "This is a grid with three
 * columns" is only half the story when the element itself is a flex item that
 * refuses to shrink — which is where the bug usually is. The analysis is pure
 * and works on a {@link LayoutStyleSnapshot} taken from computed styles, so
 * every branch is testable without a layout engine; {@link readContainerAnatomy}
 * is the thin DOM-reading wrapper on top.
 */

import { parsePx, round } from '../geometry/rect.js';
import { buildSelectorLabel } from '../probe/describe.js';
import { countTracks, parseTrackList, type TrackList } from './authored-intent.js';

/**
 * The computed properties the layout analysis reads, as plain strings.
 *
 * Taken as one snapshot rather than passed around as a live
 * `CSSStyleDeclaration` for two reasons: reading a computed style can force
 * layout, and a snapshot is something a test can build by hand.
 */
export interface LayoutStyleSnapshot {
  display: string;
  position: string;
  float: string;
  clear: string;
  writingMode: string;
  overflowX: string;
  overflowY: string;

  gridTemplateColumns: string;
  gridTemplateRows: string;
  gridTemplateAreas: string;
  gridAutoColumns: string;
  gridAutoRows: string;
  gridAutoFlow: string;

  columnGap: string;
  rowGap: string;

  justifyContent: string;
  alignContent: string;
  justifyItems: string;
  alignItems: string;

  flexDirection: string;
  flexWrap: string;

  gridColumnStart: string;
  gridColumnEnd: string;
  gridRowStart: string;
  gridRowEnd: string;
  justifySelf: string;
  alignSelf: string;
  flexGrow: string;
  flexShrink: string;
  flexBasis: string;
  order: string;
  minWidth: string;
  minHeight: string;

  top: string;
  right: string;
  bottom: string;
  left: string;
  zIndex: string;

  transform: string;
  filter: string;
  backdropFilter: string;
  perspective: string;
  willChange: string;
  contain: string;

  containerType: string;
  containerName: string;
}

const INITIAL_SNAPSHOT: LayoutStyleSnapshot = {
  display: 'inline',
  position: 'static',
  float: 'none',
  clear: 'none',
  writingMode: 'horizontal-tb',
  overflowX: 'visible',
  overflowY: 'visible',

  gridTemplateColumns: 'none',
  gridTemplateRows: 'none',
  gridTemplateAreas: 'none',
  gridAutoColumns: 'auto',
  gridAutoRows: 'auto',
  gridAutoFlow: 'row',

  columnGap: 'normal',
  rowGap: 'normal',

  justifyContent: 'normal',
  alignContent: 'normal',
  justifyItems: 'legacy',
  alignItems: 'normal',

  flexDirection: 'row',
  flexWrap: 'nowrap',

  gridColumnStart: 'auto',
  gridColumnEnd: 'auto',
  gridRowStart: 'auto',
  gridRowEnd: 'auto',
  justifySelf: 'auto',
  alignSelf: 'auto',
  flexGrow: '0',
  flexShrink: '1',
  flexBasis: 'auto',
  order: '0',
  minWidth: 'auto',
  minHeight: 'auto',

  top: 'auto',
  right: 'auto',
  bottom: 'auto',
  left: 'auto',
  zIndex: 'auto',

  transform: 'none',
  filter: 'none',
  backdropFilter: 'none',
  perspective: 'none',
  willChange: 'auto',
  contain: 'none',

  containerType: 'normal',
  containerName: 'none',
};

/**
 * A snapshot filled with CSS initial values, overridden as given.
 *
 * Exists so callers and tests can express "a grid container with a 16px gap"
 * in three lines instead of forty. The defaults are the CSS initial values, not
 * a browser's usual output — `display` starts as `inline`, so anything that
 * cares must say so.
 */
export function createLayoutSnapshot(
  overrides: Partial<LayoutStyleSnapshot> = {},
): LayoutStyleSnapshot {
  return { ...INITIAL_SNAPSHOT, ...overrides };
}

function text(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * Copy the layout-relevant properties off a computed style declaration.
 *
 * Every read is defended with the CSS initial value: partial style objects are
 * normal in tests, and non-browser DOM implementations return `undefined` for
 * properties they have never heard of (`containerType` especially). A missing
 * property must not become the string "undefined" in a UI label.
 */
export function snapshotLayoutStyle(style: CSSStyleDeclaration): LayoutStyleSnapshot {
  const initial = INITIAL_SNAPSHOT;
  return {
    display: text(style.display, initial.display),
    position: text(style.position, initial.position),
    float: text(style.float, initial.float),
    clear: text(style.clear, initial.clear),
    writingMode: text(style.writingMode, initial.writingMode),
    overflowX: text(style.overflowX, initial.overflowX),
    overflowY: text(style.overflowY, initial.overflowY),

    gridTemplateColumns: text(style.gridTemplateColumns, initial.gridTemplateColumns),
    gridTemplateRows: text(style.gridTemplateRows, initial.gridTemplateRows),
    gridTemplateAreas: text(style.gridTemplateAreas, initial.gridTemplateAreas),
    gridAutoColumns: text(style.gridAutoColumns, initial.gridAutoColumns),
    gridAutoRows: text(style.gridAutoRows, initial.gridAutoRows),
    gridAutoFlow: text(style.gridAutoFlow, initial.gridAutoFlow),

    columnGap: text(style.columnGap, initial.columnGap),
    rowGap: text(style.rowGap, initial.rowGap),

    justifyContent: text(style.justifyContent, initial.justifyContent),
    alignContent: text(style.alignContent, initial.alignContent),
    justifyItems: text(style.justifyItems, initial.justifyItems),
    alignItems: text(style.alignItems, initial.alignItems),

    flexDirection: text(style.flexDirection, initial.flexDirection),
    flexWrap: text(style.flexWrap, initial.flexWrap),

    gridColumnStart: text(style.gridColumnStart, initial.gridColumnStart),
    gridColumnEnd: text(style.gridColumnEnd, initial.gridColumnEnd),
    gridRowStart: text(style.gridRowStart, initial.gridRowStart),
    gridRowEnd: text(style.gridRowEnd, initial.gridRowEnd),
    justifySelf: text(style.justifySelf, initial.justifySelf),
    alignSelf: text(style.alignSelf, initial.alignSelf),
    flexGrow: text(style.flexGrow, initial.flexGrow),
    flexShrink: text(style.flexShrink, initial.flexShrink),
    flexBasis: text(style.flexBasis, initial.flexBasis),
    order: text(style.order, initial.order),
    minWidth: text(style.minWidth, initial.minWidth),
    minHeight: text(style.minHeight, initial.minHeight),

    top: text(style.top, initial.top),
    right: text(style.right, initial.right),
    bottom: text(style.bottom, initial.bottom),
    left: text(style.left, initial.left),
    zIndex: text(style.zIndex, initial.zIndex),

    transform: text(style.transform, initial.transform),
    filter: text(style.filter, initial.filter),
    backdropFilter: text(style.backdropFilter, initial.backdropFilter),
    perspective: text(style.perspective, initial.perspective),
    willChange: text(style.willChange, initial.willChange),
    contain: text(style.contain, initial.contain),

    containerType: text(style.containerType, initial.containerType),
    containerName: text(style.containerName, initial.containerName),
  };
}

/** `display` split into the two boxes it actually controls. */
export interface DisplayClass {
  raw: string;
  /** How the element participates in its parent's formatting context. */
  outer: 'block' | 'inline' | 'none' | 'contents' | 'other';
  /** The formatting context the element establishes for its children. */
  inner: 'flow' | 'flow-root' | 'flex' | 'grid' | 'table' | 'ruby' | 'none' | 'contents' | 'other';
  listItem: boolean;
}

/**
 * Split a `display` value into outer and inner display types.
 *
 * Browsers still report the legacy single keywords (`inline-flex`), but the
 * two-value syntax (`inline flex`, `block flow-root`) is computed output in
 * newer engines, so both spellings have to resolve to the same answer. Treating
 * `display` as one opaque string is why so many inspectors get `inline-grid`
 * wrong.
 */
export function classifyDisplay(display: string): DisplayClass {
  const raw = display.trim();
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const listItem = tokens.includes('list-item');

  if (tokens.includes('none')) return { raw, outer: 'none', inner: 'none', listItem: false };
  if (tokens.includes('contents')) {
    return { raw, outer: 'contents', inner: 'contents', listItem };
  }

  let outer: DisplayClass['outer'] = 'block';
  let inner: DisplayClass['inner'] = 'flow';

  for (const token of tokens) {
    switch (token) {
      case 'inline':
        outer = 'inline';
        break;
      case 'block':
        outer = 'block';
        break;
      case 'inline-block':
        outer = 'inline';
        inner = 'flow-root';
        break;
      case 'flex':
        inner = 'flex';
        break;
      case 'inline-flex':
        outer = 'inline';
        inner = 'flex';
        break;
      case 'grid':
        inner = 'grid';
        break;
      case 'inline-grid':
        outer = 'inline';
        inner = 'grid';
        break;
      case 'flow':
        inner = 'flow';
        break;
      case 'flow-root':
        inner = 'flow-root';
        break;
      case 'table':
      case 'inline-table':
      case 'table-row':
      case 'table-row-group':
      case 'table-header-group':
      case 'table-footer-group':
      case 'table-cell':
      case 'table-column':
      case 'table-column-group':
      case 'table-caption':
        inner = 'table';
        if (token === 'inline-table') outer = 'inline';
        break;
      case 'ruby':
      case 'ruby-base':
      case 'ruby-text':
        inner = 'ruby';
        outer = 'inline';
        break;
      case 'list-item':
        break;
      default:
        inner = 'other';
        break;
    }
  }

  return { raw, outer, inner, listItem };
}

/** Whether implicit tracks are being generated, when that can be told at all. */
export type ImplicitTrackVerdict =
  | { kind: 'none' }
  | {
      kind: 'likely';
      axis: 'row' | 'column';
      /** The `grid-auto-rows` / `grid-auto-columns` value sizing them. */
      sizing: string;
      /** How many extra tracks the child count implies. An estimate; see the docs. */
      estimatedCount: number;
    }
  | { kind: 'unknown'; reason: string };

/** What {@link estimateImplicitTracks} needs to guess. */
export interface ImplicitTrackInput {
  explicitColumns: number | null;
  explicitRows: number | null;
  autoFlow: string;
  autoColumns: string;
  autoRows: string;
  childCount: number | null;
}

/**
 * Guess whether items are spilling into implicit tracks.
 *
 * Computed `grid-template-*` only ever reports the *explicit* grid, so the rows
 * a developer sees on screen are frequently absent from the value they are
 * reading — the single most confusing thing about inspecting grid. This
 * reconstructs the missing half from the child count and the flow direction.
 *
 * It is an estimate and named accordingly: spans, explicitly placed items and
 * `display: none` children all shift the real answer, and none of them are
 * visible from computed values. When the inputs cannot support even a guess the
 * verdict is `unknown` rather than a confident zero.
 */
export function estimateImplicitTracks(input: ImplicitTrackInput): ImplicitTrackVerdict {
  const { childCount } = input;
  if (childCount === null) return { kind: 'unknown', reason: 'child count was not supplied' };
  if (childCount === 0) return { kind: 'none' };

  const flowsByColumn = input.autoFlow.toLowerCase().includes('column');
  const alongFlow = flowsByColumn ? input.explicitRows : input.explicitColumns;
  const acrossFlow = flowsByColumn ? input.explicitColumns : input.explicitRows;

  if (alongFlow === null || alongFlow < 1) {
    return {
      kind: 'unknown',
      reason: flowsByColumn
        ? 'no explicit rows to flow into, so the implicit column count depends on placement'
        : 'no explicit columns to flow into, so the implicit row count depends on placement',
    };
  }

  const needed = Math.ceil(childCount / alongFlow);
  const existing = acrossFlow ?? 0;
  if (needed <= existing) return { kind: 'none' };

  return {
    kind: 'likely',
    axis: flowsByColumn ? 'column' : 'row',
    sizing: flowsByColumn ? input.autoColumns : input.autoRows,
    estimatedCount: needed - existing,
  };
}

/** Everything about how a grid container arranges its children. */
export interface GridContainerInfo {
  /** Used track sizes as layout resolved them, e.g. `300px 300px 300px`. */
  templateColumns: string;
  templateRows: string;
  columns: TrackList;
  rows: TrackList;
  explicitColumnCount: number | null;
  explicitRowCount: number | null;
  /** Rows of `grid-template-areas`, or null when none are named. */
  areas: string[][] | null;
  autoFlow: string;
  /** `dense` packing fills holes, so visual order stops matching DOM order. */
  dense: boolean;
  autoColumns: string;
  autoRows: string;
  implicitTracks: ImplicitTrackVerdict;
  columnGap: number;
  rowGap: number;
  justifyItems: string;
  alignItems: string;
  justifyContent: string;
  alignContent: string;
}

/** Everything about how a flex container arranges its children. */
export interface FlexContainerInfo {
  direction: string;
  reversed: boolean;
  /** Screen orientation of the main axis, resolved against `writing-mode`. */
  mainAxis: 'horizontal' | 'vertical';
  wrap: string;
  wraps: boolean;
  justifyContent: string;
  alignItems: string;
  alignContent: string;
  columnGap: number;
  rowGap: number;
}

/** How an element arranges its own children. */
export interface ChildLayout {
  kind: 'grid' | 'flex' | 'table' | 'flow' | 'not-rendered' | 'box-less' | 'other';
  display: string;
  summary: string;
  /** Traps worth surfacing, e.g. dense packing reordering items visually. */
  notes: string[];
  grid?: GridContainerInfo;
  flex?: FlexContainerInfo;
}

/** How a grid item is placed in its parent's grid. */
export interface GridItemInfo {
  /** `grid-column` as `start / end`, or `auto`. */
  column: string;
  row: string;
  /** The named area, when the item was placed with one. */
  area: string | null;
  columnSpan: number | null;
  rowSpan: number | null;
  /** `auto` when both axes are auto-placed, `explicit` when neither is. */
  placement: 'auto' | 'explicit' | 'mixed';
  justifySelf: string;
  alignSelf: string;
}

/** How a flex item behaves in its parent's flex line. */
export interface FlexItemInfo {
  grow: number;
  shrink: number;
  basis: string;
  order: number;
  /** `align-self` as authored; `auto` means "inherit the container's align-items". */
  alignSelf: string;
  /** What `align-self: auto` actually resolves to for this item. */
  effectiveAlign: string;
  /** Plain-language reading of grow/shrink/basis, the trio nobody remembers. */
  behaviour: string;
}

/** Where a positioned element's offsets resolve against. */
export type ContainingBlock =
  | {
      kind: 'element';
      /** Selector label of the ancestor, e.g. `div#page.layout`. */
      label: string;
      /** The property that made it the containing block, e.g. `position: relative`. */
      reason: string;
    }
  | { kind: 'viewport'; reason: string }
  | { kind: 'initial-containing-block'; reason: string }
  | { kind: 'indeterminate'; reason: string };

/** Position, offsets, and what those offsets are measured from. */
export interface PositionedInfo {
  position: string;
  offsets: { top: string; right: string; bottom: string; left: string };
  /** Sides that are not `auto` — the ones actually constraining the element. */
  constrainedSides: Array<'top' | 'right' | 'bottom' | 'left'>;
  zIndex: string;
  containingBlock: ContainingBlock;
}

/** A float, and whether anything is honouring it. */
export interface FloatInfo {
  side: string;
  clear: string;
  /** Floats are ignored on flex/grid items and on absolutely positioned boxes. */
  ignored: boolean;
  reason: string | null;
}

/** How this element's parent places it. */
export interface ItemPlacement {
  kind:
    | 'root'
    | 'grid-item'
    | 'flex-item'
    | 'out-of-flow'
    | 'floated'
    | 'in-flow'
    | 'not-rendered'
    | 'indeterminate';
  /** The layout parent's `display`, or null at the root. */
  parentDisplay: string | null;
  summary: string;
  notes: string[];
  grid?: GridItemInfo;
  flex?: FlexItemInfo;
  positioned?: PositionedInfo;
  float?: FloatInfo;
}

/** Container-query participation, when the element opts in. */
export interface ContainerQueryInfo {
  /** `inline-size` or `size`. */
  type: string;
  name: string | null;
  /** Size containment means descendants can no longer size this element. */
  sizeContained: boolean;
}

/** The full answer for one element. */
export interface ContainerAnatomy {
  display: DisplayClass;
  childLayout: ChildLayout;
  placement: ItemPlacement;
  containerQuery: ContainerQueryInfo | null;
  /** One line for a panel header, e.g. `grid container (3 × 2, 16px gap) · flex item`. */
  summary: string;
}

/** Input to the pure analysis. The DOM wrapper assembles this. */
export interface ContainerInput {
  self: LayoutStyleSnapshot;
  /**
   * The *layout* parent: the nearest ancestor that generates a box. Skipping
   * `display: contents` ancestors matters — they are not the parent the flex or
   * grid algorithm sees.
   */
  parent: LayoutStyleSnapshot | null;
  /** Element children, used to estimate implicit tracks. Null when not counted. */
  childCount?: number | null;
  /** Resolved by the DOM wrapper; only meaningful for positioned elements. */
  containingBlock?: ContainingBlock;
}

function gapOf(value: string): number {
  // `normal` is the initial value for both gaps; in grid and flex it means 0.
  return value.toLowerCase() === 'normal' ? 0 : round(parsePx(value));
}

function formatGap(columnGap: number, rowGap: number): string {
  return columnGap === rowGap ? `${columnGap}px gap` : `${rowGap}px/${columnGap}px gap`;
}

/** Parse `grid-template-areas` into a grid of area names. */
export function parseGridAreas(value: string): string[][] | null {
  if (value.trim().toLowerCase() === 'none' || value.trim() === '') return null;
  const rows = value.match(/"[^"]*"/g);
  if (!rows) return null;
  const parsed = rows.map((row) => row.slice(1, -1).trim().split(/\s+/).filter(Boolean));
  return parsed.length > 0 ? parsed : null;
}

function readGridContainer(self: LayoutStyleSnapshot, childCount: number | null): GridContainerInfo {
  const columns = parseTrackList(self.gridTemplateColumns);
  const rows = parseTrackList(self.gridTemplateRows);
  const explicitColumnCount = countTracks(columns);
  const explicitRowCount = countTracks(rows);

  return {
    templateColumns: self.gridTemplateColumns,
    templateRows: self.gridTemplateRows,
    columns,
    rows,
    explicitColumnCount,
    explicitRowCount,
    areas: parseGridAreas(self.gridTemplateAreas),
    autoFlow: self.gridAutoFlow,
    dense: self.gridAutoFlow.toLowerCase().includes('dense'),
    autoColumns: self.gridAutoColumns,
    autoRows: self.gridAutoRows,
    implicitTracks: estimateImplicitTracks({
      explicitColumns: explicitColumnCount,
      explicitRows: explicitRowCount,
      autoFlow: self.gridAutoFlow,
      autoColumns: self.gridAutoColumns,
      autoRows: self.gridAutoRows,
      childCount,
    }),
    columnGap: gapOf(self.columnGap),
    rowGap: gapOf(self.rowGap),
    justifyItems: self.justifyItems,
    alignItems: self.alignItems,
    justifyContent: self.justifyContent,
    alignContent: self.alignContent,
  };
}

function readFlexContainer(self: LayoutStyleSnapshot): FlexContainerInfo {
  const direction = self.flexDirection.toLowerCase();
  const isColumn = direction.startsWith('column');
  const verticalWritingMode = self.writingMode.toLowerCase().startsWith('vertical');
  // In a vertical writing mode the inline axis runs top-to-bottom, so `row`
  // flex items stack vertically. Reporting "horizontal" there would be wrong.
  const mainAxis: 'horizontal' | 'vertical' =
    isColumn === verticalWritingMode ? 'horizontal' : 'vertical';

  return {
    direction: self.flexDirection,
    reversed: direction.endsWith('-reverse'),
    mainAxis,
    wrap: self.flexWrap,
    wraps: self.flexWrap.toLowerCase() !== 'nowrap',
    justifyContent: self.justifyContent,
    alignItems: self.alignItems,
    alignContent: self.alignContent,
    columnGap: gapOf(self.columnGap),
    rowGap: gapOf(self.rowGap),
  };
}

function describeGridContainer(grid: GridContainerInfo): string {
  const columns = grid.explicitColumnCount ?? 0;
  const rows = grid.explicitRowCount ?? 0;
  const shape = columns > 0 || rows > 0 ? `${columns} × ${rows} explicit tracks` : 'no explicit tracks';
  return `grid container (${shape}, ${formatGap(grid.columnGap, grid.rowGap)})`;
}

function describeFlexContainer(flex: FlexContainerInfo): string {
  const wrap = flex.wraps ? ', wrapping' : '';
  return `flex container (${flex.direction}, ${flex.mainAxis} main axis${wrap}, ${formatGap(
    flex.columnGap,
    flex.rowGap,
  )})`;
}

function analyzeChildLayout(self: LayoutStyleSnapshot, childCount: number | null): ChildLayout {
  const display = classifyDisplay(self.display);
  const notes: string[] = [];

  if (display.outer === 'none') {
    return {
      kind: 'not-rendered',
      display: display.raw,
      summary: 'display: none — this element generates no box at all',
      notes,
    };
  }

  if (display.outer === 'contents') {
    return {
      kind: 'box-less',
      display: display.raw,
      summary: 'display: contents — the element generates no box; its children are laid out by its parent',
      notes: ['most browsers remove `display: contents` elements from the accessibility tree'],
    };
  }

  if (display.inner === 'grid') {
    const grid = readGridContainer(self, childCount);
    if (grid.dense) {
      notes.push('dense auto-flow can place items out of DOM order, which screen readers and tab order do not follow');
    }
    if (grid.implicitTracks.kind === 'likely') {
      notes.push(
        `about ${grid.implicitTracks.estimatedCount} implicit ${grid.implicitTracks.axis} track(s) sized by ${grid.implicitTracks.sizing} — these never appear in grid-template-${grid.implicitTracks.axis}s`,
      );
    }
    return { kind: 'grid', display: display.raw, summary: describeGridContainer(grid), notes, grid };
  }

  if (display.inner === 'flex') {
    const flex = readFlexContainer(self);
    if (!flex.wraps) {
      notes.push('flex-wrap: nowrap — items are forced onto one line and will shrink past their content width');
    }
    return { kind: 'flex', display: display.raw, summary: describeFlexContainer(flex), notes, flex };
  }

  if (display.inner === 'table') {
    return {
      kind: 'table',
      display: display.raw,
      summary: `table layout (${display.raw})`,
      notes,
    };
  }

  if (display.inner === 'flow' || display.inner === 'flow-root') {
    const establishesBfc = display.inner === 'flow-root' || display.outer === 'inline';
    return {
      kind: 'flow',
      display: display.raw,
      summary: establishesBfc
        ? `normal flow (${display.raw}) — establishes its own block formatting context, so child margins do not collapse through it`
        : `normal flow (${display.raw}) — children stack in block direction`,
      notes,
    };
  }

  return { kind: 'other', display: display.raw, summary: `display: ${display.raw}`, notes };
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function spanOf(start: string, end: string): number | null {
  const spanMatch = /^span\s+(\d+)$/i.exec(end.trim()) ?? /^span\s+(\d+)$/i.exec(start.trim());
  if (spanMatch?.[1] !== undefined) return Number.parseInt(spanMatch[1], 10);

  const from = Number.parseInt(start, 10);
  const to = Number.parseInt(end, 10);
  if (Number.isFinite(from) && Number.isFinite(to)) return Math.abs(to - from);
  return null;
}

function lineText(start: string, end: string): string {
  if (start === 'auto' && end === 'auto') return 'auto';
  return `${start} / ${end}`;
}

function readGridItem(self: LayoutStyleSnapshot): GridItemInfo {
  const columnAuto = self.gridColumnStart === 'auto' && self.gridColumnEnd === 'auto';
  const rowAuto = self.gridRowStart === 'auto' && self.gridRowEnd === 'auto';

  // A named area shows up as the same custom identifier in all four line
  // properties. `auto` also passes an identifier test, hence the explicit
  // exclusion — an auto-placed item has no area.
  const identifier = self.gridRowStart;
  const named =
    identifier !== 'auto' &&
    /^[a-z_][\w-]*$/i.test(identifier) &&
    identifier === self.gridColumnStart &&
    identifier === self.gridRowEnd &&
    identifier === self.gridColumnEnd
      ? identifier
      : null;

  return {
    column: lineText(self.gridColumnStart, self.gridColumnEnd),
    row: lineText(self.gridRowStart, self.gridRowEnd),
    area: named,
    columnSpan: columnAuto ? null : spanOf(self.gridColumnStart, self.gridColumnEnd),
    rowSpan: rowAuto ? null : spanOf(self.gridRowStart, self.gridRowEnd),
    placement: columnAuto && rowAuto ? 'auto' : columnAuto || rowAuto ? 'mixed' : 'explicit',
    justifySelf: self.justifySelf,
    alignSelf: self.alignSelf,
  };
}

/**
 * Turn `flex-grow` / `flex-shrink` / `flex-basis` into a sentence.
 *
 * These three are the least-remembered numbers in CSS, and the shorthand hides
 * the trap: `flex: 1` sets `flex-basis: 0%`, so the item's own width is thrown
 * away entirely and only the grow ratio decides its size.
 */
export function describeFlexItem(grow: number, shrink: number, basis: string): string {
  const parts: string[] = [];
  parts.push(grow > 0 ? `grows to absorb free space (${grow})` : 'does not grow');
  parts.push(shrink > 0 ? `shrinks when space runs short (${shrink})` : 'refuses to shrink');

  const normalized = basis.trim().toLowerCase();
  if (normalized === 'auto') {
    parts.push('starts from its own width/content');
  } else if (normalized === '0' || normalized === '0px' || normalized === '0%') {
    parts.push('starts from zero, so its size comes entirely from the grow ratio');
  } else {
    parts.push(`starts from ${basis}`);
  }

  return parts.join(', ');
}

function readFlexItem(self: LayoutStyleSnapshot, parent: LayoutStyleSnapshot): FlexItemInfo {
  const grow = toNumber(self.flexGrow, 0);
  const shrink = toNumber(self.flexShrink, 1);
  const alignSelf = self.alignSelf;

  return {
    grow,
    shrink,
    basis: self.flexBasis,
    order: toNumber(self.order, 0),
    alignSelf,
    effectiveAlign: alignSelf.toLowerCase() === 'auto' ? parent.alignItems : alignSelf,
    behaviour: describeFlexItem(grow, shrink, self.flexBasis),
  };
}

function readPositioned(
  self: LayoutStyleSnapshot,
  containingBlock: ContainingBlock,
): PositionedInfo {
  const offsets = { top: self.top, right: self.right, bottom: self.bottom, left: self.left };
  const constrainedSides = (['top', 'right', 'bottom', 'left'] as const).filter(
    (side) => offsets[side].toLowerCase() !== 'auto',
  );

  return {
    position: self.position,
    offsets,
    constrainedSides: [...constrainedSides],
    zIndex: self.zIndex,
    containingBlock,
  };
}

function describeOffsets(info: PositionedInfo): string {
  if (info.constrainedSides.length === 0) return 'no offsets set, so it sits at its static position';
  return info.constrainedSides.map((side) => `${side}: ${info.offsets[side]}`).join(', ');
}

function describeContainingBlock(block: ContainingBlock): string {
  switch (block.kind) {
    case 'element':
      return `offsets resolve against ${block.label} (${block.reason})`;
    case 'viewport':
      return 'offsets resolve against the viewport';
    case 'initial-containing-block':
      return 'offsets resolve against the initial containing block (no positioned ancestor)';
    case 'indeterminate':
      return `containing block could not be determined: ${block.reason}`;
  }
}

const INDETERMINATE_BLOCK: ContainingBlock = {
  kind: 'indeterminate',
  reason: 'ancestor styles were not supplied',
};

function analyzePlacement(input: ContainerInput): ItemPlacement {
  const { self, parent } = input;
  const containingBlock = input.containingBlock ?? INDETERMINATE_BLOCK;
  const display = classifyDisplay(self.display);
  const position = self.position.toLowerCase();
  const notes: string[] = [];
  const parentDisplay = parent ? parent.display : null;
  const parentInner = parent ? classifyDisplay(parent.display).inner : null;
  const isFlexOrGridItem = parentInner === 'flex' || parentInner === 'grid';

  if (display.outer === 'none') {
    return {
      kind: 'not-rendered',
      parentDisplay,
      summary: 'display: none — not laid out by anything',
      notes,
    };
  }

  if (position === 'absolute' || position === 'fixed') {
    const positioned = readPositioned(self, containingBlock);
    if (isFlexOrGridItem) {
      notes.push(
        `out-of-flow, so the ${parentInner} algorithm does not size or place it — the ${parentInner} container only supplies its static position`,
      );
    }
    if (self.float.toLowerCase() !== 'none') {
      notes.push('float is ignored on absolutely positioned boxes');
    }
    const placement: ItemPlacement = {
      kind: 'out-of-flow',
      parentDisplay,
      summary: `position: ${self.position} — ${describeOffsets(positioned)}; ${describeContainingBlock(
        containingBlock,
      )}`,
      notes,
      positioned,
    };
    return parentInner === 'grid' ? { ...placement, grid: readGridItem(self) } : placement;
  }

  const positioned =
    position === 'relative' || position === 'sticky' ? readPositioned(self, containingBlock) : null;

  if (parent === null) {
    return {
      kind: 'root',
      parentDisplay: null,
      summary: 'root element — laid out against the initial containing block',
      notes,
      ...(positioned ? { positioned } : {}),
    };
  }

  if (parentInner === 'contents' || parentInner === 'other') {
    return {
      kind: 'indeterminate',
      parentDisplay,
      summary: `parent uses display: ${parentDisplay ?? 'unknown'}, so the real layout parent is further up the tree`,
      notes,
      ...(positioned ? { positioned } : {}),
    };
  }

  if (isFlexOrGridItem) {
    const kind = parentInner === 'grid' ? 'grid-item' : 'flex-item';
    if (self.float.toLowerCase() !== 'none') {
      notes.push(`float is ignored on ${kind}s`);
    }

    if (parentInner === 'flex') {
      const flex = readFlexItem(self, parent);
      const mainIsHorizontal = !parent.flexDirection.toLowerCase().startsWith('column');
      const minAlongMain = mainIsHorizontal ? self.minWidth : self.minHeight;
      if (flex.shrink > 0 && minAlongMain.toLowerCase() === 'auto') {
        notes.push(
          `min-${mainIsHorizontal ? 'width' : 'height'} is auto, so this item will not shrink below its content — the usual cause of a flex line overflowing`,
        );
      }
      if (flex.order !== 0) {
        notes.push('order changes visual position only; DOM order, tab order and reading order are unchanged');
      }
      return {
        kind,
        parentDisplay,
        summary: `flex item — ${flex.behaviour}${flex.order !== 0 ? `, order ${flex.order}` : ''}`,
        notes,
        flex,
        ...(positioned ? { positioned } : {}),
      };
    }

    const grid = readGridItem(self);
    const where =
      grid.placement === 'auto'
        ? 'auto-placed by the grid'
        : `placed at column ${grid.column}, row ${grid.row}`;
    return {
      kind,
      parentDisplay,
      summary: `grid item — ${where}`,
      notes,
      grid,
      ...(positioned ? { positioned } : {}),
    };
  }

  if (self.float.toLowerCase() !== 'none') {
    const float: FloatInfo = { side: self.float, clear: self.clear, ignored: false, reason: null };
    return {
      kind: 'floated',
      parentDisplay,
      summary: `float: ${self.float} — taken out of normal flow; following inline content wraps around it`,
      notes,
      float,
      ...(positioned ? { positioned } : {}),
    };
  }

  const flowSummary =
    display.outer === 'inline'
      ? "inline-level box in its parent's inline formatting context"
      : 'block-level box in normal flow';

  if (position === 'sticky' && positioned) {
    return {
      kind: 'in-flow',
      parentDisplay,
      summary: `position: sticky — ${describeOffsets(positioned)}; sticks within its parent while that parent is on screen`,
      notes: [
        ...notes,
        'sticky has no effect unless an ancestor scrolls and the parent is taller than the sticky element',
      ],
      positioned,
    };
  }

  return {
    kind: 'in-flow',
    parentDisplay,
    summary: flowSummary,
    notes,
    ...(positioned ? { positioned } : {}),
  };
}

function readContainerQuery(self: LayoutStyleSnapshot): ContainerQueryInfo | null {
  const type = self.containerType.toLowerCase();
  const name = self.containerName.toLowerCase() === 'none' ? null : self.containerName;
  if (type === 'normal' && name === null) return null;

  return {
    type: self.containerType,
    name,
    sizeContained: type.includes('size'),
  };
}

/**
 * Explain one element's layout from both sides.
 *
 * Pure: everything it needs arrives in {@link ContainerInput}. Callers that
 * cannot supply a piece (an ancestor chain, a child count) leave it out and get
 * an explicit `unknown` back rather than a plausible-looking default.
 */
export function analyzeContainer(input: ContainerInput): ContainerAnatomy {
  const display = classifyDisplay(input.self.display);
  const childLayout = analyzeChildLayout(input.self, input.childCount ?? null);
  const placement = analyzePlacement(input);
  const containerQuery = readContainerQuery(input.self);

  const summaryParts = [childLayout.summary, placement.summary];
  if (containerQuery) {
    summaryParts.push(
      `query container (container-type: ${containerQuery.type}${
        containerQuery.name ? `, name: ${containerQuery.name}` : ''
      })`,
    );
  }

  return {
    display,
    childLayout,
    placement,
    containerQuery,
    summary: summaryParts.join(' · '),
  };
}

/** Selector label for an element, reusing the probe's truncation rules. */
function labelFor(element: Element): string {
  return buildSelectorLabel(
    element.tagName.toLowerCase(),
    element.id ? element.id : null,
    Array.from(element.classList),
  );
}

/**
 * Why this snapshot would become a containing block for positioned descendants.
 *
 * The `position: relative` rule is common knowledge; the rest of this list is
 * the reason `position: fixed` elements mysteriously stop being fixed. A
 * transform, filter, backdrop-filter, `will-change` on any of those, paint or
 * layout containment, or a container-query container all capture fixed
 * descendants too. Returns the property that did it, so the UI can name it.
 */
export function containingBlockReason(
  snapshot: LayoutStyleSnapshot,
  mode: 'absolute' | 'fixed',
): string | null {
  const position = snapshot.position.toLowerCase();
  if (mode === 'absolute' && position !== 'static') return `position: ${snapshot.position}`;

  if (snapshot.transform.toLowerCase() !== 'none') return `transform: ${snapshot.transform}`;
  if (snapshot.perspective.toLowerCase() !== 'none') return `perspective: ${snapshot.perspective}`;
  if (snapshot.filter.toLowerCase() !== 'none') return `filter: ${snapshot.filter}`;
  if (snapshot.backdropFilter.toLowerCase() !== 'none') {
    return `backdrop-filter: ${snapshot.backdropFilter}`;
  }

  const willChange = snapshot.willChange.toLowerCase();
  if (/\b(transform|perspective|filter)\b/.test(willChange)) {
    return `will-change: ${snapshot.willChange}`;
  }

  const contain = snapshot.contain.toLowerCase();
  if (/\b(paint|layout|strict|content)\b/.test(contain)) return `contain: ${snapshot.contain}`;

  if (snapshot.containerType.toLowerCase() !== 'normal') {
    return `container-type: ${snapshot.containerType}`;
  }

  return null;
}

/**
 * The nearest ancestor that generates a box.
 *
 * `display: contents` ancestors are skipped: they produce no box, so they are
 * not the parent that the flex or grid algorithm sees. Reporting them would
 * make a grid item look like a child of a plain `<div>`.
 */
export function findLayoutParent(element: Element, view: Window = window): Element | null {
  let current = element.parentElement;
  while (current) {
    const display = view.getComputedStyle(current).display;
    if (classifyDisplay(text(display, 'block')).outer !== 'contents') return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Walk up to find what a positioned element's offsets resolve against.
 *
 * Returns an explicit `indeterminate` when the element is not positioned at
 * all, because "the viewport" would be a confident wrong answer for a static
 * element.
 */
export function resolveContainingBlock(
  element: Element,
  position: string,
  view: Window = window,
): ContainingBlock {
  const mode = position.toLowerCase();
  if (mode !== 'absolute' && mode !== 'fixed') {
    return { kind: 'indeterminate', reason: `position: ${position} is not offset from a containing block` };
  }

  let current = element.parentElement;
  while (current) {
    const snapshot = snapshotLayoutStyle(view.getComputedStyle(current));
    const reason = containingBlockReason(snapshot, mode);
    if (reason !== null) return { kind: 'element', label: labelFor(current), reason };
    current = current.parentElement;
  }

  return mode === 'fixed'
    ? { kind: 'viewport', reason: 'no ancestor creates a containing block for fixed elements' }
    : {
        kind: 'initial-containing-block',
        reason: 'no positioned ancestor',
      };
}

/**
 * Read an element's container anatomy from the live DOM.
 *
 * The thin measurement layer: three `getComputedStyle` reads plus an ancestor
 * walk when the element is positioned. `childElementCount` includes
 * `display: none` children, which is why the implicit-track figure it feeds is
 * reported as an estimate.
 */
export function readContainerAnatomy(element: Element, view: Window = window): ContainerAnatomy {
  const self = snapshotLayoutStyle(view.getComputedStyle(element));
  const parentElement = findLayoutParent(element, view);
  const parent = parentElement ? snapshotLayoutStyle(view.getComputedStyle(parentElement)) : null;

  return analyzeContainer({
    self,
    parent,
    childCount: element.childElementCount,
    containingBlock: resolveContainingBlock(element, self.position, view),
  });
}
