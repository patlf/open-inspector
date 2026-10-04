import type { PanelTab } from './view-model.js';

/**
 * The panel's icons, drawn inline.
 *
 * Inline rather than an icon font or sprite file: the panel lives in a shadow
 * root on pages we do not control, and anything fetched would be a request
 * the extension promises never to make. Every glyph is a 16-unit stroke
 * drawing in `currentColor`, so a button's colour is its icon's colour.
 */
const PATHS = {
  styles: 'M3 4h10M3 8h10M3 12h10M6 2.6v2.8M10 6.6v2.8M5 10.6v2.8',
  color: 'M8 2.2c2.4 3 4 5 4 7.1a4 4 0 0 1-8 0c0-2.1 1.6-4.1 4-7.1z',
  type: 'M3.5 4.5V3h9v1.5M8 3v10M6 13h4',
  layout: 'M4 2.5h8A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5zM2.5 6.5h11M6.5 6.5v7',
  assets: 'M4 3h8a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 3zM13.5 10.5l-3-3-6 5.5M6 5.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z',
  markup: 'M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3',
  export: 'M8 2.5v8M5 7.5l3 3 3-3M3 12.5h10',
  // Drawn so its bounding box is centred on 8,8: a cursor's point sits top-left,
  // and centring the tip instead made it look pushed off to one side.
  pointer: 'M3 2.9l3.8 10.2 1.5-4.4 4.4-1.5z',
  flip: 'M2.5 5.5h11M11 3l2.5 2.5L11 8M13.5 10.5h-11M5 8l-2.5 2.5L5 13',
  collapse: 'M4 4l4 4-4 4M9 4l4 4-4 4',
  expand: 'M12 4L8 8l4 4M7 4L3 8l4 4',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  help: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM6.4 6.4a1.6 1.6 0 1 1 2.2 1.5c-.4.2-.6.5-.6.9v.4M8 11h.01',
  up: 'M8 12.5v-9M4.5 7L8 3.5 11.5 7',
  down: 'M8 3.5v9M4.5 9L8 12.5 11.5 9',
  left: 'M12.5 8h-9M7 4.5L3.5 8 7 11.5',
  right: 'M3.5 8h9M9 4.5L12.5 8 9 11.5',
  // A parent row with two children hanging off it.
  tree: 'M2.5 3.5h6M4.5 3.5v8.5M4.5 8h2M4.5 12h2M8.5 8h5M8.5 12h5',
  // Points right when a tree row is closed; rotated a quarter turn when open.
  caret: 'M6 4l4 4-4 4',
  // Chevrons pointing apart, then together: the tree opening and closing.
  expandAll: 'M5 6l3-3 3 3M5 10l3 3 3-3',
  collapseAll: 'M5 3l3 3 3-3M5 13l3-3 3 3',
  eye: 'M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
  eyeOff: 'M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM2.5 13.5l11-11',
  search: 'M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3 3',
  // A board with its clip on top, and the tick it turns into once copied.
  clipboard:
    'M5.5 3.5h-1A1.5 1.5 0 0 0 3 5v8a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5a1.5 1.5 0 0 0-1.5-1.5h-1M6.5 2h3a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
  check: 'M3.5 8.5l3 3 6-7',
  coffee: 'M3 6.5h8V10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM11 7.5h1a1.5 1.5 0 0 1 0 3h-1M5.5 2.5V4M8.5 2.5V4',
  // A bezier curve between two anchor points: vector artwork.
  svg: 'M4 12C5.5 6.5 10.5 9.5 12 4M2.5 11h3v3h-3zM10.5 2.5h3v3h-3z',
  // An eight-tooth cog around a hub. Teeth with flat tops and a solid body,
  // because thin spokes round a small circle read as a sun — the light/dark
  // toggle — rather than as settings.
  settings:
    'M6.93 3.53L7.05 1.67L8.95 1.67L9.07 3.53A4.6 4.6 0 0 1 10.4 4.08L11.81 2.86L13.14 4.19L11.92 5.6A4.6 4.6 0 0 1 12.47 6.93L14.33 7.05L14.33 8.95L12.47 9.07A4.6 4.6 0 0 1 11.92 10.4L13.14 11.81L11.81 13.14L10.4 11.92A4.6 4.6 0 0 1 9.07 12.47L8.95 14.33L7.05 14.33L6.93 12.47A4.6 4.6 0 0 1 5.6 11.92L4.19 13.14L2.86 11.81L4.08 10.4A4.6 4.6 0 0 1 3.53 9.07L1.67 8.95L1.67 7.05L3.53 6.93A4.6 4.6 0 0 1 4.08 5.6L2.86 4.19L4.19 2.86L5.6 4.08A4.6 4.6 0 0 1 6.93 3.53ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
} as const;

