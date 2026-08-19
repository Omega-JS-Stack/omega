/**
 * The dev loop's config-reset watch targets are DERIVED, never listed (#200
 * Lane A): `configureOmega` reads through the captured-read helper, and
 * `registerTemplateWatchTargets` registers the union those reads recorded.
 *
 * This suite is the parity pin — the union must cover every target the hand
 * list used to register (the defaults tree, each layer's _layouts/_includes,
 * each layer's _sections/_components, the theme fonts dirs), so the derivation
 * can only ever ADD coverage. dev-watch.test.js proves the resets themselves
 * end to end through a real watcher; this one is the static contract, over a
 * stub Eleventy config.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { configureOmega } = require('../src/index.js');
const { registerTemplateWatchTargets } = require('../src/commands/dev.js');
const { resolveThemeLayers } = require('../src/layers.js');

const ACTIVE_THEME = 'toy-theme';

const SITE_DATA = {
  url: 'http://localhost:4000',
  brand: { id: 'watch', name: 'WatchCo' },
  meta: { title: 'WatchCo', description: 'Watch meta description' },
  theme: { id: ACTIVE_THEME },
};

/**
 * The hand list this derivation REPLACED (dev.js before #200), verbatim in its
 * rules: the defaults tree whole, consumer + layer _layouts/_includes,
 * consumer + theme _sections/_components, the theme fonts dirs. Pinned here so
 * a lost target is a failing assertion, not a quiet regression.
 */
function legacyWatchTargets(options) {
  const themeLayers = resolveThemeLayers({
    activeTheme: options.activeTheme,
    consumerDir: options.consumerDir,
    themesDir: options.themesDir,
  });
  const targets = new Set();

  if (fs.existsSync(options.defaultsDir)) targets.add(fs.realpathSync(options.defaultsDir));

  for (const dir of ['_layouts', '_includes']) {
    targets.add(path.join(options.consumerDir, dir));
    for (const layer of [...themeLayers, options.coreDir]) {
      const target = path.join(layer, dir);
      if (fs.existsSync(target)) targets.add(fs.realpathSync(target));
    }
  }

  for (const dir of ['_sections', '_components']) {
    targets.add(path.join(options.consumerDir, dir));
    for (const layer of themeLayers) {
      const target = path.join(layer, dir);
      if (fs.existsSync(target)) targets.add(fs.realpathSync(target));
    }
  }

  for (const layer of themeLayers) {
    const target = path.join(layer, 'fonts');
    if (fs.existsSync(target)) targets.add(fs.realpathSync(target));
  }

  return [...targets];
}

/**
 * A consumer app carrying every layer of the chain, packaged tree included —
 * reached the way a linked brand reaches it (a node_modules symlink over a
 * tree OUTSIDE cwd), because the path FORM of an out-of-cwd target is part of
 * the contract (#134).
 */
function app(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-watch-targets-')));
  const packaged = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-watch-pkg-')));
  const src = path.join(root, 'src');
  const write = (base) => (rel, contents) => {
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };
  const writeSrc = write(src);
  const writePackaged = write(packaged);

  writeSrc('pages/index.html', '---\npermalink: /\n---\n<p>home</p>');
  writeSrc('_layouts/toy.html', '<main>{{ content }}</main>');
  writeSrc('_includes/nav.json', '{ label: "BEFORE" }');
  writeSrc('_sections/toy-section/section.html', '<section>toy</section>');
  writeSrc('_sections/toy-section/section.json5', '{ defaults: { label: "BEFORE" } }');
  writeSrc(`themes/${ACTIVE_THEME}/_layouts/theme-toy.html`, '<main>{{ content }}</main>');
  writeSrc(`themes/${ACTIVE_THEME}/fonts/aaa-400-normal-latin.woff2`, 'face');
  writePackaged('core/_layouts/core-toy.html', '<main>{{ content }}</main>');
  writePackaged('core/_includes/core/head.html', '<head></head>');
  fs.mkdirSync(path.join(packaged, 'themes', 'classy'), { recursive: true });
  for (const set of ['sample-posts', 'sample-team', 'sample-updates']) {
    fs.mkdirSync(path.join(packaged, 'defaults', set), { recursive: true });
  }
  writePackaged('defaults/pages/default-toy.html', '---\npermalink: /default-page.html\n---\n<p>default</p>');
  writePackaged('defaults/showcase/showcase-toy.html', '---\npermalink: /showcase-page.html\n---\n<p>showcase</p>');

  const linked = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(packaged, linked);

  const cwd = process.cwd();
  process.chdir(root);
  t.after(() => {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(packaged, { recursive: true, force: true });
  });

  return {
    root,
    consumerDir: src,
    themesDir: path.join(linked, 'themes'),
    coreDir: path.join(linked, 'core'),
    defaultsDir: path.join(linked, 'defaults'),
    activeTheme: ACTIVE_THEME,
  };
}

// Enough Eleventy config surface for one configureOmega pass — the watch
// targets are the product under test, everything else is a sink.
function stubConfig() {
  const watched = [];
  const noop = () => {};
  return {
    watched,
    addWatchTarget: (target, options) => watched.push({ target, options }),
    setLiquidOptions: noop,
    setIncludesDirectory: noop,
    amendLibrary: noop,
    addGlobalData: noop,
    addPreprocessor: noop,
    addFilter: noop,
    addUrlTransform: noop,
    addTransform: noop,
    addTemplate: noop,
    addCollection: noop,
    on: noop,
    ignores: new Set(),
  };
}

