/**
 * Asset-pipeline invariants over LAYER ROOTS (site → theme(s) → core): page
 * modules layered via esbuild boot stubs, ESM + code splitting (@omega.js/client
 * and the boot runtime in ONE shared chunk — the cross-bundle singleton),
 * the real UJM main bundle (core runtime + dynamic theme import via
 * __theme__), the real @omega.js/client via the @omega.js/client alias (subpaths
 * included), layered sass through omega:theme (per-theme main css + theme
 * page css namespaces), dev-mode stable names, and the PurgeCSS pass.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildAssets, purgeCss } = require('../src/assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const OUT = path.join(PKG, '.omega', 'assets-test-out');

/**
 * Run buildAssets for a theme layer chain.
 * @param {string[]} themeIds
 * @returns {Promise<object>} manifest
 */
function build(themeIds) {
  const themeRoots = themeIds.map((id) => path.join(PKG, 'themes', id));
  return buildAssets({
    layers: [
      path.join(__dirname, 'fixtures', 'site-assets'),
      ...themeRoots,
      path.join(PKG, 'core'),
    ],
    themeRoots,
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
  });
}

test('layered page modules: site layer wins, core fills the rest, all content-hashed', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['classy']);

  // Site layer's flat index.js + the real UJM core modules under dir-index keys
  for (const key of ['index', 'pricing/index', 'signin/index', 'signup/index', 'payment/checkout/index', 'blog/post']) {
    assert.ok(manifest.js.pages[key], `manifest has ${key}`);
    assert.match(manifest.js.pages[key], /^\/assets\/js\/pages\/.+-[A-Z0-9]+\.js$/, `${key} is content-hashed`);
  }
  assert.ok(!manifest.js.pages['payment/checkout/modules/api'], 'helper modules are NOT entries');
  assert.ok(!manifest.js.pages['dashboard/account/sections/billing'], 'section helpers are NOT entries');

  const indexBundle = fs.readFileSync(path.join(OUT, manifest.js.pages.index.slice(1)), 'utf8');
  assert.ok(indexBundle.includes('consumer wins'), 'SITE layer index.js beat the core layer');
});

test('legacy module bundles emit at their fixed URLs (redirect pages script them)', async () => {
  await build(['classy']);
  // The redirect layout + ad units reference /assets/js/modules/<name>.bundle.js
  // directly (uj_cachebreak query, no content hash) — the lane must emit them.
  const redirect = fs.readFileSync(path.join(OUT, 'assets', 'js', 'modules', 'redirect.bundle.js'), 'utf8');
  assert.ok(redirect.includes('redirect-config'), 'redirect module bundled at its fixed URL');
  assert.ok(redirect.includes('Forwarded fragment'), 'fragment forwarding rides along (#billing deep-links)');
  assert.ok(fs.existsSync(path.join(OUT, 'assets', 'js', 'modules', 'popupads.bundle.js')), 'popupads.bundle.js emits (import-free)');
  // vert.js imports @omega.js/client — bundling it standalone would inline a
  // second client copy and break the singleton; it sits out of this lane.
  assert.ok(!fs.existsSync(path.join(OUT, 'assets', 'js', 'modules', 'vert.bundle.js')), 'client-importing modules are skipped');
});

// Read an entry bundle plus every chunk it transitively imports (the module
// graph the browser would evaluate for that <script type="module">).
function readGraph(manifestUrl) {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const content = fs.readFileSync(file, 'utf8');
    seen.set(file, content);
    // Shared chunks (chunk-HASH) AND dynamic-import chunks (_theme-HASH, dev-HASH, ...)
    for (const m of content.matchAll(/["']([^"']*chunks\/[\w.-]+-[A-Z0-9]+\.js)["']/g)) {
      visit(path.resolve(path.dirname(file), m[1]));
    }
  };
  visit(path.join(OUT, manifestUrl.slice(1)));
  return [...seen.values()].join('\n');
}

function walkJs(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => path.join(e.parentPath, e.name));
}

test('main bundle graph: real UJM runtime + theme via __theme__ + the boot runtime', async () => {
  const manifest = await build(['classy']);
  assert.ok(manifest.js.main, 'main bundle in manifest');

  const graph = readGraph(manifest.js.main);
  assert.ok(graph.includes('Global module loaded successfully'), 'core runtime module in the graph');
  assert.ok(graph.includes('Classy theme loaded successfully'), 'active theme _theme.js inlined via __theme__');
  assert.ok(graph.includes('Global module error:'), 'boot runtime (bootMain) in the graph');
});

