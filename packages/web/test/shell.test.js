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
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { layeredFileImporter } = require('../src/assets.js');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

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
    importers: [layeredFileImporter(layers)],
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
  assert.ok(app.includes('classy-side__brand'), 'classy skin chrome present in the shell');
});
