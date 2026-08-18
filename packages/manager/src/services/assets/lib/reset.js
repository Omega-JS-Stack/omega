/**
 * Assets cache invalidation: the force refresh behind `omega manage
 * --reset-assets` (#214). Every assets operation is mtime-diffed, so a
 * converged brand regenerates nothing; when a derived file is wrong for a
 * reason no timestamp records (a hand-mangled export, a sharp/ag-psd
 * upgrade that renders differently), the only lever was hand-deleting
 * `.omega/assets/`. omega-manager had `--reset-templates` /
 * `--reset-logos` for exactly this.
 *
 * Invalidation IS deletion here: `isStale()` calls a missing derived file
 * stale, so removing a kind's outputs is precisely what makes the same walk
 * regenerate them, with no second freshness mechanism to keep in sync.
 *
 * Only `.omega/assets/` is cache. The brand's committed collateral
 * (`assets/logo/*.svg`, `assets/templates/*.psd`) is a SOURCE and is never
 * resettable: a reset that ate the PSD an operator edited by hand would be
 * unrecoverable.
 *
 * The two kinds together are the whole cache: `templates` is the PSD export
 * PNGs, `logos` is everything the logo sources derive (variants, app icon
 * containers, social icons, favicons).
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const {
  PROCESSING_RULES, SOCIAL_ICON_CONFIG, TEMPLATE_CONFIG, ICON_PLATFORMS, FAVICON_CONFIG,
} = require('./assets-config.js');

const RESET_KINDS = ['logos', 'templates'];

/**
 * The derived paths a kind owns, relative to the out dir. Both lists are
 * derived from assets-config.js so a new rule/template/platform is covered
 * without a second registry to update.
 *
 * @param {string} kind - A RESET_KINDS entry.
 * @returns {string[]} Relative paths (dirs for whole-output operations,
 *   files where one dir holds more than one kind's output).
 */
function kindPaths(kind) {
  if (kind === 'templates') {
    // Files, not dirs: `app/macos` also holds the icons operation's .icns
    return Object.values(TEMPLATE_CONFIG).flatMap((config) =>
      (config.exports || [{ suffix: '' }]).map((exp) =>
        join(config.outputDir, `${config.outputName}${exp.suffix || ''}.png`)));
  }

  return [
    ...Object.values(PROCESSING_RULES).map((rule) => rule.outputDir),
    SOCIAL_ICON_CONFIG.outputDir,
    FAVICON_CONFIG.outputDir,
    ...Object.entries(ICON_PLATFORMS).map(([platform, { format }]) => join('app', platform, `icon.${format}`)),
  ];
}

/**
 * The kinds a run asked to reset. Mirrors the `--migration` idiom: the bare
 * flag means all of them, a value names one (or a comma list). An unknown
 * kind throws, because a typo that quietly reset everything (or nothing) is
 * worse than a stopped run.
 *
 * @param {boolean|string|undefined} flag - options.resetAssets.
 * @returns {string[]} Kinds in RESET_KINDS order, deduped.
 */
function resolveResetKinds(flag) {
  if (!flag) {
    return [];
  }

  if (flag === true) {
    return [...RESET_KINDS];
  }

  const asked = String(flag).split(',').map((kind) => kind.trim()).filter(Boolean);
  const unknown = asked.filter((kind) => !RESET_KINDS.includes(kind));

  if (unknown.length > 0) {
    throw new Error(
      `Unknown --reset-assets kind(s): ${unknown.join(', ')}. `
      + `Available: ${RESET_KINDS.join(', ')} (bare --reset-assets resets both).`,
    );
  }

  return RESET_KINDS.filter((kind) => asked.includes(kind));
}

/**
 * Clear the derived outputs of the given kinds.
 *
 * @param {object} args
 * @param {string} args.outDir - The brand's `.omega/assets/`.
 * @param {string[]} args.kinds - Kinds from resolveResetKinds().
 * @param {boolean} [args.dryRun] - Report what would go, delete nothing.
 * @returns {{ kinds: string[], removed: string[] }} The relative paths that
 *   existed (and, outside a dry run, are now gone).
 */
function resetAssetsCache({ outDir, kinds, dryRun = false }) {
  const removed = [];

  for (const kind of kinds) {
    for (const relative of kindPaths(kind)) {
      const target = join(outDir, relative);

      if (!jetpack.exists(target)) {
        continue;
      }

      if (!dryRun) {
        jetpack.remove(target);
      }
      removed.push(relative);
    }
  }

  return { kinds, removed };
}

module.exports = { RESET_KINDS, resolveResetKinds, resetAssetsCache };
