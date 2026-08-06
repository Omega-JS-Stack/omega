/**
 * Consumer permalink scanning — SSG-agnostic. Used by both candidates to
 * decide default-page suppression: a framework default page only exists when
 * the consumer does NOT own the same URL. Cheap frontmatter regex over the
 * consumer's pages/ (~100 files), not a full parse.
 *
 * The scan reads through the captured-read helper (@omega.js/devkit/reads) and is a
 * RESCAN capture (#200 Lane B): its dirs must never become config-reset
 * targets — every page edit lives under them, and the incremental rebuild lane
 * is the contract. Config-time callers wrap it in `reads.rescan(...)`
 * (src/decisions.js); outside a capture scope the reads record nothing.
 */
const path = require('node:path');
const reads = require('@omega.js/devkit/reads');

/**
 * Extract and normalize the `permalink:` value from a page's leading
 * frontmatter block. Only the block is scanned — a `permalink:` line in the
 * BODY (docs prose, fenced code samples) must never claim a URL, because a
 * bogus claim silently suppresses the framework default at that URL.
 * @param {string} raw - full page source
 * @returns {string|null} normalized URL (`/about/` → `/about`, the canonical
 *   slash-free legacy UJM shape) or null
 */
function permalinkOf(raw) {
  const fm = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;

  const match = fm[1].match(/^permalink:\s*(.+?)\s*$/m);
  if (!match) return null;

  // Quoted values win verbatim; unquoted values lose any trailing YAML comment
  const quoted = match[1].match(/^"([^"]*)"|^'([^']*)'/);
  let url = quoted ? (quoted[1] ?? quoted[2]) : match[1].replace(/\s+#.*$/, '');
  if (url.length > 1) url = url.replace(/\/+$/, '');
  return url;
}

/**
 * Scan a consumer dir for every page that claims a URL. One entry per FILE —
 * a collision has to name the files that claim the URL, not just the URL.
 * @param {string} consumerDir
 * @returns {Array<{ file: string, url: string }>} absolute path + normalized URL
 */
function scanConsumerPages(consumerDir) {
  const pages = [];
  const pagesDir = path.join(consumerDir, 'pages');
  if (!reads.dirExists(pagesDir)) return pages;

  for (const entry of reads.readdir(pagesDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(md|html)$/.test(entry.name)) continue;

    const file = path.join(entry.parentPath, entry.name);
    const url = permalinkOf(reads.read(file));
    if (url) pages.push({ file, url });
  }

  return pages;
}

/**
 * The URL a permalink is actually SERVED at: the engine's url transform drops
 * `.html` from every rendered URL and Eleventy collapses an index output to
 * its directory, so `/about`, `/about/` and `/about.html` are one page. The
 * suppression key is the permalink as written; this is what the browser sees,
 * which is what two files can collide on.
 * @param {string} url - a normalized permalink (permalinkOf's output)
 * @returns {string}
 */
function servedUrl(url) {
  const served = url.replace(/\.html$/, '').replace(/\/index$/, '').replace(/(.)\/+$/, '$1');
  return served === '' ? '/' : served;
}

/**
 * Find the URLs more than one file ships. Two shapes:
 *   - consumer vs consumer: two pages of the brand's own pages/ claiming one
 *     served URL, whichever spelling each used.
 *   - consumer vs framework: a consumer page landing on a default/showcase
 *     page's served URL WITHOUT suppressing it. Suppression (an exact
 *     permalink match) is the intended override and is never a collision — it
 *     is the only reason a framework page steps aside.
 * @param {object} input
 * @param {Array<{ label: string, url: string }>} input.pages - the consumer's pages
 * @param {Array<{ label: string, url: string }>} input.framework - the default/showcase pages that render
 * @returns {Array<{ url: string, claims: Array<{ label: string, url: string }> }>}
 */
function findPermalinkCollisions({ pages, framework }) {
  const claimed = new Map();
  for (const page of pages) {
    const url = servedUrl(page.url);
    claimed.set(url, [...(claimed.get(url) || []), page]);
  }
  const suppressed = new Set(pages.map((page) => page.url));

  const collisions = [...claimed]
    .filter(([, claims]) => claims.length > 1)
    .map(([url, claims]) => ({ url, claims }));

  for (const page of framework) {
    if (suppressed.has(page.url)) continue; // the consumer took the URL over — the default page never renders
    const url = servedUrl(page.url);
    const claims = claimed.get(url);
    if (!claims) continue;
    const collision = collisions.find((entry) => entry.url === url);
    if (collision) collision.claims.push(page);
    else collisions.push({ url, claims: [...claims, page] });
  }

  return collisions;
}

module.exports = {
  permalinkOf,
  scanConsumerPages,
  servedUrl,
  findPermalinkCollisions,
};
