import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { EditEntry, Field, PseudoStateInfo } from './view-model.js';
import { CopyButton, Empty, Group, Swatch } from './primitives.jsx';
import { filterFields, useSearch } from './search.jsx';
import { color } from '@open-inspector/core';
import type { ContrastAudit } from './page.js';

/**
 * Editing wiring for the panel.
 *
 * The panel itself owns no state about edits — it renders what it is given and
 * calls back. The store that actually mutates the page lives in the session,
 * so the UI stays a pure function of data and the mutation has exactly one
 * home.
 */

export interface EditingApi {
  /** Write one declaration. Returns false when the engine refused the value. */
  apply(property: string, value: string): boolean;
  /** Revert one declaration on the current element. */
  revert(property: string): void;
  /** Revert one declaration on any edited element, addressed by selector. */
  revertOn(selector: string, property: string): void;
  /** Revert everything, on every element. */
  revertAll(): void;
  /** Turn one forced pseudo-state on or off for the selected element. */
  togglePseudoState(state: string): void;
  /** Start a download. Routed differently inside an extension — see download.ts. */
  save(href: string, filename: string): void;
  /** Properties currently overridden on the element being shown. */
  editedProperties: ReadonlySet<string>;
  /** True when this element is hidden by us — a revertible `display: none`. */
  hidden: boolean;
  toggleHidden(): void;
  /**
   * Resize the browser window so the page viewport matches a width.
   *
   * Null when there is nothing to resize — the playground, or a browser that
   * refused. Passing null as the width restores the size we found.
   */
  setViewport: ((width: number | null) => void) | null;
  /** The width currently being held, or null for the window's own. */
  viewportWidth: number | null;
  /** The width the browser actually settled on. Differs when it clamped. */
  viewportActual: number | null;
  /** Why the last resize did not happen. Null when it did. */
  viewportError: string | null;
  /** The window ended up exactly where it started — a no-op, not a clamp. */
  viewportUnchanged: boolean;
  /** The last page-wide contrast audit, or null until one is run. */
  contrastAudit: ContrastAudit | null;
  runContrastAudit(): void;
  /** Jump to an element, used to reach a failure from the audit list. */
  selectElement(element: Element): void;
  /**
   * Called when the user starts editing.
   *
   * Editing while the panel tracks the pointer is impossible — moving to the
   * input would change the element out from under you — so the first keystroke
   * holds the current element.
   */
  onBeginEdit(): void;
}

export const EditingContext = createContext<EditingApi | null>(null);

export function useEditing(): EditingApi | null {
  return useContext(EditingContext);
}

/**
 * Nudge the first number in a CSS value.
 *
 * The convention every design tool shares: arrows step by one, Shift by ten,
 * Alt by a tenth. Operating on the first number only is deliberate — for
 * `8px 16px` the first is what people are adjusting, and stepping all of them
 * together silently destroys asymmetric values.
 *
 * The unit is preserved, and a unitless number stays unitless, so stepping
 * `1.5` on a line-height does not turn it into `1.5px`.
 */
export function stepValue(value: string, direction: 1 | -1, multiplier: number): string | null {
  const match = value.match(/-?\d*\.?\d+/);
  if (!match || match.index === undefined) return null;

  const current = Number.parseFloat(match[0]);
  if (!Number.isFinite(current)) return null;

  const next = current + direction * multiplier;
  // Trim float noise from repeated 0.1 steps without truncating real precision.
  const rounded = Math.abs(next) < 1e-6 ? 0 : Number(next.toFixed(4));

  return value.slice(0, match.index) + String(rounded) + value.slice(match.index + match[0].length);
}

/** Arrow steps: plain 1, Shift 10, Alt 0.1. */
function stepFor(event: KeyboardEvent): number {
  if (event.shiftKey) return 10;
  if (event.altKey) return 0.1;
  return 1;
}

/**
 * The six-digit hex `<input type="color">` requires, or null.
 *
 * Returns null for anything that is not a flat colour — `transparent`,
 * gradients, `currentColor` — because a picker seeded from a value it cannot
 * represent would silently rewrite it on first open.
 */
function pickerHex(value: string): string | null {
  const rgba = color.parseColor(value);
  if (!rgba || rgba.a === 0) return null;
  return color.formatColor(rgba).hex.slice(0, 7);
}

