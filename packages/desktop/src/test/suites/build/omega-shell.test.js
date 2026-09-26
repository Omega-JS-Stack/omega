// Build-layer pins for the app-shell channel (#111): the classy theme ships
// only the shell SKIN, so the core mechanics — the .omega-shell grid sheet and
// the app-shell module that drives it — are vendored from @omega.js/web at
// prepare (package.json omega.vendorAssets → dist/assets/css/shell/ and
// dist/assets/js/core/), and the omega-desktop entry loads the sheet BEFORE
// the theme so the skin layers over the mechanics.

const fs = require('fs');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const PACKAGE_ROOT = path.join(__dirname, '..', '..', '..', '..');

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'omega shell — vendored core mechanics + entry wiring',
  tests: [
    {
      name: 'vendored shell sheet ships the geometry contract',
      run: (ctx) => {
        const vendored = path.join(PACKAGE_ROOT, 'dist', 'assets', 'css', 'shell', '_index.scss');
        ctx.expect(fs.existsSync(vendored)).toBe(true);

        const sheet = fs.readFileSync(vendored, 'utf8');
        ctx.expect(sheet.includes('--omega-shell-sidebar-w')).toBe(true);
        ctx.expect(sheet.includes('--omega-shell-rail-w')).toBe(true);
        ctx.expect(sheet.includes('data-shell-collapsed')).toBe(true);
        ctx.expect(sheet.includes('data-shell-open')).toBe(true);
      },
    },
    {
      name: 'vendored app-shell module ships the declarative contract',
      run: (ctx) => {
        const vendored = path.join(PACKAGE_ROOT, 'dist', 'assets', 'js', 'core', 'app-shell.js');
        ctx.expect(fs.existsSync(vendored)).toBe(true);

        const module = fs.readFileSync(vendored, 'utf8');
        ctx.expect(module.includes('data-shell-toggle')).toBe(true);
        ctx.expect(module.includes('data-shell-dismiss')).toBe(true);
        ctx.expect(module.includes("'shell.collapsed'")).toBe(true);
        // The shell is built FROM the runtime instance it is handed, so the
        // vendored copy imports no runtime of its own.
        ctx.expect(module.includes('export function createShell(omega)')).toBe(true);
        ctx.expect(module.includes('@omega.js/client')).toBe(false);
      },
    },
    {
      // The renderer builds `omega.shell` from ITSELF, exactly as web's runtime
      // does (`this.shell = createShell(this)`), off the vendored module
      name: 'the renderer builds omega.shell with createShell(omega)',
      run: (ctx) => {
        const renderer = fs.readFileSync(path.join(PACKAGE_ROOT, 'dist', 'renderer.js'), 'utf8');
        ctx.expect(renderer.includes("const { createShell } = require('./assets/js/core/app-shell.js');")).toBe(true);
        ctx.expect(renderer.includes('this.shell = createShell(this);')).toBe(true);
      },
    },
    {
      // The same function object the renderer calls, and it builds the shell API
      // off the instance's storage (an inert API when the page carries no shell)
      name: 'createShell(omega) returns the shell API off the instance it is handed',
      run: (ctx) => {
        const { createShell } = require(path.join(PACKAGE_ROOT, 'dist', 'assets', 'js', 'core', 'app-shell.js'));
        const savedDocument = globalThis.document;
        globalThis.document = { querySelector: () => null };
        try {
          const shell = createShell({ storage: { get: () => null, set: () => {} } });
          for (const name of ['isCollapsed', 'isOpen', 'setCollapsed', 'setOpen', 'toggleCollapsed', 'toggleOpen']) {
            ctx.expect(typeof shell[name]).toBe('function');
          }
          ctx.expect(shell.isCollapsed()).toBe(false);
        } finally {
          if (savedDocument === undefined) delete globalThis.document;
          else globalThis.document = savedDocument;
        }
      },
    },
    {
      // Renderer code imports vendored core modules by this alias. That it
      // RESOLVES is proved downstream, in the boot layer (the fixture consumer
      // imports app-shell through it and the built bundle is asserted there).
      name: 'renderer bundles declare the vendored core assets alias',
      run: (ctx) => {
        const task = fs.readFileSync(path.join(PACKAGE_ROOT, 'dist', 'gulp', 'tasks', 'bundle.js'), 'utf8');
        ctx.expect(task.includes("'__main_assets__'")).toBe(true);
      },
    },
    {
      name: 'entry loads the shell sheet before the theme',
      run: (ctx) => {
        const entry = fs.readFileSync(path.join(PACKAGE_ROOT, 'dist', 'assets', 'css', 'omega-desktop.scss'), 'utf8');
        const shellAt = entry.indexOf("@use 'shell/index'");
        const themeAt = entry.indexOf("@forward 'theme'");

        ctx.expect(shellAt > -1).toBe(true);
        ctx.expect(themeAt > -1).toBe(true);
        ctx.expect(shellAt < themeAt).toBe(true);
      },
    },
    {
      name: 'entry compiles with the shell grid and tokens, skin layered after',
      run: (ctx) => {
        const sass = require('sass');
        const css = sass.compile(path.join(PACKAGE_ROOT, 'dist', 'assets', 'css', 'omega-desktop.scss'), {
          loadPaths: [
            path.join(PACKAGE_ROOT, 'dist', 'assets', 'css'),
            path.join(PACKAGE_ROOT, 'dist', 'assets', 'themes', 'classy'),
            path.join(PACKAGE_ROOT, 'dist', 'assets', 'themes'),
          ],
          silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function'],
        }).css;

        ctx.expect(css.includes('--omega-shell-sidebar-w')).toBe(true);
        ctx.expect(/\.omega-shell \{[^}]*display: grid/.test(css)).toBe(true);
        ctx.expect(css.includes('[data-shell-collapsed=true]')).toBe(true);

        // Cascade: the core mechanics land before classy's naked-sidebar skin,
        // so the skin wins at equal specificity (same order as web's main.scss).
        const coreAt = css.indexOf('--omega-shell-sidebar-w');
        const skinAt = css.indexOf('.omega-shell__sidebar {\n  background: transparent');
        ctx.expect(skinAt > -1).toBe(true);
        ctx.expect(coreAt < skinAt).toBe(true);
      },
    },
  ],
});
