// Unit tests for src/brand-tokens.js: the ONE accent-ramp home every target
// derives `brand.color` through ([#912](https://github.com/Omega-JS-Stack/omega/issues/912)).
//
// Two halves: the ramp math (parse, ink pick, hover direction, the dark
// variant), which moved here from @omega.js/web when desktop and the extension
// needed it too, and the generated scss partial's TEXT, which is what the sass
// tasks write and compile.

const { test } = require('node:test');
const assert = require('node:assert');

const { composeBrandTokens, parseHex, relativeLuminance, renderBrandScss, DEFAULT_BRAND_COLOR } = require('../src/brand-tokens.js');

const HEX = /^#[0-9a-f]{6}$/;

// ─── Ramp math ───────────────────────────────────────────────────────────────

test('composeBrandTokens: full ramp from a mid blue, white ink, darkening hover', () => {
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
  assert.equal(composeBrandTokens('#ffb224').accentInk, '#111213', 'amber is bright, dark ink wins');

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

// ─── The generated partial ───────────────────────────────────────────────────

test('renderBrandScss: $primary plus the light and dark ramp blocks, for one hex', () => {
  const scss = renderBrandScss(composeBrandTokens('#ff0066'));

  assert.ok(scss.includes('$primary: #ff0066;'), 'the compile-time accent Bootstrap derives from');

  // The light ramp, the same six properties head.html inlines on web.
  assert.ok(scss.includes([
    '  :root {',
    '    --omega-accent: #ff0066;',
    '    --omega-accent-hover: #db0058;',
    '    --omega-accent-active: #c70050;',
    '    --omega-accent-subtle: rgba(255, 0, 102, 0.12);',
    '    --omega-accent-ink: #111213;',
    '    --omega-accent-ring: rgba(255, 0, 102, 0.35);',
    '  }',
  ].join('\n')), 'light ramp block');

  // The dark variant, under the explicit stamp (the OS-preference block
  // carries the same six, one indent deeper).
  assert.ok(scss.includes([
    "  :root[data-bs-theme='dark'] {",
    '    --omega-accent: #ff3385;',
    '    --omega-accent-hover: #ff0f6f;',
    '    --omega-accent-active: #fa0064;',
    '    --omega-accent-subtle: rgba(255, 51, 133, 0.16);',
    '    --omega-accent-ink: #111213;',
    '    --omega-accent-ring: rgba(255, 51, 133, 0.35);',
    '  }',
  ].join('\n')), 'dark ramp block');

  assert.equal((scss.match(/--omega-accent: #ff3385;/g) || []).length, 2,
    'the dark ramp is stamped twice: the OS preference and the explicit stamp');
  assert.equal((scss.match(/--omega-accent: #ff0066;/g) || []).length, 2,
    'and the light ramp twice: bare :root and the explicit stamp');

  assert.ok(scss.includes('@media (prefers-color-scheme: dark) {'), 'OS preference carries');
  assert.ok(scss.includes(":root[data-bs-theme='dark'] {"), 'the explicit dark stamp beats the OS');
  assert.ok(scss.includes(":root[data-bs-theme='light'] {"), 'and the explicit light stamp does too');
});

test('renderBrandScss: the ramp rides a mixin so the consumer emits it AFTER the framework css', () => {
  const scss = renderBrandScss(composeBrandTokens('#ff0066'));

  const mixinAt = scss.indexOf('@mixin ramp {');
  assert.ok(mixinAt > -1, 'the css lives in a mixin');
  assert.ok(mixinAt > scss.indexOf('$primary:'), '$primary is declared before it');
  // Nothing outside the mixin emits css: a used module emits at its LOAD
  // position, which is ahead of the token sheet's placeholders.
  assert.ok(!/^:root/m.test(scss), 'no rule sits at the file root');
});

test('renderBrandScss: no usable brand.color falls back to the ONE framework default', () => {
  const fallback = renderBrandScss(null);

  assert.equal(DEFAULT_BRAND_COLOR, '#2563EB', 'the default the classy theme declares with !default');
  assert.equal(fallback, renderBrandScss(composeBrandTokens(DEFAULT_BRAND_COLOR)), 'same text as the default hex');
  assert.ok(fallback.includes('$primary: #2563eb;'));
});
