/**
 * Asset-pipeline invariants over LAYER ROOTS (site → theme(s) → core): page
 * modules layered via esbuild boot stubs, ESM + code splitting (@omega.js/client
 * and the boot runtime in ONE shared chunk — the cross-bundle singleton),
 * the real UJM main bundle (core runtime + dynamic theme import via
 * __theme__), the real @omega.js/client via the @omega.js/client alias (subpaths
 * included), layered sass through omega:theme, dev-mode stable names, and the
 * PurgeCSS pass.
 *
 * The rule page and layout assets follow (#624): EVERY layer that ships a file
 * for a key is built and loads, in layer order, JS and CSS alike. The one
 * replace-with-extend lane is the site-wide main bundle — `omega:main` on both
 * sides.
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

test('layered page modules: every layer that ships one is an entry, all content-hashed', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['classy', 'base']);

  // Site layer's flat index.js + the real UJM core modules under dir-index
  // keys + wildcard filenames (blog/[slug] serves every post URL — spec §7)
  for (const key of ['index', 'pricing/index', 'signin/index', 'signup/index', 'payment/checkout/index', 'blog/[slug]']) {
    assert.ok(manifest.js.pages[key] && manifest.js.pages[key].length, `manifest has ${key}`);
    for (const url of manifest.js.pages[key]) {
      assert.match(url, /^\/assets\/js\/pages\/.+-[A-Z0-9]+\.js$/, `${key} is content-hashed`);
    }
  }
  assert.ok(!manifest.js.pages['payment/checkout/modules/api'], 'helper modules are NOT entries');
  assert.ok(!manifest.js.pages['dashboard/account/sections/billing'], 'section helpers are NOT entries');
  assert.ok(!manifest.js.pages['legal/_document'], 'underscore partials are NOT entries');

  // The 404 page's script is an ordinary page asset, keyed by its URL (#624 —
  // it used to ride the fixed-URL modules lane).
  assert.ok(manifest.js.pages['404/index'], 'the 404 page module is a normal page asset');
});

// #624 — ONE rule for page assets, JS and CSS alike: EVERY layer's file for a
// key loads, in layer order (core → theme → consumer). The newsflash chain is
// the real case the audit found: its js/pages/blog/[slug].js used to REPLACE
// core's blog script while both layers' page CSS loaded — two rules for one
// feature.
test('#624: every layer\'s page JS loads, in layer order — core, then theme, then consumer', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['newsflash', 'base']);

  const urls = manifest.js.pages['blog/[slug]'];
  assert.equal(urls.length, 3, `core + newsflash + consumer all ship blog/[slug].js (${JSON.stringify(urls)})`);

  const [core, theme, consumer] = urls.map((url) => readGraph(url));
  assert.ok(core.includes('No valid positions for vert insertion'), 'the CORE blog script loads first — a framework page script always runs');
  assert.ok(theme.includes('newsflash-progress'), 'the active theme decorates second');
  assert.ok(consumer.includes('consumer wins'), 'the consumer adds last');
});

test('#624: page CSS follows the same one rule — no themePages namespace left', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['newsflash', 'base']);

  assert.ok(!manifest.css.themePages, 'the theme page-css namespace is gone — one bucket, one rule');

  // One key, every layer's sheet, in load order: each is either a hashed file
  // or (#767) the css text itself when it is small enough to inline.
  const sheets = manifest.css.pages['blog/[slug]'];
  assert.equal(sheets.length, 3, `core + newsflash + consumer sheets all emit (${JSON.stringify(sheets)})`);
  for (const sheet of sheets) {
    if (sheet.href) assert.match(sheet.href, /^\/assets\/css\/pages\/.+-[a-f0-9]{8}\.css$/, `${sheet.href} is content-hashed`);
    else assert.ok(sheet.inline.length, 'an inlined sheet carries its compiled css instead of a url');
  }

  const [core, theme, consumer] = sheets.map((sheet) => (
    sheet.inline || fs.readFileSync(path.join(OUT, sheet.href.slice(1)), 'utf8')
  ));
  assert.ok(core.includes('.blog-post-content'), 'core page sheet first');
  assert.ok(theme.includes('newsflash'), 'the active theme second');
  assert.ok(consumer.includes('.consumer-blog-probe'), 'the consumer last — it wins the cascade by ORDER, not by replacement');
});

test('a page sheet that compiles to nothing is never emitted or linked', async () => {
  // core's pricing, 404 and alternatives sheets are EMPTY files, and the head
  // linked each as a render-blocking stylesheet: on Slow 4G that empty request
  // queued behind the font preloads and held pricing's first paint a full
  // second past the home page's (#763 proof: 1,884 ms against 824 ms).
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['newsflash', 'base']);

  assert.equal(manifest.css.pages['empty-probe'], undefined, 'no manifest bucket for a sheet with no rules');
  assert.ok(!fs.existsSync(path.join(OUT, 'assets', 'css', 'pages', 'empty-probe')), 'and no file on disk');
});

test('#624: layout-keyed assets resolve like page assets, hashed, from every layer', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['classy', 'base']);

  // js/layouts/<layout>.js — the redirect layout's script, keyed by the layout
  // name the page's frontmatter writes.
  const js = manifest.js.layouts['modules/utilities/redirect'];
  assert.equal(js.length, 1, 'core is the only layer shipping the redirect layout script');
  assert.match(js[0], /^\/assets\/js\/layouts\/modules\/utilities\/redirect-[A-Z0-9]+\.js$/, 'content-hashed like a page bundle');
  assert.ok(readGraph(js[0]).includes('redirect-config'), 'the redirect module rides the layout lane');

  // css/layouts/<layout>.scss — same key, same layering. The fixture's sheet is
  // a couple of rules, so it rides the manifest inline (#767); the hashed-file
  // half of the lane is pinned on an over-budget sheet in inline-sheets.test.js.
  const css = manifest.css.layouts['modules/utilities/redirect'];
  assert.equal(css.length, 1, 'the fixture consumer layer ships the layout sheet');
  assert.ok(css[0].inline.includes('.consumer-redirect-probe'), 'the consumer layout sheet compiled');
});

test('#624: the modules lane is deleted — no second esbuild pass, no fixed-URL bundles', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await build(['classy', 'base']);

  assert.ok(!fs.existsSync(path.join(OUT, 'assets', 'js', 'modules')), 'nothing emits at /assets/js/modules/ any more');
  assert.ok(!fs.existsSync(path.join(PKG, 'core', 'js', 'modules')), 'and the core layer ships no modules/ dir');
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
    assert.ok(!manifest.js.pages[dead] && !manifest.css.pages[dead], `no manifest bucket carries dead key ${dead}`);
  }

  // …their replacements resolve straight from page URLs
  assert.strictEqual(resolvePageAsset(manifest.css.pages, 'blog/my-first-post'), manifest.css.pages['blog/[slug]'], 'post css via wildcard');
  assert.strictEqual(resolvePageAsset(manifest.css.pages, 'updates/v1.2.0'), manifest.css.pages['updates/[update]'], 'update css via wildcard');
  assert.ok(String(resolvePageAsset(manifest.js.pages, 'alternatives/acme')).includes('/assets/js/pages/alternatives/[alternative]'), 'alternative js via per-page-dir wildcard');
  assert.strictEqual(resolvePageAsset(manifest.css.pages, 'updates'), manifest.css.pages['updates/index'], 'the /updates list page keeps its exact entry');

  // The flat legal URLs each own an exact entry over the shared _document partials
  for (const url of ['terms', 'cookies', 'privacy']) {
    assert.ok(manifest.js.pages[url], `js.pages has ${url}`);
    assert.ok(manifest.css.pages[url].length, `classy theme css has ${url}`);
  }
  const termsGraph = readGraph(manifest.js.pages.terms[0]);
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
  const pageGraph = readGraph(manifest.js.pages['blog/[slug]'][0]);
  assert.ok(!pageGraph.includes('sectionProbed'), 'page stubs carry no section registry');

  // classy's product-demo section.js rides the same lane (the video-tab
  // behavior that moved out of the dead core index page module)
  assert.ok(graph.includes('marketing/product-demo'), 'product-demo id in the section registry');
  assert.ok(graph.includes('shown.bs.tab'), 'the tab-video behavior bundled via the section lane');
});

test('the redirect layout script keeps forwarding the querystring and the fragment', async () => {
  const manifest = await build(['classy', 'base']);
  const redirect = readGraph(manifest.js.layouts['modules/utilities/redirect'][0]);
  assert.ok(redirect.includes('redirect-config'), 'the layout bundle reads its config element');
  assert.ok(redirect.includes('Forwarded fragment'), 'fragment forwarding rides along (#billing deep-links)');
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
  const signinEntry = fs.readFileSync(path.join(OUT, manifest.js.pages['signin/index'][0].slice(1)), 'utf8');
  assert.ok(signinEntry.length < 2000, `page entry is a thin stub (${signinEntry.length} bytes)`);
  assert.ok(/chunks\/chunk-/.test(signinEntry), 'stub imports shared chunks');

  // The client (`_authReady` is its constructor marker) appears in exactly one
  // file across ALL bundles — the shared chunk both main and pages import.
  const withClient = walkJs(path.join(OUT, 'assets', 'js')).filter((f) => fs.readFileSync(f, 'utf8').includes('_authReady'));
  assert.strictEqual(withClient.length, 1, `client code in exactly one file (found ${withClient.length})`);
  assert.ok(withClient[0].includes(`${path.sep}chunks${path.sep}`), 'client lives in a shared chunk');

  // The page's own code is still in its graph (via the @omega.js/client alias)
  const graph = readGraph(manifest.js.pages['signin/index'][0]);
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

  // One page-css bucket, layered (#624): the core sheet and the active theme's
  // both land under the same key, in load order.
  assert.equal(newsflash.css.pages['blog/[slug]'].length, 3, 'core + newsflash + consumer sheets for blog/[slug]');
  // classy ships blog/[slug] page css since the cp170 editorial extras
  // (reading progress + article rail) — it layers over core's the same way
  assert.equal(classy.css.pages['blog/[slug]'].length, 3, 'core + classy + consumer sheets for blog/[slug]');
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
  assert.deepStrictEqual(manifest.js.pages['signin/index'], ['/assets/js/pages/signin/index.js'], 'page js un-hashed');
  // One key, one file per LAYER — the suffix names the owning layer, so two
  // layers' bundles for the same key never collide on a stable dev name.
  assert.deepStrictEqual(
    manifest.js.pages['blog/[slug]'],
    ['/assets/js/pages/blog/[slug].js', '/assets/js/pages/blog/[slug].site.js'],
    'wildcard filenames survive esbuild verbatim, one per layer in load order',
  );
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

test('fonts: a face named only by an INLINED page sheet survives the prune (#767)', async () => {
  // #767 keeps a small page/layout sheet out of the file tree entirely: it
  // rides the manifest as css text. The prune reads the emitted css to decide
  // which copied faces are referenced, so an inlined sheet is invisible to it,
  // and a face that sheet declares would be deleted out from under the page
  // that needs it. No packaged sheet declares a face in a page lane today; a
  // consumer sheet can, which is exactly the case nothing else covers.
  const layer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-inline-face-')));
  fs.mkdirSync(path.join(layer, 'css', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(layer, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(layer, 'fonts', 'page-only.woff2'), 'face');
  fs.writeFileSync(path.join(layer, 'fonts', 'nobody-asks.woff2'), 'face');
  fs.writeFileSync(path.join(layer, 'css', 'pages', 'fontpage.scss'), [
    '@font-face { font-family: PageOnly; src: url(/assets/fonts/page-only.woff2) format("woff2"); }',
    '.omega-page-only { font-family: PageOnly; }',
  ].join('\n'));

  try {
    fs.rmSync(OUT, { recursive: true, force: true });
    const manifest = await buildAssets({
      layers: [layer, path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')],
      themeRoots: [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')],
      sectionRoots: [layer, path.join(PKG, 'themes', 'classy')],
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir: OUT,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    });

    // The premise: this sheet really did inline, so the face has no file on
    // disk naming it. Without that, the case below proves nothing.
    const sheets = manifest.css.pages.fontpage;
    assert.ok(sheets && sheets[0].inline, 'the small page sheet rides the manifest as text');
    assert.ok(sheets[0].inline.includes('/assets/fonts/page-only.woff2'), 'and its @font-face is in that text');

    const fonts = path.join(OUT, 'assets', 'fonts');
    assert.ok(fs.existsSync(path.join(fonts, 'page-only.woff2')), 'the inlined sheet keeps its face');
    assert.ok(!fs.existsSync(path.join(fonts, 'nobody-asks.woff2')), 'a face nothing names is still pruned');
  } finally {
    fs.rmSync(layer, { recursive: true, force: true });
  }
});

// #624 — the site-wide main bundle is the one REPLACE-with-extend lane, and
// JS now spells the extend exactly as CSS does: `omega:main` resolves the same
// name from the layers BELOW the importing file (sass's `@use 'omega:main'`).
test('#624: a consumer main.js extends the framework main through `omega:main`', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-main-extend-'));
  const siteLayer = path.join(tmp, 'assets');
  fs.mkdirSync(path.join(siteLayer, 'js'), { recursive: true });
  fs.writeFileSync(
    path.join(siteLayer, 'js', 'main.js'),
    "import coreMain from 'omega:main';\n"
    + "export default async (context) => {\n"
    + "  await coreMain(context);\n"
    + "  console.log('consumer main extended the framework main');\n"
    + "};\n",
  );

  const outDir = path.join(PKG, '.omega', `assets-main-extend-${process.pid}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
  try {
    const manifest = await buildAssets({
      layers: [siteLayer, ...themeRoots, path.join(PKG, 'core')],
      themeRoots,
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      dev: true,
      only: 'js',
    });

    const graph = fs.readFileSync(path.join(outDir, manifest.js.main.slice(1)), 'utf8')
      + fs.readdirSync(path.join(outDir, 'assets', 'js', 'chunks'), { withFileTypes: true })
        .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8')).join('\n');

    assert.ok(graph.includes('consumer main extended the framework main'), 'the consumer main is the entry');
    assert.ok(graph.includes('Global module loaded successfully'), 'and the FRAMEWORK main it extends is in the graph');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

// `omega:` means BELOW, not "anything but me": the scan starts one layer under
// the importer's own, so a theme's own main.js reaches CORE and can never
// resolve UPWARD into the consumer layer that extends it.
test('#624: `omega:main` from a THEME layer resolves down to core, never up to the consumer', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-main-below-'));
  const siteLayer = path.join(tmp, 'assets');
  const themeLayer = path.join(tmp, 'themes', 'probe');
  fs.mkdirSync(path.join(siteLayer, 'js'), { recursive: true });
  fs.mkdirSync(path.join(themeLayer, 'js'), { recursive: true });
  fs.writeFileSync(
    path.join(siteLayer, 'js', 'main.js'),
    "import below from 'omega:main';\n"
    + "export default async (context) => {\n"
    + "  await below(context);\n"
    + "  console.log('consumer main ran last');\n"
    + "};\n",
  );
  fs.writeFileSync(
    path.join(themeLayer, 'js', 'main.js'),
    "import below from 'omega:main';\n"
    + "export default async (context) => {\n"
    + "  await below(context);\n"
    + "  console.log('theme main ran in between');\n"
    + "};\n",
  );

  const outDir = path.join(PKG, '.omega', `assets-main-below-${process.pid}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const themeRoots = [themeLayer, path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
  try {
    const manifest = await buildAssets({
      layers: [siteLayer, ...themeRoots, path.join(PKG, 'core')],
      themeRoots,
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      dev: true,
      only: 'js',
    });

    const graph = fs.readFileSync(path.join(outDir, manifest.js.main.slice(1)), 'utf8')
      + fs.readdirSync(path.join(outDir, 'assets', 'js', 'chunks'), { withFileTypes: true })
        .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8')).join('\n');

    assert.ok(graph.includes('consumer main ran last'), 'the consumer main is the entry');
    assert.ok(graph.includes('theme main ran in between'), 'the consumer extends the THEME below it');
    assert.ok(graph.includes('Global module loaded successfully'), "the theme's own `omega:main` reached CORE — a skip-self scan would have looped back up to the consumer instead");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

// #249 — a `js/modules/` dir is not an asset lane. It was the framework's own
// standalone-IIFE lane until #624 deleted it; a consumer's copy was never built
// (its constraints — fixed URL, no `@omega.js/client` — were the framework's),
// and now nobody's is. Shared code goes in `js/libs/`, and the build says so
// instead of ignoring the directory in silence.
test('#249: a js/modules/ dir is built by nothing, and says so once', async () => {
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

    assert.ok(!fs.existsSync(path.join(outDir, 'assets', 'js', 'modules')), 'nothing is emitted for the directory');

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

// #742 — the redirect layout module hops at IMPORT time and exports nothing
// (core/js/layouts/modules/utilities/redirect.js), so the boot stub must never
// read `.default` off its namespace: esbuild proves that access undefined and
// warns. The warning hid behind esbuild's silenced printer until @omega.js/devkit's
// bundle module started reporting its findings through the logger (#737), which
// is why the guard is the COUNT rather than one message: every esbuild warning
// this lane can raise is a real import that resolves to nothing.
test('#742: the js build over the real layer chain emits zero esbuild warnings', async () => {
  const outDir = path.join(PKG, '.omega', `assets-warning-free-${process.pid}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];

  // esbuild's findings reach a human through the devkit logger (#737), so the
  // console IS the warning channel to watch.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await buildAssets({
      layers: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots, path.join(PKG, 'core')],
      themeRoots,
      sectionRoots: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots],
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      only: 'js',
    });
  } finally {
    console.warn = realWarn;
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  assert.deepEqual(warnings, [], `the js build warned: ${warnings.join(' | ')}`);
});
