// Build-layer pins for the app-shell channel (#111): the classy theme ships
// only the shell SKIN, so the core mechanics — the .omega-shell grid sheet and
// the app-shell module that drives it — are vendored from @omega.js/web at
// prepare (package.json omega.vendorAssets → dist/assets/css/shell/ and
// dist/assets/js/core/), and the omega-extension entry loads the sheet BEFORE
// the theme so the skin layers over the mechanics.

const fs = require('fs');
const os = require('os');
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
        // client is a runtime dependency, so the specifier survives vendoring.
        ctx.expect(module.includes("from '@omega.js/client'")).toBe(true);
      },
    },
    {
      name: 'component bundles resolve the vendored core assets alias',
      run: (ctx) => {
        const task = fs.readFileSync(path.join(PACKAGE_ROOT, 'dist', 'gulp', 'tasks', 'bundle.js'), 'utf8');
        ctx.expect(task.includes("'__main_assets__'")).toBe(true);
      },
    },
    {
      name: 'entry loads the shell sheet before the theme',
      run: (ctx) => {
        const entry = fs.readFileSync(path.join(PACKAGE_ROOT, 'dist', 'assets', 'css', 'omega-extension.scss'), 'utf8');
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

        // The entry pulls '_component-specific' from the CONSUMER's dist at
        // build time (the sass task generates a stub there) — stub it here.
        const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ext-shell-'));
        fs.writeFileSync(path.join(stubDir, '_component-specific.scss'), '// test stub\n');

        try {
          const css = sass.compile(path.join(PACKAGE_ROOT, 'dist', 'assets', 'css', 'omega-extension.scss'), {
            loadPaths: [
              path.join(PACKAGE_ROOT, 'dist', 'assets', 'css'),
              path.join(PACKAGE_ROOT, 'dist', 'assets', 'themes', 'classy'),
              stubDir,
            ],
            quietDeps: true,
            silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
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
        } finally {
          fs.rmSync(stubDir, { recursive: true, force: true });
        }
      },
    },
  ],
});
