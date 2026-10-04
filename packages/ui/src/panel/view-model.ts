import type { BoxModel, ProbeBoundary, script } from '@open-inspector/core';
import type { InspectorSettings } from '../settings.js';

/**
 * What the panel renders.
 *
 * Deliberately a plain data contract rather than a pile of engine calls: the
 * panel never touches the DOM itself, so every section can be rendered from a
 * fixture and the engine can be reworked underneath without the UI noticing.
 */

/** A value the user will want to copy. Every row in the panel is one of these. */
export interface Field {
  label: string;
  value: string;
  /** Shown after the value in dimmer text — units, ratios, notes. */
  detail?: string | undefined;
  /** What lands on the clipboard. Defaults to `value`. */
  copy?: string | undefined;
  /** Renders a colour chip before the value. */
  swatch?: string | undefined;
  /**
   * Where a colour picked from the swatch is written, when that is not
   * `property` itself — a `border` row shows the shorthand but its colour
   * belongs to `border-color`.
   */
  swatchProperty?: string | undefined;
  /**
   * The CSS property this row shows.
   *
   * Present only on rows that map to exactly one declaration — those are the
   * rows that can be edited. A row showing a derived value (a ratio, a
   * dimension read off the box) has no single property to write back to, so it
   * stays read-only rather than pretending otherwise.
   */
  property?: string | undefined;
}

/**
 * Where the selected element sits in the document.
 *
 * Hit-testing can only reach what is visually on top, so a wrapper with no
 * padding of its own is unreachable by mouse — there is no pixel that belongs
 * to it and not to a child. The breadcrumb is how those elements get selected
 * at all.
 */
export interface TreeInfo {
  /** Ancestors, outermost first, ready to render left to right. */
  trail: Array<{ label: string; depth: number }>;
  childCount: number;
  siblingIndex: number;
  siblingCount: number;
  canParent: boolean;
  canChild: boolean;
  canPrevious: boolean;
  canNext: boolean;
}

/**
 * One row of the structure drawer.
 *
 * Rows carry ids, not elements, for the same reason the rest of this file
 * carries strings: the panel renders data and hands ids back, and the session
 * is the only side that turns an id into something on the page.
 */
export interface StructureRowInfo {
  /** Stable across repaints. A "more" row carries the id of the parent it belongs to. */
  id: number;
  kind: 'element' | 'shadow-root' | 'more';
  depth: number;
  label: string;
  /** A childless element's text, shortened. */
  text?: string | undefined;
  /** A frame's address. */
  address?: string | undefined;
  /** The file a script, linked resource or style block came from, or `inline`. */
  file?: string | undefined;
  /** The full URL behind `file`, when there is one. */
  fileUrl?: string | undefined;
  /** Has JavaScript wired to it: an event handler of any kind found. */
  js?: boolean | undefined;
  expandable: boolean;
  expanded: boolean;
  /** "more" rows: how many children are not listed yet. */
  hidden?: number | undefined;
}

/** The document as an expandable tree. Present only while the drawer is open. */
export interface StructureInfo {
  rows: StructureRowInfo[];
  /** The element the panel is showing, when its row is listed. */
  selectedId: number | null;
  /**
   * Counts reveals: selections made on purpose, which expanded the tree down
   * to the selected row. The drawer scrolls to that row when this changes and
   * at no other time, so sweeping the pointer over the page leaves it alone.
   */
  revealed: number;
  /** The row ceiling cut the listing short. */
  truncated: boolean;
  /** The expand toggle's state: true after "expand all", so it offers to collapse. */
  allExpanded: boolean;
  /** Listing only the elements with JavaScript wired to them, flat. */
  scriptOnly: boolean;
  /** What the tree's search holds. While it holds anything the rows are its matches, flat. */
  query: string;
  /** Whether the JS-only filter can be offered at all. */
  canFilterScripts: boolean;
}

/**
 * Forceable pseudo-states for the selected element.
 *
 * `available` is what the page actually styles. Offering a :hover toggle on a
 * page with no hover rules produces a control that visibly does nothing, which
 * reads as a broken tool rather than as a page without hover styles.
 */
export interface PseudoStateInfo {
  all: string[];
  available: string[];
  active: string[];
  unreadableSheets: number;
}

