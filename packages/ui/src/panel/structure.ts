import {
  DEFAULT_STRUCTURE_CHILD_LIMIT,
  MAX_STRUCTURE_VISITS,
  flattenStructure,
  matchesStructureQuery,
  matchingStructure,
  structureChildren,
  structurePath,
  type StructureListing,
  type StructureNode,
} from '@open-inspector/core';
import type { StructureInfo, StructureRowInfo } from './view-model.js';

/**
 * The state behind the structure drawer: what is expanded, how many children
 * each node lists, and which id stands for which node.
 *
 * Lives with the session rather than the panel, like the override store: the
 * panel renders rows and hands ids back, and this is the one place that turns
 * an id into something on the page.
 */
export interface StructureModel {
  readonly open: boolean;
  setOpen(open: boolean): void;
  setExpanded(id: number, expanded: boolean): void;
  /** List another batch of a node's children. */
  showMore(id: number): void;
  /** Expand everything above an element so its row is listed, and count it as a reveal. */
  reveal(element: Element): void;
  /**
   * Open every node, as far as a bounded walk reaches, or close them all
   * back to the document element's children.
   */
  setAllExpanded(expanded: boolean): void;
  /** List only the elements with JavaScript wired to them, flat, in document order. */
  setScriptOnly(on: boolean): void;
  /**
   * List only the elements a search matches, flat, in document order, and
   * with handlers too when the JS filter is on. Empty lists the tree again.
   */
  setQuery(query: string): void;
  /** Forget the JS-only listing, so the next build looks again: the handler read landed. */
  refreshScripts(): void;
  /**
   * The element a row stands for. A shadow-root row stands for its host, which
   * is what there is to highlight or select.
   */
  elementFor(id: number): Element | null;
  /** Rows for the expanded part of the document, with `selected` marked. */
  build(selected: Element | null): StructureInfo;
}

export interface StructureModelOptions {
  /** The inspector's own UI, kept out of the tree. */
  ignore?: (element: Element) => boolean;
  /** How many children a node lists at first, and per "more". */
  childLimit?: number;
  maxRows?: number;
  /** Whether an element has JavaScript wired to it, for the row's JS mark. */
  hasScript?: (element: Element) => boolean;
}

const DOCUMENT_FRAGMENT_NODE = 11;

