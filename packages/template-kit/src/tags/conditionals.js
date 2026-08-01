/**
 * conditionals.js — the conditional/control-flow omega_ tags.
 *
 * Ported from jekyll-uj-powertools lib/tags/{iftruthy,iffalsy,iffile,urlmatches}.rb.
 * Each tag is an engine-neutral renderer: `ctx` carries { lookup, page, site }
 * (built by the engine adapter), `markup` is the raw tag argument string, and
 * block tags receive `renderInner()` returning their rendered body.
 */

// Libraries
const { resolveInput, resolveVariable, parseArguments } = require('../variable-resolver.js');

/**
 * Truthy check matching the Ruby port: nil/false/''/0 are falsy.
 * @param {*} value
 * @returns {boolean}
 */
function isTruthy(value) {
  return !(value === null || value === undefined || value === false || value === '' || value === 0);
}

// {% iftruthy var %}...{% endiftruthy %}
const iftruthy = {
  block: true,
  render(ctx, markup, renderInner) {
    const value = resolveInput(ctx.lookup, markup.trim(), false);
    return isTruthy(value) ? renderInner() : '';
  },
};

// {% iffalsy var %}...{% endiffalsy %}
const iffalsy = {
  block: true,
  render(ctx, markup, renderInner) {
    const value = resolveInput(ctx.lookup, markup.trim(), false);
    return isTruthy(value) ? '' : renderInner();
  },
};

// {% iffile path %}...{% endiffile %} — body renders only if the static file exists
const iffile = {
  block: true,
  render(ctx, markup, renderInner) {
    let path = resolveFilePath(ctx, markup.trim());
    if (!path) return '';

    if (!String(path).startsWith('/')) path = `/${path}`;
    return ctx.site.fileExists(path) ? renderInner() : '';
  },
};

/**
 * Resolve the iffile path argument: quoted = literal; bare tokens resolve as
 * variables, falling back to the literal markup only when the root segment is
 * also undefined in context (Ruby parity).
 */
function resolveFilePath(ctx, markup) {
  if (!markup) return null;

  const quoted = markup.match(/^["'](.*)["']$/);
  if (quoted) return quoted[1];

  const resolved = resolveVariable(ctx.lookup, markup);
  if (resolved !== null && resolved !== undefined) return resolved;

  const root = markup.split('.')[0];
  const rootValue = ctx.lookup(root);
  return (rootValue === null || rootValue === undefined) ? markup : null;
}

// {% urlmatches "/pricing", "active" %} — outputs arg2 (default "active") when
// the current page URL matches arg1 (index.html-normalized)
const urlmatches = {
  block: false,
  render(ctx, markup) {
    const args = parseArguments(markup);
    const url = args[0] || '';
    const outputArg = args[1] || 'active';

    const pageUrl = ctx.page ? ctx.page.url : null;
    const checkUrl = resolveInput(ctx.lookup, url, true);
    const output = resolveInput(ctx.lookup, outputArg, true);

    return normalizeUrl(pageUrl) === normalizeUrl(checkUrl) ? output : '';
  },
};

/**
 * Normalize a URL for comparison: strip trailing index.html, ensure trailing slash.
 * @param {string|null} url
 * @returns {string|null}
 */
function normalizeUrl(url) {
  if (url === null || url === undefined) return null;

  let normalized = String(url).replace(/index\.html?$/, '');
  if (normalized !== '/' && !normalized.endsWith('/')) normalized += '/';
  return normalized;
}

module.exports = { iftruthy, iffalsy, iffile, urlmatches, isTruthy, normalizeUrl };
