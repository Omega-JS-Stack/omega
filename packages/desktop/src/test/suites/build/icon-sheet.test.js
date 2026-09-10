// Build-layer pins for the shared icon sheet (#183): icon presentation lives
// ONCE in @omega.js/web and is vendored here at prepare (package.json
// omega.vendorAssets → dist/assets/css/core/_fontawesome.scss), so desktop
// icons get the same square glyph-centered box and the same animation
// utilities web has instead of a hand-written sheet that drifts.

const fs = require('fs');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const PACKAGE_ROOT = path.join(__dirname, '..', '..', '..', '..');

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'icon sheet: vendored cross-target sheet + entry wiring',
  tests: [
    {
      // Fidelity to the web source is the devkit vendor unit test's job (and
      // the prepare hook fails loud on a missing source). Here we pin that
      // the shipped sheet carries the contract. No @omega.js/web reference:
      // dist code never names publishable packages it doesn't depend on.
      name: 'vendored icon sheet ships the box and the parked animations',
      run: (ctx) => {
        const vendored = path.join(PACKAGE_ROOT, 'dist', 'assets', 'css', 'core', '_fontawesome.scss');
        ctx.expect(fs.existsSync(vendored)).toBe(true);

        const sheet = fs.readFileSync(vendored, 'utf8');
        ctx.expect(sheet.includes('i[data-omega-fa]')).toBe(true);
        ctx.expect(sheet.includes('@keyframes fa-spin')).toBe(true);
        ctx.expect(sheet.includes('prefers-reduced-motion')).toBe(true);
      },
    },
    {
      name: 'entry compiles the box rule and the reduced-motion park into the output',
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

        // The renderer bootstrap stamps data-omega-fa on the <i> it fills
        // (renderer.js _wireFontAwesome), so that is the hook the box keys on.
        const box = css.match(/i\[data-omega-fa\] \{[^}]*\}/);
        ctx.expect(box !== null).toBe(true);
        ctx.expect(box[0].includes('display: inline-flex')).toBe(true);
        ctx.expect(box[0].includes('width: 1em')).toBe(true);
        ctx.expect(box[0].includes('height: 1em')).toBe(true);

        ctx.expect(css.includes('@keyframes fa-spin')).toBe(true);

        // Its own park block, not just any reduced-motion at-rule the theme ships.
        ctx.expect(/@media \(prefers-reduced-motion: reduce\) \{\s*\.fa-spin,[^{]*\{\s*animation: none/.test(css)).toBe(true);
      },
    },
  ],
});
