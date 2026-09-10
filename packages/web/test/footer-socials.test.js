/**
 * The footer socials row — the brand's `socials` config block IS the list
 * (#462). No default platform set: a brand that declares nothing gets no row
 * at all (never five icons with empty hrefs), a declared handle prints its
 * profile link with the platform's FA brand icon, and an entry with nothing
 * to point at prints nothing.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { buildWith, miniData } = require('./lib/build.js');

const ROW = /<div class="omega-footer__social"[^>]*>([\s\S]*?)<\/div>/;

function socialsRow(html) {
  const match = html.match(ROW);
  return match ? match[1] : null;
}

test('no socials configured → no row, not one empty link', async () => {
  const pages = await buildWith(miniData, {}, 'footer-socials-none');
  const home = pages.get('/');

  assert.strictEqual(socialsRow(home), null, 'the whole row stays out of the markup');
  assert.ok(!home.includes('omega-footer__social-link'), 'no social link anywhere');
  assert.ok(!/fa-(?:twitter|facebook|instagram|linkedin|github)\b/.test(home), 'no default platform icons');
});

test('one declared handle → exactly that link, with the platform brand icon', async () => {
  const pages = await buildWith({ ...miniData, socials: { twitter: 'minico' } }, {}, 'footer-socials-one');
  const row = socialsRow(pages.get('/'));

  assert.ok(row, 'a declared social brings the row');
  const links = row.match(/<a\s/g) || [];
  assert.strictEqual(links.length, 1, `exactly one link: ${row}`);
  assert.ok(row.includes('href="https://twitter.com/minico"'), `the profile URL: ${row}`);
  assert.ok(/data-omega-fa="solid\/twitter"><svg/.test(row), `the FA brand icon inlined: ${row}`);
  assert.ok(!/facebook|instagram|linkedin|github/.test(row), 'nothing the brand never declared');
});

test('an entry with nothing to point at prints nothing', async () => {
  // A blank placeholder handle, and a platform whose profile URL the handle
  // can never derive — omega_social resolves neither, so neither renders.
  const pages = await buildWith(
    { ...miniData, socials: { twitter: 'minico', facebook: '', patreon: { redirect: 'https://patreon.com/minico' } } },
    {},
    'footer-socials-blank',
  );
  const row = socialsRow(pages.get('/'));

  const links = row.match(/<a\s/g) || [];
  assert.strictEqual(links.length, 1, `only the entry that resolves: ${row}`);
  assert.ok(row.includes('href="https://twitter.com/minico"'), `the resolvable one: ${row}`);
  assert.ok(!row.includes('href=""'), 'never an empty href');
});
