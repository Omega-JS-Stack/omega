/**
 * Affirmation checks — ONE ink, ONE alignment rule (#10, #11).
 *
 * #11: every "you get this" tick (homepage hero meta, signup benefits, plan
 * features, comparison yes cells, product-demo, alternatives) reads the shared
 * `--omega-check` slot through the `.omega-check` utility — never a per-page
 * color. Status green (--omega-ok) stays for state feedback.
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

test('#11: the check ink is ONE token consumed by ONE class', () => {
  const css = compileBundle('classy');

  assert.match(css, /--omega-check: var\(--omega-accent\)/, 'the slot rides the accent (blue by default)');
  assert.match(css, /\.omega-check\s*\{\s*color: var\(--omega-check\);?\s*\}/, 'the utility reads the slot');
  assert.ok(
    css.indexOf('.omega-check') > css.indexOf('.classy-price-card__check'),
    'the utility lands after the theme so it wins ties',
  );
});

test('#11: no check site re-colors its own tick', () => {
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

test('#11: the check surfaces stamp the shared class — plan features, comparison, signup', async () => {
  const pages = await buildWith({ ...miniData, payment: CATALOG });

  const pricing = pages.get('/pricing');
  assert.ok(pricing, '/pricing built');
  assert.match(pricing, /classy-price-card__check omega-check/, 'plan-feature checks carry the shared class');
  assert.match(pricing, /classy-compare__yes omega-check/, 'comparison yes-marks carry the shared class');

  const signup = pages.get('/signup');
  assert.ok(signup, '/signup built');
  assert.match(signup, /class="fa omega-check fa-sm"/, 'signup benefit checks carry the shared class');
});

test('#11: the affirmation-check sites keep no local color override', () => {
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
    const calls = source.split('\n').filter((line) => line.includes(`uj_icon "${icon}"`));
    assert.ok(calls.length > 0, `${rel} still renders its ${icon}`);
    for (const call of calls) {
      assert.ok(!/text-success|text-primary/.test(call), `${rel} check keeps no local color: ${call.trim()}`);
    }
  }
});
