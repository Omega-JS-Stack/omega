/**
 * #180: the icon sheet — a square box for the rendered <i>, and a spin
 * utility that parks under reduced motion.
 *
 * The box keys on what the renderers actually stamp (data-omega-fa from
 * @omega.js/client's icon-renderer, class="fa" from template-kit's
 * omega_icon), never on a class an author must remember to type; without it
 * the 1em svg rides the text baseline and a spin orbits a point below the
 * glyph.
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
  assert.ok(box, 'the box keys on BOTH stamps: template-kit\'s class="fa" and the runtime data-omega-fa');
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
  assert.match(sizing[0], /\[data-omega-fa\] svg/, 'both renderer stamps, same as the box');
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
  assert.match(reduced, /\.fa-spin \{\s*animation: none/, 'the icon parks instead of spinning');
});
