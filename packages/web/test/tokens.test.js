/**
 * C3 token layer — the design-token contract that survives any skin pass.
 *
 * Two halves: the token SHEET compiling clean under modern sass (zero
 * deprecations — the #16 bar for all new css), and the build emitting the
 * brand ramp into <head> AFTER the bundles (cascade-winning) only when
 * brand.color is real.
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const sass = require('sass');

const { composeBrandTokens } = require('@omega.js/devkit/brand-tokens');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'tokens-test');

module.exports = defineCases({
  type: 'group',
  description: 'tokens',
  tests: [
    // ─── Token sheet ─────────────────────────────────────────────────────────────

    {
      name: 'token sheet compiles clean — modern sass, ZERO deprecations, full plumbing',
      run: (ctx) => {
        const warnings = [];
        const result = sass.compile(path.join(PKG, 'core', 'css', 'tokens', '_index.scss'), {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        });

        ctx.expect(warnings, 'new core css never warns — the #16 bar').toEqual([]);
        ctx.expect(result.css).toMatch(/--omega-ground/);
        ctx.expect(result.css, 'classy v2 placeholder accent (light)').toMatch(/--omega-accent: #2563eb/);
        ctx.expect(result.css, 'classy v2 placeholder accent (dark variant)').toMatch(/--omega-accent: #5484ef/);
        ctx.expect(result.css, 'type pairing slots present (D5 seam)').toMatch(/--omega-font-marketing/);
        ctx.expect(result.css, 'the categorical ramp runs to six (light)').toMatch(/--omega-chart-6: #6a7f2b/);
        ctx.expect(result.css, 'and carries its own dark values').toMatch(/--omega-chart-6: #a9c153/);
        ctx.expect(result.css, 'OS preference carries (D2)').toMatch(/prefers-color-scheme: dark/);
        ctx.expect(result.css, 'appearance.js stamp beats OS — dark').toMatch(/data-bs-theme=['"]?dark/);
        ctx.expect(result.css, 'appearance.js stamp beats OS — light').toMatch(/data-bs-theme=['"]?light/);
      },
    },

    // #13: "all systems operational" wore --omega-ok while the uptime bars under
    // it wore Bootstrap's compiled $success — one green in light mode, two in
    // dark. The token owns the hue now, and every theme's root bridge re-points
    // Bootstrap's variable at it (hex AND the -rgb channels the translucency
    // utilities paint from) AFTER Bootstrap compiles, so the bridge wins.
    {
      name: '#13: one success token site-wide — every theme bridges Bootstrap onto it',
      run: (ctx) => {
        const LEVELS = [['success', 'ok'], ['warning', 'warn'], ['danger', 'danger']];

        for (const theme of ['classy', 'newsflash', 'neobrutalism']) {
          const css = sass.compile(path.join(PKG, 'themes', theme, '_theme.scss'), {
            quietDeps: true,
            logger: { warn: () => {}, debug: () => {} },
          }).css;

          for (const [level, token] of LEVELS) {
            for (const [property, value] of [[`--bs-${level}`, `var(--omega-${token})`], [`--bs-${level}-rgb`, `var(--omega-${token}-rgb)`]]) {
              const last = css.slice(css.lastIndexOf(`${property}:`));
              ctx.expect(last, `${theme}: the LAST ${property} is the token bridge, not Bootstrap's compiled hex`).toMatch(new RegExp(`^${property}: ${value.replace(/[()-]/g, '\\$&')};`));
            }
          }
        }
      },
    },

    {
      name: '#13: every status hue ships its -rgb twin, in both modes',
      run: (ctx) => {
        const css = sass.compile(path.join(PKG, 'core', 'css', 'tokens', '_index.scss'), {
          logger: { warn: () => {}, debug: () => {} },
        }).css;

        for (const token of ['ok', 'warn', 'danger']) {
          const hues = css.match(new RegExp(`--omega-${token}: #[0-9a-f]{6}`, 'g')) || [];
          const channels = css.match(new RegExp(`--omega-${token}-rgb: \\d+, \\d+, \\d+`, 'g')) || [];
          ctx.expect(hues.length >= 2, `--omega-${token} carries a light AND a dark value`).toBeTruthy();
          ctx.expect(channels.length, `--omega-${token}-rgb tracks it stamp for stamp — a lone hue is the #13 drift`).toBe(hues.length);
        }
      },
    },

    {
      name: 'main.scss wires the token sheet ahead of the theme',
      run: (ctx) => {
        const fs = require('node:fs');
        const main = fs.readFileSync(path.join(PKG, 'core', 'css', 'main.scss'), 'utf8');
        const tokensAt = main.indexOf("@use 'tokens/index'");
        const themeAt = main.indexOf("@use 'omega:theme'");
        ctx.expect(tokensAt !== -1, 'tokens sheet is used').toBeTruthy();
        ctx.expect(tokensAt < themeAt, 'tokens emit before the theme so themes can override').toBeTruthy();
      },
    },

    // ─── Head emission ───────────────────────────────────────────────────────────

    {
      name: 'brand.color → inline --omega-accent ramp in <head>, after the css bundles',
      run: async (ctx) => {
        const pages = await buildWith({
          ...miniData,
          brand: { ...miniData.brand, color: '#d6336c' },
        });
        const html = pages.get('/pricing');

        ctx.expect(html.includes('--omega-accent:#d6336c'), 'ramp emitted from brand.color').toBeTruthy();
        ctx.expect(html.includes('--omega-accent-ink:#ffffff'), 'derived ink emitted').toBeTruthy();
        ctx.expect(html.indexOf('--omega-accent:') > html.indexOf('main-TEST.css'), 'inline ramp comes after the bundles so it wins the cascade').toBeTruthy();

        // The dark-variant ramp rides the same stamp plumbing as the token sheet.
        const darkRamp = composeBrandTokens('#d6336c').dark;
        ctx.expect(html.includes(`--omega-accent:${darkRamp.accent}`), 'dark ramp emitted').toBeTruthy();
        ctx.expect(html, 'dark ramp carries the OS preference').toMatch(/prefers-color-scheme: dark[\s\S]*?--omega-accent:/);
        ctx.expect(html, 'dark ramp behind the explicit stamp').toMatch(/data-bs-theme='dark'[\s\S]*?--omega-accent:/);
      },
    },

    {
      name: 'no brand.color → no inline ramp (the sheet placeholder stands)',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData });
        const html = pages.get('/pricing');
        ctx.expect(!html.includes('--omega-accent:'), 'nothing emitted without a usable color').toBeTruthy();
      },
    },
  ],
});
