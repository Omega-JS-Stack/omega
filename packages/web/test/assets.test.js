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
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { buildAssets, purgeCss, resolvePageAsset } = require('../src/assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
// #182: several tests here clear their out dir mid-run to count freshly built
// files, so the dir belongs to THIS process. A fixed path let a second suite
// run (parallel agent, second terminal) wipe the first one's assets mid-flight.
const OUT = path.join(PKG, '.omega', `assets-test-out-${process.pid}`);
const ONLY_OUT = path.join(PKG, '.omega', `assets-only-out-${process.pid}`);

after(() => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.rmSync(ONLY_OUT, { recursive: true, force: true });
});

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
    // §7 lanes: the fixture site doubles as the consumer dir (its _sections
    // carries the demo/probe entry); real theme roots ride behind it.
    sectionRoots: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
  });
}

test('layered page modules: site layer wins, core fills the rest, all content-hashed', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['classy', 'base']);

  // Site layer's flat index.js + the real UJM core modules under dir-index
  // keys + wildcard filenames (blog/[slug] serves every post URL — spec §7)
  for (const key of ['index', 'pricing/index', 'signin/index', 'signup/index', 'payment/checkout/index', 'blog/[slug]']) {
    assert.ok(manifest.js.pages[key], `manifest has ${key}`);
    assert.match(manifest.js.pages[key], /^\/assets\/js\/pages\/.+-[A-Z0-9]+\.js$/, `${key} is content-hashed`);
  }
  assert.ok(!manifest.js.pages['payment/checkout/modules/api'], 'helper modules are NOT entries');
  assert.ok(!manifest.js.pages['dashboard/account/sections/billing'], 'section helpers are NOT entries');
  assert.ok(!manifest.js.pages['legal/_document'], 'underscore partials are NOT entries');

  const slugBundle = fs.readFileSync(path.join(OUT, manifest.js.pages['blog/[slug]'].slice(1)), 'utf8');
  assert.ok(slugBundle.includes('consumer wins'), 'SITE layer blog/[slug].js beat the core layer (wildcards layer too)');
});

test('resolvePageAsset: exact beats /index spelling beats wildcard; segments match one-to-one', () => {
  const map = {
    'pricing/index': '/pricing-dir.js',
    'blog/index': '/blog-list.js',
    'blog/[slug]': '/blog-post.js',
    'alternatives/[alternative]/index': '/alternative.js',
    'updates/index': '/updates-list.js',
    'updates/[update]': '/updates-detail.css',
    'team/lead': '/team-lead.js',
    'team/[id]': '/team-member.js',
  };

  assert.strictEqual(resolvePageAsset(map, 'pricing'), '/pricing-dir.js', 'per-page-dir /index spelling');
  assert.strictEqual(resolvePageAsset(map, 'blog'), '/blog-list.js', 'list page hits its exact key, not the wildcard');
  assert.strictEqual(resolvePageAsset(map, 'blog/hello-world'), '/blog-post.js', '[slug] matches any post segment');
  assert.strictEqual(resolvePageAsset(map, 'blog/hello/world'), null, 'a wildcard segment never spans two URL segments');
  assert.strictEqual(resolvePageAsset(map, 'team/lead'), '/team-lead.js', 'exact path beats wildcard');
  assert.strictEqual(resolvePageAsset(map, 'team/anyone-else'), '/team-member.js', 'wildcard serves the rest of the family');
  assert.strictEqual(resolvePageAsset(map, 'alternatives/acme'), '/alternative.js', 'trailing /index on a wildcard key is the per-page-dir spelling');
  assert.strictEqual(resolvePageAsset(map, 'updates/v1.0.0'), '/updates-detail.css', 'dots in the URL segment are fine');
  assert.strictEqual(resolvePageAsset(map, 'nowhere'), null, 'no match → null');
  assert.strictEqual(resolvePageAsset(undefined, 'blog'), null, 'missing bucket → null');

  // Specificity: the most-literal wildcard wins; full ties break lexicographically
  const overlap = { '[a]/[b]': '/wide.js', 'blog/[slug]': '/narrow.js' };
  assert.strictEqual(resolvePageAsset(overlap, 'blog/post-1'), '/narrow.js', 'most-literal wildcard wins');
  assert.strictEqual(resolvePageAsset({ '[x]': '/x.js', '[y]': '/y.js' }, 'anything'), '/x.js', 'ties are deterministic');
});