/**
 * The JavaScript logo: a square with the letters cut out of it. Exported
 * for the page overlay, which draws it without Preact.
 */
export const JS_LOGO = {
  viewBox: '0 0 128 128',
  d: 'M2 1v125h125V1zm66.119 106.513c-1.845 3.749-5.367 6.212-9.448 7.401-6.271 1.44-12.269.619-16.731-2.059-2.986-1.832-5.318-4.652-6.901-7.901l9.52-5.83c.083.035.333.487.667 1.071 1.214 2.034 2.261 3.474 4.319 4.485 2.022.69 6.461 1.131 8.175-2.427 1.047-1.81.714-7.628.714-14.065C58.433 78.073 58.48 68 58.48 58h11.709c0 11 .06 21.418 0 32.152.025 6.58.596 12.446-2.07 17.361m48.574-3.308c-4.07 13.922-26.762 14.374-35.83 5.176-1.916-2.165-3.117-3.296-4.26-5.795 4.819-2.772 4.819-2.772 9.508-5.485 2.547 3.915 4.902 6.068 9.139 6.949 5.748.702 11.531-1.273 10.234-7.378-1.333-4.986-11.77-6.199-18.873-11.531-7.211-4.843-8.901-16.611-2.975-23.335 1.975-2.487 5.343-4.343 8.877-5.235l3.688-.477c7.081-.143 11.507 1.727 14.756 5.355.904.916 1.642 1.904 3.022 4.045-3.772 2.404-3.76 2.381-9.163 5.879-1.154-2.486-3.069-4.046-5.093-4.724-3.142-.952-7.104.083-7.926 3.403-.285 1.023-.226 1.975.227 3.665 1.273 2.903 5.545 4.165 9.377 5.926 11.031 4.474 14.756 9.271 15.672 14.981.882 4.916-.213 8.105-.38 8.581',
} as const;

/**
 * Marks drawn by someone else, kept as they drew them: filled rather than
 * stroked, at their own scale. Still `currentColor`, so they take their
 * ink from where they sit like the rest.
 */
const FILLED = {
  js: JS_LOGO,
} as const;

export type IconName = keyof typeof PATHS | keyof typeof FILLED;

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  if (name in FILLED) {
    const mark = FILLED[name as keyof typeof FILLED];
    return (
      <svg
        class="icon"
        viewBox={mark.viewBox}
        width={size}
        height={size}
        aria-hidden="true"
        fill="currentColor"
      >
        <path d={mark.d} />
      </svg>
    );
  }

  return (
    <svg
      class="icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={PATHS[name as keyof typeof PATHS]} />
    </svg>
  );
}

/** Which glyph stands for which tab on the rail. */
export const TAB_ICONS: Record<PanelTab, IconName> = {
  styles: 'styles',
  color: 'color',
  type: 'type',
  layout: 'layout',
  assets: 'assets',
  markup: 'markup',
  js: 'js',
  export: 'export',
  svg: 'svg',
  settings: 'settings',
};
