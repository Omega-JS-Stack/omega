/**
 * Base-path support (#355) — the build-time half of serving a site under a URL
 * PATH instead of a domain root (`https://<user>.github.io/<repo>/`, the
 * GitHub Pages project-site case). Every URL the build writes is root-relative,
 * so a site mounted under a path asks the DOMAIN root for its assets and 404s.
 *
 * The base path is a PUBLISHER input, never an end-user one: whatever machinery
 * publishes the site knows its mount point (workkit's publish reads it off the
 * Pages API) and exports `OMEGA_PATH_PREFIX` around `omega build`. Hosts that
 * serve at the domain root (Netlify, Vercel, a custom domain) pass nothing.
 *
 * Three emit lanes carry it, one mechanism each:
 *   HTML - the `omega-path-prefix` Eleventy transform (src/engine.js), which
 *          rewrites the URL attributes of a rendered page and stamps the value
 *          on <html> for the browser half. The asset MANIFEST stays
 *          root-relative on purpose: it is an internal index, and the transform
 *          is the ONE place its URLs become markup — prefixing both would
 *          mount them twice.
 *   CSS  - the emit step in src/assets.js (theme sheets carry
 *          `url(/assets/fonts/…)`, which no HTML pass can reach).
 *   JS   - core/js/libs/path-prefix.js, the browser helper that reads the
 *          stamp; nothing is baked into a bundle.
 *
 * An unset (or `/`) prefix is a no-op everywhere — the transform is not even
 * registered — so today's output is unchanged byte for byte.
 */

const { mapSrcset } = require('./srcset.js');

// The attributes a browser resolves as a URL. The lookbehind keeps `data-src`,
// `data-srcset` and friends out of scope (same guard cachebreak-html.js uses):
// those are runtime-consumed values, and the browser half mounts them itself.
const URL_ATTR_PATTERN = /(?<![-\w])(href|src|srcset|action)=(?:"([^"]*)"|'([^']*)')/gi;

// A url() target in emitted CSS, with or without quotes.
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;

/**
 * Normalize a publisher-supplied base path. External input, so it is treated
 * defensively: leading slash ensured, trailing slashes stripped, inner doubles
 * collapsed. `/` (and anything empty) means "serves at the domain root" and
 * normalizes to '' — the no-op every lane tests for.
 * @param {string|undefined|null} value - e.g. process.env.OMEGA_PATH_PREFIX
 * @returns {string} '' (no prefix) or a normalized '/base' with no trailing slash
 */
function resolvePathPrefix(value) {
  const trimmed = String(value == null ? '' : value).trim();
  const prefix = `/${trimmed}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '');

  return prefix === '/' ? '' : prefix;
}

/**
 * Mount one URL under the base path. Only ROOT-RELATIVE URLs move: absolute
 * and protocol-relative URLs belong to another origin, and bare-relative ones
 * (and anchors, mailto:, data: …) already resolve against the mounted page.
 * @param {string} url
 * @param {string} prefix - resolvePathPrefix output
 * @returns {string}
 */
function prefixUrl(url, prefix) {
  if (!prefix) return url;

  const value = String(url);
  if (!value.startsWith('/') || value.startsWith('//')) return value;

  return `${prefix}${value}`;
}

/**
 * The inverse of prefixUrl: the SITE-relative path of an already mounted URL.
 * Post-build passes that reason about routes (the translation pass composes
 * prefix-then-lang, #359) need the route the build knows, not the mounted one.
 * A path that does not carry the prefix is returned as it came.
 * @param {string} pathname - a root-relative path
 * @param {string} prefix - resolvePathPrefix output
 * @returns {string}
 */
function stripPathPrefix(pathname, prefix) {
  const value = String(pathname);
  if (!prefix || !(value === prefix || value.startsWith(`${prefix}/`))) return value;

  return value.slice(prefix.length) || '/';
}

/**
 * The base path a built page carries. prefixHtml stamps the mount point on
 * <html> for the browser half, and that stamp is equally the record a
 * post-build pass reads instead of re-plumbing the publisher's value.
 * @param {string} html - a built page
 * @returns {string} resolvePathPrefix output ('' when the page is unmounted)
 */
function readPathPrefixStamp(html) {
  const match = /<html\b[^>]*\bdata-omega-path-prefix="([^"]*)"/i.exec(String(html));

  return resolvePathPrefix(match ? match[1] : '');
}

/**
 * The base path a whole BUILD carries, off the stamp `prefixHtml` leaves on
 * <html> — one answer for the post-build passes that read a dist page by page
 * (the #468 audit, the #430 link check). '' (an unmounted site) is what most
 * builds answer, and the first stamped page settles it: one build, one mount.
 * @param {Iterable<string>} pages - the built pages' HTML
 * @returns {string} resolvePathPrefix output
 */
function readBuildPathPrefix(pages) {
  for (const html of pages) {
    const stamp = readPathPrefixStamp(html);
    if (stamp) return stamp;
  }

  return '';
}

/**
 * Rewrite a rendered page for a mounted site: every root-relative URL
 * attribute moves under the base path, and <html> carries the value so the
 * browser half (core/js/libs/path-prefix.js) can build URLs too.
 * @param {string} html - rendered page
 * @param {string} prefix - resolvePathPrefix output ('' → the page is returned as-is)
 * @returns {string}
 */
function prefixHtml(html, prefix) {
  if (!prefix) return html;

  const mounted = String(html).replace(
    URL_ATTR_PATTERN,
    (attr, name, doubleQuoted, singleQuoted) => {
      const value = doubleQuoted !== undefined ? doubleQuoted : singleQuoted;
      const quote = doubleQuoted !== undefined ? '"' : "'";
      const next = name.toLowerCase() === 'srcset'
        ? mapSrcset(value, (url) => prefixUrl(url, prefix))
        : prefixUrl(value, prefix);

      return `${name}=${quote}${next}${quote}`;
    },
  );

  // Stamped AFTER the rewrite, so the value itself can never be mounted twice.
  return mounted.replace(/<html\b/i, `<html data-omega-path-prefix="${prefix}"`);
}

/**
 * Rewrite an emitted stylesheet for a mounted site — the @font-face and
 * background url() targets theme sheets write root-relative.
 * @param {string} css - compiled stylesheet
 * @param {string} prefix - resolvePathPrefix output ('' → the sheet is returned as-is)
 * @returns {string}
 */
function prefixCss(css, prefix) {
  if (!prefix) return css;

  return String(css).replace(
    CSS_URL_PATTERN,
    (match, doubleQuoted, singleQuoted, bare) => {
      const value = doubleQuoted ?? singleQuoted ?? bare;
      const next = prefixUrl(value, prefix);
      if (next === value) return match;

      const quote = doubleQuoted !== undefined ? '"' : (singleQuoted !== undefined ? "'" : '');
      return `url(${quote}${next}${quote})`;
    },
  );
}

module.exports = { resolvePathPrefix, prefixUrl, stripPathPrefix, readPathPrefixStamp, readBuildPathPrefix, prefixHtml, prefixCss };
