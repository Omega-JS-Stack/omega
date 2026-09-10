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
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { buildAssets } = require('../src/assets.js');
const { MINI, PKG } = require('./lib/build.js');

// Own the css-lane out dir per process, per assets.test.js's #182 rule.
const OUT = path.join(PKG, '.omega', `font-fallback-out-${process.pid}`);

after(() => {
  fs.rmSync(OUT, { recursive: true, force: true });
});

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

test('classy: one fallback face per vendored family, measured off the woff2 files', async () => {
  const { css } = await buildCss(packagedChain('classy'), 'classy');

  // Inter over Helvetica Neue: the first family classy's own --omega-font-ui
  // stack names that the built-in metrics table knows (-apple-system,
  // blinkmacsystemfont, 'Segoe UI' and roboto are not measurable families).
  // Arial rides along as a second local() source: Helvetica Neue is macOS-only,
  // and a face with no resolvable source would hand the swap to an unadjusted
  // tail entry on Windows. The overrides are computed against the first.
  assert.ok(css.includes(
    '@font-face{font-family:"Inter Fallback";src:local("Helvetica Neue"),local("Arial");'
    + 'size-adjust:105.508%;ascent-override:91.818%;descent-override:22.862%;line-gap-override:0.000%}',
  ), 'the Inter fallback face, with all four overrides');

  // Newsreader over Georgia, off --omega-font-serif.
  assert.ok(css.includes(
    '@font-face{font-family:"Newsreader Fallback";src:local("Georgia"),local("Times New Roman");'
    + 'size-adjust:91.224%;ascent-override:80.571%;descent-override:29.049%;line-gap-override:0.000%}',
  ), 'the Newsreader fallback face');
});

test('classy: the token stacks name the fallback right after the web family', async () => {
  const { css } = await buildCss(packagedChain('classy'), 'classy-tokens');

  assert.ok(
    css.includes('--omega-font-ui: \'Inter\', "Inter Fallback", -apple-system'),
    'the fallback follows Inter, ahead of the system tail',
  );
  assert.ok(
    css.includes('--omega-font-serif: \'Newsreader\', "Newsreader Fallback", ui-serif'),
    'and follows Newsreader in the serif stack',
  );

  // The core token sheet's own system stacks name no web family, so nothing
  // is inserted into them.
  assert.ok(css.includes('--omega-font-mono: ui-monospace'), 'the mono stack is untouched');
  assert.ok(!/--omega-font-mono:[^;}]*Fallback/.test(css), 'no fallback in a stack with no web family');
});

test('classy: a fallback face is never preloaded (it is a local(), not a file)', async () => {
  const { manifest } = await buildCss(packagedChain('classy'), 'classy-preloads');

  assert.deepEqual(manifest.fontPreloads, [
    '/assets/fonts/inter-italic-latin.woff2',
    '/assets/fonts/inter-normal-latin.woff2',
    '/assets/fonts/newsreader-italic-latin.woff2',
    '/assets/fonts/newsreader-normal-latin.woff2',
  ], 'the #765 list is exactly what it was');
});

test('newsflash: its own two families get the same treatment', async () => {
  const { css } = await buildCss(packagedChain('newsflash'), 'newsflash');

  assert.ok(css.includes(
    '@font-face{font-family:"Schibsted Grotesk Fallback";src:local("Helvetica Neue"),local("Arial");'
    + 'size-adjust:103.367%;ascent-override:94.475%;descent-override:24.941%;line-gap-override:0.000%}',
  ), 'the Schibsted Grotesk fallback face');
  assert.ok(css.includes(
    '@font-face{font-family:"Fraunces Fallback";src:local("Georgia"),local("Times New Roman");'
    + 'size-adjust:115.780%;ascent-override:84.471%;descent-override:22.025%;line-gap-override:0.000%}',
  ), 'the Fraunces fallback face');
  assert.ok(css.includes('--omega-font-ui: \'Schibsted Grotesk\', "Schibsted Grotesk Fallback", -apple-system'));
  assert.ok(css.includes('--omega-font-serif: \'Fraunces\', "Fraunces Fallback", ui-serif'));
});

test('a stack naming no known system family: one warning, no face, no throw', async () => {
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

    assert.ok(!css.includes('Brandface Fallback'), 'no face is generated from metrics it cannot have');
    assert.ok(css.includes('--omega-font-ui: Brandface, "Nonesuch Grotesk", sans-serif'), 'the stack is left alone');

    const named = warnings.filter((message) => message.includes('Brandface'));
    assert.equal(named.length, 1, 'exactly one warning for the family');
    assert.ok(named[0].includes('Nonesuch Grotesk'), 'it names the stack it could not match against');
  } finally {
    fs.rmSync(layer, { recursive: true, force: true });
  }
});

test('a theme that ships no font FILES gets no fallback faces and no noise (#177)', async () => {
  // The inheritance hatch hands a partial theme the default skin's @font-face
  // rules without its font files, so there is nothing to measure and nothing
  // to generate, and that is not a problem to report.
  const warnings = [];
  const { css } = await buildCss(
    [path.join(MINI, 'themes', 'toy'), path.join(PKG, 'themes', 'base')],
    'toy',
    { warn: (message) => warnings.push(message) },
  );

  assert.ok(!css.includes('Fallback'), 'no fallback face without a file to measure');
  assert.deepEqual(warnings.filter((message) => message.includes('fallback')), [], 'and no warning about it');
});
