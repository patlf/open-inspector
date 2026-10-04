/**
 * The markup inside a `data:image/svg+xml` URI, or null for anything else.
 *
 * Both encodings occur in the wild: percent-encoded text, which is what most
 * build tools inline, and base64. Neither costs a request to read — the bytes
 * are already in the URL.
 */
export function decodeSvgDataUri(url: string): string | null {
  const match = /^data:image\/svg\+xml([^,]*),(.*)$/is.exec(url.trim());
  if (!match) return null;
  const meta = match[1] ?? '';
  const payload = match[2] ?? '';

  try {
    if (/;base64/i.test(meta)) {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}
