/**
 * Font Awesome root resolution for web builds (C4 cp111) — which icon set
 * the uj_icon tag reads from, best-first:
 *
 *   1. OMEGA_FONTAWESOME_ROOT — a fontawesome.com "Pro for Web" download
 *      dir (contains svgs/ + metadata/); no npm token needed.
 *   2. @fortawesome/fontawesome-pro — installed by the brand with its own
 *      FA npm token. NEVER a dependency of any omega package (license).
 *   3. @fortawesome/fontawesome-free — the declared-dependency floor.
 *
 * Every available rung stays in the chain ([env, pro, free] when all
 * exist — same as desktop's), so a partial supply (an old solid-only
 * download) never loses icons a lower rung has. Preference order itself
 * is icon-core's PACKAGES — shared with desktop's runtime icon server so
 * the surfaces can't drift.
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

module.exports = { resolveFontAwesomeRoots };
