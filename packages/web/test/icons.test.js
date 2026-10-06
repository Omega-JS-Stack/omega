/**
 * #180: the icon sheet — a square box for the rendered <i>, and a spin
 * utility that parks under reduced motion.
 *
 * The box keys on what the renderers actually stamp — data-omega-fa, written
 * by @omega.js/client's icon-renderer at runtime and by web's build-time
 * inlining pass alike (#619) — never on a class an author must remember to
 * type; without it the 1em svg rides the text baseline and a spin orbits a
 * point below the glyph. `.fa` stays for hand-authored wrappers around a
 * glyph (the account page's `div.fa fa-3xl` provider logos).
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const sass = require('sass');

const { PKG } = require('./lib/build.js');

const compileIconSheet = () => {
  const warnings = [];
  const result = sass.compile(path.join(PKG, 'core', 'css', 'core', '_custom-font-awesome.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  });
  return { css: result.css, warnings };
};

module.exports = defineCases({
  type: 'group',
  description: 'icons',
  tests: [
    {
      name: '#180: the rendered icon <i> gets a square, glyph-centered box on both renderer hooks',
      run: (ctx) => {
        const { css, warnings } = compileIconSheet();

        ctx.expect(warnings, 'new core css never warns — the #16 bar').toEqual([]);

        const box = css.match(/i\.fa,\ni\[data-omega-fa\] \{[^}]*\}/);
        ctx.expect(box, 'the box keys on the renderer stamp and the hand-authored .fa wrapper').toBeTruthy();
        ctx.expect(box[0]).toMatch(/display: inline-flex/);
        ctx.expect(box[0]).toMatch(/align-items: center/);
        ctx.expect(box[0]).toMatch(/justify-content: center/);
        ctx.expect(box[0]).toMatch(/width: 1em/);
        ctx.expect(box[0]).toMatch(/height: 1em/);
        ctx.expect(box[0], 'FA\'s own baseline offset moved onto the box').toMatch(/vertical-align: -0\.125em/);
        ctx.expect(box[0], 'a flex row never squeezes an icon out of square').toMatch(/flex-shrink: 0/);

        for (const child of ['i.fa svg', 'i.fa img', 'i\\[data-omega-fa\\] svg', 'i\\[data-omega-fa\\] img']) {
          ctx.expect(css, `the glyph inside ${child.replace(/\\/g, '')} keeps its 1em sizing`).toMatch(new RegExp(`${child}[^{]*\\{[^}]*width: 1em;\\s*height: 1em`));
        }
      },
    },

    {
      name: '#180: the glyph sizing stays UNQUALIFIED, so non-`i` markup keeps its 1em children',
      run: (ctx) => {
        const { css } = compileIconSheet();

        // The account page wraps provider logos in `div.fa fa-3xl`
        // (themes/base/_layouts/frontend/pages/account/index.html), so the child
        // sizing may never inherit the box's `i` qualifier.
        const sizing = css.match(/(?:^|\n)\.fa svg,[^{}]*\{[^}]*\}/);
        ctx.expect(sizing, 'a `.fa svg` rule with NO `i` prefix — a div.fa wrapper sizes its glyph too').toBeTruthy();
        ctx.expect(sizing[0], 'the renderer stamp, same as the box').toMatch(/\[data-omega-fa\] svg/);
        ctx.expect(sizing[0]).toMatch(/width: 1em/);
        ctx.expect(sizing[0]).toMatch(/height: 1em/);
        ctx.expect(sizing[0], 'the pre-box offset for the non-`i` case (inert on a flex item)').toMatch(/vertical-align: -0\.125em/);
      },
    },

    {
      name: '#180: .fa-spin turns once per second, from center, and parks for reduced motion',
      run: (ctx) => {
        const { css } = compileIconSheet();

        ctx.expect(css, 'FA\'s own keyframes name — the sheet stands alone').toMatch(/@keyframes fa-spin \{[^@]*rotate\(360deg\)/);
        ctx.expect(css).toMatch(/\.fa-spin \{[^}]*animation: fa-spin 1s linear infinite/s);
        ctx.expect(css, 'the turn is centered, not orbiting the baseline').toMatch(/\.fa-spin \{[^}]*transform-origin: center/s);

        const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
        ctx.expect(reduced, 'the reduced-motion branch exists').toMatch(/prefers-reduced-motion: reduce/);
        ctx.expect(reduced, 'the icon parks instead of spinning').toMatch(/\.fa-spin,[^{]*\{\s*animation: none/);
      },
    },

    {
      name: '#183: fa-bounce and fa-beat are implemented, not silent no-ops, and park too',
      run: (ctx) => {
        const { css } = compileIconSheet();

        // Both are already in core markup (core/_includes/core/body.html's
        // outdated-browser and payment-issue alerts), where they rendered nothing
        // until this sheet grew its own keyframes.
        ctx.expect(css, 'a bounce actually moves the glyph').toMatch(/@keyframes fa-bounce \{[^@]*translateY\(-0\.25em\)/);
        ctx.expect(css).toMatch(/\.fa-bounce \{[^}]*animation: fa-bounce 1s ease-in-out infinite/s);

        ctx.expect(css, 'a beat actually swells the glyph').toMatch(/@keyframes fa-beat \{[^@]*scale\(1\.25\)/);
        ctx.expect(css).toMatch(/\.fa-beat \{[^}]*animation: fa-beat 1s ease-in-out infinite/s);
        ctx.expect(css, 'the swell grows from the glyph center').toMatch(/\.fa-beat \{[^}]*transform-origin: center/s);

        const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
        for (const utility of ['fa-spin', 'fa-bounce', 'fa-beat']) {
          ctx.expect(reduced, `${utility} parks under reduced motion, like every looping effect`).toMatch(new RegExp(`\\.${utility}[,\\s]`));
        }
        ctx.expect(reduced).toMatch(/animation: none/);
      },
    },

    {
      name: '#183: the sheet ships all 12 sizes the client renderer treats as modifiers',
      run: (ctx) => {
        // Derived from the sheet's OWN $fa-sizes map through Sass, so drift is caught
        // from either side: this literal is the same roster
        // packages/client/test/icon-core.test.js pins MODIFIER_REGEX against, and a
        // size that ships here without landing there parses as an icon NAME.
        const probe = sass.compileString(
          "@use 'sass:map';\n@use 'core/custom-font-awesome' as fa;\n.roster { content: '#{map.keys(fa.$fa-sizes)}'; }",
          { loadPaths: [path.join(PKG, 'core', 'css')] },
        ).css;

        const roster = probe.match(/\.roster \{\s*content: "([^"]+)"/)[1].split(', ');

        ctx.expect(roster).toEqual(['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl']);
      },
    },
  ],
});
