/**
 * Consumer permalink scanning — SSG-agnostic. Used by both candidates to
 * decide default-page suppression: a framework default page only exists when
 * the consumer does NOT own the same URL. Cheap frontmatter regex over the
 * consumer's pages/ (~100 files), not a full parse.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Extract and normalize the `permalink:` value from raw frontmatter.
 * @param {string} raw
 * @returns {string|null} normalized URL (`/about/` → `/about`, the canonical
 *   slash-free legacy UJM shape) or null
 */
function permalinkOf(raw) {
  const match = raw.match(/^permalink:\s*(.+?)\s*$/m);
  if (!match) return null;

  let url = match[1].replace(/^["']|["']$/g, '');
  if (url.length > 1) url = url.replace(/\/+$/, '');
  return url;
}

/**
 * Scan a consumer dir for the set of page URLs it owns.
 * @param {string} consumerDir
 * @returns {Set<string>} normalized URLs
 */
function scanConsumerPermalinks(consumerDir) {
  const urls = new Set();
  const pagesDir = path.join(consumerDir, 'pages');
  if (!fs.existsSync(pagesDir)) return urls;

  for (const entry of fs.readdirSync(pagesDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(md|html)$/.test(entry.name)) continue;

    const raw = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
    const url = permalinkOf(raw);
    if (url) urls.add(url);
  }

  return urls;
}

module.exports = { permalinkOf, scanConsumerPermalinks };
