/**
 * C3 token layer — the design-token contract that survives any skin pass.
 *
 * Two halves: the token SHEET compiling clean under modern sass (zero
 * deprecations — the #16 bar for all new css), and the build emitting the
 * brand ramp into <head> AFTER the bundles (cascade-winning) only when
 * brand.color is real.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { composeBrandTokens } = require('@omega.js/devkit/brand-tokens');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'tokens-test');

// ─── Token sheet ─────────────────────────────────────────────────────────────

test('token sheet compiles clean — modern sass, ZERO deprecations, full plumbing', () => {
  const warnings = [];
  const result = sass.compile(path.join(PKG, 'core', 'css', 'tokens', '_index.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  });

  assert.deepEqual(warnings, [], 'new core css never warns — the #16 bar');
  assert.match(result.css, /--omega-ground/);
  assert.match(result.css, /--omega-accent: #2563eb/, 'classy v2 placeholder accent (light)');
  assert.match(result.css, /--omega-accent: #5484ef/, 'classy v2 placeholder accent (dark variant)');
  assert.match(result.css, /--omega-font-marketing/, 'type pairing slots present (D5 seam)');
  assert.match(result.css, /--omega-chart-6: #6a7f2b/, 'the categorical ramp runs to six (light)');
  assert.match(result.css, /--omega-chart-6: #a9c153/, 'and carries its own dark values');
  assert.match(result.css, /prefers-color-scheme: dark/, 'OS preference carries (D2)');
  assert.match(result.css, /data-bs-theme=['"]?dark/, 'appearance.js stamp beats OS — dark');
  assert.match(result.css, /data-bs-theme=['"]?light/, 'appearance.js stamp beats OS — light');
});

// #13: "all systems operational" wore --omega-ok while the uptime bars under
// it wore Bootstrap's compiled $success — one green in light mode, two in
// dark. The token owns the hue now, and every theme's root bridge re-points
// Bootstrap's variable at it (hex AND the -rgb channels the translucency
// utilities paint from) AFTER Bootstrap compiles, so the bridge wins.
test('#13: one success token site-wide — every theme bridges Bootstrap onto it', () => {
  const LEVELS = [['success', 'ok'], ['warning', 'warn'], ['danger', 'danger']];

  for (const theme of ['classy', 'newsflash', 'neobrutalism']) {
    const css = sass.compile(path.join(PKG, 'themes', theme, '_theme.scss'), {
      quietDeps: true,
      logger: { warn: () => {}, debug: () => {} },
    }).css;

    for (const [level, token] of LEVELS) {
      for (const [property, value] of [[`--bs-${level}`, `var(--omega-${token})`], [`--bs-${level}-rgb`, `var(--omega-${token}-rgb)`]]) {
        const last = css.slice(css.lastIndexOf(`${property}:`));
        assert.match(last, new RegExp(`^${property}: ${value.replace(/[()-]/g, '\\$&')};`), `${theme}: the LAST ${property} is the token bridge, not Bootstrap's compiled hex`);
      }
    }
  }
});

test('#13: every status hue ships its -rgb twin, in both modes', () => {
  const css = sass.compile(path.join(PKG, 'core', 'css', 'tokens', '_index.scss'), {
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  for (const token of ['ok', 'warn', 'danger']) {
    const hues = css.match(new RegExp(`--omega-${token}: #[0-9a-f]{6}`, 'g')) || [];
    const channels = css.match(new RegExp(`--omega-${token}-rgb: \\d+, \\d+, \\d+`, 'g')) || [];
    assert.ok(hues.length >= 2, `--omega-${token} carries a light AND a dark value`);
    assert.equal(channels.length, hues.length, `--omega-${token}-rgb tracks it stamp for stamp — a lone hue is the #13 drift`);
  }
});

test('main.scss wires the token sheet ahead of the theme', () => {
  const fs = require('node:fs');
  const main = fs.readFileSync(path.join(PKG, 'core', 'css', 'main.scss'), 'utf8');
  const tokensAt = main.indexOf("@use 'tokens/index'");
  const themeAt = main.indexOf("@use 'omega:theme'");
  assert.ok(tokensAt !== -1, 'tokens sheet is used');
  assert.ok(tokensAt < themeAt, 'tokens emit before the theme so themes can override');
});

// ─── Head emission ───────────────────────────────────────────────────────────

test('brand.color → inline --omega-accent ramp in <head>, after the css bundles', async () => {
  const pages = await buildWith({
    ...miniData,
    brand: { ...miniData.brand, color: '#d6336c' },
  });
  const html = pages.get('/pricing');

  assert.ok(html.includes('--omega-accent:#d6336c'), 'ramp emitted from brand.color');
  assert.ok(html.includes('--omega-accent-ink:#ffffff'), 'derived ink emitted');
  assert.ok(
    html.indexOf('--omega-accent:') > html.indexOf('main-TEST.css'),
    'inline ramp comes after the bundles so it wins the cascade',
  );

  // The dark-variant ramp rides the same stamp plumbing as the token sheet.
  const darkRamp = composeBrandTokens('#d6336c').dark;
  assert.ok(html.includes(`--omega-accent:${darkRamp.accent}`), 'dark ramp emitted');
  assert.match(html, /prefers-color-scheme: dark[\s\S]*?--omega-accent:/, 'dark ramp carries the OS preference');
  assert.match(html, /data-bs-theme='dark'[\s\S]*?--omega-accent:/, 'dark ramp behind the explicit stamp');
});

test('no brand.color → no inline ramp (the sheet placeholder stands)', async () => {
  const pages = await buildWith({ ...miniData });
  const html = pages.get('/pricing');
  assert.ok(!html.includes('--omega-accent:'), 'nothing emitted without a usable color');
});
