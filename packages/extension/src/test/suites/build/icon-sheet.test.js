// Build-layer pins for the shared icon sheet (#183): icon presentation lives
// ONCE in @omega.js/web and is vendored here at prepare (package.json
// omega.vendorAssets → dist/assets/css/core/_fontawesome.scss), so extension
// surfaces ship the same square glyph-centered box and animation utilities web
// has instead of the commented-out stub that shipped no icon css at all.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..', '..', '..', '..');

module.exports = {
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

        // The entry pulls '_component-specific' from the CONSUMER's dist at
        // build time (the sass task generates a stub there), so stub it here.
        const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ext-icons-'));
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

          // The shared client renderer stamps data-omega-fa on the <i> it fills
          // (src/lib/icons.js), so that is the hook the box keys on.
          const box = css.match(/i\[data-omega-fa\] \{[^}]*\}/);
          ctx.expect(box !== null).toBe(true);
          ctx.expect(box[0].includes('display: inline-flex')).toBe(true);
          ctx.expect(box[0].includes('width: 1em')).toBe(true);
          ctx.expect(box[0].includes('height: 1em')).toBe(true);

          ctx.expect(css.includes('@keyframes fa-spin')).toBe(true);

          // Its own park block, not just any reduced-motion at-rule the theme ships.
          ctx.expect(/@media \(prefers-reduced-motion: reduce\) \{\s*\.fa-spin,[^{]*\{\s*animation: none/.test(css)).toBe(true);
        } finally {
          fs.rmSync(stubDir, { recursive: true, force: true });
        }
      },
    },
  ],
};
