import { useMemo, useState } from 'preact/hooks';
import { assets, svg } from '@open-inspector/core';
import { useEditing } from './editing.jsx';
import { Icon } from './icons.jsx';
import { CodeBlock, Empty, Group, formatBytes } from './primitives.jsx';

type SvgMode = 'optimized' | 'minified' | 'beautified';

const MODES: ReadonlyArray<{ id: SvgMode; label: string; title: string }> = [
  {
    id: 'optimized',
    label: 'Optimized',
    title: 'Smallest output that draws the same picture: editor data, comments and excess precision removed',
  },
  { id: 'minified', label: 'Minified', title: 'The same markup with blank space and comments removed' },
  { id: 'beautified', label: 'Beautified', title: 'One element per line, indented, for reading' },
];

/**
 * An SVG, three ways: optimized, minified and beautified.
 *
 * The same tool wherever SVG turns up — the selected element, an inline asset,
 * markup pasted in — because the job is the same: get a file you would put
 * in a codebase. Everything happens in the panel; saving hands the browser a
 * `data:` URI, so nothing is fetched.
 */
export function SvgTool({
  source,
  filename,
  preview = false,
}: {
  source: string;
  /** What a saved copy is called. */
  filename: string;
  /** Show the result as a picture too — for pasted markup, which is not on the page. */
  preview?: boolean;
}) {
  const editing = useEditing();
  const [mode, setMode] = useState<SvgMode>('optimized');

  const result = useMemo(() => {
    const parsed = svg.parseSvg(source);
    if (!parsed.document) return { error: parsed.error };
    return {
      outputs: {
        optimized: svg.minifySvg(svg.optimizeSvg(parsed.document)),
        minified: svg.minifySvg(parsed.document),
        beautified: svg.beautifySvg(parsed.document),
      } satisfies Record<SvgMode, string>,
    };
  }, [source]);

  if ('error' in result) return <Empty>Not readable as SVG. {result.error}</Empty>;

  const text = result.outputs[mode];
  const before = assets.byteLength(source);
  const after = assets.byteLength(text);
  const change = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;

  return (
    <div class="svg-tool">
      <div class="export-actions" role="group" aria-label="SVG output">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={mode === entry.id}
            title={entry.title}
            onClick={() => setMode(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <p class="svg-size">
        {formatBytes(before)} → {formatBytes(after)}
        {change > 0 ? ` · ${change}% smaller` : change < 0 ? ` · ${-change}% larger` : ' · same size'}
      </p>

      {preview ? (
        // An <img>, never inline markup: as an image an SVG runs no script and
        // loads nothing, which pasted markup from anywhere has to be held to.
        <div class="svg-preview">
          <img src={dataUri} alt="Preview of the SVG" />
        </div>
      ) : null}

      <CodeBlock
        text={text}
        language="markup"
        actions={
          editing ? (
            <button
              type="button"
              class="copy copy-icon"
              onClick={() => editing.save(dataUri, filename)}
            >
              <Icon name="export" size={12} />
              <span class="tab-label">Save as .svg</span>
            </button>
          ) : null
        }
      />
    </div>
  );
}

/**
 * The SVG tab: markup from anywhere, pasted in.
 *
 * Not tied to the page at all — the same optimizer for an icon copied out of
 * a design tool. The text is kept by the panel, so it survives switching tabs.
 */
export function SvgPasteSection({ text, onText }: { text: string; onText: (text: string) => void }) {
  return (
    <>
      <Group title="Paste SVG">
        <textarea
          class="svg-input"
          aria-label="SVG markup to optimize"
          placeholder="<svg …>…</svg>"
          value={text}
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => onText((event.target as HTMLTextAreaElement).value)}
        />
      </Group>
      {text.trim() ? (
        <Group title="Result">
          <SvgTool source={text} filename="optimized.svg" preview />
        </Group>
      ) : (
        <Empty>Paste SVG markup to optimize, minify or beautify it. It never leaves this tab.</Empty>
      )}
    </>
  );
}
