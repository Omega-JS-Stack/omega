/**
 * #243 — the account page's accordion triggers keep a visible focus ring.
 *
 * The data-request / delete / refund sections turn a <button> into plain text
 * (background, border and padding stripped), and the reset took the focus
 * outline with it: keyboard users lost the ring entirely on those triggers
 * (accessibility checklist item 6 — never remove an outline without shipping a
 * replacement). The replacement is the page's own ring recipe, on
 * `:focus-visible` so a mouse click never paints it.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { PKG } = require('./lib/build.js');

const ACCOUNT_STYLES = path.join(PKG, 'core', 'css', 'pages', 'dashboard', 'account', 'index.scss');

/** Every compiled rule whose selector mentions `needle`. */
function rulesFor(css, needle) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim(), body: match[2] }))
    .filter((rule) => rule.selector.includes(needle));
}

test('#243: the accordion trigger rings on :focus-visible, and nothing kills an outline bare', () => {
  const css = sass.compile(ACCOUNT_STYLES, { logger: { warn: () => {}, debug: () => {} } }).css;

  const rings = rulesFor(css, '.accordion-trigger:focus-visible');
  assert.ok(rings.length > 0, 'the trigger declares a keyboard focus ring');
  for (const ring of rings) {
    assert.match(ring.body, /outline:\s*2px solid var\(--omega-accent\)/, 'the page\'s ring recipe, token-painted');
    assert.match(ring.body, /outline-offset:\s*2px/, 'offset so the ring clears the text');
  }

  assert.deepStrictEqual(
    rulesFor(css, ':focus').filter((rule) => /outline:\s*none/.test(rule.body)).map((rule) => rule.selector),
    [],
    'no focus rule strips the outline without a replacement',
  );
});
