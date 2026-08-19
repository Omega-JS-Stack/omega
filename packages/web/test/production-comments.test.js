/**
 * #330 — a PRODUCTION build ships no framework developer comments; dev keeps
 * every one of them for debuggability. Two lanes carry the guarantee and both
 * are pinned here, because both are byproducts of passes that exist for other
 * reasons and could be narrowed without anyone noticing:
 *
 *   HTML — the production-only minify transform ([minify-html.js](../src/minify-html.js),
 *          `keep_comments: false`), which restores IE conditional comments
 *          verbatim. Dev renders untouched, so the dev/prod SPLIT is this lane's.
 *   JS   — the esbuild bundle ([assets.js](../src/assets.js)). esbuild emits no
 *          source comment in EITHER mode (only its own `// <path>` banners
 *          when unminified), so there is no split to pin here — just the
 *          production floor. Third-party LEGAL comments survive on purpose
 *          (esbuild's default `legalComments: 'eof'`): licenses are the one
 *          comment class a build must keep shipping. What no bundler can
 *          reach is comment text inside a STRING (an iframe srcdoc's own
 *          source) — the accepted call's "where the bundler can".
 *
 * There is no config knob either way — a production build has no legitimate
 * reason to carry framework internals, and dev has no reason to hide them.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');

const { buildAssets } = require('../src/assets.js');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const ROOT = path.resolve(PKG, '..', '..');
// Per-process out dir (#182): a second suite run must never wipe this one's
// assets mid-flight.
const JS_OUT = path.join(PKG, '.omega', `comments-js-${process.pid}`);

after(() => fs.rmSync(JS_OUT, { recursive: true, force: true }));

// The head's own developer notes — the comments the em-dash sweep found on
// built pages (#330). If head.html is reworded, pick another line from it.
const HEAD_COMMENTS = ['Meta Variables', 'Prefetch and Preconnect', 'Resolve Image'];

/**
 * Build the js half of the asset pipeline in production mode (no `dev` flag —
 * exactly what `omega build` passes).
 * @returns {Promise<string[]>} every built .js file's contents
 */
async function buildProductionJs() {
  fs.rmSync(JS_OUT, { recursive: true, force: true });
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
  await buildAssets({
    layers: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    sectionRoots: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: JS_OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    only: 'js',
  });
  return fs.readdirSync(path.join(JS_OUT, 'assets', 'js'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'));
}

test('production HTML carries no framework comments; dev carries them all', async () => {
  const prod = await sharedBuildWith(miniData, { environment: 'production' }, 'comments-prod');
  const dev = await sharedBuildWith(miniData, {}, 'comments-dev');

  const devHome = dev.get('/');
  for (const note of HEAD_COMMENTS) {
    assert.ok(devHome.includes(note), `dev keeps the head's "${note}" note`);
  }

  // Every .html the production build wrote, not just the home page: one
  // template rendering outside the transform's reach is the whole leak.
  for (const [url, page] of prod) {
    if (!url.endsWith('/') && !url.endsWith('.html')) continue; // meta files ship as rendered (cp139)
    // IE conditionals are restored verbatim and are the ONE surviving class
    const comments = page.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/g, '').match(/<!--[\s\S]*?-->/g) || [];
    assert.deepStrictEqual(comments, [], `${url} ships no HTML comments`);
  }
  assert.ok(prod.get('/').includes('<!--[if lte IE 11]>'), 'the head IE conditional still survives production');
});

test('production JS bundles carry no developer comments; third-party licenses still ship', async () => {
  const prod = await buildProductionJs();

  // The site-assets fixture's page module leads with a block comment naming
  // itself — the shape of every framework module's header
  assert.ok(!prod.some((code) => code.includes('SITE-layer index page module')), 'source comments never reach the bundle');
  // esbuild's own unminified file banners (`// <path>`) name framework paths
  assert.ok(!prod.some((code) => code.includes('// core/js/')), 'no esbuild path banners either');

  // Those two ARE the guarantee: minified output has no newline outside a
  // string, so a `// …` line standing alone in a production bundle can only
  // be a comment inside a generated document string (the client's vert
  // srcdoc) — the accepted call's "where the bundler can". Scanning for such
  // lines would pin nothing; losing minification is what these two catch.
  assert.ok(prod.some((code) => code.includes('/*! Bundled license information')), 'third-party licenses still ship');
});
