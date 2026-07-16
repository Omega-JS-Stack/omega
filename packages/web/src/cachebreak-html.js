/**
 * Build-time image cache-breaker — every LOCAL <img>/<source> URL in
 * rendered HTML gets ?cb=<build stamp> so image edits show up on rebuilds
 * without busting on every request. One stamp per build process, shared
 * with the uj_cachebreak filter and (via site.uj.cache_breaker) the runtime
 * lazy-loader.
 *
 * Local = site-relative or bare-relative URLs. External (http/https,
 * protocol-relative), data:/blob:, and empty srcs pass through; URLs that
 * already carry a cb param keep the value they have (an explicit
 * uj_cachebreak or author value wins).
 */

const IMG_TAG_PATTERN = /<(?:img|source)\b[^>]*>/gi;
// Lookbehind keeps data-src/data-srcset (and any *-src) out of scope
const SRC_ATTR_PATTERN = /(?<![-\w])(src|srcset)=(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Whether a URL is a first-party asset this build owns.
 * @param {string} url
 * @returns {boolean}
 */
function isLocal(url) {
  const value = String(url).trim();
  if (!value) return false;
  if (/^(https?:)?\/\//i.test(value)) return false;
  if (/^(data|blob|mailto|tel|javascript):/i.test(value)) return false;
  return true;
}

/**
 * Append the stamp to one URL (no-op for external/data/already-stamped).
 * @param {string} url
 * @param {string} stamp
 * @returns {string}
 */
function breakUrl(url, stamp) {
  if (!isLocal(url) || /[?&]cb=/.test(url)) return url;

  const [base, hash] = url.split('#');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}cb=${stamp}${hash ? `#${hash}` : ''}`;
}

/**
 * Stamp every candidate URL in a srcset value, keeping descriptors.
 * @param {string} value - srcset attribute value
 * @param {string} stamp
 * @returns {string}
 */
function breakSrcset(value, stamp) {
  return value
    .split(',')
    .map((candidate) => {
      const part = candidate.trim();
      if (!part) return part;
      const [url, ...descriptor] = part.split(/\s+/);
      return [breakUrl(url, stamp), ...descriptor].join(' ');
    })
    .join(', ');
}

/**
 * Rewrite an HTML document's <img>/<source> src + srcset attributes.
 * @param {string} html - rendered page
 * @param {string} stamp - build cache stamp (CACHE_TIMESTAMP)
 * @returns {string}
 */
function cachebreakHtml(html, stamp) {
  return String(html).replace(IMG_TAG_PATTERN, (tag) => tag.replace(
    SRC_ATTR_PATTERN,
    (attr, name, doubleQuoted, singleQuoted) => {
      const value = doubleQuoted !== undefined ? doubleQuoted : singleQuoted;
      const broken = name.toLowerCase() === 'srcset' ? breakSrcset(value, stamp) : breakUrl(value, stamp);
      const quote = doubleQuoted !== undefined ? '"' : "'";
      return `${name}=${quote}${broken}${quote}`;
    },
  ));
}

module.exports = { cachebreakHtml };
