/**
 * Runtime icon emission (C4 cp112) — every build ships the site's Font
 * Awesome set to `assets/fa/<style>/<name>.svg`, so browser-side dynamic
 * icons (`el.className = 'fa-solid fa-play'`, rendered by
 * @omega.js/client's icon-renderer) fetch from the site's OWN origin: no
 * CDN, no icon font, Pro included when the brand supplies one, and only
 * the icons a page actually uses ever transfer.
 *
 * The emitted set is the same chain uj_icon resolves at build time —
 * fontawesome-roots' [env/pro, free] plus the curated core icons — merged
 * lowest-priority-first so the best source wins per file.
 */
const fs = require('node:fs');
const path = require('node:path');

const { resolveFontAwesomeRoots } = require('./fontawesome-roots.js');

/**
 * Emit the merged icon set into the site output.
 *
 * @param {object} options
 * @param {string} options.outDir - Site output dir (_site).
 * @param {string} [options.coreIconsDir] - Curated core icons (highest priority).
 * @param {string[]} [options.svgsDirs] - Ordered svgs dirs, best-first
 *   (defaults to the resolved fontawesome-roots chain).
 * @returns {{ files: number, dest: string }} Emitted file count + dir.
 */
function emitIcons(options) {
  const svgsDirs = options.svgsDirs || resolveFontAwesomeRoots().svgsDirs;
  const dest = path.join(options.outDir, 'assets', 'fa');

  // Lowest priority first — later copies overwrite, so the chain's best
  // source (and finally the curated core set) wins per file.
  const sources = [...svgsDirs].reverse();
  if (options.coreIconsDir && fs.existsSync(options.coreIconsDir)) {
    sources.push(options.coreIconsDir);
  }

  for (const dir of sources) {
    if (fs.existsSync(dir)) {
      fs.cpSync(dir, dest, { recursive: true, force: true });
    }
  }

  let files = 0;
  for (const entry of fs.readdirSync(dest, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files++;
  }
  return { files, dest };
}

module.exports = { emitIcons };
