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
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const sass = require('sass');

const { PKG } = require('./lib/build.js');

const ACCOUNT_STYLES = path.join(PKG, 'core', 'css', 'pages', 'dashboard', 'account', 'index.scss');

/** Every compiled rule whose selector mentions `needle`. */
function rulesFor(css, needle) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim(), body: match[2] }))
    .filter((rule) => rule.selector.includes(needle));
}

module.exports = defineCases({
  type: 'group',
  description: 'account-focus',
  tests: [
    {
      name: '#243: the accordion trigger rings on :focus-visible, and nothing kills an outline bare',
      run: (ctx) => {
        const css = sass.compile(ACCOUNT_STYLES, { logger: { warn: () => {}, debug: () => {} } }).css;

        const rings = rulesFor(css, '.accordion-trigger:focus-visible');
        ctx.expect(rings.length > 0, 'the trigger declares a keyboard focus ring').toBeTruthy();
        for (const ring of rings) {
          ctx.expect(ring.body, 'the page\'s ring recipe, token-painted').toMatch(/outline:\s*2px solid var\(--omega-accent\)/);
          ctx.expect(ring.body, 'offset so the ring clears the text').toMatch(/outline-offset:\s*2px/);
        }

        ctx.expect(rulesFor(css, ':focus').filter((rule) => /outline:\s*none/.test(rule.body)).map((rule) => rule.selector), 'no focus rule strips the outline without a replacement').toEqual([]);
      },
    },
  ],
});
