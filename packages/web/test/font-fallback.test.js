/**
 * #768: metric-matched fallback faces, so a webfont swap moves nothing.
 *
 * `font-display: swap` paints the system fallback first and the vendored face
 * when it lands; every line that changes width or height between the two is
 * CLS (the #763 proof measured /terms at 0.158, a single shift at 3.1 s
 * attributed to the body paragraphs). The lane generates, per vendored family,
 * a `<Family> Fallback` face: the system family the theme's own stack already
 * names, re-proportioned with `size-adjust` and the three vertical overrides
 * so it occupies the SAME lines. The numbers come from the font files at build
 * time (src/font-metrics.js), so a consumer theme's own faces are covered with
 * nothing to declare.
 *
 * The transform runs on the COMPILED sheet, before the critical extractor, so
 * the inlined block and the deferred sheet agree, and no scss source has a
 * fallback family written into it.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildAssets } = require('../src/assets.js');
const { MINI, PKG } = require('./lib/build.js');

// Own the css-lane out dir per process, per assets.test.js's #182 rule.
const OUT = path.join(PKG, '.omega', `font-fallback-out-${process.pid}`);

/**
 * Build ONLY the css half over a real theme chain and hand back the manifest
 * plus the compiled main sheet as it was written.
 * @param {string[]} themeRoots - the layer chain, active theme first
 * @param {string} name - out-dir namespace for this build
 * @param {object} [overrides] - buildAssets option overrides
 * @returns {Promise<{manifest: object, css: string}>}
 */
