import { useCallback, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { filterFields, useSearch } from './search.jsx';
import type { Field } from './view-model.js';

/**
 * Copy text, and report honestly whether it worked.
 *
 * Two routes, because neither works everywhere a content script runs:
 *
 * - `execCommand('copy')` is synchronous and needs no focus or secure
 *   context, but from an extension's isolated world Chrome performs the copy
 *   and still returns `false` — so the button never said "copied". The
 *   `copy` event on the textarea is what gets trusted instead.
 * - `navigator.clipboard.writeText` reports success properly, but only exists
 *   on secure pages and needs the document focused.
 *
 * The textarea goes inside our own shadow root where the engine allows it, so
 * a page's `copy` or `focusin` listeners never see it.
 */
function copyVia(container: Node, text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText = 'position:fixed;top:-1000px;opacity:0;';

  // The copy event fires only when the copy really happens, which makes it a
  // truthful signal where the return value is not.
  let fired = false;
  textarea.addEventListener('copy', () => {
    fired = true;
  });

  container.appendChild(textarea);
  textarea.select();
  let returned = false;
  try {
    returned = document.execCommand('copy');
  } catch {
    returned = false;
  }
  textarea.remove();
  return returned || fired;
}

export async function copyText(text: string, near?: Node | null): Promise<boolean> {
  // Our own shadow root first, so the page's listeners never see the text;
  // the page's body if the engine will not select inside a shadow tree.
  const root = near?.getRootNode();
  if (root instanceof ShadowRoot && copyVia(root, text)) return true;
  const body = document.body ?? document.documentElement;
  if (body && copyVia(body, text)) return true;

  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(
    async (event: MouseEvent) => {
      if (!(await copyText(text, event.currentTarget as Node))) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    },
    [text],
  );

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
