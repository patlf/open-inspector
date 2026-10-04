import { Component, type ComponentChildren } from 'preact';
import type * as PrismApi from 'prismjs';
// Prism's core and single languages, never the package's main file: that one
// also bundles the file-highlight plugin, which loads code over the network,
// and the egress guard would rightly refuse it.
import 'prismjs/components/prism-core.js';
import 'prismjs/components/prism-markup.js';
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-clike.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-scss.js';

/**
 * Syntax highlighting for the panel's code blocks.
 *
 * The languages register themselves on a global `Prism` that the core sets
 * up, so that is where it is read from. In the extension this is the content
 * script's own world, never the page's.
 */
const Prism = (window as unknown as { Prism: typeof PrismApi }).Prism;

/*
 * Left alone, Prism highlights every `code.language-*` element in the
 * document on the next frame, and here that document is the page being
 * inspected. It checks again when that frame comes, so this is in time.
 */
Prism.manual = true;

export type CodeLanguage = 'markup' | 'jsx' | 'css' | 'scss' | 'javascript' | 'json';

/**
 * Past this many characters a block is shown plain. The panel repaints on
 * every settled hover, and a whole bundle's worth of spans is not worth that.
 */
const HIGHLIGHT_LIMIT = 50_000;

/**
 * Prism's tokens as Preact elements rather than its HTML string: what is
 * shown is the page's own code, and none of it should pass through innerHTML.
 */
function toNodes(stream: PrismApi.TokenStream): ComponentChildren {
  if (typeof stream === 'string') return stream;
  if (Array.isArray(stream)) return stream.map(toNodes);

  const aliases = stream.alias ? ([] as string[]).concat(stream.alias) : [];
  const classes = ['tok-' + stream.type, ...aliases.map((alias) => 'tok-' + alias)].join(' ');
  return <span class={classes}>{toNodes(stream.content)}</span>;
}

/**
 * Code, tokenized, for inside a `<pre>`. Only redrawn when its text or
 * language changes, since the rest of the panel repaints far more often.
 */
export class Highlighted extends Component<{ text: string; language?: CodeLanguage | undefined }> {
  override shouldComponentUpdate(next: { text: string; language?: CodeLanguage | undefined }): boolean {
    return next.text !== this.props.text || next.language !== this.props.language;
  }

  override render(): ComponentChildren {
    const { text, language } = this.props;
    const grammar = language ? Prism.languages[language] : undefined;
    if (!grammar || text.length > HIGHLIGHT_LIMIT) return text;
    return toNodes(Prism.tokenize(text, grammar));
  }
}
