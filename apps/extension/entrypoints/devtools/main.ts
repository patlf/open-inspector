import { browser } from 'wxt/browser';

/**
 * The DevTools page: no UI of its own, only the tab it adds to the toolbox.
 *
 * Firefox loads it once DevTools opens on a tab, and only after the user has
 * granted the optional `devtools` permission in settings.
 *
 * It also tells the tab when it is shown and hidden. The tab follows the
 * Inspector's selection by asking for it, and should only ask while someone
 * is looking; these two events are where that is known.
 */
void browser.devtools.panels
  .create('Open Inspector', '/icon/32.png', '/devtools-panel.html')
  .then((panel) => {
    let shownIn: Window | null = null;
    const tell = (shown: boolean): void =>
      shownIn?.postMessage({ type: 'open-inspector:visibility', shown }, location.origin);

    panel.onShown.addListener((panelWindow) => {
      shownIn = panelWindow as Window;
      tell(true);
    });
    panel.onHidden.addListener(() => tell(false));
  });
