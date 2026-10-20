/**
 * The URL a page serves at when its frontmatter names no permalink: the file
 * path under `pages/` IS the URL. The ONE derivation, shared by the engine's
 * permalink (engine.js `jekyllPermalink`) and the consumer scan
 * (consumer-scan.js `permalinkOf`), so a permalink-less page suppresses a
 * default page and collides exactly like one that spells its permalink.
 */

/**
 * Derive a page's URL from its input path: the path under `pages/` without its
 * extension, an `index` file collapsing to its folder, with a leading slash
 * and no trailing slash (`pages/guides/intro.md` → `/guides/intro`,
 * `pages/index.md` → `/`).
 * @param {string} inputPath - the page's path; the first `pages/` segment anchors it
 * @returns {string|null} the URL, or null for a file not under `pages/`
 */
function pageUrlFromPath(inputPath) {
  const match = inputPath.replace(/\\/g, '/').match(/(?:^|\/)pages\/(.+)$/);
  if (!match) return null;

  const rel = match[1].replace(/\.[^./]+$/, '').replace(/(?:^|\/)index$/, '');
  return `/${rel}`;
}

module.exports = { pageUrlFromPath };
