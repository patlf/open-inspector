import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import type { BoxModel, EdgeSizes } from '@open-inspector/core';
import { round } from '@open-inspector/core';
import { edgeProperty, type BoxFocus, type BoxRegion, type BoxSide } from '../overlay.js';
import { EditableValue, useEditing } from './editing.jsx';

/**
 * The nested box-model diagram.
 *
 * Everyone who has used DevTools reads this shape instantly, so it uses the
 * same colour mapping — orange margin, yellow border, green padding, blue
 * content. Reinventing that would cost recognition and buy nothing.
 *
 * Every edge number is editable, and each maps to its own longhand
 * (`margin-top`, `padding-left`, …) rather than the shorthand. Editing one
 * side through the shorthand would silently reset the other three, which is
 * exactly the surprise this diagram exists to prevent.
 *
 * Zero edges are dimmed rather than hidden: a missing number reads as "not
 * measured", while a dimmed 0 reads as "measured, and it is zero".
 *
 * Pointing at a band or a number singles that part out on the page as well,
 * so it is never a guess which stretch of the element a value belongs to.
 */

type Region = Exclude<BoxRegion, 'content'>;
type Side = BoxSide;

/**
 * What the pointer is on, from the data attributes the diagram carries.
 *
 * Prefixed `data-box-`, because `closest()` keeps climbing past the diagram:
 * the panel's own root carries a `data-side` for the edge it is docked to,
 * and a bare `[data-side]` lookup found that instead of an edge cell.
 */
function focusAt(target: EventTarget | null): BoxFocus | null {
  const element = target as Element | null;
  const cell = element?.closest?.('[data-box-side]');
  const band = element?.closest?.('[data-box-region]');
  const region = (cell ?? band)?.getAttribute('data-box-region') as BoxRegion | null | undefined;
  if (!region) return null;
  return { region, side: (cell?.getAttribute('data-box-side') as BoxSide | null) ?? null };
}

function EdgeCell({
  region,
  side,
  value,
}: {
  region: Region;
  side: Side;
  value: number;
}) {
  const editing = useEditing();
  const property = edgeProperty(region, side);
  const text = value === 0 ? '0' : String(round(value));

  if (!editing) {
    return (
      <span class={`bd-${side[0]}`} data-zero={String(value === 0)}>
        {text}
      </span>
    );
  }

  const edited = editing.editedProperties.has(property);

  return (
    <span
      class={`bd-${side[0]}`}
      data-box-region={region}
      data-box-side={side}
      data-zero={String(value === 0 && !edited)}
    >
      <EditableValue
        field={{ label: property, value: text, property }}
        edited={edited}
        onBegin={editing.onBeginEdit}
        onCommit={(next) => editing.apply(property, /^-?[\d.]+$/.test(next.trim()) ? `${next.trim()}px` : next)}
      />
    </span>
  );
}

function Edges({
  region,
  values,
  children,
}: {
  region: Region;
  values: EdgeSizes;
  children: ComponentChildren;
}) {
  return (
    <>
      <EdgeCell region={region} side="top" value={values.top} />
      <EdgeCell region={region} side="left" value={values.left} />
      {children}
      <EdgeCell region={region} side="right" value={values.right} />
      <EdgeCell region={region} side="bottom" value={values.bottom} />
    </>
  );
}

export function BoxDiagram({ box }: { box: BoxModel }) {
  const editing = useEditing();
  /** The last focus sent, so moving within one part does not repaint the page. */
  const sent = useRef<BoxFocus | null>(null);

  const point = (focus: BoxFocus | null): void => {
    const last = sent.current;
    if (focus?.region === last?.region && focus?.side === last?.side) return;
    sent.current = focus;
    editing?.focusBox(focus);
  };

  return (
    <div
      class="boxdiagram"
      onPointerOver={(event) => point(focusAt(event.target))}
      onPointerLeave={() => point(null)}
    >
      <div class="bd-layer bd-margin" data-box-region="margin">
        <span class="bd-name">margin</span>
        <Edges region="margin" values={box.edges.margin}>
          <div class="bd-layer bd-border" data-box-region="border">
            <span class="bd-name">border</span>
            <Edges region="border" values={box.edges.border}>
              <div class="bd-layer bd-padding" data-box-region="padding">
                <span class="bd-name">padding</span>
                <Edges region="padding" values={box.edges.padding}>
                  <div class="bd-layer bd-content" data-box-region="content">
                    <span class="bd-content-size">
                      {round(box.content.width)} × {round(box.content.height)}
                    </span>
                  </div>
                </Edges>
              </div>
            </Edges>
          </div>
        </Edges>
      </div>
    </div>
  );
}

