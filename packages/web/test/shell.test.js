/**
 * C3 app-shell mechanics — the skin-independent backend/admin shell.
 *
 * Four halves: the shell SHEET compiling clean (zero deprecations, regions +
 * states + breakpoint + token consumption all present), the core bundle
 * carrying it in the right cascade slot, the JS module wired into main.js and
 * speaking the declarative contract, and a theme expressing the shell through
 * the real engine (toy theme's backend base renders the contract markup).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { buildSite, buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'shell-test');

// ─── Shell sheet ─────────────────────────────────────────────────────────────

test('shell sheet compiles clean — zero deprecations, regions, states, breakpoint', () => {
  const warnings = [];
  const result = sass.compile(path.join(PKG, 'core', 'css', 'shell', '_index.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  });

  assert.deepEqual(warnings, [], 'new core css never warns — the #16 bar');

  // Regions painted by tokens, never hardcoded
  assert.match(result.css, /\.omega-shell\s*\{[^}]*var\(--omega-ground\)/s, 'shell ground from tokens');
  assert.match(result.css, /\.omega-shell__sidebar\s*\{[^}]*var\(--omega-surface\)/s, 'sidebar surface from tokens');
  assert.match(result.css, /--omega-shell-sidebar-w: 264px/, 'shell dimension tokens declared (classy v2 geometry)');

  // States
  assert.match(result.css, /\.omega-shell\[data-shell-collapsed=['"]?true['"]?\] \.omega-shell__sidebar/, 'rail collapse state');
  assert.match(result.css, /\.omega-shell\[data-shell-open=['"]?true['"]?\] \.omega-shell__sidebar/, 'drawer open state');
  assert.match(result.css, /\.omega-shell--locked \.omega-shell__main\s*\{[^}]*overflow: hidden/s, 'viewport-locked variant');

  // Responsive + motion mechanics
  assert.match(result.css, /max-width: 1199\.98px/, 'drawer breakpoint matches classy\'s xl cutover');
  assert.match(result.css, /translateX\(-100%\)/, 'drawer parks off-canvas');
  assert.match(result.css, /prefers-reduced-motion: reduce/, 'motion respects the OS preference');
});

test('main.scss wires the shell after tokens and before the theme', () => {
  const main = fs.readFileSync(path.join(PKG, 'core', 'css', 'main.scss'), 'utf8');
  const tokensAt = main.indexOf("@use 'tokens/index'");
  const shellAt = main.indexOf("@use 'shell/index'");
  const themeAt = main.indexOf("@use 'omega:theme'");

  assert.ok(shellAt !== -1, 'shell sheet is used');
  assert.ok(tokensAt < shellAt, 'tokens emit before the shell (shell consumes them)');
  assert.ok(shellAt < themeAt, 'shell emits before the theme so themes can override');
});

test('core bundle carries the shell through the classy chain, warning set unchanged', () => {
  const layers = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'core')];

  const warnings = [];
  const css = sass.compile(path.join(PKG, 'core', 'css', 'main.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.ok(css.includes('.omega-shell'), 'bundle carries the shell');
  assert.ok(
    css.indexOf('--omega-ground') < css.indexOf('.omega-shell'),
    'tokens land ahead of the shell in the bundle',
  );
  assert.deepEqual(warnings, [], 'shell adds ZERO deprecations to the bundle compile');
});

test('purge keeps the shell mechanics — runtime-stamped states never appear in static HTML', async () => {
  const os = require('node:os');
  const { purgeCss } = require('../src/assets.js');

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-shell-purge-'));
  fs.mkdirSync(path.join(outDir, 'assets', 'css'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), '<html><body><p class="kept-by-content">hi</p></body></html>');
  fs.writeFileSync(
    path.join(outDir, 'assets', 'css', 'main.css'),
    [
      ".omega-shell[data-shell-collapsed='true'] .omega-shell__sidebar { width: 68px; }",
      '.kept-by-content { color: red; }',
      '.stripped-dead-rule { color: blue; }',
    ].join('\n'),
  );

  await purgeCss({ outDir, manifest: { css: { main: '/assets/css/main.css' } } });
  const css = fs.readFileSync(path.join(outDir, 'assets', 'css', 'main.css'), 'utf8');

  assert.ok(css.includes('data-shell-collapsed'), 'safelist keeps the runtime-stamped shell state');
  assert.ok(css.includes('.kept-by-content'), 'content-referenced rules survive');
  assert.ok(!css.includes('.stripped-dead-rule'), 'purge still strips genuinely dead rules');
  fs.rmSync(outDir, { recursive: true, force: true });
});

// ─── JS wiring ───────────────────────────────────────────────────────────────

test('app-shell module is wired into main.js and speaks the declarative contract', () => {
  const main = fs.readFileSync(path.join(PKG, 'core', 'js', 'main.js'), 'utf8');
  assert.ok(main.includes("__main_assets__/js/core/app-shell.js"), 'module statically imported');
  assert.ok(main.includes('appShellModule({ manager, options })'), 'module invoked with the core signature');

  const module = fs.readFileSync(path.join(PKG, 'core', 'js', 'core', 'app-shell.js'), 'utf8');
  for (const hook of ['data-omega-shell', 'data-shell-toggle', 'data-shell-dismiss', "'shell.collapsed'", 'Escape', 'aria-expanded']) {
    assert.ok(module.includes(hook), `module speaks ${hook}`);
  }
});

// ─── Engine expression ───────────────────────────────────────────────────────

test('a theme expresses the shell through the engine — toy backend base renders the contract', async () => {
  const pages = await buildWith(miniData, { activeTheme: 'toy' });
  const app = pages.get('/app');

  assert.ok(app.includes('data-omega-shell'), 'shell root present');
  for (const region of ['omega-shell__sidebar', 'omega-shell__topbar', 'omega-shell__main', 'omega-shell__scrim']) {
    assert.ok(app.includes(region), `${region} region present`);
  }
  assert.match(app, /data-shell-toggle="drawer"[^>]*aria-expanded/, 'drawer toggle carries aria state');
  assert.match(app, /data-shell-toggle="collapse"[^>]*aria-expanded/, 'collapse toggle carries aria state');
  assert.ok(app.includes('data-shell-dismiss'), 'scrim dismisses the drawer');
  assert.ok(app.includes('id="app-page-content"'), 'page content lands inside the shell');
});

test('the same page falls through to classy — v2 rides the shell contract too', async () => {
  const pages = await buildWith(miniData);
  const app = pages.get('/app');

  assert.ok(app && app.includes('id="app-page-content"'), 'classy backend base still renders the page');
  assert.ok(app.includes('data-omega-shell'), 'classy v2 expresses the omega-shell contract');
  assert.ok(app.includes('omega-side__brand'), 'classy skin chrome present in the shell');
});

// ─── Chrome switches: a page that drops a region (#740, #741) ────────────────

test('#741: main pins its own row, so a page without a topbar still scrolls inside it', () => {
  const css = sass.compile(path.join(PKG, 'core', 'css', 'shell', '_index.scss'), {
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  const main = css.match(/(?:^|\n)\.omega-shell__main \{[^}]*\}/);
  assert.ok(main, 'the main region is styled');
  assert.match(main[0], /grid-row: 2/, 'main claims the 1fr row explicitly — never auto-placed into the topbar row');

  // The drawer block re-places main's COLUMN only: the row pin holds at every width.
  const drawerAt = css.indexOf('max-width: 1199.98px');
  assert.ok(drawerAt > 0, 'the drawer breakpoint is in the sheet (otherwise the loop below checks nothing)');
  const mobile = css.slice(drawerAt);
  for (const rule of mobile.matchAll(/[^{}]*\.omega-shell__main[^{}]*\{([^}]*)\}/g)) {
    assert.ok(!/grid-row/.test(rule[1]), 'no width re-places main out of the 1fr row');
  }
});

test('#740: the rail toggles render only while the page HAS a rail', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-shell-chrome-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'app.html'), [
    '---',
    'layout: backend/core/base',
    'permalink: /app',
    'meta:',
    '  title: App',
    '---',
    '',
    '<p id="app-page-content">Hello from the app surface</p>',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(consumerDir, 'pages', 'dock.html'), [
    '---',
    'layout: backend/core/base',
    'permalink: /dock',
    'meta:',
    '  title: Dock',
    'config:',
    '  theme:',
    '    sidebar:',
    '      enabled: false',
    '---',
    '',
    '<p id="dock-page-content">A pane that needs no navigation</p>',
    '',
  ].join('\n'));

  try {
    const pages = await buildSite(consumerDir, miniData, {}, 'shell-chrome');

    const app = pages.get('/app');
    assert.ok(app, 'the default app surface built');
    assert.ok(app.includes('omega-shell__sidebar'), 'it carries the rail');
    assert.match(app, /data-shell-toggle="drawer"/, 'and the drawer toggle that opens it');
    assert.match(app, /data-shell-toggle="collapse"/, 'and the rail collapse toggle');

    const dock = pages.get('/dock');
    assert.ok(dock, 'the rail-less surface built');
    assert.ok(!dock.includes('omega-shell__sidebar'), 'sidebar.enabled: false drops the rail');
    assert.ok(!dock.includes('data-shell-toggle'), 'and every control that would have driven it');
    assert.ok(!dock.includes('aria-controls="app-sidebar"'), 'no aria-controls names an id the page does not carry');
    assert.ok(dock.includes('id="dock-page-content"'), 'the page itself still renders in the shell');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#719: classy gives main its FULL frame on a page with no topbar', async () => {
  const warnings = [];
  const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'layout', '_shell.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.deepEqual(warnings, [], 'the skin sheet compiles clean');

  // Standalone, main IS the card: four borders, four corners, four insets.
  const main = css.match(/(?:^|\n)\.omega-shell__main \{[^}]*\}/);
  assert.ok(main, 'the main region is skinned');
  assert.ok(!/border-top: 0/.test(main[0]), 'no unconditional open top: that painted a lidless card (#719)');
  assert.match(main[0], /border-radius: var\(--omega-radius-xl\)(?!\s+var)/, 'all four corners round by default');

  // The cap-off trim is CONDITIONAL on a topbar actually being in the shell.
  const capped = css.match(/\.omega-shell:has\(> \.omega-shell__topbar\) \.omega-shell__main \{[^}]*\}/);
  assert.ok(capped, 'the two-child card composition is guarded by the topbar being present');
  assert.match(capped[0], /border-top: 0/, 'with a cap above it, main drops its top frame');
  assert.match(capped[0], /border-radius: 0 0 var\(--omega-radius-xl\) var\(--omega-radius-xl\)/, 'and its top corners');

  // And the guard is real: the switch removes the element the :has() looks for.
  const pages = await buildWith(miniData, { activeTheme: 'toy' });
  assert.ok(pages.get('/app').includes('omega-shell__topbar'), 'the default app surface carries the cap');
});

test('#719: a sidebar-only page floats its own drawer toggle', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-shell-drawer-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });

  // Sidebar on, topbar off: the topbar's drawer toggle went with the topbar.
  fs.writeFileSync(path.join(consumerDir, 'pages', 'reader.html'), [
    '---',
    'layout: backend/core/base',
    'permalink: /reader',
    'meta:',
    '  title: Reader',
    'config:',
    '  theme:',
    '    topbar:',
    '      enabled: false',
    '---',
    '',
    '<p id="reader-page-content">A full-bleed reading surface</p>',
    '',
  ].join('\n'));

  // Neither region: nothing to open, so nothing floats.
  fs.writeFileSync(path.join(consumerDir, 'pages', 'kiosk.html'), [
    '---',
    'layout: backend/core/base',
    'permalink: /kiosk',
    'meta:',
    '  title: Kiosk',
    'config:',
    '  theme:',
    '    topbar:',
    '      enabled: false',
    '    sidebar:',
    '      enabled: false',
    '---',
    '',
    '<p id="kiosk-page-content">Chromeless</p>',
    '',
  ].join('\n'));

  try {
    const pages = await buildSite(consumerDir, miniData, {}, 'shell-drawer');

    const reader = pages.get('/reader');
    assert.ok(reader, 'the sidebar-only surface built');
    assert.ok(!reader.includes('omega-shell__topbar'), 'topbar.enabled: false drops the cap');
    assert.ok(reader.includes('omega-shell__sidebar'), 'and keeps the rail');

    const floating = reader.match(/<button[^>]*class="[^"]*omega-shell__drawer-toggle[^"]*"[^>]*>/);
    assert.ok(floating, 'a floating toggle stands in for the one the topbar carried');
    assert.match(floating[0], /data-shell-toggle="drawer"/, 'it drives the EXISTING drawer mechanism, never a second one');
    assert.match(floating[0], /aria-controls="app-sidebar"/, 'and names the rail it opens');
    assert.match(floating[0], /aria-expanded="false"/, 'closed at parse time; app-shell.js syncs it after');
    assert.match(floating[0], /aria-label="/, 'an icon-only control carries a name');

    assert.equal(
      (reader.match(/data-shell-toggle="drawer"/g) || []).length,
      1,
      'exactly one drawer toggle on the page',
    );

    const kiosk = pages.get('/kiosk');
    assert.ok(kiosk, 'the chromeless surface built');
    assert.ok(!kiosk.includes('omega-shell__drawer-toggle'), 'no rail means nothing to float a toggle for');
    assert.ok(kiosk.includes('id="kiosk-page-content"'), 'the page itself still renders');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#719: a page WITH a topbar keeps exactly its own drawer toggle', async () => {
  const pages = await buildWith(miniData);
  const app = pages.get('/app');

  assert.ok(!app.includes('omega-shell__drawer-toggle'), 'the topbar already carries one, so no floating duplicate');
  assert.equal((app.match(/data-shell-toggle="drawer"/g) || []).length, 1, 'exactly one drawer toggle');
});
