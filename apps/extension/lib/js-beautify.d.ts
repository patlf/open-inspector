/**
 * js-beautify's JavaScript formatter on its own, without the CSS and HTML
 * ones its main entry pulls in. The package's types cover only that entry.
 */
declare module 'js-beautify/js/src/javascript/index.js' {
  export default function beautify(source: string, options?: Record<string, unknown>): string;
}
