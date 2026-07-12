// Build-layer pins for the C4 cross-target token channel: the --omega-*
// sheet is vendored from @omega.js/web at prepare (package.json
// omega.vendorAssets → dist/assets/css/tokens/), and the omega-extension
// entry emits it BEFORE the theme so theme rules can override.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..', '..', '..', '..');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'omega tokens — vendored cross-target sheet + entry wiring',
  tests: [
    {
      // Fidelity to the web source is the devkit vendor unit test's job (and
      // the prepare hook fails loud on a missing source) — here we pin that
      // the shipped sheet carries the contract. No @omega.js/web reference:
      // dist code never names publishable packages it doesn't depend on.
      name: 'vendored token sheet ships the cross-target contract',
      run: (ctx) => {
        const vendored = path.join(PACKAGE_ROOT, 'dist', 'assets', 'css', 'tokens', '_index.scss');
        ctx.expect(fs.existsSync(vendored)).toBe(true);

        const sheet = fs.readFileSync(vendored, 'utf8');
        ctx.expect(sheet.includes('--omega-ground')).toBe(true);
        ctx.expect(sheet.includes('--omega-accent')).toBe(true);
        ctx.expect(sheet.includes('prefers-color-scheme')).toBe(true);
      },
    },
    {
      name: 'entry emits tokens before the theme and consumes the accent',
      run: (ctx) => {
        const entry = fs.readFileSync(path.join(PACKAGE_ROOT, 'dist', 'assets', 'css', 'omega-extension.scss'), 'utf8');
        const tokensAt = entry.indexOf("@use 'tokens/index'");
        const themeAt = entry.indexOf("@use 'theme'");

        ctx.expect(tokensAt > -1).toBe(true);
        ctx.expect(themeAt > -1).toBe(true);
        ctx.expect(tokensAt < themeAt).toBe(true);
        ctx.expect(entry.includes('accent-color: var(--omega-accent)')).toBe(true);
      },
    },
    {
      name: 'entry compiles with the token contract in the output',
      run: (ctx) => {
        const sass = require('sass');

        // The entry pulls '_component-specific' from the CONSUMER's dist at
        // build time (the sass task generates a stub there) — stub it here.
        const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ext-tokens-'));
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

          ctx.expect(css.includes('--omega-ground')).toBe(true);
          ctx.expect(css.includes('accent-color: var(--omega-accent)')).toBe(true);
        } finally {
          fs.rmSync(stubDir, { recursive: true, force: true });
        }
      },
    },
  ],
};
