import type { ComponentChildren } from 'preact';
import type { BoxModel, EdgeSizes } from '@open-inspector/core';
import { round } from '@open-inspector/core';
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
 */

type Region = 'margin' | 'border' | 'padding';
type Side = 'top' | 'right' | 'bottom' | 'left';

/** The longhand this cell writes to. Border edits width, not the shorthand. */
function propertyFor(region: Region, side: Side): string {
  return region === 'border' ? `border-${side}-width` : `${region}-${side}`;
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
  const property = propertyFor(region, side);
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
    <span class={`bd-${side[0]}`} data-zero={String(value === 0 && !edited)}>
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
  return (
    <div class="boxdiagram">
      <div class="bd-layer bd-margin">
        <span class="bd-name">margin</span>
        <Edges region="margin" values={box.edges.margin}>
          <div class="bd-layer bd-border">
            <span class="bd-name">border</span>
            <Edges region="border" values={box.edges.border}>
              <div class="bd-layer bd-padding">
                <span class="bd-name">padding</span>
                <Edges region="padding" values={box.edges.padding}>
                  <div class="bd-layer bd-content">
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
    font-family: var(--mono);
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    user-select: none;
  }

  .bd-layer {
    position: relative;
    display: grid;
    grid-template-columns: 30px 1fr 30px;
    grid-template-rows: 18px auto 18px;
    grid-template-areas:
      '.  t  .'
      'l  c  r'
      '.  b  .';
    align-items: center;
    justify-items: center;
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0;
  }

  .bd-layer > .bd-layer { grid-area: c; width: 100%; }

  .bd-t { grid-area: t; }
  .bd-r { grid-area: r; }
  .bd-b { grid-area: b; }
  .bd-l { grid-area: l; }

  .bd-t, .bd-r, .bd-b, .bd-l { color: #14181c; }
  [data-zero='true'] { opacity: 0.45; }

  /* The diagram sits on light fills, so its editable cells need their own
     colours rather than the panel's — the shared ones vanish on orange. */
  .boxdiagram .editable {
    padding: 0 3px;
    margin: 0;
    color: inherit;
    cursor: text;
  }
  .boxdiagram .editable:hover {
    background: rgba(255, 255, 255, 0.55);
    border-color: rgba(20, 24, 28, 0.35);
  }
  .boxdiagram .editable[data-edited='true'] {
    color: #14181c;
    background: rgba(255, 255, 255, 0.75);
    border-color: #14181c;
    font-weight: 600;
  }

  .boxdiagram .edit-input {
    width: 44px;
    padding: 0 2px;
    margin: 0;
    font-size: 9.5px;
    text-align: center;
    background: #fff;
    color: #14181c;
    border-color: #14181c;
  }

  .bd-name {
    position: absolute;
    top: 2px;
    left: 5px;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    /*
     * Full strength, and always the dark ink.
     *
     * The layer fills are the same pale DevTools colours in both themes, so
     * the label colour must not follow the theme — it follows the fill. At
     * 0.75 alpha it measured 2.9:1 against them.
     */
    color: #14181c;
  }

  /*
   * Opaque, so the diagram is identical in both themes.
   *
   * As translucent fills these composited against the panel background, which
   * meant the dark theme produced much darker bands — and the labels and edge
   * numbers, which are always dark ink, dropped to 3.7:1 on them. These are
   * the same colours, pre-composited over white.
   */
  .bd-margin  { background: #fad5ae; }
  .bd-border  { background: #feee9a; }
  .bd-padding { background: #c4dfb8; }

  .bd-content {
    grid-area: c;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 30px;
    background: rgba(111, 168, 220, 0.6);
    color: #14181c;
    font-weight: 600;
  }

  .bd-content-size { padding: 4px 8px; }
`;
