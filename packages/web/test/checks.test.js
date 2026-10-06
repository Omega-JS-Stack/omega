/**
 * Affirmation checks: ONE ink, ONE alignment rule (#10, #11, #44).
 *
 * #44 (Ian 2026-07-31): the `.omega-check` seam is GONE. Every "you get this"
 * tick (homepage hero meta, signup benefits, plan features, comparison yes
 * cells, product-demo, alternatives) wears Bootstrap's `.text-success`, which
 * every theme's root bridge points at --omega-ok, so a check and a status
 * glyph on the same page are never two different greens and the framework
 * ships no second vocabulary for a concept Bootstrap already names.
 *
 * #10: the plan-feature check is a one-line-tall box so the glyph centers on
 * the FIRST line of its feature text instead of drifting off the baseline.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const sass = require('sass');

const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'checks-test');

/** The shipped bundle for a theme chain. */
function compileBundle(theme) {
  const layers = [path.join(PKG, 'themes', theme), path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];
  return sass.compile(path.join(PKG, 'core', 'css', 'main.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;
}

// A catalog with plan features + a comparison table (the check-heaviest page).
// Each feature is defined ONCE in the top-level catalog and each product names
// only its value (#647).
const FEATURES = {
  requests: { name: 'Requests', icon: 'sparkles', usage: {} },
  support: { name: 'Priority support', icon: 'headset' },
};

const CATALOG = {
  products: [
    {
      id: 'basic',
      name: 'Basic',
      type: 'subscription',
      features: { requests: 100 },
    },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      prices: { monthly: 9.99 },
      features: { requests: -1, support: true },
    },
  ],
};

module.exports = defineCases({
  type: 'group',
  description: 'checks',
  tests: [
    {
      name: '#44: the check seam is gone, the ink is Bootstrap success bridged to --omega-ok',
      run: (ctx) => {
        const css = compileBundle('classy');

        ctx.expect(!css.includes('--omega-check'), 'the check token is gone, no second slot for the success hue').toBeTruthy();
        ctx.expect(!css.includes('.omega-check'), 'the check utility is gone, no parallel class for text-success').toBeTruthy();

        // The bridge is what makes a tick the theme's green in BOTH modes (#13).
        ctx.expect(css, 'the root bridge points Bootstrap success at the token').toMatch(/--bs-success: var\(--omega-ok\)/);
        ctx.expect(css, 'the channel twin rides the token too').toMatch(/--bs-success-rgb: var\(--omega-ok-rgb\)/);

        // The two greens Ian caught side by side on /pricing: the plan check (now
        // .text-success) and the money-back shield must resolve to the SAME hue.
        const guarantee = css.match(/\.omega-guarantee-icon\s*\{[^}]*\}/)[0];
        ctx.expect(guarantee, 'the guarantee shield reads the same success hue as a tick').toMatch(/color: var\(--omega-ok\)/);
      },
    },

    {
      name: '#11: no check site paints its own tick a local color',
      run: (ctx) => {
        const css = compileBundle('classy');

        ctx.expect(!/\.omega-compare__yes\s*\{/.test(css), 'the comparison yes-mark dropped its local green').toBeTruthy();
        ctx.expect(css, 'the signup benefit check dropped its local grey').toMatch(/\.omega-auth__aside-row svg\s*\{(?:(?!color)[^}])*\}/);
        ctx.expect(!/\.omega-feature-check\s*\{[^}]*color:/.test(css), 'the plan-feature check dropped its local accent').toBeTruthy();
      },
    },

    {
      name: '#10: the plan-feature check is a one-line box, not a magic margin — and one home',
      run: (ctx) => {
        const css = compileBundle('classy');
        const rule = css.match(/\.omega-feature-check\s*\{[^}]*\}/)[0];

        ctx.expect(rule, 'the check is its own box').toMatch(/display: inline-flex/);
        ctx.expect(rule, 'the glyph centers inside it').toMatch(/align-items: center/);
        ctx.expect(rule, 'the box is exactly one line of the feature list tall').toMatch(/height: 1\.5em/);
        ctx.expect(!/margin-top/.test(rule), 'the baseline nudge is gone').toBeTruthy();

        // The rule shipped three times, declaration for declaration (plan card,
        // enterprise band, the account page's change-plan modal). `.omega-feature-
        // check` is the one home now, so a per-surface copy is a regression.
        ctx.expect(!css.includes('.omega-price-card__check'), 'the plan card keeps no private copy').toBeTruthy();
        ctx.expect(!css.includes('.omega-band__check'), 'the enterprise band keeps no private copy').toBeTruthy();
      },
    },

    {
      name: '#44: the check surfaces stamp text-success on plan features, comparison, signup',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, features: FEATURES, payment: CATALOG });

        const pricing = pages.get('/pricing');
        ctx.expect(pricing, '/pricing built').toBeTruthy();
        ctx.expect(pricing, 'plan-feature checks carry the success class').toMatch(/omega-feature-check text-success/);
        ctx.expect(pricing, 'comparison yes-marks carry the success class').toMatch(/omega-compare__yes text-success/);
        ctx.expect(!pricing.includes('omega-check'), 'no page still stamps the retired seam class').toBeTruthy();

        const signup = pages.get('/signup');
        ctx.expect(signup, '/signup built').toBeTruthy();
        ctx.expect(signup, 'signup benefit checks carry the success class').toMatch(/class="fa-solid fa-check text-success fa-sm"/);
      },
    },

    {
      name: '#44: every affirmation-check site wears text-success and nothing else',
      run: (ctx) => {
        const affirmationSites = [
          ['themes/base/_layouts/frontend/pages/pricing.html', 'check'],
          ['themes/base/_layouts/frontend/pages/auth/signup.html', 'check'],
          ['themes/base/_sections/marketing/hero/section.html', 'check'],
          ['themes/base/_sections/marketing/product-demo/section.html', 'check'],
          ['themes/base/_layouts/frontend/pages/alternatives/alternative.html', 'circle-check'],
          // Neither partial theme forks a pricing layout (#177 phases 2 + 3);
          // their /pricing renders the base page, already pinned above.
        ];

        for (const [rel, icon] of affirmationSites) {
          const source = fs.readFileSync(path.join(PKG, rel), 'utf8');
          ctx.expect(!source.includes('omega-check'), `${rel} dropped the retired seam class`).toBeTruthy();

          const calls = source.split('\n').filter((line) => line.includes(`fa-${icon}`));
          ctx.expect(calls.length > 0, `${rel} still renders its ${icon}`).toBeTruthy();
          for (const call of calls) {
            ctx.expect(call.includes('text-success'), `${rel} check takes its ink from the bridge: ${call.trim()}`).toBeTruthy();
            ctx.expect(!/text-primary|text-info|style="color/.test(call), `${rel} check keeps no local color: ${call.trim()}`).toBeTruthy();
          }
        }
      },
    },
  ],
});