async function buildCss(themeRoots, name, overrides = {}) {
  const outDir = path.join(OUT, name);
  const manifest = await buildAssets({
    layers: [...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    sectionRoots: themeRoots,
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir,
    clientEntry: path.join(PKG, '..', 'client', 'src', 'index.js'),
    only: 'css',
    ...overrides,
  });

  return { manifest, css: fs.readFileSync(path.join(outDir, manifest.css.main.slice(1)), 'utf8') };
}

/** The packaged theme chain for a theme id. */
const packagedChain = (id) => [path.join(PKG, 'themes', id), path.join(PKG, 'themes', 'base')];

module.exports = defineCases({
  type: 'group',
  description: 'font-fallback',
  cleanup: () => {
    fs.rmSync(OUT, { recursive: true, force: true });
  },
  tests: [
    {
      name: 'classy: one fallback face per vendored family, measured off the woff2 files',
      run: async (ctx) => {
        const { css } = await buildCss(packagedChain('classy'), 'classy');

        // Inter over Helvetica Neue: the first family classy's own --omega-font-ui
        // stack names that the built-in metrics table knows (-apple-system,
        // blinkmacsystemfont, 'Segoe UI' and roboto are not measurable families).
        // Arial rides along as a second local() source: Helvetica Neue is macOS-only,
        // and a face with no resolvable source would hand the swap to an unadjusted
        // tail entry on Windows. The overrides are computed against the first.
        ctx.expect(css.includes(
          '@font-face{font-family:"Inter Fallback";src:local("Helvetica Neue"),local("Arial");'
          + 'size-adjust:105.508%;ascent-override:91.818%;descent-override:22.862%;line-gap-override:0.000%}',
        ), 'the Inter fallback face, with all four overrides').toBeTruthy();

        // Newsreader over Georgia, off --omega-font-serif.
        ctx.expect(css.includes(
          '@font-face{font-family:"Newsreader Fallback";src:local("Georgia"),local("Times New Roman");'
          + 'size-adjust:91.224%;ascent-override:80.571%;descent-override:29.049%;line-gap-override:0.000%}',
        ), 'the Newsreader fallback face').toBeTruthy();
      },
    },

    {
      name: 'classy: the token stacks name the fallback right after the web family',
      run: async (ctx) => {
        const { css } = await buildCss(packagedChain('classy'), 'classy-tokens');

        ctx.expect(css.includes('--omega-font-ui: \'Inter\', "Inter Fallback", -apple-system'), 'the fallback follows Inter, ahead of the system tail').toBeTruthy();
        ctx.expect(css.includes('--omega-font-serif: \'Newsreader\', "Newsreader Fallback", ui-serif'), 'and follows Newsreader in the serif stack').toBeTruthy();

        // The core token sheet's own system stacks name no web family, so nothing
        // is inserted into them.
        ctx.expect(css.includes('--omega-font-mono: ui-monospace'), 'the mono stack is untouched').toBeTruthy();
        ctx.expect(!/--omega-font-mono:[^;}]*Fallback/.test(css), 'no fallback in a stack with no web family').toBeTruthy();
      },
    },

    {
      name: 'classy: a fallback face is never preloaded (it is a local(), not a file)',
      run: async (ctx) => {
        const { manifest } = await buildCss(packagedChain('classy'), 'classy-preloads');

        ctx.expect(manifest.fontPreloads, 'the #765 list is exactly what it was').toEqual([
          '/assets/fonts/inter-italic-latin.woff2',
          '/assets/fonts/inter-normal-latin.woff2',
          '/assets/fonts/newsreader-italic-latin.woff2',
          '/assets/fonts/newsreader-normal-latin.woff2',
        ]);
      },
    },

    {
      name: 'newsflash: its own two families get the same treatment',
      run: async (ctx) => {
        const { css } = await buildCss(packagedChain('newsflash'), 'newsflash');

        ctx.expect(css.includes(
          '@font-face{font-family:"Schibsted Grotesk Fallback";src:local("Helvetica Neue"),local("Arial");'
          + 'size-adjust:103.367%;ascent-override:94.475%;descent-override:24.941%;line-gap-override:0.000%}',
        ), 'the Schibsted Grotesk fallback face').toBeTruthy();
        ctx.expect(css.includes(
          '@font-face{font-family:"Fraunces Fallback";src:local("Georgia"),local("Times New Roman");'
          + 'size-adjust:115.780%;ascent-override:84.471%;descent-override:22.025%;line-gap-override:0.000%}',
        ), 'the Fraunces fallback face').toBeTruthy();
        ctx.expect(css.includes('--omega-font-ui: \'Schibsted Grotesk\', "Schibsted Grotesk Fallback", -apple-system')).toBeTruthy();
        ctx.expect(css.includes('--omega-font-serif: \'Fraunces\', "Fraunces Fallback", ui-serif')).toBeTruthy();
      },
    },

    {
      name: 'a stack naming no known system family: one warning, no face, no throw',
      run: async (ctx) => {
        const layer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-font-fallback-')));
        fs.mkdirSync(path.join(layer, 'css'), { recursive: true });
        fs.mkdirSync(path.join(layer, 'fonts'), { recursive: true });
        fs.copyFileSync(
          path.join(PKG, 'themes', 'classy', 'fonts', 'inter-normal-latin.woff2'),
          path.join(layer, 'fonts', 'brand.woff2'),
        );
        fs.writeFileSync(path.join(layer, 'css', 'main.scss'), [
          '@font-face { font-family: Brandface; src: url(/assets/fonts/brand.woff2); }',
          ':root { --omega-font-ui: Brandface, "Nonesuch Grotesk", sans-serif; }',
        ].join('\n'));

        try {
          const warnings = [];
          const { css } = await buildCss([layer], 'unknown-fallback', { warn: (message) => warnings.push(message) });

          ctx.expect(!css.includes('Brandface Fallback'), 'no face is generated from metrics it cannot have').toBeTruthy();
          ctx.expect(css.includes('--omega-font-ui: Brandface, "Nonesuch Grotesk", sans-serif'), 'the stack is left alone').toBeTruthy();

          const named = warnings.filter((message) => message.includes('Brandface'));
          ctx.expect(named.length, 'exactly one warning for the family').toBe(1);
          ctx.expect(named[0].includes('Nonesuch Grotesk'), 'it names the stack it could not match against').toBeTruthy();
        } finally {
          fs.rmSync(layer, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a theme that ships no font FILES gets no fallback faces and no noise (#177)',
      run: async (ctx) => {
        // The inheritance hatch hands a partial theme the default skin's @font-face
        // rules without its font files, so there is nothing to measure and nothing
        // to generate, and that is not a problem to report.
        const warnings = [];
        const { css } = await buildCss(
          [path.join(MINI, 'themes', 'toy'), path.join(PKG, 'themes', 'base')],
          'toy',
          { warn: (message) => warnings.push(message) },
        );

        ctx.expect(!css.includes('Fallback'), 'no fallback face without a file to measure').toBeTruthy();
        ctx.expect(warnings.filter((message) => message.includes('fallback')), 'and no warning about it').toEqual([]);
      },
    },
  ],
});
