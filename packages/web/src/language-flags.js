/**
 * Language flag aliases for the client-side switcher (#129).
 *
 * The retired footer dropdown drew its flags at BUILD time, through the core
 * flag set and the language→country map. The switcher renders in the BROWSER
 * from the page's own hreflang tags, so no build-time lookup can run for it —
 * but the flag set already ships:
 * emitIcons copies `core/icons/` wholesale, so `core/icons/flags/us.svg` lands
 * at `assets/icons/flags/us.svg` in every build and dev boot.
 *
 * This pass writes LANGUAGE-named copies into their own namespace,
 * `assets/icons/flags/lang/<code>.svg`, so a browser row needs only its hreflang
 * code and carries no map of its own. The map stays template-kit's — the one
 * home. The namespace is not cosmetic: language codes and country codes share
 * a space (`ar` is Arabic AND Argentina, `ca` is Catalan AND Canada), so
 * writing aliases beside the country set would overwrite real flags.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ICONS_DIR } = require('@omega.js/devkit/icons');
const { LANGUAGE_TO_COUNTRY } = require('@omega.js/template-kit');

/**
 * Write the language-named flag aliases into an emitted icon set. Runs AFTER
 * emitIcons (it reads what that pass copied) and is idempotent — an alias that
 * already exists is rewritten from the same source.
 * @param {object} options
 * @param {string} options.outDir - build output dir (the one emitIcons wrote into)
 * @returns {{ files: number, dest: string }} aliases written + the alias dir
 */
function emitLanguageFlags(options) {
  const flags = path.join(options.outDir, 'assets', ICONS_DIR, 'flags');
  const dest = path.join(flags, 'lang');

  // No flag set in this output (a build with no core icons dir) — nothing to alias
  if (!fs.existsSync(flags)) return { files: 0, dest };

  let files = 0;

  for (const [language, country] of Object.entries(LANGUAGE_TO_COUNTRY)) {
    const source = path.join(flags, `${country}.svg`);

    // The set covers 47 countries, the map 46 languages — a language whose
    // country has no flag simply gets none, and the row drops its <img>
    if (!fs.existsSync(source)) continue;

    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(source, path.join(dest, `${language}.svg`));
    files += 1;
  }

  return { files, dest };
}

module.exports = { emitLanguageFlags };