/** Styles for the diagram, appended to the panel stylesheet. */
export const BOX_DIAGRAM_STYLES = `
  .boxdiagram {
    /* Full width at any panel size, so its edges line up with the rows below. */
    width: 100%;
    font-family: var(--mono);
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
    color: var(--bd-ink);
    user-select: none;
  }

  .bd-layer {
    position: relative;
    display: grid;
    grid-template-columns: 26px 1fr 26px;
    grid-template-rows: 16px auto 16px;
    grid-template-areas:
      '.  t  .'
      'l  c  r'
      '.  b  .';
    align-items: center;
    justify-items: center;
    border-radius: 5px;
    padding: 0;
  }

  .bd-layer > .bd-layer { grid-area: c; width: 100%; }

  .bd-t { grid-area: t; }
  .bd-r { grid-area: r; }
  .bd-b { grid-area: b; }
  .bd-l { grid-area: l; }

  .bd-t, .bd-r, .bd-b, .bd-l { color: var(--bd-ink); }
  /*
   * Receded, not faded. Opacity took zeros to 2.7:1 on the fills — below the
   * AA line the panel grades every other page against. A softer ink that
   * clears 4.5:1 on every fill still reads as "measured, and zero".
   */
  [data-zero='true'] { color: var(--bd-zero); font-weight: 400; }

  /* The diagram sits on its own fills, so its editable cells take their
     colours from the diagram's ink rather than the panel's. */
  .boxdiagram .editable {
    padding: 0 3px;
    margin: 0;
    color: inherit;
    cursor: text;
  }
  .boxdiagram .editable:hover {
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    border-color: color-mix(in srgb, var(--bd-ink) 35%, transparent);
  }
  .boxdiagram .editable[data-edited='true'] {
    color: var(--bd-ink);
    background: color-mix(in srgb, var(--bg) 75%, transparent);
    border-color: var(--bd-ink);
    font-weight: 600;
  }

  .boxdiagram .edit-input {
    width: 44px;
    padding: 0 2px;
    margin: 0;
    font-size: 9.5px;
    text-align: center;
    background: var(--bg);
    color: var(--ink);
    border-color: var(--bd-ink);
  }

  .bd-name {
    position: absolute;
    top: 2px;
    left: 6px;
    font-family: var(--sans);
    font-size: 9.5px;
    /* The fill's ink, not the theme's: see --bd-ink. */
    color: var(--bd-ink);
  }

  /*
   * The DevTools mapping — orange margin, yellow border, green padding, blue
   * content — at a lower strength, opaque and per theme (see --bd-margin).
   */
  .bd-margin  { background: var(--bd-margin); }
  .bd-border  { background: var(--bd-border); }
  .bd-padding { background: var(--bd-padding); }

  .bd-content {
    grid-area: c;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    border-radius: 3px;
    background: var(--bd-content);
    color: var(--bd-ink);
    font-weight: 600;
  }

  .bd-content-size { padding: 3px 4px; white-space: nowrap; }

  /*
   * The band under the pointer, and only that one: hovering padding also
   * hovers the border and margin around it, so ancestors that contain a
   * hovered band are left out. An outline in the diagram's own ink, rather
   * than a brighter fill, so the numbers keep their contrast.
   */
  .bd-layer:hover:not(:has(.bd-layer:hover)) {
    box-shadow: inset 0 0 0 1.5px var(--bd-ink);
  }
  .bd-t:hover, .bd-r:hover, .bd-b:hover, .bd-l:hover { font-weight: 700; }
`;
