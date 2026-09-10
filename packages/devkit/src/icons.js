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

const {
  PACKAGES, ICONS_DIR, candidateRelPaths, buildAliasMap,
} = require('@omega.js/client/modules/icon-core.js');

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
 * site's own /assets/icons/, extension pages from
 * chrome.runtime.getURL('assets/icons/…'). Only icons a page actually uses
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
  const dest = path.join(options.outDir, 'assets', ICONS_DIR);

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

/**
 * The flag set carries hardcoded width/height="512" on the root — strip them
 * so icon-core's standard 1em inline-icon sizing applies (Font Awesome
 * sources never carry dimensions; the flags are the exception).
 *
 * @param {string} svg - Raw SVG source.
 * @returns {string} SVG with any root width/height removed.
 */
function stripRootSize(svg) {
  return svg.replace(/<svg([^>]*)>/, (match, attrs) => `<svg${attrs.replace(/\s(?:width|height)="[^"]*"/g, '')}>`);
}

/**
 * A build-time icon reader over a resolved chain — the file-reading half of
 * icon-core, which owns every decision ABOUT the files (candidate order,
 * aliases) but reads none of them. Web's build-time inlining pass
 * (@omega.js/web src/inline-icons.js) is the caller; the browser reads the
 * SAME bytes at runtime out of what `emitIcons` shipped.
 *
 * Aliases and file contents are cached for the process — a site inlines the
 * same chrome icons on every one of its pages.
 *
 * @param {object} options
 * @param {string[]} options.svgsDirs - Ordered icon roots, best-first (each
 *   holding `<style>/<name>.svg`).
 * @param {string} [options.aliasFile] - icon-families.json for alias
 *   resolution ('search' → 'magnifying-glass').
 * @returns {function(string, string): (string|null)} (name, style) → raw SVG.
 */
function createIconLoader(options) {
  const dirs = options.svgsDirs || [];
  const cache = new Map();
  let aliases = null;

  const aliasFor = (name) => {
    if (!aliases) {
      aliases = new Map();
      try {
        aliases = buildAliasMap(JSON.parse(fs.readFileSync(options.aliasFile, 'utf8')));
      } catch {
        // No (readable) metadata in this chain — resolve without aliases.
      }
    }
    return aliases.get(name) || null;
  };

  return function loadIcon(name, style) {
    const key = `${style}/${name}`;
    if (cache.has(key)) return cache.get(key);

    const alias = aliasFor(name);
    let svg = null;

    for (const dir of dirs) {
      for (const candidate of (alias ? [name, alias] : [name])) {
        for (const rel of candidateRelPaths(candidate, style)) {
          try {
            svg = fs.readFileSync(path.join(dir, rel), 'utf8');
          } catch {
            continue;
          }
          break;
        }
        if (svg) break;
      }
      if (svg) break;
    }

    if (svg) svg = stripRootSize(svg);
    cache.set(key, svg);
    return svg;
  };
}

// ICONS_DIR is icon-core's, re-exported here so the build side has one import
// for the whole icon contract.
module.exports = { ICONS_DIR, resolveFontAwesomeRoots, emitIcons, createIconLoader };
