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
 * The free set stays in the lookup chain even when a brand set wins, so a
 * partial supply (an old solid-only download) never loses icons the free
 * set has. Preference order itself is icon-core's PACKAGES — shared with
 * desktop's runtime icon server so the surfaces can't drift.
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
  const freeRoot = path.dirname(require.resolve(`${PACKAGES[PACKAGES.length - 1]}/package.json`));

  let brandRoot = null;
  let source = 'free';

  const envRoot = env.OMEGA_FONTAWESOME_ROOT;
  if (envRoot && fs.existsSync(path.join(envRoot, 'svgs'))) {
    brandRoot = envRoot;
    source = 'env';
  } else {
    try {
      brandRoot = path.dirname(require.resolve(`${PACKAGES[0]}/package.json`));
      source = 'pro';
    } catch (e) {
      // free-only — the normal case for brands without a Pro license
    }
  }

  const brandAliasFile = brandRoot && path.join(brandRoot, 'metadata', 'icon-families.json');
  return {
    svgsDirs: [
      ...(brandRoot ? [path.join(brandRoot, 'svgs')] : []),
      path.join(freeRoot, 'svgs'),
    ],
    aliasFile: brandAliasFile && fs.existsSync(brandAliasFile)
      ? brandAliasFile
      : path.join(freeRoot, 'metadata', 'icon-families.json'),
    source,
  };
}

module.exports = { resolveFontAwesomeRoots };
