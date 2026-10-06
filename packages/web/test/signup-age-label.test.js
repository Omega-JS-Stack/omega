/**
 * The signup form's legal consent states the minimum age: the terms checkbox
 * the visitor ticks is the one place they agree to it, so its label carries the
 * age line beside the Terms and Privacy links.
 *
 * Read off the rendered /signup of the mini fixture (the checks.test.js
 * harness), so the brand name is the one the build interpolates.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');

const { buildWith, miniData } = require('./lib/build.js');

let signup;

/**
 * The legal consent checkbox inputs on the page.
 *
 * @returns {string[]} Each matching `<input>` tag.
 */
function legalCheckboxes() {
  return (signup.match(/<input\b[^>]*>/g) || [])
    .filter((tag) => /\sname="consentLegal"/.test(tag) && /\stype="checkbox"/.test(tag));
}

/**
 * The inner HTML of the label bound to the legal consent checkbox.
 *
 * @returns {string} The label's contents.
 */
function legalLabel() {
  const id = legalCheckboxes()[0].match(/\sid="([^"]+)"/)[1];
  const match = signup.match(new RegExp(`<label\\b[^>]*\\sfor="${id}"[^>]*>([\\s\\S]*?)</label>`));
  expect(match, `a label is bound to #${id}`).toBeTruthy();

  return match[1];
}

module.exports = defineCases({
  type: 'group',
  description: 'signup-age-label',
  setup: async () => {
    const pages = await buildWith(miniData, {}, 'signup-age-label-test');
    signup = pages.get('/signup');
  },
  tests: [
    {
      name: 'signup: the page has exactly one legal consent checkbox',
      run: (ctx) => {
        ctx.expect(signup, '/signup built').toBeTruthy();
        ctx.expect(legalCheckboxes().length, 'one consentLegal checkbox').toBe(1);
      },
    },

    {
      name: 'signup: the terms label states the minimum age',
      run: (ctx) => {
        const text = legalLabel().replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

        ctx.expect(text).toBe('I agree to MiniCo\'s Terms of Service and Privacy Policy, and I am at least 13 years old.');
      },
    },

    {
      name: 'signup: the terms label still links the Terms and the Privacy Policy',
      run: (ctx) => {
        const label = legalLabel();

        ctx.expect(label, 'the Terms of Service link').toMatch(/<a\b[^>]*\shref="\/terms"/);
        ctx.expect(label, 'the Privacy Policy link').toMatch(/<a\b[^>]*\shref="\/privacy"/);
      },
    },
  ],
});
