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
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'checks-test');

/** The shipped bundle for a theme chain. */
function compileBundle(theme) {
  const layers = [path.join(PKG, 'themes', theme), path.join(PKG, 'themes', 'classy'), path.join(PKG, 'core')];
  return sass.compile(path.join(PKG, 'core', 'css', 'main.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;
}

test('#44: the check seam is gone, the ink is Bootstrap success bridged to --omega-ok', () => {
  const css = compileBundle('classy');

  assert.ok(!css.includes('--omega-check'), 'the check token is gone, no second slot for the success hue');
  assert.ok(!css.includes('.omega-check'), 'the check utility is gone, no parallel class for text-success');

  // The bridge is what makes a tick the theme's green in BOTH modes (#13).
  assert.match(css, /--bs-success: var\(--omega-ok\)/, 'the root bridge points Bootstrap success at the token');
  assert.match(css, /--bs-success-rgb: var\(--omega-ok-rgb\)/, 'the channel twin rides the token too');

  // The two greens Ian caught side by side on /pricing: the plan check (now
  // .text-success) and the money-back shield must resolve to the SAME hue.
  const guarantee = css.match(/\.classy-guarantee-icon\s*\{[^}]*\}/)[0];
  assert.match(guarantee, /color: var\(--omega-ok\)/, 'the guarantee shield reads the same success hue as a tick');
});

test('#11: no check site paints its own tick a local color', () => {
  const css = compileBundle('classy');

  assert.ok(!/\.classy-compare__yes\s*\{/.test(css), 'the comparison yes-mark dropped its local green');
  assert.match(css, /\.classy-auth__aside-row svg\s*\{(?:(?!color)[^}])*\}/, 'the signup benefit check dropped its local grey');
  assert.ok(
    !/\.classy-price-card__check\s*\{[^}]*color:/.test(css),
    'the plan-feature check dropped its local accent',
  );
});

test('#10: the plan-feature check is a one-line box, not a magic margin', () => {
  const css = compileBundle('classy');
  const rule = css.match(/\.classy-price-card__features li \.classy-price-card__check\s*\{[^}]*\}/)[0];

  assert.match(rule, /display: inline-flex/, 'the check is its own box');
  assert.match(rule, /align-items: center/, 'the glyph centers inside it');
  assert.match(rule, /height: 1\.5em/, 'the box is exactly one line of the feature list tall');
  assert.ok(!/margin-top/.test(rule), 'the baseline nudge is gone');
});

// A catalog with plan features + a comparison table (the check-heaviest page)
const CATALOG = {
  products: [
    {
      id: 'basic',
      name: 'Basic',
      type: 'subscription',
      limits: { requests: 100 },
      features: [{ id: 'requests', name: 'Requests', icon: 'sparkles' }],
    },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      prices: { monthly: 9.99 },
      limits: { requests: -1 },
      features: [
        { id: 'requests', name: 'Requests', icon: 'sparkles' },
        { id: 'support', name: 'Priority support', icon: 'headset', value: true },
      ],
    },
  ],
};

test('#44: the check surfaces stamp text-success on plan features, comparison, signup', async () => {
  const pages = await buildWith({ ...miniData, payment: CATALOG });

  const pricing = pages.get('/pricing');
  assert.ok(pricing, '/pricing built');
  assert.match(pricing, /classy-price-card__check text-success/, 'plan-feature checks carry the success class');
  assert.match(pricing, /classy-compare__yes text-success/, 'comparison yes-marks carry the success class');
  assert.ok(!pricing.includes('omega-check'), 'no page still stamps the retired seam class');

  const signup = pages.get('/signup');
  assert.ok(signup, '/signup built');
  assert.match(signup, /class="fa text-success fa-sm"/, 'signup benefit checks carry the success class');
});

test('#44: every affirmation-check site wears text-success and nothing else', () => {
  const affirmationSites = [
    ['themes/classy/_layouts/frontend/pages/pricing.html', 'check'],
    ['themes/classy/_layouts/frontend/pages/auth/signup.html', 'check'],
    ['themes/classy/_sections/marketing/hero/section.html', 'check'],
    ['themes/classy/_sections/marketing/product-demo/section.html', 'check'],
    ['themes/classy/_layouts/frontend/pages/alternatives/alternative.html', 'circle-check'],
    ['themes/newsflash/_layouts/frontend/pages/pricing.html', 'circle-check'],
    ['themes/neobrutalism/_layouts/frontend/pages/pricing.html', 'circle-check'],
  ];

  for (const [rel, icon] of affirmationSites) {
    const source = fs.readFileSync(path.join(PKG, rel), 'utf8');
    assert.ok(!source.includes('omega-check'), `${rel} dropped the retired seam class`);

    const calls = source.split('\n').filter((line) => line.includes(`omega_icon "${icon}"`));
    assert.ok(calls.length > 0, `${rel} still renders its ${icon}`);
    for (const call of calls) {
      assert.ok(call.includes('text-success'), `${rel} check takes its ink from the bridge: ${call.trim()}`);
      assert.ok(!/text-primary|text-info|style="color/.test(call), `${rel} check keeps no local color: ${call.trim()}`);
    }
  }
});
