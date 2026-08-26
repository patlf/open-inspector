import { useCallback, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { filterFields, useSearch } from './search.jsx';
import type { Field } from './view-model.js';

/**
 * Copy to clipboard without the async Clipboard API.
 *
 * `navigator.clipboard.writeText` requires the document to be focused and a
 * secure context, and content scripts frequently satisfy neither — the user is
 * clicking inside a shadow root on an http:// page. The execCommand fallback
 * is deprecated but is the only thing that works reliably here.
 */
function copyText(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();
  return copied;
}

export function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(() => {
    if (!copyText(text)) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [text]);

  return (
    <button
      type="button"
      class="copy"
      data-copied={copied ? "true" : "false"}
      title={`Copy ${text}`}
      onClick={onClick}
    >
      {copied ? 'copied' : label}
    </button>
  );
}

export function Swatch({ color }: { color: string }) {
  return (
    <span class="swatch" aria-hidden="true">
      <span style={{ background: color }} />
    </span>
  );
}

export function Row({ field }: { field: Field }) {
  return (
    <div class="row">
      <span class="row-label" title={field.label}>
        {field.label}
      </span>
      <span class="row-value">
        {field.swatch ? <Swatch color={field.swatch} /> : null}
        {/* Long composite values (shadows, URLs, font stacks) may break; short
            tokens like a hex code must not. */}
        <span class={field.value.length > 28 ? 'wrap' : undefined}>{field.value}</span>
        {field.detail ? <span class="row-detail">{field.detail}</span> : null}
      </span>
      <CopyButton text={field.copy ?? field.value} />
    </div>
  );
}

export function Rows({ fields }: { fields: Field[] }) {
  const visible = filterFields(fields, useSearch());

  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((field) => (
        <Row key={`${field.label}:${field.value}`} field={field} />
      ))}
    </>
  );
}

export function Group({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="group">
      <h2 class="group-title">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Explanatory text for an empty or unreadable section.
 *
 * Suppressed while a search is running. These lines explain why something is
 * missing, which is exactly what nobody wants to read fifteen times while
 * hunting for one property — and a group left holding only this would survive
 * the filter with nothing in it.
 */
export function Empty({ children }: { children: ComponentChildren }) {
  if (useSearch().trim()) return null;
  return <p class="empty">{children}</p>;
}

export function Badge({
  kind,
  children,
}: {
  kind: 'pass' | 'fail' | 'unknown';
  children: ComponentChildren;
}) {
  return <span class={`badge ${kind}`}>{children}</span>;
}

export function Meter({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div class="meter" role="presentation">
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}
