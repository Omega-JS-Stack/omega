/**
 * Font Awesome build-side helpers (C4 cp111/112) — ONE implementation for
 * every target that assembles an icon set at build time (web site builds,
 * extension dist builds; desktop resolves at runtime in its own main lib).
 *
 * Root resolution, best-first:
 *
 *   1. OMEGA_FONTAWESOME_ROOT — a fontawesome.com "Pro for Web" download
 *      dir (contains svgs/ + metadata/); no npm token needed.
 *   2. @fortawesome/fontawesome-pro — installed by the brand with its own
 *      FA npm token. NEVER a dependency of any omega package (license).
 *   3. @fortawesome/fontawesome-free — the declared-dependency floor
 *      (web, desktop, extension all declare it).
 *
 * Every available rung stays in the chain, so a partial supply (an old
 * solid-only download) never loses icons a lower rung has. Preference
 * order itself is icon-core's PACKAGES — shared with desktop's runtime
 * icon server and the browser renderer so no surface can drift.
 */
const fs = require('node:fs');
const path = require('node:path');

const { PACKAGES } = require('@omega.js/client/modules/icon-core.js');

/**
 * Resolve the icon roots for a build.
 *
 * @param {object} [env] - Environment map (injectable for tests).
 * @returns {{ svgsDirs: string[], aliasFile: string, source: 'env'|'pro'|'free' }}
 *   svgsDirs — ordered svgs/ dirs (brand set first when present, free last);
 *   aliasFile — the richest icon-families.json available;
 *   source — where the winning set came from.
 */
function resolveFontAwesomeRoots(env = process.env) {
  const roots = [];
  let source = 'free';

  const envRoot = env.OMEGA_FONTAWESOME_ROOT;
  if (envRoot && fs.existsSync(path.join(envRoot, 'svgs'))) {
    roots.push(envRoot);
    source = 'env';
  }

  try {
    roots.push(path.dirname(require.resolve(`${PACKAGES[0]}/package.json`)));
    if (source === 'free') source = 'pro';
  } catch (e) {
    // Pro npm set not installed — the normal case for brands without a token
  }

  roots.push(path.dirname(require.resolve(`${PACKAGES[PACKAGES.length - 1]}/package.json`)));

  const aliasRoot = roots.find((root) => fs.existsSync(path.join(root, 'metadata', 'icon-families.json')))
    || roots[roots.length - 1];
  return {
    svgsDirs: roots.map((root) => path.join(root, 'svgs')),
    aliasFile: path.join(aliasRoot, 'metadata', 'icon-families.json'),
    source,
  };
}

/**
 * Emit the merged icon set into a build output — feeds the browser-side
 * auto-render (@omega.js/client icon-renderer): web fetches from the
 * site's own /assets/fa/, extension pages from
 * chrome.runtime.getURL('assets/fa/…'). Only icons a page actually uses
 * ever transfer.
 *
 * @param {object} options
 * @param {string} options.outDir - Build output dir (_site, dist).
 * @param {string} [options.coreIconsDir] - Curated core icons (highest priority).
 * @param {string[]} [options.svgsDirs] - Ordered svgs dirs, best-first
 *   (defaults to the resolved chain).
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

module.exports = { resolveFontAwesomeRoots, emitIcons };
