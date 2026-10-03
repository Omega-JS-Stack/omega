/**
 * The signup form's legal consent states the minimum age: the terms checkbox
 * the visitor ticks is the one place they agree to it, so its label carries the
 * age line beside the Terms and Privacy links.
 *
 * Read off the rendered /signup of the mini fixture (the checks.test.js
 * harness), so the brand name is the one the build interpolates.
 */
const assert = require('node:assert');
const { test, before } = require('node:test');

const { buildWith, miniData } = require('./lib/build.js');

let signup;

before(async () => {
  const pages = await buildWith(miniData, {}, 'signup-age-label-test');
  signup = pages.get('/signup');
});

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
  assert.ok(match, `a label is bound to #${id}`);

  return match[1];
}

test('signup: the page has exactly one legal consent checkbox', () => {
  assert.ok(signup, '/signup built');
  assert.equal(legalCheckboxes().length, 1, 'one consentLegal checkbox');
});

test('signup: the terms label states the minimum age', () => {
  const text = legalLabel().replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  assert.equal(text, 'I agree to MiniCo\'s Terms of Service and Privacy Policy, and I am at least 13 years old.');
});

test('signup: the terms label still links the Terms and the Privacy Policy', () => {
  const label = legalLabel();

  assert.match(label, /<a\b[^>]*\shref="\/terms"/, 'the Terms of Service link');
  assert.match(label, /<a\b[^>]*\shref="\/privacy"/, 'the Privacy Policy link');
});