// Does a watcher over `dir` see events for `target`? (Watch targets are
// recursive, so a dir covers itself and everything under it.)
const covers = (dir, target) => target === dir || target.startsWith(dir + path.sep);

function configure(config, fixture, siteData = SITE_DATA) {
  return configureOmega(config, {
    consumerDir: fixture.consumerDir,
    siteData,
    activeTheme: fixture.activeTheme,
    themesDir: fixture.themesDir,
    coreDir: fixture.coreDir,
    defaultsDir: fixture.defaultsDir,
    environment: 'development',
    assetManifest: { js: { pages: {} }, css: { pages: {}, themePages: {} } },
  });
}

function registeredForms(fixture) {
  const config = stubConfig();
  registerTemplateWatchTargets(config);
  configure(config, fixture);
  return config.watched;
}

test('the recorded union covers every target the hand list registered', (t) => {
  const fixture = app(t);
  const forms = registeredForms(fixture);
  const registered = new Set(forms.map((entry) => entry.target));

  // COVERAGE, not membership: a watch target is recursive, so containment
  // pruning (#200 Lane B) drops a recorded dir whose recorded ancestor already
  // watches it — `_sections/toy-section` rides `_sections`, the whole defaults
  // tree rides its root. What may never happen is a hand-list dir no target
  // covers.
  for (const target of legacyWatchTargets(fixture)) {
    assert.ok([...registered].some((form) => path.isAbsolute(form) && covers(form, target)),
      `${target} is watched by no registered target — the derivation may only ever add coverage`);
  }
});

test('a target whose ancestor is already registered is pruned away', (t) => {
  const fixture = app(t);
  const registered = registeredForms(fixture).map((entry) => entry.target).filter((form) => path.isAbsolute(form));

  const entryDir = path.join(fixture.consumerDir, '_sections', 'toy-section');
  assert.ok(registered.includes(path.join(fixture.consumerDir, '_sections')), 'the sections root is the target');
  assert.ok(!registered.includes(entryDir), 'one recursive watcher already covers every entry folder under it');

  for (const form of registered) {
    assert.ok(!registered.some((other) => other !== form && covers(other, form)),
      `${form} sits under another registered target — one dir, one watcher`);
  }
});

test('the consumer scan dirs stay OFF the reset lane', (t) => {
  const fixture = app(t);
  const registered = new Set(registeredForms(fixture).map((entry) => entry.target));

  // The Lane B pin (#200): pages/ and the collection dirs are where a brand's
  // content lives. A reset target on either would rebuild the whole Eleventy
  // config on every page edit — the incremental contract (dev-watch.test.js)
  // dies the moment one appears here.
  for (const dir of ['pages', '_posts', '_team', '_updates']) {
    const target = path.join(fixture.consumerDir, dir);
    assert.ok(![...registered].some((form) => path.isAbsolute(form) && covers(form, target)),
      `${target} resets the config — the content lanes are rescan captures, never resets`);
  }
});

test('every derived target resets the config', (t) => {
  const fixture = app(t);

  for (const entry of registeredForms(fixture)) {
    assert.deepEqual(entry.options, { resetConfig: true }, `${entry.target} must force a config reset`);
  }
});

test('a config build that throws still registers what it read', (t) => {
  const fixture = app(t);
  const config = stubConfig();
  registerTemplateWatchTargets(config);

  // A real config-time failure, part way through the build: an unknown
  // collection name in dev.limitCollections. Everything read before it — the
  // layers, the sections, the defaults tree — is already recorded.
  assert.throws(
    () => configure(config, fixture, { ...SITE_DATA, dev: { limitCollections: { bogus: 5 } } }),
    /limitCollections/,
  );

  const registered = config.watched.map((entry) => entry.target);
  assert.ok(registered.includes(path.join(fixture.consumerDir, '_layouts')),
    'the scope closes in a finally — a broken config must still watch the dirs where its fix will land, or the fix needs a restart to be seen');
});

test('in-cwd targets register both path forms, out-of-cwd targets absolute only', (t) => {
  const fixture = app(t);
  const forms = registeredForms(fixture);
  const registered = new Set(forms.map((entry) => entry.target));

  const inCwd = path.join(fixture.consumerDir, '_layouts');
  assert.ok(registered.has(inCwd), 'the absolute form carries the reset today');
  // Not dead insurance, measured (#344): registering the absolute form ALONE
  // starved the packaged-layer reset in 5 of 8 interleaved A/B runs, against
  // 0 of 8 with both. The duplicate event is the cost of an FSEvents stream
  // arrangement that actually delivers.
  assert.ok(registered.has(path.relative(process.cwd(), inCwd)), 'the relative form is the insurance form');

  const outOfCwd = path.join(fs.realpathSync(fixture.coreDir), '_layouts');
  assert.ok(registered.has(outOfCwd), 'a packaged layer registers its resolved absolute path');
  for (const form of registered) {
    assert.ok(!form.startsWith('..'), `${form} escapes cwd — an escaping relative target re-roots Eleventy's watcher and kills every reset (#134)`);
  }
});
