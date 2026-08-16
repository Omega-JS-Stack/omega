/**
 * Wave-3 W3/W10 — the PurgeCSS safelist keeps what the content scan can
 * never see: Bootstrap's JS-toggled transition classes (`.collapsing` and
 * friends snap without it — M19, verified empirically on the mobile nav)
 * and every omega-namespaced selector (runtime-stamped attributes like
 * data-omega-scrolled, which neobrutalism's navbar shadow now rides).
 * Anything genuinely unused still purges.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { loadConfig, toSiteGlobal } = require('@omega.js/config');

const { purgeCss } = require('../src/assets.js');
const { buildSite } = require('../src/build.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');

test('purge safelist: Bootstrap runtime classes + omega-stamped attributes survive; unused rules purge', async () => {
  const outDir = path.join(__dirname, '..', '.omega', 'purge-safelist-test-out');
  const cssDir = path.join(outDir, 'assets', 'css');
  fs.mkdirSync(cssDir, { recursive: true });

  fs.writeFileSync(path.join(cssDir, 'main.css'), [
    '.collapsing{height:0;transition:height .35s ease}',
    '.fade{transition:opacity .15s linear}',
    ".navbar-floating[data-omega-scrolled='true']{box-shadow:0 2px 0 #111}",
    '.statically-used{color:blue}',
    '.never-referenced{color:red}',
  ].join('\n'));
  fs.writeFileSync(path.join(outDir, 'index.html'), '<div class="statically-used navbar-floating"></div>');

  await purgeCss({ outDir, manifest: { css: { main: '/assets/css/main.css' } } });

  const purged = fs.readFileSync(path.join(cssDir, 'main.css'), 'utf8');
  assert.ok(purged.includes('.collapsing'), 'Bootstrap collapse transition survives (M19)');
  assert.ok(purged.includes('.fade'), 'Bootstrap fade survives');
  assert.ok(purged.includes("data-omega-scrolled"), 'omega-stamped attribute selector survives (W10)');
  assert.ok(purged.includes('.statically-used'), 'statically referenced rule survives');
  assert.ok(!purged.includes('.never-referenced'), 'genuinely unused rule still purges');
});

// #250 — `targets.web.purgecss` converted faithfully by `omega migrate`,
// validated by the schema, and read by nobody: the hardcoded safelist was the
// whole truth. It is now the DEFAULT, with the brand's own safelist merged
// over it (the resolved web config carries the section at `purgecss`).
test('#250: the config safelist merges over the built-in defaults', async () => {
  const outDir = path.join(__dirname, '..', '.omega', 'purge-config-safelist-out');
  const cssDir = path.join(outDir, 'assets', 'css');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(cssDir, { recursive: true });

  fs.writeFileSync(path.join(cssDir, 'main.css'), [
    '.collapsing{height:0}',
    '.brand-injected{color:green}',
    '.brand-widget__title{color:teal}',
    '.never-referenced{color:red}',
  ].join('\n'));
  fs.writeFileSync(path.join(outDir, 'index.html'), '<div></div>');

  await purgeCss({
    outDir,
    manifest: { css: { main: '/assets/css/main.css' } },
    purgecss: { safelist: { standard: ['brand-injected'], greedy: ['brand-widget'] } },
  });

  const purged = fs.readFileSync(path.join(cssDir, 'main.css'), 'utf8');
  assert.ok(purged.includes('.brand-injected'), 'a class named only in the config safelist survives');
  assert.ok(purged.includes('.brand-widget__title'), 'a config greedy pattern survives as a pattern');
  assert.ok(purged.includes('.collapsing'), 'the built-in defaults still apply underneath');
  assert.ok(!purged.includes('.never-referenced'), 'everything else still purges');
});

// The test above calls purgeCss directly, so it stays green even if the
// SECTION never reaches it: the feature crosses omega.json5 → loadConfig →
// toSiteGlobal → buildSite's `purgecss: options.siteData.purgecss` forwarding,
// and a rename anywhere on that chain kills it silently. This one walks the
// whole chain over a real build.
test('#250 wiring: a brand omega.json5 safelist survives the resolved-config path into the purge pass', async () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-purge-config-'));
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'purgeco', name: 'PurgeCo', url: 'https://purge.example.com' },
    meta: { title: 'PurgeCo', description: 'Config-path purge fixture' },
    theme: { id: 'classy' },
    // .carousel-inner is genuinely unused by the bare fixture — it purges
    // without this section, so its survival can ONLY come from the config.
    targets: { web: { purgecss: { safelist: { standard: ['carousel-inner'] } } } },
  }, null, 2));

  const { config, errors } = loadConfig(brandRoot, 'web');
  assert.deepStrictEqual(errors, [], 'the fixture config validates clean');

  const outDir = path.join(PKG, '.omega', 'purge-config-path');
  try {
    const { manifest } = await buildSite({
      consumerDir: path.join(__dirname, 'fixtures', 'bare-site'),
      siteData: toSiteGlobal(config),
      outDir,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    });

    const css = fs.readFileSync(path.join(outDir, manifest.css.main.slice(1)), 'utf8');
    assert.ok(css.includes('.carousel-inner'), 'the brand safelist reached PurgeCSS through the resolved config');
    assert.ok(!css.includes('.carousel-control-prev'), 'the purge pass really ran (its unsafelisted sibling is gone)');
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

// A pattern lane compiles config STRINGS with `new RegExp`, and its throw
// names neither the lane nor the pattern — an unclosed bracket in omega.json5
// surfaced as an anonymous SyntaxError mid-build.
test('an invalid safelist pattern fails naming its config key and the pattern', async () => {
  const outDir = path.join(PKG, '.omega', 'purge-bad-pattern-out');
  const cssDir = path.join(outDir, 'assets', 'css');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(cssDir, { recursive: true });
  fs.writeFileSync(path.join(cssDir, 'main.css'), '.kept{color:blue}');
  fs.writeFileSync(path.join(outDir, 'index.html'), '<div class="kept"></div>');

  await assert.rejects(
    () => purgeCss({
      outDir,
      manifest: { css: { main: '/assets/css/main.css' } },
      purgecss: { safelist: { greedy: ['brand-[widget'] } },
    }),
    (error) => {
      assert.match(error.message, /targets\.web\.purgecss\.safelist\.greedy/, 'names the config key that carries it');
      assert.match(error.message, /brand-\[widget/, 'and quotes the offending pattern');
      return true;
    },
  );
});