/**
 * A colour well beside an editable colour.
 *
 * Typing `#3b82f6` is fine when you already know the value; choosing one is
 * what a picker is for, and it is the single most-requested thing missing
 * from a panel that can otherwise edit everything.
 *
 * Alpha is carried across by hand. The native control is RGB-only, so writing
 * its six-digit output straight back would quietly turn a 40%-opaque overlay
 * fully opaque — a change the user never asked for and would struggle to spot.
 */
function ColorWell({
  value,
  onPick,
}: {
  value: string;
  onPick: (next: string) => void;
}) {
  const hex = pickerHex(value);
  if (hex === null) return null;

  const alpha = color.parseColor(value)?.a ?? 1;

  return (
    <input
      type="color"
      class="color-well"
      value={hex}
      title={`Pick a colour${alpha < 1 ? ` — the current ${Math.round(alpha * 100)}% opacity is kept` : ''}`}
      onInput={(event) => {
        const picked = (event.target as HTMLInputElement).value;
        if (alpha >= 1) {
          onPick(picked);
          return;
        }
        const rgba = color.parseColor(picked);
        if (!rgba) return;
        onPick(`rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${Number(alpha.toFixed(3))})`);
      }}
    />
  );
}

/**
 * A value that can be clicked and typed into.
 *
 * Enter commits, Escape restores the previous text and gives up focus, blur
 * commits — the conventions from every other inspector, so nobody has to learn
 * anything here.
 */
export function EditableValue({
  field,
  onCommit,
  onBegin,
  edited,
  showSwatch = true,
}: {
  field: Field;
  onCommit: (value: string) => boolean;
  onBegin: () => void;
  edited: boolean;
  /** Off when a colour well already stands in front of the row. */
  showSwatch?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value);
  const [rejected, setRejected] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const begin = useCallback(() => {
    setDraft(field.value);
    setRejected(false);
    setEditing(true);
    onBegin();
  }, [field.value, onBegin]);

  const commit = useCallback(() => {
    if (draft === field.value) {
      setEditing(false);
      return;
    }
    if (onCommit(draft)) {
      setEditing(false);
      setRejected(false);
    } else {
      // Keep the field open with the bad value visible; silently reverting
      // would leave the user wondering whether they mistyped or we broke.
      setRejected(true);
    }
  }, [draft, field.value, onCommit]);

  if (!editing) {
    return (
      <button type="button" class="editable" data-edited={edited} onClick={begin} title="Click to edit">
        {field.swatch && showSwatch ? <Swatch color={field.swatch} /> : null}
        <span class={field.value.length > 28 ? 'wrap' : undefined}>{field.value}</span>
        {field.detail ? <span class="row-detail">{field.detail}</span> : null}
      </button>
    );
  }

  return (
    <input
      ref={input}
      class="edit-input"
      data-rejected={rejected}
      value={draft}
      spellcheck={false}
      autocomplete="off"
      onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const stepped = stepValue(draft, event.key === 'ArrowUp' ? 1 : -1, stepFor(event));
          if (stepped === null) return;

          event.preventDefault();
          setDraft(stepped);
          // Apply as you step, so the page animates under the arrow key
          // instead of waiting for Enter. A rejected step just does not land.
          if (onCommit(stepped)) setRejected(false);
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation(); // Escape closes the inspector; not here.
          setDraft(field.value);
          setRejected(false);
          setEditing(false);
        }
      }}
    />
  );
}

/** A row that is editable when the field maps to a single CSS property. */
export function EditableRow({ field }: { field: Field }) {
  const editing = useEditing();
  const property = field.property;

  if (!editing || !property) {
    return (
      <div class="row">
        <span class="row-label" title={field.label}>
          {field.label}
        </span>
        <span class="row-value">
          {field.swatch ? <Swatch color={field.swatch} /> : null}
          <span class={field.value.length > 28 ? 'wrap' : undefined}>{field.value}</span>
          {field.detail ? <span class="row-detail">{field.detail}</span> : null}
        </span>
        <CopyButton text={field.copy ?? field.value} />
      </div>
    );
  }

  const edited = editing.editedProperties.has(property);

  return (
    <div class="row" data-edited={edited}>
      <span class="row-label" title={property}>
        {field.label}
      </span>
      <span class="row-value">
        {field.swatch ? (
          <ColorWell
            value={field.swatch}
            onPick={(next) => {
              editing.onBeginEdit();
              editing.apply(property, next);
            }}
          />
        ) : null}
        <EditableValue
          field={field}
          edited={edited}
          // The well is the swatch. Rendering both put two colour chips in one
          // row and pushed the value onto a second line.
          showSwatch={!field.swatch}
          onBegin={editing.onBeginEdit}
          onCommit={(value) => editing.apply(property, value)}
        />
      </span>
      {edited ? (
        <button
          type="button"
          class="copy revert"
          title="Revert this declaration"
          onClick={() => editing.revert(property)}
        >
          revert
        </button>
      ) : (
        <CopyButton text={field.copy ?? field.value} />
      )}
    </div>
  );
}