test('the asset_path families resolve by URL alone against the real manifest', async () => {
  const manifest = await build(['classy', 'base']);

  // The dead frontmatter's old exact keys are gone…
  for (const dead of ['blog/post', 'updates/update', 'alternatives/alternative/index', 'legal/document/index']) {
    assert.ok(!manifest.js.pages[dead] && !manifest.css.pages[dead] && !manifest.css.themePages[dead], `no manifest bucket carries dead key ${dead}`);
  }

  // …their replacements resolve straight from page URLs
  assert.ok(String(resolvePageAsset(manifest.css.pages, 'blog/my-first-post')).includes('/assets/css/pages/blog/[slug]'), 'post css via wildcard');
  assert.ok(String(resolvePageAsset(manifest.css.pages, 'updates/v1.2.0')).includes('/assets/css/pages/updates/[update]'), 'update css via wildcard');
  assert.ok(String(resolvePageAsset(manifest.js.pages, 'alternatives/acme')).includes('/assets/js/pages/alternatives/[alternative]'), 'alternative js via per-page-dir wildcard');
  assert.strictEqual(resolvePageAsset(manifest.css.pages, 'updates'), manifest.css.pages['updates/index'], 'the /updates list page keeps its exact entry');

  // The flat legal URLs each own an exact entry over the shared _document partials
  for (const url of ['terms', 'cookies', 'privacy']) {
    assert.ok(manifest.js.pages[url], `js.pages has ${url}`);
    assert.ok(manifest.css.themePages[url], `classy theme css has ${url}`);
  }
  const termsGraph = readGraph(manifest.js.pages.terms);
  assert.ok(termsGraph.includes('data-legal-toc'), 'terms entry reaches the shared legal-document module');
});

test('§7 asset lanes: section.scss joins the main sheet, section.js boots behind DOM presence', async () => {
  const manifest = await build(['classy', 'base']);

  // css lane: the fixture's section.scss compiled in via omega:sections
  const mainCss = fs.readFileSync(path.join(OUT, manifest.css.main.slice(1)), 'utf8');
  assert.ok(mainCss.includes('.section-assets-probe'), 'section.scss landed in the main sheet');

  // js lane: the main boot stub carries the registry + presence-init runtime
  const graph = readGraph(manifest.js.main);
  assert.ok(graph.includes('demo/probe'), 'registry carries the section id');
  assert.ok(graph.includes('sectionProbed'), 'the section.js module body bundled');
  assert.ok(graph.includes('data-omega-'), 'presence-init selector rides the bundle');

  // page bundles stay clean — sections ride the MAIN stub only
  const pageGraph = readGraph(manifest.js.pages['blog/[slug]']);
  assert.ok(!pageGraph.includes('sectionProbed'), 'page stubs carry no section registry');

  // classy's product-demo section.js rides the same lane (the video-tab
  // behavior that moved out of the dead core index page module)
  assert.ok(graph.includes('marketing/product-demo'), 'product-demo id in the section registry');
  assert.ok(graph.includes('shown.bs.tab'), 'the tab-video behavior bundled via the section lane');
});

