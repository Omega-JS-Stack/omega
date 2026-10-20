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
const { LANGUAGE_NAMES } = require('@omega.js/devkit/translate');
const { LANGUAGE_TO_COUNTRY } = require('@omega.js/template-kit');

// The neutral glyph a supported language gets when its country has no flag
const FALLBACK_FLAG = 'lang-fallback.svg';

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

  const fallback = path.join(flags, FALLBACK_FLAG);

  // emitIcons copies the core flag set wholesale, fallback glyph included
  if (!fs.existsSync(fallback)) {
    throw new Error(`[@omega.js/web:language-flags] missing ${fallback}: the emitted flag set has no fallback glyph`);
  }

  // Every language the translation engine supports, plus the source language
  // and any extra the map carries, so the switcher never requests a missing file
  const languages = new Set(['en', ...Object.keys(LANGUAGE_NAMES), ...Object.keys(LANGUAGE_TO_COUNTRY)]);
  let files = 0;

  fs.mkdirSync(dest, { recursive: true });

  for (const language of languages) {
    const country = LANGUAGE_TO_COUNTRY[language];
    const flag = country && path.join(flags, `${country}.svg`);
    const source = flag && fs.existsSync(flag) ? flag : fallback;

    fs.copyFileSync(source, path.join(dest, `${language}.svg`));
    files += 1;
  }

  return { files, dest };
}

module.exports = { emitLanguageFlags, FALLBACK_FLAG };
