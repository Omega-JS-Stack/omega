// Unit tests for src/brand-tokens.js: the ONE accent-ramp home every target
// derives `brand.color` through ([#912](https://github.com/Omega-JS-Stack/omega/issues/912)).
//
// Two halves: the ramp math (parse, ink pick, hover direction, the dark
// variant), which moved here from @omega.js/web when desktop and the extension
// needed it too, and the generated scss partial's TEXT, which is what the sass
// tasks write and compile.

const defineCases = require('@omega.js/devkit/test/define-cases');

const { composeBrandTokens, parseHex, relativeLuminance, renderBrandScss, DEFAULT_BRAND_COLOR } = require('../src/brand-tokens.js');

const HEX = /^#[0-9a-f]{6}$/;

module.exports = defineCases({
  type: 'group',
  description: 'brand-tokens',
  tests: [
    // ─── Ramp math ───────────────────────────────────────────────────────────────

    {
      name: 'composeBrandTokens: full ramp from a mid blue, white ink, darkening hover',
      run: (ctx) => {
        const ramp = composeBrandTokens('#3b5bdb');

        ctx.expect(ramp.accent).toBe('#3b5bdb');
        ctx.expect(ramp.accentInk, 'dark-enough accent gets white ink (WCAG pick)').toBe('#ffffff');
        ctx.expect(ramp.accentSubtle).toBe('rgba(59, 91, 219, 0.12)');
        ctx.expect(ramp.accentRing).toBe('rgba(59, 91, 219, 0.35)');

        ctx.expect(ramp.accentHover).toMatch(HEX);
        ctx.expect(ramp.accentActive).toMatch(HEX);
        ctx.expect(ramp.accentHover).not.toBe(ramp.accent);
        ctx.expect(relativeLuminance(parseHex(ramp.accentHover)) < relativeLuminance(parseHex(ramp.accent)), 'mid/light accents deepen on hover').toBeTruthy();
      },
    },

    {
      name: 'composeBrandTokens: light accent gets dark ink; near-black accent brightens on hover',
      run: (ctx) => {
        ctx.expect(composeBrandTokens('#ffb224').accentInk, 'amber is bright, dark ink wins').toBe('#111213');

        const dark = composeBrandTokens('#101014');
        ctx.expect(dark.accentInk).toBe('#ffffff');
        ctx.expect(relativeLuminance(parseHex(dark.accentHover)) > relativeLuminance(parseHex(dark.accent)), 'near-black accents brighten on hover').toBeTruthy();
      },
    },

    {
      name: 'composeBrandTokens: 3-digit and bare hex parse; garbage → null',
      run: (ctx) => {
        ctx.expect(composeBrandTokens('#f0f').accent).toBe('#ff00ff');
        ctx.expect(composeBrandTokens('D6336C').accent).toBe('#d6336c');

        for (const bad of ['red', '', '#12345g', '#12345', null, undefined, 42, {}]) {
          ctx.expect(composeBrandTokens(bad), `no ramp from ${JSON.stringify(bad)}`).toBe(null);
        }
      },
    },

    {
      name: 'composeBrandTokens: dark variant lifts dark accents, passes light ones through',
      run: (ctx) => {
        const mid = composeBrandTokens('#3b5bdb');
        ctx.expect(relativeLuminance(parseHex(mid.dark.accent)) > relativeLuminance(parseHex(mid.accent)), 'mid accents lift for the charcoal ground').toBeTruthy();

        const nearBlack = composeBrandTokens('#101014');
        ctx.expect(relativeLuminance(parseHex(nearBlack.dark.accent)) > 0.15, 'near-black accents reach a visible dark-mode lightness').toBeTruthy();

        const alreadyLight = composeBrandTokens('#8577ff'); // l ≈ 0.73, above the keep threshold
        ctx.expect(alreadyLight.dark.accent, 'light accents pass through unchanged').toBe(alreadyLight.accent);
        ctx.expect(alreadyLight.dark.accentInk, 'dark ramp keeps the WCAG ink pick').toBe('#111213');
      },
    },

    // ─── The generated partial ───────────────────────────────────────────────────

    {
      name: 'renderBrandScss: $primary plus the light and dark ramp blocks, for one hex',
      run: (ctx) => {
        const scss = renderBrandScss(composeBrandTokens('#ff0066'));

        ctx.expect(scss.includes('$primary: #ff0066;'), 'the compile-time accent Bootstrap derives from').toBeTruthy();

        // The light ramp, the same six properties head.html inlines on web.
        ctx.expect(scss.includes([
          '  :root {',
          '    --omega-accent: #ff0066;',
          '    --omega-accent-hover: #db0058;',
          '    --omega-accent-active: #c70050;',
          '    --omega-accent-subtle: rgba(255, 0, 102, 0.12);',
          '    --omega-accent-ink: #111213;',
          '    --omega-accent-ring: rgba(255, 0, 102, 0.35);',
          '  }',
        ].join('\n')), 'light ramp block').toBeTruthy();

        // The dark variant, under the explicit stamp (the OS-preference block
        // carries the same six, one indent deeper).
        ctx.expect(scss.includes([
          "  :root[data-bs-theme='dark'] {",
          '    --omega-accent: #ff3385;',
          '    --omega-accent-hover: #ff0f6f;',
          '    --omega-accent-active: #fa0064;',
          '    --omega-accent-subtle: rgba(255, 51, 133, 0.16);',
          '    --omega-accent-ink: #111213;',
          '    --omega-accent-ring: rgba(255, 51, 133, 0.35);',
          '  }',
        ].join('\n')), 'dark ramp block').toBeTruthy();

        ctx.expect((scss.match(/--omega-accent: #ff3385;/g) || []).length, 'the dark ramp is stamped twice: the OS preference and the explicit stamp').toBe(2);
        ctx.expect((scss.match(/--omega-accent: #ff0066;/g) || []).length, 'and the light ramp twice: bare :root and the explicit stamp').toBe(2);

        ctx.expect(scss.includes('@media (prefers-color-scheme: dark) {'), 'OS preference carries').toBeTruthy();
        ctx.expect(scss.includes(":root[data-bs-theme='dark'] {"), 'the explicit dark stamp beats the OS').toBeTruthy();
        ctx.expect(scss.includes(":root[data-bs-theme='light'] {"), 'and the explicit light stamp does too').toBeTruthy();
      },
    },

    {
      name: 'renderBrandScss: the ramp rides a mixin so the consumer emits it AFTER the framework css',
      run: (ctx) => {
        const scss = renderBrandScss(composeBrandTokens('#ff0066'));

        const mixinAt = scss.indexOf('@mixin ramp {');
        ctx.expect(mixinAt > -1, 'the css lives in a mixin').toBeTruthy();
        ctx.expect(mixinAt > scss.indexOf('$primary:'), '$primary is declared before it').toBeTruthy();
        // Nothing outside the mixin emits css: a used module emits at its LOAD
        // position, which is ahead of the token sheet's placeholders.
        ctx.expect(!/^:root/m.test(scss), 'no rule sits at the file root').toBeTruthy();
      },
    },

    {
      name: 'renderBrandScss: no usable brand.color falls back to the ONE framework default',
      run: (ctx) => {
        const fallback = renderBrandScss(null);

        ctx.expect(DEFAULT_BRAND_COLOR, 'the default the classy theme declares with !default').toBe('#2563EB');
        ctx.expect(fallback, 'same text as the default hex').toBe(renderBrandScss(composeBrandTokens(DEFAULT_BRAND_COLOR)));
        ctx.expect(fallback.includes('$primary: #2563eb;')).toBeTruthy();
      },
    },
  ],
});