test('legacy module bundles emit at their fixed URLs (redirect pages script them)', async () => {
  await build(['classy', 'base']);
  // The redirect layout references /assets/js/modules/<name>.bundle.js
  // directly (omega_cachebreak query, no content hash) — the lane must emit it.
  const redirect = fs.readFileSync(path.join(OUT, 'assets', 'js', 'modules', 'redirect.bundle.js'), 'utf8');
  assert.ok(redirect.includes('redirect-config'), 'redirect module bundled at its fixed URL');
  assert.ok(redirect.includes('Forwarded fragment'), 'fragment forwarding rides along (#billing deep-links)');
  // The 404 page scripts the path-redirect module at its own fixed URL (#442)
  const redirectMap = fs.readFileSync(path.join(OUT, 'assets', 'js', 'modules', 'redirect-map.bundle.js'), 'utf8');
  assert.ok(redirectMap.includes('omega-redirect-map'), 'the path-redirect module reads the inlined map');
  // The legacy ad modules are retired (verts spec step 5) — the verts/unit
  // section + shared client verts module are the one implementation.
  assert.ok(!fs.existsSync(path.join(OUT, 'assets', 'js', 'modules', 'vert.bundle.js')), 'vert.bundle.js retired');
  assert.ok(!fs.existsSync(path.join(OUT, 'assets', 'js', 'modules', 'popupads.bundle.js')), 'popupads.bundle.js retired');
});

// Read an entry bundle plus every chunk it transitively imports (the module
// graph the browser would evaluate for that <script type="module">).
function readGraph(manifestUrl) {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    // A bundled string literal can LOOK like a sibling chunk without being
    // one. Skipping it degrades to a plain assertion failure below; reading it
    // would blow the suite up with an ENOENT instead.
    if (!fs.existsSync(file)) return;
    const content = fs.readFileSync(file, 'utf8');
    seen.set(file, content);
    // Shared chunks (chunk-HASH) AND dynamic-import chunks (_theme-HASH,
    // dev-HASH, ...). An entry names them through the `chunks/` dir; a chunk
    // names its PEERS by bare relative path ("./chunk-HASH.js"), and a module
    // shared by two entries lives exactly there — miss it and the graph reads
    // as if the shared code vanished.
    for (const m of content.matchAll(/["']((?:[^"']*chunks\/|\.\/)[\w.-]+-[A-Z0-9]+\.js)["']/g)) {
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
  const manifest = await build(['classy', 'base']);
  assert.ok(manifest.js.main, 'main bundle in manifest');

  const graph = readGraph(manifest.js.main);
  assert.ok(graph.includes('Global module loaded successfully'), 'core runtime module in the graph');
  // The theme's dev-only "loaded successfully" log is STRIPPED from this
  // production build (cp268) — assert on durable theme code instead.
  assert.ok(graph.includes('window.bootstrap'), 'active theme _theme.js inlined via __theme__');
  assert.ok(!graph.includes('Classy theme loaded successfully'), 'theme dev-only block stripped in production');
  assert.ok(graph.includes('Global module error:'), 'boot runtime (bootMain) in the graph');
});

test('tooltips: one shared initializer on the core layer, wired by every theme (#99)', async () => {
  // The initializer had a byte-identical copy under every theme's js/ — a fix
  // had to be made three times. One home on the core layer, imported through
  // __main_assets__ like the chart helper beside it.
  const SHARED = path.join(PKG, 'core', 'js', 'libs', 'initialize-tooltips.js');
  assert.ok(fs.existsSync(SHARED), 'the shared initializer lives on the core layer');

  for (const theme of fs.readdirSync(path.join(PKG, 'themes'))) {
    const copy = path.join(PKG, 'themes', theme, 'js', 'initialize-tooltips.js');
    assert.ok(!fs.existsSync(copy), `${theme} carries no private copy`);
  }

  // Every theme that wires tooltips still gets them into its bundle graph
  // (real chain: a sibling theme always sits over the base layer).
  for (const theme of ['classy', 'newsflash', 'neobrutalism']) {
    const manifest = await build([theme, 'base']);
    const graph = readGraph(manifest.js.main);
    assert.ok(graph.includes('data-bs-toggle="tooltip"'), `${theme}: the shared initializer rides the bundle`);
    assert.ok(graph.includes('tooltips'), `${theme}: the initializer body (not just the selector) bundled`);
  }
});

