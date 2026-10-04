import type { script } from '@open-inspector/core';
import type { PanelData } from './view-model.js';
import { Highlighted } from './highlight.jsx';
import { CodeBlock, CopyButton, Empty, Group, formatBytes } from './primitives.jsx';

const VIA_LABELS: Record<script.HandlerSource, string> = {
  attribute: 'attribute',
  link: 'javascript: link',
  property: 'property',
  react: 'React',
  vue: 'Vue',
  jquery: 'jQuery',
};

function HandlerItem({ handler }: { handler: script.ScriptHandler }) {
  return (
    <li class="js-item">
      <div class="js-head">
        <span class="js-event">{handler.event}</span>
        <span class="js-tag">{VIA_LABELS[handler.via]}</span>
        {handler.name ? <span class="js-name">{handler.name}</span> : null}
        {handler.selector ? <span class="js-detail">on {handler.selector}</span> : null}
      </div>
      {/* Focusable, so a keyboard user can scroll a long one. */}
      {handler.source ? (
        <pre class="js-source" tabIndex={0}>
          <Highlighted text={handler.source} language="javascript" />
        </pre>
      ) : null}
    </li>
  );
}

function ScriptItem({ entry }: { entry: script.PageScript }) {
  return (
    <li class="js-item">
      <div class="js-head">
        <span class="js-name" title={entry.url}>
          {entry.name}
        </span>
        {entry.kind !== 'classic' ? <span class="js-tag">{entry.kind}</span> : null}
        {entry.async ? <span class="js-tag">async</span> : null}
        {entry.defer ? <span class="js-tag">defer</span> : null}
        {entry.bytes !== undefined ? <span class="js-detail">{formatBytes(entry.bytes)}</span> : null}
        {entry.url ? (
          <span class="js-actions">
            <CopyButton text={entry.url} label="copy URL" />
          </span>
        ) : null}
      </div>
      {entry.text ? (
        <details class="js-more">
          <summary>source</summary>
          <CodeBlock text={entry.text} language="javascript" />
        </details>
      ) : null}
    </li>
  );
}

/**
 * The JS view: what JavaScript is wired to the selected element, and which
 * scripts the page runs.
 *
 * Says what it could not see. Listeners added with `addEventListener` are
 * kept where only DevTools reaches, so an empty list is not proof of no
 * handlers; and without the extension's page-world read only inline handlers
 * are visible at all.
 */
export function ScriptSection({ data }: { data: PanelData }) {
  const handlers = data.handlers ?? [];
  const scripts = data.page?.scripts;
  const reach =
    data.handlersRead === 'page'
      ? 'Read from inline attributes, on… properties, React, Vue and jQuery.'
      : 'Inline attributes only: the page’s own scripts could not be read here.';

  return (
    <>
      <Group title="Event handlers">
        {handlers.length === 0 ? (
          <Empty>No handlers found on this element.</Empty>
        ) : (
          <ul class="js-list">
            {handlers.map((handler, index) => (
              <HandlerItem key={`${handler.via}:${handler.event}:${index}`} handler={handler} />
            ))}
          </ul>
        )}
        <p class="js-note">
          {reach} Listeners added with addEventListener show only in the browser’s DevTools.
        </p>
      </Group>

      <Group title={scripts ? `Scripts on this page (${scripts.length})` : 'Scripts on this page'}>
        {!scripts ? (
          <Empty>Scanning…</Empty>
        ) : scripts.length === 0 ? (
          <Empty>This page has no script elements.</Empty>
        ) : (
          <ul class="js-list">
            {scripts.map((entry, index) => (
              <ScriptItem key={`${entry.url ?? 'inline'}:${index}`} entry={entry} />
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}