test('ESM splitting: @omega.js/client singleton lives in exactly ONE shared chunk', async () => {
  const manifest = await build(['classy']);

  // Page entries are thin boot stubs importing shared chunks
  const signinEntry = fs.readFileSync(path.join(OUT, manifest.js.pages['signin/index'].slice(1)), 'utf8');
  assert.ok(signinEntry.length < 2000, `page entry is a thin stub (${signinEntry.length} bytes)`);
  assert.ok(/chunks\/chunk-/.test(signinEntry), 'stub imports shared chunks');

  // The client (`_authReady` is its constructor marker) appears in exactly one
  // file across ALL bundles — the shared chunk both main and pages import.
  const withClient = walkJs(path.join(OUT, 'assets', 'js')).filter((f) => fs.readFileSync(f, 'utf8').includes('_authReady'));
  assert.strictEqual(withClient.length, 1, `client code in exactly one file (found ${withClient.length})`);
  assert.ok(withClient[0].includes(`${path.sep}chunks${path.sep}`), 'client lives in a shared chunk');

  // The page's own code is still in its graph (via the @omega.js/client alias)
  const graph = readGraph(manifest.js.pages['signin/index']);
  assert.ok(graph.includes('Email is required'), 'real UJM auth page module code present');
  assert.ok(graph.includes('_authReady'), 'client reachable from the page graph');
});

test('layered sass: main css compiles per theme through omega:theme', async () => {
  const classy = await build(['classy']);
  const newsflash = await build(['newsflash', 'classy']);

  const classyCss = fs.readFileSync(path.join(OUT, classy.css.main.slice(1)), 'utf8');
  const newsflashCss = fs.readFileSync(path.join(OUT, newsflash.css.main.slice(1)), 'utf8');
  assert.ok(classyCss.includes('#2563EB') || classyCss.includes('#2563eb'), 'classy primary in classy build');
  assert.ok(newsflashCss.includes('#F03612') || newsflashCss.includes('#f03612'), 'newsflash primary in newsflash build');
  assert.ok(classyCss.includes('.btn'), 'bootstrap compiled in via the theme config');
  assert.notStrictEqual(classy.css.main, newsflash.css.main, 'content hash differs per theme');

  // cp190 floor: sibling themes carry classy's token-pure app/auth
  // vocabulary so fall-through pages render styled (Lane B)
  assert.ok(newsflashCss.includes('.classy-auth'), 'newsflash bundle carries the classy auth floor');
  assert.ok(newsflashCss.includes('.classy-statgrid'), 'newsflash bundle carries the classy app floor');
  // …and speaks the shared token contract after the cp187 rebase
  assert.ok(newsflashCss.includes('--omega-ground: #F7F2E7') || newsflashCss.includes('--omega-ground: #f7f2e7'), 'newsflash re-values the omega sheet (paper ground)');

  // Page css namespaces: base pages from core, theme pages from the theme
  assert.ok(classy.css.pages['blog/post'], 'core page css entry (blog/post)');
  assert.ok(newsflash.css.themePages['blog/post'], 'newsflash theme page css for blog/post');
  // classy ships blog/post theme css since the cp170 editorial extras
  // (reading progress + article rail) — both namespaces live side by side
  assert.ok(classy.css.themePages['blog/post'], 'classy theme page css for blog/post');
});

test('dev mode: stable un-hashed names so rebuilds keep their URLs', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await buildAssets({
    layers: [path.join(__dirname, 'fixtures', 'site-assets'), path.join(PKG, 'themes', 'classy'), path.join(PKG, 'core')],
    themeRoots: [path.join(PKG, 'themes', 'classy')],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    dev: true,
  });

  assert.strictEqual(manifest.js.main, '/assets/js/main.js', 'main js un-hashed');
  assert.strictEqual(manifest.js.pages['signin/index'], '/assets/js/pages/signin/index.js', 'page js un-hashed');
  assert.strictEqual(manifest.css.main, '/assets/css/main.css', 'main css un-hashed');
  fs.rmSync(OUT, { recursive: true, force: true });
});

test('PurgeCSS strips selectors unused by the rendered HTML', async () => {
  const manifest = await build(['classy']);
  fs.writeFileSync(
    path.join(OUT, 'index.html'),
    '<body class="omega-body"><div class="container"><a class="btn btn-primary">x</a></div></body>'
  );

  const sizes = await purgeCss({ outDir: OUT, manifest });
  const purged = fs.readFileSync(path.join(OUT, manifest.css.main.slice(1)), 'utf8');
  assert.ok(purged.includes('.btn-primary'), 'used selector kept');
  assert.ok(!purged.includes('.carousel-inner'), 'unused selector stripped');
  assert.ok(sizes.after < sizes.before, `size shrank (${sizes.before} → ${sizes.after})`);
});

test('only-half rebuilds (dev watcher narrowing): css writes no js, js writes no css', async () => {
  const outDir = path.join(PKG, '.omega', 'assets-only-out');
  fs.rmSync(outDir, { recursive: true, force: true });
  const themeRoots = [path.join(PKG, 'themes', 'classy')];
  const base = {
    layers: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    dev: true,
  };

  const cssOnly = await buildAssets({ ...base, only: 'css' });
  assert.ok(cssOnly.css.main, 'css half built');
  assert.ok(!cssOnly.js.main, 'no js in the manifest');
  assert.ok(!fs.existsSync(path.join(outDir, 'assets', 'js')), 'no js files written — the dev server can hot-swap');

  fs.rmSync(outDir, { recursive: true, force: true });
  const jsOnly = await buildAssets({ ...base, only: 'js' });
  assert.ok(jsOnly.js.main, 'js half built');
  assert.ok(!jsOnly.css.main, 'no css in the manifest');
  assert.ok(!fs.existsSync(path.join(outDir, 'assets', 'css')), 'no css files written');
});