test('ESM splitting: @omega.js/client singleton lives in exactly ONE shared chunk', async () => {
  // The invariant is per BUILD, and the count below walks the whole out dir —
  // so start clean: stale chunks accumulated from PREVIOUS RUNS (differently
  // hashed as sources drift) read as duplicates, exactly like the sibling
  // tests that clear OUT before building.
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['classy', 'base']);

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
  const classy = await build(['classy', 'base']);
  const newsflash = await build(['newsflash', 'base']);

  const classyCss = fs.readFileSync(path.join(OUT, classy.css.main.slice(1)), 'utf8');
  const newsflashCss = fs.readFileSync(path.join(OUT, newsflash.css.main.slice(1)), 'utf8');
  assert.ok(classyCss.includes('#2563EB') || classyCss.includes('#2563eb'), 'classy primary in classy build');
  assert.ok(newsflashCss.includes('#F03612') || newsflashCss.includes('#f03612'), 'newsflash primary in newsflash build');
  assert.ok(classyCss.includes('.btn'), 'bootstrap compiled in via the theme config');
  assert.notStrictEqual(classy.css.main, newsflash.css.main, 'content hash differs per theme');

  // cp190 floor: sibling themes carry classy's token-pure app/auth
  // vocabulary so fall-through pages render styled (Lane B)
  assert.ok(newsflashCss.includes('.omega-auth'), 'newsflash bundle carries the classy auth floor');
  assert.ok(newsflashCss.includes('.omega-statgrid'), 'newsflash bundle carries the classy app floor');
  // cp192: the shared footer include speaks omega-footer vocabulary on every
  // page — the floor supplies its structure, the theme re-inks it
  assert.ok(newsflashCss.includes('.omega-footer'), 'newsflash bundle carries the classy footer floor');
  // …and speaks the shared token contract after the cp187 rebase
  assert.ok(newsflashCss.includes('--omega-ground: #F7F2E7') || newsflashCss.includes('--omega-ground: #f7f2e7'), 'newsflash re-values the omega sheet (paper ground)');

  // Page css namespaces: base pages from core, theme pages from the theme
  assert.ok(classy.css.pages['blog/[slug]'], 'core page css entry (blog/[slug])');
  assert.ok(newsflash.css.themePages['blog/[slug]'], 'newsflash theme page css for blog/[slug]');
  // classy ships blog/[slug] theme css since the cp170 editorial extras
  // (reading progress + article rail) — both namespaces live side by side
  assert.ok(classy.css.themePages['blog/[slug]'], 'classy theme page css for blog/[slug]');
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
  assert.strictEqual(manifest.js.pages['blog/[slug]'], '/assets/js/pages/blog/[slug].js', 'wildcard filenames survive esbuild verbatim');
  assert.strictEqual(manifest.css.main, '/assets/css/main.css', 'main css un-hashed');
  fs.rmSync(OUT, { recursive: true, force: true });
});

