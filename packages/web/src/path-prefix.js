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
 * Mount every candidate URL in a srcset value, keeping descriptors.
 * @param {string} value - srcset attribute value
 * @param {string} prefix
 * @returns {string}
 */
function prefixSrcset(value, prefix) {
  return value
    .split(',')
    .map((candidate) => {
      const part = candidate.trim();
      if (!part) return part;
      const [url, ...descriptor] = part.split(/\s+/);
      return [prefixUrl(url, prefix), ...descriptor].join(' ');
    })
    .join(', ');
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
        ? prefixSrcset(value, prefix)
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

module.exports = { resolvePathPrefix, prefixUrl, prefixHtml, prefixCss };
