/**
 * fontawesome-roots — the brand icon-set supply chain (C4 cp111): a
 * OMEGA_FONTAWESOME_ROOT download dir wins, then a Pro npm install, with
 * the free set always last in the chain so partial brand sets never lose
 * icons. Pro isn't installable here (token-gated), so the pro rung is
 * covered by the env rung sharing its code path + the free fallthrough.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { resolveFontAwesomeRoots } = require('../src/icons.js');

// Pro is token-gated, so its presence depends on the machine — assertions
// adapt so the suite is green before AND after a brand installs it.
let proInstalled = false;
try {
  require.resolve('@fortawesome/fontawesome-pro/package.json');
  proInstalled = true;
} catch (e) { /* free-only machine */ }

module.exports = defineCases({
  type: 'group',
  description: 'fontawesome-roots',
  tests: [
    {
      name: 'no env override: Pro npm set when installed, otherwise the free floor alone',
      run: (ctx) => {
        const fa = resolveFontAwesomeRoots({});
        if (proInstalled) {
          ctx.expect(fa.source).toBe('pro');
          ctx.expect(fa.svgsDirs.length).toBe(2);
          ctx.expect(fa.svgsDirs[0]).toMatch(/fontawesome-pro[\/\\]svgs$/);
        } else {
          ctx.expect(fa.source).toBe('free');
          ctx.expect(fa.svgsDirs.length).toBe(1);
        }
        ctx.expect(fa.svgsDirs[fa.svgsDirs.length - 1]).toMatch(/@fortawesome[\/\\]fontawesome-free[\/\\]svgs$/);
        ctx.expect(fa.aliasFile).toMatch(/metadata[\/\\]icon-families\.json$/);
      },
    },

    {
      name: 'OMEGA_FONTAWESOME_ROOT with svgs/ wins; every lower rung stays in the chain',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fa-'));
        fs.mkdirSync(path.join(root, 'svgs', 'solid'), { recursive: true });
        fs.mkdirSync(path.join(root, 'metadata'), { recursive: true });
        fs.writeFileSync(path.join(root, 'metadata', 'icon-families.json'), '{}');

        const fa = resolveFontAwesomeRoots({ OMEGA_FONTAWESOME_ROOT: root });
        ctx.expect(fa.source).toBe('env');
        ctx.expect(fa.svgsDirs[0]).toBe(path.join(root, 'svgs'));
        ctx.expect(fa.svgsDirs.length).toBe(proInstalled ? 3 : 2);
        ctx.expect(fa.svgsDirs[fa.svgsDirs.length - 1]).toMatch(/fontawesome-free[\/\\]svgs$/);
        ctx.expect(fa.aliasFile).toBe(path.join(root, 'metadata', 'icon-families.json'));

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'a brand set without metadata falls back to the next rung\'s alias file',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fa-'));
        fs.mkdirSync(path.join(root, 'svgs', 'solid'), { recursive: true });

        const fa = resolveFontAwesomeRoots({ OMEGA_FONTAWESOME_ROOT: root });
        ctx.expect(fa.source).toBe('env');
        ctx.expect(!fa.aliasFile.startsWith(root)).toBeTruthy();
        ctx.expect(fa.aliasFile).toMatch(/metadata[\/\\]icon-families\.json$/);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'a dir without svgs/ is a misconfiguration — ignored, chain falls through',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fa-'));

        const fa = resolveFontAwesomeRoots({ OMEGA_FONTAWESOME_ROOT: root });
        ctx.expect(fa.source).not.toBe('env');
        ctx.expect(!fa.svgsDirs.includes(path.join(root, 'svgs'))).toBeTruthy();

        fs.rmSync(root, { recursive: true, force: true });
      },
    },
  ],
});