export function EditableRows({ fields }: { fields: Field[] }) {
  const query = useSearch();
  const visible = filterFields(fields, query);

  if (fields.length === 0) return <Empty>Nothing to show here.</Empty>;
  // A filtered-to-nothing group renders nothing at all; the stylesheet hides
  // the empty shell around it, so a search leaves only what matched.
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((field) => (
        <EditableRow key={`${field.label}:${field.property ?? field.value}`} field={field} />
      ))}
    </>
  );
}

/**
 * Toggles for the forceable pseudo-states.
 *
 * Hover styles are otherwise uninspectable: reaching the panel means leaving
 * the element, and the state leaves with the pointer. States the page does not
 * style are shown disabled rather than hidden — "this page has no :hover
 * rules" is a useful answer, and a control that silently does nothing is not.
 */
export function PseudoStates({ info }: { info: PseudoStateInfo }) {
  const editing = useEditing();
  if (!editing) return null;

  const active = new Set(info.active);
  const available = new Set(info.available);

  return (
    <Group title="Force state">
      <div class="states">
        {info.all.map((state) => {
          const styled = available.has(state);
          const forced = active.has(state);

          return (
            <button
              key={state}
              type="button"
              class="state-toggle"
              aria-pressed={forced}
              // Never disable something that is currently on. Whatever the
              // availability scan concluded afterwards, the only control for
              // turning this back off is this button.
              disabled={!styled && !forced}
              title={
                forced
                  ? `Forcing :${state}. Press to release it.`
                  : styled
                    ? `Force :${state} on this element`
                    : `Nothing on this page styles :${state}`
              }
              onClick={() => editing.togglePseudoState(state)}
            >
              :{state}
            </button>
          );
        })}
      </div>
      {info.unreadableSheets > 0 ? (
        <Empty>
          {info.unreadableSheets} cross-origin stylesheet
          {info.unreadableSheets === 1 ? '' : 's'} could not be read, so states defined there
          cannot be forced.
        </Empty>
      ) : null}
    </Group>
  );
}


/**
 * The running list of edits.
 *
 * Each change shows the new value with the old one directly beneath it, both
 * labelled. A list of new values alone is unreadable a minute later: you
 * cannot tell a nudge from a rewrite, and you certainly cannot put it back by
 * hand.
 */
export function ChangesSection({
  edits,
  css,
  prompt,
}: {
  edits: EditEntry[];
  css: string;
  prompt: string;
}) {
  const editing = useEditing();
  if (edits.length === 0) return null;

  // Group by element, so several tweaks to one thing read as one change.
  const byElement = new Map<string, EditEntry[]>();
  for (const entry of edits) {
    const list = byElement.get(entry.selector) ?? [];
    list.push(entry);
    byElement.set(entry.selector, list);
  }

  return (
    <Group title={`Changes · ${edits.length}`}>
      <p class="changes-note">
        Applied inline to the live page. Nothing is saved — a reload discards them.
      </p>

      {[...byElement.entries()].map(([selector, entries]) => (
        <div class="change-block" key={selector}>
          <div class="change-head">
            <span class="change-element" title={selector}>
              {entries[0]?.element ?? selector}
              {entries[0]?.onCurrentElement ? <span class="change-here"> · selected</span> : null}
            </span>
            <CopyButton text={selector} label="selector" />
          </div>

          {entries.map((entry) => (
            <div class="change" key={entry.property}>
              <span class="change-prop">{entry.property}</span>
              <span class="change-now" title="after">
                {entry.value}
              </span>
              <span class="change-was" title="before">
                was {entry.previous || 'not set'}
              </span>
              <button
                type="button"
                class="copy revert"
                title={`Revert ${entry.property}`}
                onClick={() => editing?.revertOn(selector, entry.property)}
              >
                revert
              </button>
            </div>
          ))}
        </div>
      ))}

      <div class="export-actions">
        <CopyButton text={prompt} label="copy for AI" />
        <CopyButton text={css} label="copy CSS" />
        <button type="button" onClick={() => editing?.revertAll()}>
          revert all
        </button>
      </div>
    </Group>
  );
}