export function createStructureModel(
  doc: Document,
  options: StructureModelOptions = {},
): StructureModel {
  const batch = options.childLimit ?? DEFAULT_STRUCTURE_CHILD_LIMIT;

  let open = false;
  let revealed = 0;

  /** Weak, so a node the page removes is not kept alive by having been expanded. */
  let expanded = new WeakSet<StructureNode>();
  /** What the expand toggle last did, so it offers the other next. */
  let allExpanded = false;
  let scriptOnly = false;
  let query = '';
  /**
   * The filtered listing (JS only, a search, or both), kept between builds:
   * it walks the whole document, and the panel builds on every repaint.
   * Dropped when either filter changes or the handler read lands.
   */
  let filteredListing: StructureListing | null = null;
  const limits = new WeakMap<StructureNode, number>();

  /**
   * Ids handed to the panel.
   *
   * Stable for a node's lifetime, so Preact keeps each row's DOM — and with it
   * keyboard focus — across repaints. The reverse map only holds what the last
   * build listed: those are the only ids the panel can send back.
   */
  const ids = new WeakMap<StructureNode, number>();
  let nextId = 1;
  const listed = new Map<number, StructureNode>();

  function idFor(node: StructureNode): number {
    let id = ids.get(node);
    if (id === undefined) {
      id = nextId;
      nextId += 1;
      ids.set(node, id);
    }
    return id;
  }

  function limitFor(node: StructureNode): number {
    return limits.get(node) ?? batch;
  }

  // The tree opens at the page's content, as DevTools does.
  expanded.add(doc.documentElement);
  if (doc.body) expanded.add(doc.body);

  return {
    get open() {
      return open;
    },

    setOpen(next) {
      open = next;
    },

    setExpanded(id, next) {
      const node = listed.get(id);
      if (!node) return;
      if (next) expanded.add(node);
      else expanded.delete(node);
    },

    setAllExpanded(next) {
      allExpanded = next;
      expanded = new WeakSet<StructureNode>();
      expanded.add(doc.documentElement);
      if (!next) return;

      // Breadth first, so a page too large to open entirely opens its upper
      // levels — the part a person scans — rather than one deep branch.
      const queue: StructureNode[] = [doc.documentElement];
      let visits = 0;
      while (queue.length > 0 && visits < MAX_STRUCTURE_VISITS) {
        const node = queue.shift();
        if (!node) break;
        visits += 1;
        const children = structureChildren(node, options.ignore);
        if (children.length === 0) continue;
        expanded.add(node);
        queue.push(...children);
      }
    },

    setScriptOnly(next) {
      scriptOnly = next;
      filteredListing = null;
    },

    setQuery(next) {
      const trimmed = next.trim();
      if (trimmed === query) return;
      query = trimmed;
      filteredListing = null;
    },

    refreshScripts() {
      filteredListing = null;
    },

    showMore(id) {
      const node = listed.get(id);
      if (node) limits.set(node, limitFor(node) + batch);
    },

    reveal(element) {
      const path = structurePath(element);

      path.forEach((node, index) => {
        expanded.add(node);

        // A selection past its parent's listing limit would be revealed into a
        // row that is not there; list at least as far as it.
        const child = path[index + 1] ?? element;
        const position = structureChildren(node, options.ignore).indexOf(child);
        if (position >= limitFor(node)) limits.set(node, position + 1);
      });

      revealed += 1;
    },

    elementFor(id) {
      const node = listed.get(id);
      if (!node) return null;
      return node.nodeType === DOCUMENT_FRAGMENT_NODE ? (node as ShadowRoot).host : (node as Element);
    },

    build(selected) {
      listed.clear();

      const hasScript = options.hasScript;
      const scriptsOnly = scriptOnly && hasScript !== undefined;
      const match = (element: Element): boolean =>
        (!scriptsOnly || hasScript(element)) && matchesStructureQuery(element, query);
      const listing =
        scriptsOnly || query
          ? (filteredListing ??= matchingStructure(doc.documentElement, match, {
              ...(options.ignore ? { ignore: options.ignore } : {}),
              ...(options.maxRows !== undefined ? { maxRows: options.maxRows } : {}),
            }))
          : flattenStructure(doc.documentElement, {
              isExpanded: (node) => expanded.has(node),
              childLimit: limitFor,
              ...(options.ignore ? { ignore: options.ignore } : {}),
              ...(options.maxRows !== undefined ? { maxRows: options.maxRows } : {}),
            });

      const rows = listing.rows.map((row): StructureRowInfo => {
        if (row.kind === 'more') {
          return {
            id: idFor(row.parent),
            kind: 'more',
            depth: row.depth,
            label: `${row.hidden} more`,
            expandable: false,
            expanded: false,
            hidden: row.hidden,
          };
        }

        const id = idFor(row.node);
        listed.set(id, row.node);

        const info: StructureRowInfo = {
          id,
          kind: row.kind,
          depth: row.depth,
          label: row.label,
          expandable: row.expandable,
          expanded: row.expanded,
        };
        if (row.kind === 'element' && options.hasScript?.(row.node as Element)) info.js = true;
        if (row.text) info.text = row.text;
        if (row.address) info.address = row.address;
        if (row.file) {
          info.file = row.file.name;
          if (row.file.url) info.fileUrl = row.file.url;
        }
        return info;
      });

      const selectedId = selected ? (ids.get(selected) ?? null) : null;

      return {
        rows,
        selectedId: selectedId !== null && listed.has(selectedId) ? selectedId : null,
        revealed,
        truncated: listing.truncated,
        allExpanded,
        scriptOnly: scriptsOnly,
        query,
        canFilterScripts: hasScript !== undefined,
      };
    },
  };
}
