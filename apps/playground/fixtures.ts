/**
 * The awkward cases the engine has to survive, as DOM.
 *
 * Shared by the interactive playground and the headless end-to-end fixture
 * page. Deliberately contains no inspector wiring — the e2e page must have
 * exactly one overlay in it (the extension's), or assertions cannot tell which
 * one they are looking at.
 */

/** Two nested open shadow roots — the probe should reach the innermost button. */
class OuterWidget extends HTMLElement {
  connectedCallback(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .shell { padding: 16px; border: 2px dashed #b8451f; border-radius: 4px; }
      </style>
      <div class="shell"><inner-widget></inner-widget></div>
    `;
  }
}

class InnerWidget extends HTMLElement {
  connectedCallback(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        button {
          font: 13px ui-monospace, Menlo, monospace;
          padding: 10px 14px;
          margin: 8px;
          border: 2px solid #2c5f8a;
          border-radius: 3px;
          background: #eaf1f7;
          cursor: default;
        }
      </style>
      <button type="button">Two shadow roots deep</button>
    `;
  }
}

/** Closed root: unreachable by design, so the probe must report a boundary. */
class SealedWidget extends HTMLElement {
  connectedCallback(): void {
    const shadow = this.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <div style="padding:14px;border:2px solid #97671b;border-radius:3px;background:#fdf6e8;
                  font:13px ui-monospace,Menlo,monospace">
        Sealed contents
      </div>
    `;
  }
}

function paintScene(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;

  context.fillStyle = '#14181c';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#e4743f';

  for (let i = 0; i < 8; i += 1) {
    context.fillRect(16 + i * 36, 24 + (i % 3) * 12, 20, 42 - (i % 3) * 12);
  }
}

/** Define the custom elements and paint the canvas. Safe to call once. */
export function installFixtures(): void {
  if (!customElements.get('outer-widget')) customElements.define('outer-widget', OuterWidget);
  if (!customElements.get('inner-widget')) customElements.define('inner-widget', InnerWidget);
  if (!customElements.get('sealed-widget')) customElements.define('sealed-widget', SealedWidget);

  paintScene();
}
