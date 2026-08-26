import { useState } from 'preact/hooks';
import type {
  AssetEntry,
  ColorEntry,
  PanelData,
  RuleInfo,
  ScaleInfo,
} from './view-model.js';
import { Badge, CopyButton, Empty, Group, Meter, Rows, Swatch } from './primitives.jsx';
import { ChangesSection, EditableRows, PseudoStates, useEditing } from './editing.jsx';
import { BoxDiagram } from './box-diagram.jsx';
import { assetUrlList, downloadAsset } from './download.js';
import { color } from '@open-inspector/core';
import { useSearch } from './search.jsx';

/** Shared shape: every section renders from `PanelData` and nothing else. */
interface SectionProps {
  data: PanelData;
}

function ColorChip({ entry }: { entry: ColorEntry }) {
  return (
    <button
      type="button"
      class="chip"
      title={`${entry.hex} · ${entry.role}${entry.merged ? ` · ${entry.merged} similar merged` : ''}`}
      onClick={() => {
        const textarea = document.createElement('textarea');
        textarea.value = entry.hex;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
        } finally {
          textarea.remove();
        }
      }}
    >
      <Swatch color={entry.hex} />
      <span>{entry.hex}</span>
      {entry.usage != null ? <span class="count">{entry.usage}</span> : null}
    </button>
  );
}

function Palette({ entries }: { entries: ColorEntry[] }) {
  const query = useSearch().trim().toLowerCase();
  const visible = query
    ? entries.filter((entry) => `${entry.hex} ${entry.role}`.toLowerCase().includes(query))
    : entries;

  if (visible.length === 0) return null;

  return (
    <div class="palette">
      {visible.map((entry) => (
        <ColorChip key={entry.hex + entry.role} entry={entry} />
      ))}
    </div>
  );
}

function Scale({ scale, unit }: { scale: ScaleInfo; unit: string }) {
  if (scale.kind === 'none') {
    return <Empty>No consistent {unit} scale — the values do not follow one base.</Empty>;
  }

  return (
    <>
      <div class="row">
        <span class="row-label">base</span>
        <span class="row-value">
          <span>{scale.base}</span>
          {scale.conformance != null ? (
            <span class="row-detail">{scale.conformance}% conform</span>
          ) : null}
        </span>
        <CopyButton text={scale.base ?? ''} />
      </div>
      {scale.conformance != null ? <Meter percent={scale.conformance} /> : null}
      {scale.values && scale.values.length > 0 ? (
        <div class="palette">
          {scale.values.map((value) => (
            <span key={value.value} class="chip">
              <span>{value.value}</span>
              <span class="count">{value.count}</span>
            </span>
          ))}
        </div>
      ) : null}
      {scale.outliers && scale.outliers.length > 0 ? (
        <div class="row">
          <span class="row-label">outliers</span>
          <span class="row-value">
            <span>{scale.outliers.join(', ')}</span>
          </span>
          <CopyButton text={scale.outliers.join(', ')} />
        </div>
      ) : null}
    </>
  );
}

export function StylesSection({ data }: SectionProps) {
  return (
    <>
      <ChangesSection
        edits={data.edits ?? []}
        css={data.editsCss ?? ''}
        prompt={data.editsPrompt ?? ''}
      />

      {/* The box model answers the question people opened the panel to ask, so
          it goes first. Forcing a pseudo-state is a deliberate, occasional act
          and it used to occupy the whole first screen ahead of the numbers. */}
      <Group title="Box model">
        <BoxDiagram box={data.box} />
      </Group>

      {/* Spacing and appearance map one row to one declaration, so they are
          the rows worth making editable. */}
      <Group title="Spacing">
        <EditableRows fields={data.spacing} />
      </Group>

      <Group title="Appearance">
        <EditableRows fields={data.appearance} />
      </Group>

      {data.pseudoStates ? <PseudoStates info={data.pseudoStates} /> : null}
    </>
  );
}