test('PurgeCSS strips selectors unused by the rendered HTML', async () => {
  const manifest = await build(['classy', 'base']);
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
  const outDir = ONLY_OUT;
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

test('fonts: the layer union is pruned to css-referenced faces — sibling themes ship no base-layer fat (cp243)', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await build(['newsflash', 'base']);
  const fonts = path.join(OUT, 'assets', 'fonts');
  assert.ok(fs.existsSync(path.join(fonts, 'fraunces-normal-latin.woff2')), 'newsflash ships its own faces');
  assert.ok(!fs.existsSync(path.join(fonts, 'newsreader-normal-latin.woff2')), 'classy faces pruned from the newsflash chain');

  fs.rmSync(OUT, { recursive: true, force: true });
  await build(['classy', 'base']);
  assert.ok(fs.existsSync(path.join(OUT, 'assets', 'fonts', 'newsreader-normal-latin.woff2')), 'the classy chain keeps its own faces');
});

// #249 — the js/modules lane is FRAMEWORK-only (core + theme layers). A UJM
// consumer's src/assets/js/modules/ is ordinary shared code: sweeping it into
// the standalone-IIFE lane either broke the build (`Could not resolve
// "@omega.js/client"`) or, worse, succeeded into the wrong lane.
test('#249: a consumer js/modules/ dir stays out of the module-bundle lane, with one loud warning', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-consumer-modules-'));
  const siteLayer = path.join(tmp, 'assets');
  fs.mkdirSync(path.join(siteLayer, 'js', 'modules'), { recursive: true });
  fs.writeFileSync(
    path.join(siteLayer, 'js', 'modules', 'foo.js'),
    "import { Manager } from '@omega.js/client';\nexport const foo = () => Manager;\n",
  );

  const outDir = path.join(PKG, '.omega', `assets-consumer-modules-${process.pid}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
  const warnings = [];
  try {
    await buildAssets({
      layers: [siteLayer, ...themeRoots, path.join(PKG, 'core')],
      themeRoots,
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      warn: (message) => warnings.push(message),
      only: 'js',
    });

    const modulesDir = path.join(outDir, 'assets', 'js', 'modules');
    assert.ok(!fs.existsSync(path.join(modulesDir, 'foo.bundle.js')), 'the consumer file is never swept into the lane');
    assert.ok(fs.existsSync(path.join(modulesDir, 'redirect.bundle.js')), 'framework layers still bundle their modules');

    const warning = warnings.filter((line) => line.includes('js/modules'));
    assert.equal(warning.length, 1, `exactly one warning: ${warnings.join(' | ')}`);
    assert.ok(warning[0].includes(path.join(siteLayer, 'js', 'modules')), 'the warning names the offending directory');
    assert.ok(warning[0].includes('js/libs/'), 'the warning names the js/libs/ convention');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

// #469 — the legacy 4-segment page module (js/pages/dashboard/agents/edit.js)
// is collected as a HELPER, so the page ships with no JS and the build stays
// green. Real helpers (checkout modules/, account sections/) reach a bundle
// through their page entry; an orphan reaches nothing, and says so.
test('#469: a page module no entry reaches warns loudly; helpers and partials stay silent', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-orphan-page-'));
  const siteLayer = path.join(tmp, 'assets');
  const pageDir = path.join(siteLayer, 'js', 'pages', 'dashboard', 'agents');
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'edit.js'), 'export default () => {};\n');
  fs.writeFileSync(path.join(pageDir, '_shared.js'), 'export const shared = () => {};\n');

  const outDir = path.join(PKG, '.omega', `assets-orphan-page-${process.pid}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
  const warnings = [];
  try {
    await buildAssets({
      layers: [siteLayer, ...themeRoots, path.join(PKG, 'core')],
      themeRoots,
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      warn: (message) => warnings.push(message),
      only: 'js',
    });

    const warning = warnings.filter((line) => line.includes('js/pages'));
    assert.equal(warning.length, 1, `exactly one warning: ${warnings.join(' | ')}`);
    assert.ok(warning[0].includes(path.join(pageDir, 'edit.js')), 'the warning names the orphaned file');
    assert.ok(warning[0].includes('[slug]'), 'the warning names the [name] wildcard family file (#470)');
    assert.ok(warning[0].indexOf('[slug]') < warning[0].indexOf('index.js'), 'the family file comes FIRST, the single-page spellings after');
    assert.ok(warning[0].includes('index.js'), 'the warning names the accepted per-page-dir spelling');
    assert.ok(warning[0].includes('3 segments'), 'the warning names the accepted flat spelling');
    assert.ok(!warning[0].includes('_shared.js'), 'underscore partials stay silent');
    assert.ok(!warning[0].includes(path.join('checkout', 'modules')), 'a helper its page entry imports stays silent');
    assert.ok(!warning[0].includes(path.join('account', 'sections')), 'account section helpers stay silent');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
