import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import type { StructureInfo, StructureRowInfo } from './view-model.js';

/**
 * What the structure drawer can ask of the session.
 *
 * Ids only, never elements: the session resolves them, so the drawer renders
 * from data like every other part of the panel and can be driven by fixtures.
 */
export interface StructureApi {
  setOpen(open: boolean): void;
  setExpanded(id: number, expanded: boolean): void;
  showMore(id: number): void;
  /** Highlight a row's element on the page without selecting it; null clears. */
  preview(id: number | null): void;
  /** Make a row's element the selection. */
  select(id: number): void;
  /** Open every node, or close them all. */
  setAllExpanded(expanded: boolean): void;
  /** List only the elements with JavaScript wired to them. */
  setScriptOnly(on: boolean): void;
  /** List only the elements a search matches; empty lists the tree again. */
  setQuery(query: string): void;
}

/** Pixels per level. Narrow, because the drawer shares the panel's 348px. */
const INDENT = 12;

/** A "more" row shares its parent's id, so keys tell the two apart. */
function rowKey(row: StructureRowInfo): string {
  return row.kind === 'more' ? `more:${row.id}` : String(row.id);
}

/** `div#hero.card+2` → the tag, and everything after it. */
function splitLabel(label: string): [string, string] {
  const match = /^([^#.+]+)(.*)$/.exec(label);
  return match ? [match[1] ?? label, match[2] ?? ''] : [label, ''];
}

/** Scroll a row into the drawer's view, centring it when it was out of sight. */
function keepVisible(list: HTMLElement, row: HTMLElement, center: boolean): void {
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight) return;

  list.scrollTop = center
    ? top - (list.clientHeight - row.offsetHeight) / 2
    : top < list.scrollTop
      ? top
      : bottom - list.clientHeight;
}

/**
 * The document as an expandable tree.
 *
 * Follows the WAI-ARIA tree pattern with one tab stop: arrows move between
 * rows, right and left open and close them, Enter selects. Hovering or
 * focusing a row highlights its element on the page; only a click or Enter
 * selects it, so you can look around without losing your place.
 */
export function StructureTree({
  info,
  api,
  onOpenScript,
}: {
  info: StructureInfo;
  api: StructureApi;
  /** Show the JS tab, for a click on a row's JS badge or a double-click on the row. */
  onOpenScript?: (() => void) | undefined;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /**
   * The row a keyboard move must carry DOM focus to.
   *
   * A ref rather than read from render: effects run after paint, so two quick
   * presses can leave the first render's effect running last, and a key
   * captured in its closure would put focus back on the row before.
   */
  const focusTarget = useRef<string | null>(null);

  const search = useRef<HTMLInputElement>(null);
  /**
   * What the search field shows. Kept here rather than read back from the
   * session, so a keystroke never waits on a repaint to appear in the field.
   */
  const [text, setText] = useState(info.query);
  const [searching, setSearching] = useState(info.query !== '');
  /** Move focus into the field, or back to the tree, once the next render lands. */
  const focusNext = useRef<'search' | 'tree' | null>(null);
  /**
   * A step from the field into the results, held until the rows are the
   * results for what the field says: typing outruns the session's repaint,
   * and the rows a quick Enter would see are the ones before the last key.
   */
  const pendingStep = useRef<'focus' | 'select' | null>(null);

  const { rows } = info;
  const filtering = info.scriptOnly || info.query !== '';
  const selectedKey = info.selectedId !== null ? String(info.selectedId) : null;
  const firstKey = rows[0] ? rowKey(rows[0]) : null;
  const activeKey =
    focusKey !== null && rows.some((row) => rowKey(row) === focusKey)
      ? focusKey
      : (selectedKey ?? firstKey);

  // Scroll to the selection when it was revealed on purpose, and only then:
  // the panel repaints on every pointer move, and the tree must not chase it.
  useEffect(() => {
    const container = list.current;
    const row = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (container && row) keepVisible(container, row, true);
  }, [info.revealed]);

  useEffect(() => {
    const key = focusTarget.current;
    if (key === null) return;
    focusTarget.current = null;
    const container = list.current;
    const row = container?.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!container || !row) return;
    row.focus({ preventScroll: true });
    keepVisible(container, row, false);
  });

  useEffect(() => {
    const next = focusNext.current;
    if (next === null) return;
    focusNext.current = null;
    if (next === 'search') {
      const field = search.current;
      field?.focus();
      // At the end, after the character that opened it.
      field?.setSelectionRange(field.value.length, field.value.length);
    } else {
      list.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    const step = pendingStep.current;
    if (step === null || info.query !== text.trim()) return;
    pendingStep.current = null;
    enterResults(step);
  });

  /** Into the results: focus the first, and with Enter choose it, as a find-as-you-type list does. */
  function enterResults(step: 'focus' | 'select'): void {
    const first = rows[0];
    if (step === 'select' && first && first.kind !== 'more') api.select(first.id);
    focusRow(0);
  }

  function updateSearch(next: string): void {
    setText(next);
    api.setQuery(next);
  }

  function openSearch(initial: string): void {
    setSearching(true);
    updateSearch(initial);
    focusNext.current = 'search';
  }

  /** Empty the search, put the whole tree back, and return to it. */
  function closeSearch(): void {
    setSearching(false);
    if (text) updateSearch('');
    focusNext.current = 'tree';
  }

  function onSearchKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      closeSearch();
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      const step = event.key === 'Enter' ? 'select' : 'focus';
      if (info.query === text.trim()) enterResults(step);
      else pendingStep.current = step;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function focusRow(index: number): void {
    const row = rows[index];
    if (!row) return;
    const key = rowKey(row);
    setFocusKey(key);
    focusTarget.current = key;
    api.preview(row.kind === 'more' ? null : row.id);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const index = rows.findIndex((row) => rowKey(row) === activeKey);
    const row = rows[index];

    switch (event.key) {
      case 'ArrowDown':
        focusRow(index + 1);
        break;
      case 'ArrowUp':
        focusRow(index - 1);
        break;
      case 'Home':
        focusRow(0);
        break;
      case 'End':
        focusRow(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row?.expandable && !row.expanded) api.setExpanded(row.id, true);
        else if (row?.expanded) focusRow(index + 1);
        break;
      case 'ArrowLeft': {
        if (row?.expanded) {
          api.setExpanded(row.id, false);
          break;
        }
        // Up to the parent: the nearest row above that sits one level out.
        const depth = row?.depth ?? 0;
        for (let above = index - 1; above >= 0; above -= 1) {
          if ((rows[above]?.depth ?? 0) < depth) {
            focusRow(above);
            break;
          }
        }
        break;
      }
      case 'Enter':
      case ' ':
        if (row?.kind === 'more') api.showMore(row.id);
        else if (row) api.select(row.id);
        break;
      case 'Escape':
        // A search is the first thing Escape unwinds; after that it is the session's.
        if (!searching && !text) return;
        closeSearch();
        break;
      default:
        // A character typed into the tree starts a search with it, the way a
        // file list does. Shortcuts with a modifier are left alone.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          openSearch(text + event.key);
          break;
        }
        // Everything else belongs to the session.
        return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <>
      <div class="structure-bar">
        {filtering ? null : (
          <button
            type="button"
            class="icon-btn"
            onClick={() => api.setAllExpanded(!info.allExpanded)}
          >
            <Icon name={info.allExpanded ? 'collapseAll' : 'expandAll'} size={14} />
            <span class="tab-label">{info.allExpanded ? 'Collapse all' : 'Expand all'}</span>
          </button>
        )}
        {info.canFilterScripts ? (
          <button
            type="button"
            class="js-toggle"
            aria-pressed={info.scriptOnly}
            onClick={() => api.setScriptOnly(!info.scriptOnly)}
          >
            <Icon name="js" size={16} />
            <span class="tab-label">Only elements with JS</span>
          </button>
        ) : null}
        {searching || text ? (
          <label class="search-box">
            <Icon name="search" size={12} />
            <input
              ref={search}
              type="search"
              class="tree-search"
              placeholder="Find in tree"
              aria-label="Find elements by tag, id, class or text"
              aria-controls="oi-structure"
              value={text}
              spellcheck={false}
              autocomplete="off"
              onInput={(event) => updateSearch((event.target as HTMLInputElement).value)}
              onKeyDown={onSearchKeyDown}
              onBlur={() => {
                if (!text) setSearching(false);
              }}
            />
          </label>
        ) : (
          <button type="button" class="icon-btn" onClick={() => openSearch('')}>
            <Icon name="search" size={14} />
            <span class="tab-label">Find in tree</span>
          </button>
        )}
        {filtering ? (
          <span class="structure-count">
            {rows.length}
            {info.truncated ? '+' : ''}{' '}
            {info.query ? (rows.length === 1 ? 'match' : 'matches') : 'with handlers'}
          </span>
        ) : null}
      </div>
      <div
        ref={list}
        id="oi-structure"
        class="structure"
        role="tree"
        aria-label="Document structure"
        data-owns-escape={searching || text ? '' : undefined}
        onKeyDown={onKeyDown}
        onPointerLeave={() => api.preview(null)}
        onFocusOut={(event) => {
          // Leaving the tree, not moving between its rows.
          const next = event.relatedTarget as Node | null;
          if (!next || !list.current?.contains(next)) api.preview(null);
        }}
      >
        {rows.map((row) => {
          const key = rowKey(row);
          const indent = { paddingLeft: `${row.depth * INDENT + 4}px` };

          if (row.kind === 'more') {
            return (
              <div
                key={key}
                data-key={key}
                data-kind="more"
                class="node"
                role="treeitem"
                aria-level={row.depth + 1}
                tabIndex={key === activeKey ? 0 : -1}
                style={indent}
                title="List more of these children"
                onPointerEnter={() => api.preview(null)}
                onClick={() => {
                  setFocusKey(key);
                  api.showMore(row.id);
                }}
              >
                <span class="node-twisty" aria-hidden="true" />
                <span class="node-more">{row.label}…</span>
              </div>
            );
          }

          const [tag, rest] = splitLabel(row.label);

          return (
            <div
              key={key}
              data-key={key}
              data-kind={row.kind}
              class="node"
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={row.expandable ? row.expanded : undefined}
              aria-selected={row.id === info.selectedId}
              tabIndex={key === activeKey ? 0 : -1}
              style={indent}
              onPointerEnter={() => api.preview(row.id)}
              onClick={() => {
                setFocusKey(key);
                api.select(row.id);
              }}
              onDblClick={() => {
                if (row.expandable) api.setExpanded(row.id, !row.expanded);
                // The first click already selected it, so the tab opens on its handlers.
                if (row.js) onOpenScript?.();
              }}
            >
              <span
                class="node-twisty"
                aria-hidden="true"
                data-open={row.expanded}
                onClick={(event) => {
                  // Opening a branch is not choosing it.
                  event.stopPropagation();
                  if (row.expandable) api.setExpanded(row.id, !row.expanded);
                }}
              >
                {row.expandable ? <Icon name="caret" size={10} /> : null}
              </span>
              <span class="node-tag">{tag}</span>
              {rest ? <span class="node-attrs">{rest}</span> : null}
              {row.js ? (
                // A click on the badge opens the JS tab; the row's own click,
                // which it bubbles on to, selects the element it opens on.
                <span
                  class="node-js"
                  title="Has event handlers: click to see them in the JS tab"
                  onClick={() => onOpenScript?.()}
                >
                  <Icon name="js" size={12} />
                  <span class="sr-only">, has event handlers</span>
                </span>
              ) : null}
              {row.text ? <span class="node-text">{row.text}</span> : null}
              {row.address ? <span class="node-address">{row.address}</span> : null}
              {row.file ? (
                <span class="node-file" data-inline={row.fileUrl === undefined} title={row.fileUrl}>
                  {row.file}
                </span>
              ) : null}
            </div>
          );
        })}

        {filtering && rows.length === 0 ? (
          <p class="structure-note">
            {info.query
              ? `No element${info.scriptOnly ? ' with handlers' : ''} matches "${info.query}".`
              : 'No element on this page has a handler that could be read.'}
          </p>
        ) : null}

        {info.truncated ? (
          <p class="structure-note">
            {filtering
              ? 'The search stops here to keep the page responsive.'
              : 'The listing stops here to keep the page responsive. Collapse a branch to see further.'}
          </p>
        ) : null}
      </div>
    </>
  );
}