function RuleBlock({ rule }: { rule: RuleInfo }) {
  const query = useSearch().trim().toLowerCase();

  // A matching selector keeps the whole rule — you searched for the rule, not
  // for one line inside it.
  const selectorMatches = query !== '' && rule.selector.toLowerCase().includes(query);
  const declarations =
    query === '' || selectorMatches
      ? rule.declarations
      : rule.declarations.filter((declaration) =>
          `${declaration.property} ${declaration.value}`.toLowerCase().includes(query),
        );

  if (declarations.length === 0) return null;

  return (
    <div class="rule-block">
      <div class="rule-head">
        <span class="rule-selector">{rule.selector}</span>
        <span class="rule-source" title={rule.source}>
          {rule.specificity}
        </span>
      </div>
      <div class="decls">
        {declarations.map((declaration) => (
          <div
            key={declaration.property}
            class="decl"
            data-winning={String(declaration.winning)}
            title={declaration.winning ? 'applied' : 'overridden by a higher-priority rule'}
          >
            <span class="prop">{declaration.property}:</span>
            <span class="val">
              {declaration.value}
              {declaration.important ? ' !important' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Say which of "nothing matched" and "nothing could be read" is true.
 *
 * Cross-origin stylesheets throw on `.cssRules`, and no extension permission
 * changes that — the restriction follows the stylesheet's CORS headers. Sites
 * that serve CSS from a separate CDN are entirely opaque to us. Reporting that
 * as "no rules match" would be a confident wrong answer about the page rather
 * than an honest limit of the tool.
 */
function unreadableNote(count: number): string {
  const sheets = count === 1 ? 'stylesheet is' : 'stylesheets are';
  return `${count} ${sheets} served cross-origin, so the browser will not let any extension read the rules inside.`;
}

export function RulesSection({ data }: SectionProps) {
  if (data.rules.length === 0) {
    return data.unreadableSheets > 0 ? (
      <Group title="Matched rules">
        <Empty>{unreadableNote(data.unreadableSheets)}</Empty>
      </Group>
    ) : (
      <Empty>No author stylesheet rules match this element.</Empty>
    );
  }

  return (
    <Group title="Matched rules">
      {data.rules.map((rule) => (
        <RuleBlock key={`${rule.selector}:${rule.source}`} rule={rule} />
      ))}
      {data.unreadableSheets > 0 ? (
        <Empty>This list may be incomplete — {unreadableNote(data.unreadableSheets)}</Empty>
      ) : null}
    </Group>
  );
}

/**
 * Rules that style the element's pseudo-elements.
 *
 * Kept in their own groups rather than mixed into the element's own rules,
 * because `content: "→"` on `::after` is not a property of the element and
 * reading it as one is confusing.
 */
export function PseudoRulesSection({ data }: SectionProps) {
  const groups = data.pseudoRules ?? [];
  if (groups.length === 0) return null;

  return (
    <>
      {groups.map((group) => (
        <Group key={group.pseudo} title={group.pseudo}>
          {group.rules.map((rule) => (
            <RuleBlock key={`${group.pseudo}:${rule.selector}`} rule={rule} />
          ))}
        </Group>
      ))}
    </>
  );
}

/**
 * Sample any pixel on the screen.
 *
 * `EyeDropper` is a browser API that needs no permission and no canvas access —
 * it hands back one colour after the user clicks, and it can read pixels the
 * DOM cannot: inside images, canvas, video, and cross-origin frames. That is
 * the whole reason it exists, and the reason this is the one colour feature we
 * could not have built ourselves.
 *
 * Chromium-only. Firefox has no implementation, so the button hides itself
 * rather than failing when pressed.
 */
function Eyedropper() {
  const [picked, setPicked] = useState<color.Rgba | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const Dropper = (globalThis as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } })
    .EyeDropper;
  if (!Dropper) return null;

  const formats = picked ? color.formatColor(picked) : null;

  return (
    <Group title="Sample a colour">
      <div class="export-actions">
        <button
          type="button"
          class="sample-btn"
          title="Pick any pixel on the screen, including inside images and video"
          onClick={() => {
            setFailed(null);
            void new Dropper()
              .open()
              .then((result) => {
                const rgba = color.parseColor(result.sRGBHex);
                if (rgba) setPicked(rgba);
              })
              // Escape rejects, and that is a cancel rather than a fault.
              .catch(() => setFailed(null));
          }}
        >
          Pick from screen
        </button>
      </div>

      {formats ? (
        <Rows
          fields={[
            { label: 'hex', value: formats.hex, swatch: formats.hex, copy: formats.hex },
            { label: 'rgb', value: formats.rgb, copy: formats.rgb },
            { label: 'hsl', value: formats.hsl, copy: formats.hsl },
            { label: 'oklch', value: formats.oklch, copy: formats.oklch },
          ]}
        />
      ) : (
        <Empty>{failed ?? 'Nothing sampled yet.'}</Empty>
      )}
    </Group>
  );
}

/**
 * Every failing text sample on the page, worst first.
 *
 * Run on request rather than automatically: it is a second full walk of the
 * document, and charging every session for it would make the panel feel slow
 * to serve the few who want it.
 */
function ContrastAuditSection() {
  const editing = useEditing();
  if (!editing) return null;

  const audit = editing.contrastAudit;

  return (
    <Group title="Contrast issues on this page">
      <div class="export-actions">
        <button type="button" class="sample-btn" onClick={editing.runContrastAudit}>
          {audit ? 'Scan again' : 'Scan the page'}
        </button>
      </div>

      {!audit ? (
        <Empty>Checks every visible text sample against WCAG AA.</Empty>
      ) : audit.failures.length === 0 ? (
        <Empty>
          Nothing failed AA across {audit.assessed} text sample
          {audit.assessed === 1 ? '' : 's'}.
          {audit.indeterminate > 0
            ? ` ${audit.indeterminate} could not be read — a gradient or image behind the text.`
            : ''}
        </Empty>
      ) : (
        <>
          {audit.failures.slice(0, 40).map((failure) => (
            <button
              key={`${failure.label}:${failure.text}`}
              type="button"
              class="finding"
              data-severity={failure.severity}
              title={
                failure.suggestion
                  ? `Needs ${failure.required}:1. ${failure.suggestion} would pass. Press to select this element.`
                  : `Needs ${failure.required}:1, and no lightness of this hue reaches it on that background. Press to select this element.`
              }
              onClick={() => editing.selectElement(failure.element)}
            >
              <span class="finding-ratio">{failure.ratio}:1</span>
              <span class="finding-body">
                <span class="finding-label">{failure.label}</span>
                <span class="finding-text">{failure.text}</span>
              </span>
              {failure.suggestion ? <Swatch color={failure.suggestion} /> : null}
            </button>
          ))}

          <Empty>
            {audit.failures.length} failing of {audit.assessed} samples
            {audit.failures.length > 40 ? ' — first 40 shown' : ''}
            {audit.indeterminate > 0
              ? `. ${audit.indeterminate} could not be read at all, and are not counted either way.`
              : '.'}
            {audit.truncated ? ' The page was large enough that the walk stopped early.' : ''}
          </Empty>
        </>
      )}
    </Group>
  );
}

export function ColorSection({ data }: SectionProps) {
  const { contrast, page } = data;

  return (
    <>
      <Group title="On this element">
        {data.colors.length === 0 ? (
          <Empty>This element declares no colours of its own.</Empty>
        ) : (
          // Colours that came from exactly one declaration carry it, and are
          // editable with a picker. A shadow or gradient stop lives inside a
          // longhand string with no single property to write back to, so it
          // stays a reading.
          <EditableRows
            fields={data.colors.map((entry) => ({
              label: entry.role,
              value: entry.hex,
              detail: entry.rgb,
              copy: entry.hex,
              swatch: entry.hex,
              property: entry.property,
            }))}
          />
        )}
      </Group>

      {contrast ? (
        <Group title="Contrast">
          {contrast.kind === 'indeterminate' ? (
            <>
              <div class="row">
                <span class="row-label">result</span>
                <span class="row-value">
                  <Badge kind="unknown">indeterminate</Badge>
                </span>
                <span />
              </div>
              <Empty>{contrast.reason}</Empty>
            </>
          ) : (
            <>
              <div class="row">
                <span class="row-label">ratio</span>
                <span class="row-value">
                  <span>{contrast.ratio}</span>
                  <Badge kind={contrast.aa ? 'pass' : 'fail'}>AA {contrast.aa ? 'pass' : 'fail'}</Badge>
                  <Badge kind={contrast.aaa ? 'pass' : 'fail'}>
                    AAA {contrast.aaa ? 'pass' : 'fail'}
                  </Badge>
                </span>
                <CopyButton text={contrast.ratio ?? ''} />
              </div>
              {contrast.largeText ? (
                <Empty>Graded as large text (≥24px, or ≥18.66px bold).</Empty>
              ) : null}
              {contrast.suggestion ? (
                <Rows
                  fields={[
                    {
                      label: 'nearest AA',
                      value: contrast.suggestion,
                      swatch: contrast.suggestion,
                    },
                  ]}
                />
              ) : null}
            </>
          )}
        </Group>
      ) : null}

      <Eyedropper />

      <ContrastAuditSection />

      <Group title="Page palette">
        {!page ? (
          <Empty>Scanning…</Empty>
        ) : page.palette.length === 0 ? (
          <Empty>No colours found.</Empty>
        ) : (
          <Palette entries={page.palette} />
        )}
      </Group>
    </>
  );
}

export function TypeSection({ data }: SectionProps) {
  const { typography: type, page } = data;

  return (
    <>
      <Group title="Font">
        {/* `rendered` is a measurement, not a declaration — there is nothing to
            write back to. The stack is the declaration behind it. */}
        <Rows
          fields={[
            {
              label: 'rendered',
              value: type.rendered ?? 'could not determine',
              detail: type.rendered ? type.method : undefined,
              copy: type.rendered ?? '',
            },
          ]}
        />
        <EditableRows
          fields={[
            {
              label: 'stack',
              value: type.stack.join(', '),
              copy: type.stack.join(', '),
              property: 'font-family',
            },
          ]}
        />
      </Group>

      <Group title="Metrics">
        <EditableRows
          fields={[
            { label: 'size', value: type.size, detail: type.sizeRem, property: 'font-size' },
            { label: 'weight', value: type.weight, property: 'font-weight' },
            {
              label: 'line height',
              value: type.lineHeight,
              detail: type.lineHeightRatio,
              property: 'line-height',
            },
            { label: 'letter spacing', value: type.letterSpacing, property: 'letter-spacing' },
            { label: 'style', value: type.style, property: 'font-style' },
            { label: 'transform', value: type.transform, property: 'text-transform' },
            ...(type.align ? [{ label: 'align', value: type.align, property: 'text-align' }] : []),
            ...(type.decoration
              ? [{ label: 'decoration', value: type.decoration, property: 'text-decoration' }]
              : []),
          ]}
        />
      </Group>

      <Group title="Type scale">
        {page ? <Scale scale={page.typeScale} unit="type" /> : <Empty>Scanning…</Empty>}
      </Group>

      <Group title="Fonts on this page">
        {!page ? (
          <Empty>Scanning…</Empty>
        ) : page.fonts.length === 0 ? (
          <Empty>No fonts detected.</Empty>
        ) : (
          <Rows
            fields={page.fonts.map((font) => ({
              label: `${font.usage}×`,
              value: font.family,
              detail: font.source,
              copy: font.family,
            }))}
          />
        )}
      </Group>
    </>
  );
}

export function LayoutSection({ data }: SectionProps) {
  const { layout, page } = data;

  return (
    <>
      <Group title="This element lays out">
        {layout.summary ? (
          <div class="row">
            <span class="row-label">summary</span>
            <span class="row-value">{layout.summary}</span>
            <CopyButton text={layout.summary} />
          </div>
        ) : null}
        <Rows fields={layout.fields} />
      </Group>

      {layout.parent ? (
        <Group title={`Positioned by parent (${layout.parent.display})`}>
          <Rows fields={layout.parent.fields} />
        </Group>
      ) : null}

      <Group title="Spacing scale">
        {page ? <Scale scale={page.spacingScale} unit="spacing" /> : <Empty>Scanning…</Empty>}
      </Group>

      <Group title="Breakpoints affecting this element">
        {!page ? (
          <Empty>Scanning…</Empty>
        ) : page.breakpoints.length === 0 ? (
          <Empty>No media queries target this element or its ancestors.</Empty>
        ) : (
          <Rows
            fields={page.breakpoints.map((breakpoint) => ({
              label: breakpoint.active ? 'active' : 'inactive',
              value: breakpoint.condition,
              detail: breakpoint.changes?.slice(0, 4).join(', '),
              copy: breakpoint.condition,
            }))}
          />
        )}
      </Group>
    </>
  );
}

/**
 * One asset, with a thumbnail.
 *
 * A filename on its own does not identify anything — a page with twelve
 * `icon.svg` entries is a list of twelve identical rows. Seeing the thing is
 * the entire point of an asset browser.
 */
function AssetRow({ asset }: { asset: AssetEntry }) {
  const editing = useEditing();
  const [failed, setFailed] = useState(false);
  const showImage = asset.preview && !failed;

  return (
    <div class="asset">
      <div class="asset-thumb" data-empty={!showImage}>
        {showImage ? (
          <img src={asset.preview} alt="" loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <span class="asset-thumb-note">{failed ? 'unavailable' : (asset.noPreview ?? '—')}</span>
        )}
      </div>

      <div class="asset-body">
        <span class="asset-name" title={asset.url || asset.name}>
          {asset.name}
        </span>
        <span class="asset-meta">
          {[
            asset.dimensions,
            asset.bytes != null ? formatBytes(asset.bytes) : null,
            asset.usage && asset.usage > 1 ? `${asset.usage}×` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      <div class="asset-actions">
        {asset.url ? (
          <button
            type="button"
            class="copy"
            title={
              asset.kind === 'inline svg'
                ? 'Save as an .svg file'
                : 'Save this file (the browser fetches it, from cache where it can)'
            }
            onClick={() => downloadAsset(asset, editing?.save)}
          >
            save
          </button>
        ) : null}
        <CopyButton text={asset.url || asset.name} label="copy" />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssetsSection({ data }: SectionProps) {
  const { page } = data;
  const query = useSearch().trim().toLowerCase();

  if (!page) return <Empty>Scanning…</Empty>;
  if (page.assets.length === 0) return <Empty>No images, SVGs, media or webfonts found.</Empty>;

  const assets = query
    ? page.assets.filter((asset) =>
        `${asset.name} ${asset.url} ${asset.kind}`.toLowerCase().includes(query),
      )
    : page.assets;

  const byKind = new Map<string, AssetEntry[]>();
  for (const asset of assets) {
    const list = byKind.get(asset.kind) ?? [];
    list.push(asset);
    byKind.set(asset.kind, list);
  }

  return (
    <>
      {[...byKind.entries()].map(([kind, group]) => (
        <Group key={kind} title={`${kind} · ${group.length}`}>
          {group.map((asset) => (
            <AssetRow key={`${asset.kind}:${asset.url}:${asset.name}`} asset={asset} />
          ))}
        </Group>
      ))}
      {query ? null : (
        <div class="export-actions">
          <CopyButton text={assetUrlList(page.assets)} label="copy all URLs" />
        </div>
      )}

      <Empty>
        Bulk download would mean fetching every file, which is the one thing this extension does
        not do. Copy the list and hand it to curl or a download manager instead.
      </Empty>

      {page.truncated ? (
        <Empty>
          This page is large enough that the scan hit its budget and stopped early, so this list
          is partial.
        </Empty>
      ) : null}
    </>
  );
}

/**
 * The element, written back out as source.
 *
 * Not `outerHTML`: that carries framework hydration ids, our own attributes
 * and whatever inline styles a script has set, none of which anyone wants in
 * their codebase. See core/markup for exactly what is dropped.
 */
export function MarkupSection({ data }: SectionProps) {
  const [dialect, setDialect] = useState<'html' | 'jsx'>('html');

  if (!data.markup) return <Empty>Select an element to see its markup.</Empty>;

  const text = data.markup[dialect];

  return (
    <>
      <Group title="Dialect">
        <div class="export-actions">
          <button type="button" aria-pressed={dialect === 'html'} onClick={() => setDialect('html')}>
            HTML
          </button>
          <button type="button" aria-pressed={dialect === 'jsx'} onClick={() => setDialect('jsx')}>
            JSX
          </button>
        </div>
      </Group>

      <Group title="Markup">
        <div class="export-actions">
          <CopyButton text={text} label="copy" />
        </div>
        <pre>{text}</pre>
        <Empty>
          Framework attributes, scripts and inline styles are stripped, and the subtree stops at six
          levels — this is markup to paste, not a recording of the live DOM.
        </Empty>
      </Group>
    </>
  );
}

export function ExportSection({ data }: SectionProps) {
  const formats = data.exports ?? [];
  const [active, setActive] = useState(formats[0]?.id ?? '');

  if (formats.length === 0) {
    return <Empty>Export becomes available once the page scan finishes.</Empty>;
  }

  const current = formats.find((format) => format.id === active) ?? formats[0];
  if (!current) return <Empty>Nothing to export.</Empty>;

  return (
    <>
      <Group title="Format">
        <div class="export-actions">
          {formats.map((format) => (
            <button
              key={format.id}
              type="button"
              aria-pressed={format.id === current.id}
              onClick={() => setActive(format.id)}
            >
              {format.label}
            </button>
          ))}
        </div>
      </Group>

      <Group title={current.label}>
        <div class="export-actions">
          <CopyButton text={current.text} label="copy all" />
        </div>
        <pre>{current.text}</pre>
      </Group>
    </>
  );
}
