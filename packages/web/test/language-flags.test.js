/**
 * The language-flag aliases (#129) — the client switcher fetches a flag by the
 * row's own hreflang code, so the build writes language-named copies of the
 * country-named core set into the emitted icon dir. Runs the REAL emitIcons
 * over the REAL core/icons set (no fixture flags: the point is that the shipped
 * set reaches the shipped path).
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { emitIcons } = require('@omega.js/devkit/icons');
const { LANGUAGE_NAMES } = require('@omega.js/devkit/translate');

const { emitLanguageFlags, FALLBACK_FLAG } = require('../src/language-flags.js');
const { PATHS } = require('../src/paths.js');
const { PKG } = require('./lib/build.js');

const OUT = path.join(PKG, '.omega', 'language-flags-test-out');
const FALLBACK = path.join(PATHS.core, 'icons', 'flags', FALLBACK_FLAG);

/** Emit the icon set (flags included) into a clean output dir. */
function emitInto(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  emitIcons({ outDir, coreIconsDir: path.join(PATHS.core, 'icons') });

  return path.join(outDir, 'assets', 'icons', 'flags');
}

module.exports = defineCases({
  type: 'group',
  description: 'language-flags',
  tests: [
    {
      name: 'emitIcons already ships the core flag set — the aliases only add names to it',
      run: (ctx) => {
        const flagsDir = emitInto(OUT);

        ctx.expect(fs.existsSync(path.join(flagsDir, 'us.svg')), 'the country-named set is the emitted one').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(flagsDir, 'lang')), 'and carries no language namespace of its own').toBeTruthy();
      },
    },

    {
      name: 'a language row can fetch its own code: lang/en → the us flag, byte for byte',
      run: (ctx) => {
        const flagsDir = emitInto(OUT);
        const { files } = emitLanguageFlags({ outDir: OUT });

        ctx.expect(files > 0, 'aliases were written').toBeTruthy();
        ctx.expect(fs.readFileSync(path.join(flagsDir, 'lang', 'en.svg')), 'lang/en.svg IS the us flag — the map is template-kit\'s, not a second copy').toEqual(fs.readFileSync(path.join(flagsDir, 'us.svg')));
        ctx.expect(fs.existsSync(path.join(flagsDir, 'lang', 'ja.svg')), 'ja → jp').toBeTruthy();
        ctx.expect(fs.existsSync(path.join(flagsDir, 'lang', 'zh.svg')), 'zh → cn').toBeTruthy();
        ctx.expect(fs.existsSync(path.join(flagsDir, 'lang', 'es.svg')), 'a language whose code equals its country is aliased too — the browser path is uniform').toBeTruthy();
      },
    },

    {
      name: 'the language namespace never touches a country flag of the same name',
      run: (ctx) => {
        const flagsDir = emitInto(OUT);
        const argentina = fs.readFileSync(path.join(flagsDir, 'ar.svg'));
        const canada = fs.readFileSync(path.join(flagsDir, 'ca.svg'));

        emitLanguageFlags({ outDir: OUT });

        // ar = Arabic AND Argentina, ca = Catalan AND Canada; the map sends both
        // languages elsewhere (ar → sa, ca → es), so a flat alias would have
        // overwritten two real flags
        ctx.expect(fs.readFileSync(path.join(flagsDir, 'ar.svg')), 'ar.svg is still Argentina').toEqual(argentina);
        ctx.expect(fs.readFileSync(path.join(flagsDir, 'ca.svg')), 'ca.svg is still Canada').toEqual(canada);
        ctx.expect(fs.readFileSync(path.join(flagsDir, 'lang', 'ar.svg')), 'and an Arabic row gets Saudi Arabia, from its own namespace').toEqual(fs.readFileSync(path.join(flagsDir, 'sa.svg')));
        ctx.expect(fs.readFileSync(path.join(flagsDir, 'lang', 'ca.svg')), 'a Catalan row gets Spain').toEqual(fs.readFileSync(path.join(flagsDir, 'es.svg')));
      },
    },

    {
      name: '#827 fa and el alias their country flags: lang/fa → ir, lang/el → gr, byte for byte',
      run: (ctx) => {
        const flagsDir = emitInto(OUT);
        emitLanguageFlags({ outDir: OUT });

        ctx.expect(fs.readFileSync(path.join(flagsDir, 'lang', 'fa.svg')), 'a Farsi row gets Iran').toEqual(fs.readFileSync(path.join(flagsDir, 'ir.svg')));
        ctx.expect(fs.readFileSync(path.join(flagsDir, 'lang', 'el.svg')), 'a Greek row gets Greece').toEqual(fs.readFileSync(path.join(flagsDir, 'gr.svg')));
      },
    },

    {
      name: '#827 a language whose country has no flag gets the neutral fallback glyph',
      run: (ctx) => {
        const flagsDir = emitInto(OUT);
        emitLanguageFlags({ outDir: OUT });

        ctx.expect(!fs.existsSync(path.join(flagsDir, 'il.svg')), 'the set carries no Israeli flag to alias').toBeTruthy();
        ctx.expect(fs.existsSync(path.join(flagsDir, 'lang', 'he.svg')), 'yet a Hebrew row still has a file to fetch').toBeTruthy();
        ctx.expect(fs.readFileSync(path.join(flagsDir, 'lang', 'he.svg')), 'and it IS lang-fallback.svg, byte for byte').toEqual(fs.readFileSync(FALLBACK));
      },
    },

    {
      name: '#827 every supported language (LANGUAGE_NAMES plus en) has an alias after one emit',
      run: (ctx) => {
        const flagsDir = emitInto(OUT);
        emitLanguageFlags({ outDir: OUT });

        const missing = [...Object.keys(LANGUAGE_NAMES), 'en']
          .filter((code) => !fs.existsSync(path.join(flagsDir, 'lang', `${code}.svg`)));

        ctx.expect(missing, 'no supported code is left for the switcher to 404 on').toEqual([]);
      },
    },

    {
      name: '#827 the pass is idempotent: a second run over the same output changes nothing',
      run: (ctx) => {
        const flagsDir = emitInto(OUT);
        const snapshot = () => fs.readdirSync(path.join(flagsDir, 'lang')).sort()
          .map((name) => [name, fs.readFileSync(path.join(flagsDir, 'lang', name)).toString('base64')]);
        const first = emitLanguageFlags({ outDir: OUT });
        const afterFirst = fs.readdirSync(flagsDir, { recursive: true }).sort();
        const aliasesAfterFirst = snapshot();
        const second = emitLanguageFlags({ outDir: OUT });

        ctx.expect(second.files, 'the same alias count').toBe(first.files);
        ctx.expect(fs.readdirSync(flagsDir, { recursive: true }).sort(), 'the same files').toEqual(afterFirst);
        ctx.expect(snapshot(), 'the same bytes in every alias').toEqual(aliasesAfterFirst);
      },
    },

    {
      name: 'an output with no emitted icon set is a no-op, not a crash',
      run: (ctx) => {
        const empty = path.join(PKG, '.omega', 'language-flags-test-empty');
        fs.rmSync(empty, { recursive: true, force: true });

        ctx.expect(emitLanguageFlags({ outDir: empty }).files, 'nothing to alias').toEqual(0);
      },
    },
  ],
});