/** One live edit, as the panel displays it. */
export interface EditEntry {
  selector: string;
  /** Short human description of the element, e.g. `<button> "Get started"`. */
  element: string;
  property: string;
  /** What it is now. */
  value: string;
  /** What it was before the edit; empty when the property was unset. */
  previous: string;
  /** True when this edit is on the element currently being inspected. */
  onCurrentElement: boolean;
}

export interface ColorEntry {
  hex: string;
  hexa?: string | undefined;
  rgb: string;
  hsl?: string | undefined;
  oklch?: string | undefined;
  /** Where the colour is used: text, background, border, shadow, gradient. */
  role: string;
  /** How many elements use it, when this came from a page-wide scan. */
  usage?: number | undefined;
  /** How many near-identical colours were merged into this one. */
  merged?: number | undefined;
  /** The declaration this came from, when there is exactly one. Makes it editable. */
  property?: string | undefined;
}

export interface TypeInfo {
  /** The authored stack, in order. */
  stack: string[];
  /** The family the browser actually rendered, when determinable. */
  rendered: string | null;
  /** How `rendered` was established, so the UI can be honest about it. */
  method: string;
  size: string;
  sizeRem?: string | undefined;
  weight: string;
  style: string;
  lineHeight: string;
  lineHeightRatio?: string | undefined;
  letterSpacing: string;
  transform: string;
  decoration?: string | undefined;
  align?: string | undefined;
}

export interface ContrastInfo {
  kind: 'measured' | 'indeterminate';
  ratio?: string | undefined;
  foreground?: string | undefined;
  background?: string | undefined;
  aa?: boolean | undefined;
  aaa?: boolean | undefined;
  largeText?: boolean | undefined;
  /** Why the background could not be resolved. */
  reason?: string | undefined;
  /** A nearby colour that would pass AA. */
  suggestion?: string | undefined;
}

export interface LayoutInfo {
  /** How this element lays out its own children. */
  display: string;
  /** Human summary, e.g. "3 columns from repeat(auto-fit, minmax(240px, 1fr))". */
  summary?: string | undefined;
  fields: Field[];
  /** How the parent positions this element. */
  parent?: {
    display: string;
    fields: Field[];
  };
}

/** One value on a scale, as the scale's ladder draws it. */
export interface ScaleValue {
  /** e.g. "16px" */
  value: string;
  px: number;
  count: number;
  /** False for a value that breaks the scale: an outlier, marked in place. */
  onScale: boolean;
  /**
   * Custom property names for this size: the page's own variables that come
   * to it, or failing those, the name the Export tab writes for it.
   */
  variables: string[];
  variablesFrom: 'page' | 'export';
}

export interface ScaleInfo {
  kind: 'detected' | 'none';
  /** e.g. "8px" or "1.25" */
  base?: string | undefined;
  /** A spacing scale's base in px, which the ladder's ruler ticks off. */
  step?: number | undefined;
  /** 0-100 */
  conformance?: number | undefined;
  /** The most-used values, smallest first. */
  values?: ScaleValue[];
}

export interface BreakpointInfo {
  condition: string;
  px?: number | undefined;
  active: boolean;
  /** Properties this breakpoint changes for the selected element. */
  changes?: string[] | undefined;
}

export interface RuleInfo {
  selector: string;
  source: string;
  specificity: string;
  declarations: Array<{
    property: string;
    value: string;
    important?: boolean | undefined;
    winning: boolean;
  }>;
}

export interface AssetEntry {
  kind: string;
  url: string;
  name: string;
  /** Natural dimensions where known, e.g. "1200 × 630". */
  dimensions?: string | undefined;
  /** Byte length, only knowable for data: URIs. */
  bytes?: number | undefined;
  usage?: number | undefined;
  /**
   * Something an `<img>` can render, when a thumbnail is possible.
   *
   * A filename alone is not identification — a list of twelve `icon.svg`
   * entries tells you nothing about which one you want. For URL assets this is
   * the same URL the page already loaded, so the browser answers from cache;
   * for inline SVG it is the markup encoded as a data URI, which needs no
   * network at all.
   */
  preview?: string | undefined;
  /** Why there is no preview, so the slot can say so instead of sitting blank. */
  noPreview?: string | undefined;
}

