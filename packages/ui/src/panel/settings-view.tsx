import { color } from '@open-inspector/core';
import { THEME_SETTINGS, type InspectorSettings, type ThemeSetting } from '../settings.js';
import { Empty, Group, Rows } from './primitives.jsx';

const FORMAT_LABELS: Record<color.ColorFormat, string> = {
  oklch: 'OKLCH',
  hex: 'HEX',
  hexa: 'HEXA',
  rgb: 'RGB',
  hsl: 'HSL',
};

const THEME_LABELS: Record<ThemeSetting, string> = {
  system: 'System',
  dark: 'Dark',
  light: 'Light',
};

/** Shown in each notation as it is picked: the panel's own accent. */
const SAMPLE: color.Rgba = { r: 228, g: 116, b: 63, a: 1 };

/**
 * The inspector's preferences, in the panel itself.
 *
 * Here rather than on an options page, so a change is one click from the
 * values it changes and shows up in them immediately.
 */
export function SettingsSection({
  settings,
  saved,
  onChange,
  onSetUpDevtools,
}: {
  settings: InspectorSettings;
  /** Whether a change outlives this session — true in the extension. */
  saved: boolean;
  onChange: (next: Partial<InspectorSettings>) => void;
  /** Opens the page that turns on the Firefox DevTools tab. Absent where there is none. */
  onSetUpDevtools?: (() => void) | undefined;
}) {
  const sample = color.formatAs(SAMPLE, settings.colorFormat);

  return (
    <>
      <Group title="Theme">
        <div class="export-actions" role="group" aria-label="Theme">
          {THEME_SETTINGS.map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={settings.theme === theme}
              onClick={() => onChange({ theme })}
            >
              {THEME_LABELS[theme]}
            </button>
          ))}
        </div>
        <Empty>System follows your operating system's light or dark setting.</Empty>
      </Group>

      <Group title="Color format">
        <div class="export-actions" role="group" aria-label="Color format">
          {color.COLOR_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              aria-pressed={settings.colorFormat === format}
              onClick={() => onChange({ colorFormat: format })}
            >
              {FORMAT_LABELS[format]}
            </button>
          ))}
        </div>
        <Rows fields={[{ label: 'example', value: sample, swatch: color.toHex(SAMPLE) }]} />
        <Empty>
          Used in the Styles and Color tabs, on the clipboard and in the exports. Matched rules stay
          as the stylesheet wrote them, and the design-tokens export stays hex, as that format
          expects.
        </Empty>
      </Group>

      {onSetUpDevtools ? (
        <Group title="Firefox DevTools">
          <p class="summary">
            Show the inspector as a tab in Firefox DevTools, next to the Inspector. Firefox asks
            for its permission when you turn it on, not before.
          </p>
          <div class="export-actions">
            <button type="button" onClick={onSetUpDevtools}>
              Set up the DevTools tab
            </button>
          </div>
        </Group>
      ) : null}

      <Empty>
        {saved
          ? 'Saved in this browser only. Never synced, and nothing about any page is kept.'
          : 'Lasts until the inspector closes; the extension saves it.'}
      </Empty>
    </>
  );
}
