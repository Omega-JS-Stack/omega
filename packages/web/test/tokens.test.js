/**
 * C3 token layer — the design-token contract that survives any skin pass.
 *
 * Three halves: composeBrandTokens' ramp math (parse, ink pick, hover
 * direction), the token SHEET compiling clean under modern sass (zero
 * deprecations — the #16 bar for all new css), and the build emitting the
 * brand ramp into <head> AFTER the bundles (cascade-winning) only when
 * brand.color is real.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { composeBrandTokens, parseHex, relativeLuminance } = require('../src/brand-tokens.js');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'tokens-test');

const HEX = /^#[0-9a-f]{6}$/;

// ─── Ramp math ───────────────────────────────────────────────────────────────

test('composeBrandTokens: full ramp from a mid blue — white ink, darkening hover', () => {
  const ramp = composeBrandTokens('#3b5bdb');

  assert.equal(ramp.accent, '#3b5bdb');
  assert.equal(ramp.accentInk, '#ffffff', 'dark-enough accent gets white ink (WCAG pick)');
  assert.equal(ramp.accentSubtle, 'rgba(59, 91, 219, 0.12)');
  assert.equal(ramp.accentRing, 'rgba(59, 91, 219, 0.35)');

  assert.match(ramp.accentHover, HEX);
  assert.match(ramp.accentActive, HEX);
  assert.notEqual(ramp.accentHover, ramp.accent);
  assert.ok(
    relativeLuminance(parseHex(ramp.accentHover)) < relativeLuminance(parseHex(ramp.accent)),
    'mid/light accents deepen on hover',
  );
});

test('composeBrandTokens: light accent gets dark ink; near-black accent brightens on hover', () => {
  assert.equal(composeBrandTokens('#ffb224').accentInk, '#111213', 'amber is bright — dark ink wins');

  const dark = composeBrandTokens('#101014');
  assert.equal(dark.accentInk, '#ffffff');
  assert.ok(
    relativeLuminance(parseHex(dark.accentHover)) > relativeLuminance(parseHex(dark.accent)),
    'near-black accents brighten on hover',
  );
});

test('composeBrandTokens: 3-digit and bare hex parse; garbage → null', () => {
  assert.equal(composeBrandTokens('#f0f').accent, '#ff00ff');
  assert.equal(composeBrandTokens('D6336C').accent, '#d6336c');

  for (const bad of ['red', '', '#12345g', '#12345', null, undefined, 42, {}]) {
    assert.equal(composeBrandTokens(bad), null, `no ramp from ${JSON.stringify(bad)}`);
  }
});

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

test('composeBrandTokens: dark variant lifts dark accents, passes light ones through', () => {
  const mid = composeBrandTokens('#3b5bdb');
  assert.ok(
    relativeLuminance(parseHex(mid.dark.accent)) > relativeLuminance(parseHex(mid.accent)),
    'mid accents lift for the charcoal ground',
  );

  const nearBlack = composeBrandTokens('#101014');
  assert.ok(
    relativeLuminance(parseHex(nearBlack.dark.accent)) > 0.15,
    'near-black accents reach a visible dark-mode lightness',
  );

  const alreadyLight = composeBrandTokens('#8577ff'); // l ≈ 0.73, above the keep threshold
  assert.equal(alreadyLight.dark.accent, alreadyLight.accent, 'light accents pass through unchanged');
  assert.equal(alreadyLight.dark.accentInk, '#111213', 'dark ramp keeps the WCAG ink pick');
});

test('no brand.color → no inline ramp (the sheet placeholder stands)', async () => {
  const pages = await buildWith({ ...miniData });
  const html = pages.get('/pricing');
  assert.ok(!html.includes('--omega-accent:'), 'nothing emitted without a usable color');
});
