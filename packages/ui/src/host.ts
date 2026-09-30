/**
 * Defending our host elements against the page they are mounted in.
 *
 * Both hosts — the overlay and the panel — sit in a document we do not
 * control, and two things about that document can reach them even through a
 * shadow boundary:
 *
 * - **Page CSS on the host itself.** `:host { all: initial }` in our shadow
 *   stylesheet loses to any page rule with `!important`, and inherited
 *   properties (`text-transform`, `text-align`, `cursor`, `letter-spacing`)
 *   then flow into everything we render. Inline `!important` is the one
 *   author-level declaration a page stylesheet cannot beat.
 * - **A containing block we did not ask for.** `position: fixed` means "the
 *   viewport" only until an ancestor has a transform, filter or contain. A
 *   page that transforms `<html>` turned the panel into a 200px sliver. The
 *   top layer — a manual popover — is the one place no ancestor can reach.
 */

/**
 * Reset the host to initial values, then apply its own geometry, all inline
 * and `!important`. `all` comes first so the specific values below override
 * the longhands it expanded into.
 */
export function lockHost(host: HTMLElement, rules: Record<string, string>): void {
  host.style.setProperty('all', 'initial', 'important');

  const popoverResets: Record<string, string> = {
    // The UA popover style centres, pads, borders and paints its element.
    right: 'auto',
    bottom: 'auto',
    overflow: 'visible',
    background: 'transparent',
    color: 'inherit',
  };

  for (const [property, value] of Object.entries({ ...popoverResets, ...rules })) {
    host.style.setProperty(property, value, 'important');
  }
}

/**
 * Put a connected host into the top layer, where no page transform or
 * stacking context can contain it. Silently skipped where popovers are
 * unsupported (Firefox before 125); the z-index still applies there.
 */
export function raiseToTopLayer(host: HTMLElement): void {
  if (typeof host.showPopover !== 'function' || !host.isConnected) return;
  if (!host.hasAttribute('popover')) host.setAttribute('popover', 'manual');
  try {
    // Hide first so a second call re-inserts it at the top of the stack.
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch {
    // A page that has already put our host somewhere odd; stay in the flow.
  }
}
