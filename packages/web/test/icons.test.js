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
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { PKG } = require('./lib/build.js');

const compileIconSheet = () => {
  const warnings = [];
  const result = sass.compile(path.join(PKG, 'core', 'css', 'core', '_custom-font-awesome.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  });
  return { css: result.css, warnings };
};

test('#180: the rendered icon <i> gets a square, glyph-centered box on both renderer hooks', () => {
  const { css, warnings } = compileIconSheet();

  assert.deepEqual(warnings, [], 'new core css never warns — the #16 bar');

  const box = css.match(/i\.fa,\ni\[data-omega-fa\] \{[^}]*\}/);
  assert.ok(box, 'the box keys on the renderer stamp and the hand-authored .fa wrapper');
  assert.match(box[0], /display: inline-flex/);
  assert.match(box[0], /align-items: center/);
  assert.match(box[0], /justify-content: center/);
  assert.match(box[0], /width: 1em/);
  assert.match(box[0], /height: 1em/);
  assert.match(box[0], /vertical-align: -0\.125em/, 'FA\'s own baseline offset moved onto the box');
  assert.match(box[0], /flex-shrink: 0/, 'a flex row never squeezes an icon out of square');

  for (const child of ['i.fa svg', 'i.fa img', 'i\\[data-omega-fa\\] svg', 'i\\[data-omega-fa\\] img']) {
    assert.match(css, new RegExp(`${child}[^{]*\\{[^}]*width: 1em;\\s*height: 1em`),`the glyph inside ${child.replace(/\\/g, '')} keeps its 1em sizing`);
  }
});

test('#180: the glyph sizing stays UNQUALIFIED, so non-`i` markup keeps its 1em children', () => {
  const { css } = compileIconSheet();

  // The account page wraps provider logos in `div.fa fa-3xl`
  // (themes/base/_layouts/frontend/pages/account/index.html), so the child
  // sizing may never inherit the box's `i` qualifier.
  const sizing = css.match(/(?:^|\n)\.fa svg,[^{}]*\{[^}]*\}/);
  assert.ok(sizing, 'a `.fa svg` rule with NO `i` prefix — a div.fa wrapper sizes its glyph too');
  assert.match(sizing[0], /\[data-omega-fa\] svg/, 'the renderer stamp, same as the box');
  assert.match(sizing[0], /width: 1em/);
  assert.match(sizing[0], /height: 1em/);
  assert.match(sizing[0], /vertical-align: -0\.125em/, 'the pre-box offset for the non-`i` case (inert on a flex item)');
});

test('#180: .fa-spin turns once per second, from center, and parks for reduced motion', () => {
  const { css } = compileIconSheet();

  assert.match(css, /@keyframes fa-spin \{[^@]*rotate\(360deg\)/, 'FA\'s own keyframes name — the sheet stands alone');
  assert.match(css, /\.fa-spin \{[^}]*animation: fa-spin 1s linear infinite/s);
  assert.match(css, /\.fa-spin \{[^}]*transform-origin: center/s, 'the turn is centered, not orbiting the baseline');

  const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
  assert.match(reduced, /prefers-reduced-motion: reduce/, 'the reduced-motion branch exists');
  assert.match(reduced, /\.fa-spin,[^{]*\{\s*animation: none/, 'the icon parks instead of spinning');
});

test('#183: fa-bounce and fa-beat are implemented, not silent no-ops, and park too', () => {
  const { css } = compileIconSheet();

  // Both are already in core markup (core/_includes/core/body.html's
  // outdated-browser and payment-issue alerts), where they rendered nothing
  // until this sheet grew its own keyframes.
  assert.match(css, /@keyframes fa-bounce \{[^@]*translateY\(-0\.25em\)/, 'a bounce actually moves the glyph');
  assert.match(css, /\.fa-bounce \{[^}]*animation: fa-bounce 1s ease-in-out infinite/s);

  assert.match(css, /@keyframes fa-beat \{[^@]*scale\(1\.25\)/, 'a beat actually swells the glyph');
  assert.match(css, /\.fa-beat \{[^}]*animation: fa-beat 1s ease-in-out infinite/s);
  assert.match(css, /\.fa-beat \{[^}]*transform-origin: center/s, 'the swell grows from the glyph center');

  const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
  for (const utility of ['fa-spin', 'fa-bounce', 'fa-beat']) {
    assert.match(reduced, new RegExp(`\\.${utility}[,\\s]`), `${utility} parks under reduced motion, like every looping effect`);
  }
  assert.match(reduced, /animation: none/);
});

test('#183: the sheet ships all 12 sizes the client renderer treats as modifiers', () => {
  // Derived from the sheet's OWN $fa-sizes map through Sass, so drift is caught
  // from either side: this literal is the same roster
  // packages/client/test/icon-core.test.js pins MODIFIER_REGEX against, and a
  // size that ships here without landing there parses as an icon NAME.
  const probe = sass.compileString(
    "@use 'sass:map';\n@use 'core/custom-font-awesome' as fa;\n.roster { content: '#{map.keys(fa.$fa-sizes)}'; }",
    { loadPaths: [path.join(PKG, 'core', 'css')] },
  ).css;

  const roster = probe.match(/\.roster \{\s*content: "([^"]+)"/)[1].split(', ');

  assert.deepEqual(roster, ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl']);
});
