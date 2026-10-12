/**
 * fnSource(fn): the BODY text of a function, so a page or a worker that
 * cannot receive the function itself rebuilds it as `new Function('ctx', body)`
 * or inside an evaluated payload. The rebuilt body sees `ctx` and the page's
 * globals only, never the closure the function was written in.
 */

// A single-parameter arrow written without parentheses: `ctx => ...`, `async ctx => ...`.
const BARE_ARROW = /^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*(?==>)/;

/**
 * The index of the `)` closing the `(` at `open`, by paren depth.
 * @param {string} src - The function source.
 * @param {number} open - The index of an opening `(`.
 * @returns {number} The closing index, or -1 when the parens never balance.
 */
function closingParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    if (src[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/**
 * A function's parameter list and the source after it: `=> ...` for an arrow, `{ ... }` otherwise.
 * @param {string} src - The function source.
 * @returns {{params: string, rest: string}|null} Both trimmed, or null when no parameter list is found.
 */
function splitParams(src) {
  const bare = src.match(BARE_ARROW);
  if (bare) return { params: bare[0].replace(/^\s*async\s+/, '').trim(), rest: src.slice(bare[0].length).trim() };
  const open = src.indexOf('(');
  const close = open === -1 ? -1 : closingParen(src, open);
  return close === -1 ? null : { params: src.slice(open + 1, close).trim(), rest: src.slice(close + 1).trim() };
}

/**
 * The body text of a function: an arrow (block or expression body, async or not),
 * a `function` expression, or a method shorthand. An expression body comes back as
 * `return (<expr>);`, the expression on lines of its own.
 * @param {Function} fn - The function to serialize.
 * @returns {string} The body, ready for `new Function('ctx', body)`.
 * @throws {Error} When `fn` is bound or native, takes a parameter other than `ctx`, or has no rebuildable body.
 */
function fnSource(fn) {
  const src = Function.prototype.toString.call(fn);
  const split = /\[native code\]\s*\}\s*$/.test(src) ? null : splitParams(src);
  if (split && split.params && split.params !== 'ctx') {
    throw new Error(`fnSource: ${fn.name || 'anonymous'} takes (${split.params}), and a rebuilt body sees only ctx`);
  }
  const rest = split && split.rest;
  const arrowBody = rest != null && rest.startsWith('=>') ? rest.slice(2).trim() : null;

  // On its own line, so a comment leading the expression cannot end the return early.
  if (arrowBody !== null && !arrowBody.startsWith('{')) return `return (\n${arrowBody}\n);`;
  const block = arrowBody !== null ? arrowBody : rest;
  if (block !== null && block.startsWith('{') && block.endsWith('}')) return block.slice(1, -1);

  throw new Error(`fnSource: ${fn.name || 'anonymous'} has no source to rebuild`);
}

module.exports = { fnSource };
