/**
 * C3 app-shell mechanics — the skin-independent backend/admin shell.
 *
 * Four halves: the shell SHEET compiling clean (zero deprecations, regions +
 * states + breakpoint + token consumption all present), the core bundle
 * carrying it in the right cascade slot, the JS module wired into main.js and
 * speaking the declarative contract, and a theme expressing the shell through
 * the real engine (toy theme's backend base renders the contract markup).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const sass = require('sass');

const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { buildSite, buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'shell-test');

module.exports = defineCases({
  type: 'group',
  description: 'shell',
  tests: [
    // ─── Shell sheet ─────────────────────────────────────────────────────────────

    {
      name: 'shell sheet compiles clean — zero deprecations, regions, states, breakpoint',
      run: (ctx) => {
        const warnings = [];
        const result = sass.compile(path.join(PKG, 'core', 'css', 'shell', '_index.scss'), {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        });

        ctx.expect(warnings, 'new core css never warns — the #16 bar').toEqual([]);

        // Regions painted by tokens, never hardcoded
        ctx.expect(result.css, 'shell ground from tokens').toMatch(/\.omega-shell\s*\{[^}]*var\(--omega-ground\)/s);
        ctx.expect(result.css, 'sidebar surface from tokens').toMatch(/\.omega-shell__sidebar\s*\{[^}]*var\(--omega-surface\)/s);
        ctx.expect(result.css, 'shell dimension tokens declared (classy v2 geometry)').toMatch(/--omega-shell-sidebar-w: 264px/);

        // States
        ctx.expect(result.css, 'rail collapse state').toMatch(/\.omega-shell\[data-shell-collapsed=['"]?true['"]?\] \.omega-shell__sidebar/);
        ctx.expect(result.css, 'drawer open state').toMatch(/\.omega-shell\[data-shell-open=['"]?true['"]?\] \.omega-shell__sidebar/);
        ctx.expect(result.css, 'viewport-locked variant').toMatch(/\.omega-shell--locked \.omega-shell__main\s*\{[^}]*overflow: hidden/s);

        // Responsive + motion mechanics
        ctx.expect(result.css, 'drawer breakpoint matches classy\'s xl cutover').toMatch(/max-width: 1199\.98px/);
        ctx.expect(result.css, 'drawer parks off-canvas').toMatch(/translateX\(-100%\)/);
        ctx.expect(result.css, 'motion respects the OS preference').toMatch(/prefers-reduced-motion: reduce/);
      },
    },

    {
      name: 'main.scss wires the shell after tokens and before the theme',
      run: (ctx) => {
        const main = fs.readFileSync(path.join(PKG, 'core', 'css', 'main.scss'), 'utf8');
        const tokensAt = main.indexOf("@use 'tokens/index'");
        const shellAt = main.indexOf("@use 'shell/index'");
        const themeAt = main.indexOf("@use 'omega:theme'");

        ctx.expect(shellAt !== -1, 'shell sheet is used').toBeTruthy();
        ctx.expect(tokensAt < shellAt, 'tokens emit before the shell (shell consumes them)').toBeTruthy();
        ctx.expect(shellAt < themeAt, 'shell emits before the theme so themes can override').toBeTruthy();
      },
    },

    {
      name: 'core bundle carries the shell through the classy chain, warning set unchanged',
      run: (ctx) => {
        const layers = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'core')];

        const warnings = [];
        const css = sass.compile(path.join(PKG, 'core', 'css', 'main.scss'), {
          importers: [layeredFileImporter(layers), sectionsImporter([])],
          loadPaths: layers,
          quietDeps: true,
          silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        }).css;

        ctx.expect(css.includes('.omega-shell'), 'bundle carries the shell').toBeTruthy();
        ctx.expect(css.indexOf('--omega-ground') < css.indexOf('.omega-shell'), 'tokens land ahead of the shell in the bundle').toBeTruthy();
        ctx.expect(warnings, 'shell adds ZERO deprecations to the bundle compile').toEqual([]);
      },
    },

    {
      name: 'purge keeps the shell mechanics — runtime-stamped states never appear in static HTML',
      run: async (ctx) => {
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

        ctx.expect(css.includes('data-shell-collapsed'), 'safelist keeps the runtime-stamped shell state').toBeTruthy();
        ctx.expect(css.includes('.kept-by-content'), 'content-referenced rules survive').toBeTruthy();
        ctx.expect(!css.includes('.stripped-dead-rule'), 'purge still strips genuinely dead rules').toBeTruthy();
        fs.rmSync(outDir, { recursive: true, force: true });
      },
    },

    // ─── JS wiring ───────────────────────────────────────────────────────────────

    {
      name: 'app-shell module is wired into the web runtime and speaks the declarative contract',
      run: (ctx) => {
        const runtime = fs.readFileSync(path.join(PKG, 'runtime', 'omega.js'), 'utf8');
        ctx.expect(runtime.includes("'../core/js/core/app-shell.js'"), 'module statically imported').toBeTruthy();
        ctx.expect(runtime.includes('this.shell = createShell(this)'), 'built as omega.shell from the instance').toBeTruthy();

        const module = fs.readFileSync(path.join(PKG, 'core', 'js', 'core', 'app-shell.js'), 'utf8');
        for (const hook of ['data-omega-shell', 'data-shell-toggle', 'data-shell-dismiss', "'shell.collapsed'", 'Escape', 'aria-expanded']) {
          ctx.expect(module.includes(hook), `module speaks ${hook}`).toBeTruthy();
        }
      },
    },

    // ─── Engine expression ───────────────────────────────────────────────────────

    {
      name: 'a theme expresses the shell through the engine — toy backend base renders the contract',
      run: async (ctx) => {
        const pages = await buildWith(miniData, { activeTheme: 'toy' });
        const app = pages.get('/app');

        ctx.expect(app.includes('data-omega-shell'), 'shell root present').toBeTruthy();
        for (const region of ['omega-shell__sidebar', 'omega-shell__topbar', 'omega-shell__main', 'omega-shell__scrim']) {
          ctx.expect(app.includes(region), `${region} region present`).toBeTruthy();
        }
        ctx.expect(app, 'drawer toggle carries aria state').toMatch(/data-shell-toggle="drawer"[^>]*aria-expanded/);
        ctx.expect(app, 'collapse toggle carries aria state').toMatch(/data-shell-toggle="collapse"[^>]*aria-expanded/);
        ctx.expect(app.includes('data-shell-dismiss'), 'scrim dismisses the drawer').toBeTruthy();
        ctx.expect(app.includes('id="app-page-content"'), 'page content lands inside the shell').toBeTruthy();
      },
    },

    {
      name: 'the same page falls through to classy — v2 rides the shell contract too',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const app = pages.get('/app');

        ctx.expect(app && app.includes('id="app-page-content"'), 'classy backend base still renders the page').toBeTruthy();
        ctx.expect(app.includes('data-omega-shell'), 'classy v2 expresses the omega-shell contract').toBeTruthy();
        ctx.expect(app.includes('omega-side__brand'), 'classy skin chrome present in the shell').toBeTruthy();
      },
    },

    // ─── Chrome switches: a page that drops a region (#740, #741) ────────────────

    {
      name: '#741: main pins its own row, so a page without a topbar still scrolls inside it',
      run: (ctx) => {
        const css = sass.compile(path.join(PKG, 'core', 'css', 'shell', '_index.scss'), {
          logger: { warn: () => {}, debug: () => {} },
        }).css;

        const main = css.match(/(?:^|\n)\.omega-shell__main \{[^}]*\}/);
        ctx.expect(main, 'the main region is styled').toBeTruthy();
        ctx.expect(main[0], 'main claims the 1fr row explicitly — never auto-placed into the topbar row').toMatch(/grid-row: 2/);

        // The drawer block re-places main's COLUMN only: the row pin holds at every width.
        const drawerAt = css.indexOf('max-width: 1199.98px');
        ctx.expect(drawerAt > 0, 'the drawer breakpoint is in the sheet (otherwise the loop below checks nothing)').toBeTruthy();
        const mobile = css.slice(drawerAt);
        for (const rule of mobile.matchAll(/[^{}]*\.omega-shell__main[^{}]*\{([^}]*)\}/g)) {
          ctx.expect(!/grid-row/.test(rule[1]), 'no width re-places main out of the 1fr row').toBeTruthy();
        }
      },
    },

    {
      name: '#740: the rail toggles render only while the page HAS a rail',
      run: async (ctx) => {
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
          ctx.expect(app, 'the default app surface built').toBeTruthy();
          ctx.expect(app.includes('omega-shell__sidebar'), 'it carries the rail').toBeTruthy();
          ctx.expect(app, 'and the drawer toggle that opens it').toMatch(/data-shell-toggle="drawer"/);
          ctx.expect(app, 'and the rail collapse toggle').toMatch(/data-shell-toggle="collapse"/);

          const dock = pages.get('/dock');
          ctx.expect(dock, 'the rail-less surface built').toBeTruthy();
          ctx.expect(!dock.includes('omega-shell__sidebar'), 'sidebar.enabled: false drops the rail').toBeTruthy();
          ctx.expect(!dock.includes('data-shell-toggle'), 'and every control that would have driven it').toBeTruthy();
          ctx.expect(!dock.includes('aria-controls="app-sidebar"'), 'no aria-controls names an id the page does not carry').toBeTruthy();
          ctx.expect(dock.includes('id="dock-page-content"'), 'the page itself still renders in the shell').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#719: classy gives main its FULL frame on a page with no topbar',
      run: async (ctx) => {
        const warnings = [];
        const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'layout', '_shell.scss'), {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        }).css;

        ctx.expect(warnings, 'the skin sheet compiles clean').toEqual([]);

        // Standalone, main IS the card: four borders, four corners, four insets.
        const main = css.match(/(?:^|\n)\.omega-shell__main \{[^}]*\}/);
        ctx.expect(main, 'the main region is skinned').toBeTruthy();
        ctx.expect(!/border-top: 0/.test(main[0]), 'no unconditional open top: that painted a lidless card (#719)').toBeTruthy();
        ctx.expect(main[0], 'all four corners round by default').toMatch(/border-radius: var\(--omega-radius-xl\)(?!\s+var)/);

        // The cap-off trim is CONDITIONAL on a topbar actually being in the shell.
        const capped = css.match(/\.omega-shell:has\(> \.omega-shell__topbar\) \.omega-shell__main \{[^}]*\}/);
        ctx.expect(capped, 'the two-child card composition is guarded by the topbar being present').toBeTruthy();
        ctx.expect(capped[0], 'with a cap above it, main drops its top frame').toMatch(/border-top: 0/);
        ctx.expect(capped[0], 'and its top corners').toMatch(/border-radius: 0 0 var\(--omega-radius-xl\) var\(--omega-radius-xl\)/);

        // And the guard is real: the switch removes the element the :has() looks for.
        const pages = await buildWith(miniData, { activeTheme: 'toy' });
        ctx.expect(pages.get('/app').includes('omega-shell__topbar'), 'the default app surface carries the cap').toBeTruthy();
      },
    },

    {
      name: '#719: a sidebar-only page floats its own drawer toggle',
      run: async (ctx) => {
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
          ctx.expect(reader, 'the sidebar-only surface built').toBeTruthy();
          ctx.expect(!reader.includes('omega-shell__topbar'), 'topbar.enabled: false drops the cap').toBeTruthy();
          ctx.expect(reader.includes('omega-shell__sidebar'), 'and keeps the rail').toBeTruthy();

          const floating = reader.match(/<button[^>]*class="[^"]*omega-shell__drawer-toggle[^"]*"[^>]*>/);
          ctx.expect(floating, 'a floating toggle stands in for the one the topbar carried').toBeTruthy();
          ctx.expect(floating[0], 'it drives the EXISTING drawer mechanism, never a second one').toMatch(/data-shell-toggle="drawer"/);
          ctx.expect(floating[0], 'and names the rail it opens').toMatch(/aria-controls="app-sidebar"/);
          ctx.expect(floating[0], 'closed at parse time; app-shell.js syncs it after').toMatch(/aria-expanded="false"/);
          ctx.expect(floating[0], 'an icon-only control carries a name').toMatch(/aria-label="/);

          ctx.expect((reader.match(/data-shell-toggle="drawer"/g) || []).length, 'exactly one drawer toggle on the page').toBe(1);

          const kiosk = pages.get('/kiosk');
          ctx.expect(kiosk, 'the chromeless surface built').toBeTruthy();
          ctx.expect(!kiosk.includes('omega-shell__drawer-toggle'), 'no rail means nothing to float a toggle for').toBeTruthy();
          ctx.expect(kiosk.includes('id="kiosk-page-content"'), 'the page itself still renders').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#719: a page WITH a topbar keeps exactly its own drawer toggle',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const app = pages.get('/app');

        ctx.expect(!app.includes('omega-shell__drawer-toggle'), 'the topbar already carries one, so no floating duplicate').toBeTruthy();
        ctx.expect((app.match(/data-shell-toggle="drawer"/g) || []).length, 'exactly one drawer toggle').toBe(1);
      },
    },
  ],
});
