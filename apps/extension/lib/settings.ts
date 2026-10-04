import { browser } from 'wxt/browser';
import { normalizeSettings, type InspectorSettings } from '@open-inspector/ui';

/**
 * Where the settings live: `storage.local`, under one key.
 *
 * Local and never sync. The sync storage area uploads to the browser
 * vendor's servers, which would make a preference toggle the one thing this
 * extension sends anywhere, and the zero-egress guard refuses to build with it.
 */
const KEY = 'settings';

export async function loadSettings(): Promise<InspectorSettings> {
  const stored = await browser.storage.local.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function saveSettings(next: InspectorSettings): Promise<void> {
  await browser.storage.local.set({ [KEY]: next });
}

/**
 * Hear about changes made anywhere — the settings page in another tab, say.
 * Returns the unsubscribe, which a content script must call when it is
 * superseded or its listener outlives it.
 */
export function onSettingsChanged(listener: (settings: InspectorSettings) => void): () => void {
  const handle = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    const change = changes[KEY];
    if (area === 'local' && change) listener(normalizeSettings(change.newValue));
  };
  browser.storage.onChanged.addListener(handle);
  return () => browser.storage.onChanged.removeListener(handle);
}