/** The code behind an element that does not render: a style, a script, head metadata. */
export interface SourceInfo {
  /** For the heading: `CSS`, `JavaScript`, `JSON`, `HTML`. */
  language: string;
  text: string;
  /** Where the text came from, or why there is none. */
  note?: string | undefined;
  truncated: boolean;
}

/** Everything about the element currently under inspection. */
export interface PanelData {
  selectorLabel: string;
  tagName: string;
  dimensions: string;
  boundary: ProbeBoundary | null;
  box: BoxModel;

  colors: ColorEntry[];
  typography: TypeInfo;
  contrast: ContrastInfo | null;
  layout: LayoutInfo;
  spacing: Field[];
  appearance: Field[];
  rules: RuleInfo[];
  /**
   * Stylesheets whose rules could not be read.
   *
   * Cross-origin CSS throws on `.cssRules`, and no extension permission
   * changes that — the restriction follows the stylesheet's CORS headers, not
   * the reader. Stripe serves all six of its sheets this way, so an empty
   * rule list there means "could not read", not "nothing matches". Saying the
   * wrong one of those is the difference between a limitation and a bug.
   */
  unreadableSheets: number;
  /** Rules targeting ::before, ::after and friends, grouped by pseudo-element. */
  pseudoRules?: Array<{ pseudo: string; rules: RuleInfo[] }> | undefined;

  /** Ancestor chain and stepping affordances for the selected element. */
  tree?: TreeInfo | undefined;
  /**
   * The `<svg>` the selection is, or is drawn in, as markup that stands on its
   * own — for the SVG view in Markup.
   */
  svgSource?: string | undefined;
  /** Event handlers on the element, inline and page-attached, for the JS view. */
  handlers?: script.ScriptHandler[] | undefined;
  /**
   * How far the handler read reached: `page` when the page's own world was
   * read too, `inline` when only attributes could be.
   */
  handlersRead?: 'page' | 'inline' | undefined;
  /** Present only for elements that do not render; the Styles tab shows it instead of a box. */
  source?: SourceInfo | undefined;
  /**
   * The preferences in force. Values the collector builds already follow
   * them; colour entries carry every notation and the panel picks from them.
   */
  settings?: InspectorSettings | undefined;
  /** The structure drawer's rows. Absent while the drawer is closed. */
  structure?: StructureInfo | undefined;
  /** Forceable pseudo-states, and which are on. */
  pseudoStates?: PseudoStateInfo | undefined;
  /** The element serialized back to source. */
  markup?: { html: string; jsx: string } | undefined;

  /** Live edits across the whole session, for the Changes list. */
  edits?: EditEntry[] | undefined;
  /** The edits as a paste-ready stylesheet. */
  editsCss?: string | undefined;
  /** The edits written as an instruction for a coding assistant. */
  editsPrompt?: string | undefined;

  /** Page-wide findings. Computed lazily — these walk the whole document. */
  page?: PageData | undefined;

  /** Ready-to-copy token exports, one per format. */
  exports?: ExportFormat[] | undefined;
}

export interface ExportFormat {
  id: string;
  label: string;
  text: string;
}

/** Findings that describe the page rather than the element. */
export interface PageData {
  palette: ColorEntry[];
  fonts: Array<{ family: string; usage: number; source?: string }>;
  typeScale: ScaleInfo;
  spacingScale: ScaleInfo;
  breakpoints: BreakpointInfo[];
  assets: AssetEntry[];
  /** The page's `<script>` elements, for the JS view. */
  scripts: script.PageScript[];
  /** True when a walk hit its element budget and stopped early. */
  truncated: boolean;
  /** Token exports built from these findings. */
  exports?: ExportFormat[] | undefined;
}

export type PanelTab =
  | 'styles'
  | 'color'
  | 'type'
  | 'layout'
  | 'assets'
  | 'markup'
  | 'js'
  | 'export'
  | 'svg'
  | 'settings';

export const PANEL_TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'styles', label: 'Styles' },
  { id: 'color', label: 'Color' },
  { id: 'type', label: 'Type' },
  { id: 'layout', label: 'Layout' },
  { id: 'assets', label: 'Assets' },
  { id: 'markup', label: 'Markup' },
  { id: 'js', label: 'JS' },
  { id: 'export', label: 'Export' },
  { id: 'svg', label: 'SVG' },
];
