/**
 * social-pages.js — the shortlink redirect page a brand gets per entry of the
 * `socials` config block (#429, legacy UJM's per-social redirect pages):
 *  1. the config read: the string form is a handle, the object form adds a
 *     redirect target that WINS over the derived profile URL, and a shape the
 *     brand fat-fingered is an error (a silently dropped entry is a 404 on a
 *     link the footer prints site-wide)
 *  2. an entry with nothing to point at — an empty placeholder handle, a
 *     platform with no known URL pattern — generates no page instead
 *  3. through the real engine: one page per entry at /<platform>, on the
 *     redirect module, out of the sitemap, and a consumer page at that
 *     permalink takes the URL over exactly like any default page
 *  4. every OTHER socials consumer is untouched by the object form: the
 *     JSON-LD sameAs list and the twitter meta still read profile URLs and
 *     handles, string entries and object entries alike
 */
const assert = require('node:assert');
const { test, before } = require('node:test');

const { buildWith, miniData } = require('./lib/build.js');
const { readSocials, socialPages } = require('../src/social-pages.js');

// The block a migrated brand carries: handles for the platforms whose profile
// URL IS the destination, and kirue's Spotify case — an artist page the
// `user/%s` pattern could never derive.
const SOCIALS = {
  twitter: 'minico',
  discord: 'abc123',
  spotify: { handle: 'minico', redirect: 'https://open.spotify.com/artist/1k6DRF1jd1tmb1oxEQ0UNq' },
};

test('an unset block declares nothing', () => {
  assert.deepStrictEqual(readSocials(undefined), []);
  assert.deepStrictEqual(readSocials(null), []);
  assert.deepStrictEqual(readSocials({}), []);
  assert.deepStrictEqual(socialPages(readSocials(undefined)), [], 'no socials, no pages');
});

test('the string form is a handle, and the handle derives the destination', () => {
  assert.deepStrictEqual(readSocials({ twitter: 'minico' }), [{
    key: 'twitter',
    handle: 'minico',
    url: 'https://twitter.com/minico',
    redirect: 'https://twitter.com/minico',
  }]);

  // Every platform pattern is template-kit's — the one home omega_social and
  // the JSON-LD sameAs list already read.
  const [discord] = readSocials({ discord: 'abc123' });
  assert.strictEqual(discord.redirect, 'https://discord.gg/abc123');
});

test('the object form carries a redirect target that WINS over the profile URL', () => {
  const [spotify] = readSocials({ spotify: { handle: 'minico', redirect: 'https://open.spotify.com/artist/1k6' } });

  assert.strictEqual(spotify.url, 'https://open.spotify.com/user/minico', 'the profile URL still derives from the handle (sameAs)');
  assert.strictEqual(spotify.redirect, 'https://open.spotify.com/artist/1k6', 'the shortlink goes where the brand said');

  // Redirect alone: a platform with no known pattern still gets its shortlink.
  assert.deepStrictEqual(readSocials({ patreon: { redirect: 'https://patreon.com/minico' } }), [{
    key: 'patreon',
    handle: '',
    url: '',
    redirect: 'https://patreon.com/minico',
  }]);
});

test('an entry with nowhere to point generates no page, and says nothing about it', () => {
  // Legacy configs list every platform, most of them blank — the footer and
  // sameAs already skip those, and so does the shortlink lane.
  assert.deepStrictEqual(readSocials({ twitter: '', youtube: null }), [], 'a placeholder handle is not an entry');

  // A platform template-kit has no URL pattern for, with only a handle: there
  // is no destination to send anyone to.
  assert.deepStrictEqual(readSocials({ patreon: 'minico' }), [], 'an underivable handle declares nothing');
});

test('a shape the brand fat-fingered is an ERROR — a dropped entry is a site-wide broken link', () => {
  assert.throws(() => readSocials([{ twitter: 'minico' }]), /socials must be a map of platform → handle — got array/);
  assert.throws(() => readSocials({ twitter: 12 }), /socials\.twitter must be a handle string or \{ handle, redirect \} — got number/);
  assert.throws(() => readSocials({ twitter: { handle: 'minico', url: 'https://x.com/minico' } }), /socials\.twitter has an unknown key "url" — an entry carries handle and redirect/);
  assert.throws(() => readSocials({ twitter: { handle: 12 } }), /socials\.twitter\.handle must be a string/);
  assert.throws(() => readSocials({ twitter: { handle: 'minico', redirect: 12 } }), /socials\.twitter\.redirect must be a URL string/);
  assert.throws(() => readSocials({ twitter: {} }), /socials\.twitter carries neither a handle nor a redirect/);
  assert.throws(() => readSocials({ 'Twitter X': 'minico' }), /socials\."Twitter X" is not a usable platform key/);
});

let pages;
before(async () => {
  pages = await buildWith({ ...miniData, socials: SOCIALS }, {}, 'social-pages');
});

test('every entry ships its shortlink at /<platform>, on the redirect module', () => {
  for (const url of ['/twitter', '/discord', '/spotify']) {
    assert.ok(pages.has(url), `${url} is generated`);
  }

  assert.ok(pages.get('/twitter').includes('data-url="https://twitter.com/minico"'), 'the derived profile URL is the destination');
  assert.ok(pages.get('/discord').includes('data-url="https://discord.gg/abc123"'));
  assert.ok(
    pages.get('/spotify').includes('data-url="https://open.spotify.com/artist/1k6DRF1jd1tmb1oxEQ0UNq"'),
    'the object form\'s redirect target wins — the artist page, never the derived /user/ URL',
  );
  assert.ok(pages.get('/spotify').includes('/assets/js/layouts/modules/utilities/redirect-TEST.js'), 'the shortlink rides the redirect layout\'s script like a hand-written one');
});

test('a shortlink is noindex and out of every machine file', () => {
  assert.ok(pages.get('/twitter').includes('<meta name="robots" content="noindex'), 'the redirect layout already says noindex');

  const sitemap = pages.get('/sitemap.xml');
  const pagesJson = pages.get('/pages.json');
  for (const url of ['/twitter', '/discord', '/spotify']) {
    assert.ok(!sitemap.includes(`<loc>${miniData.url}${url}</loc>`), `${url} stays out of the sitemap`);
    assert.ok(!pagesJson.includes(`"${url}"`), `${url} stays out of the search index`);
  }
});

test('a consumer page at the same URL takes it over, like any default page', async () => {
  // mini-site's own pages claim /about — declare a social on that key and the
  // consumer's page is what ships.
  const claimed = await buildWith({ ...miniData, socials: { about: { redirect: 'https://example.com/nope' } } }, {}, 'social-pages-claimed');

  assert.ok(claimed.has('/about'), 'the URL still ships');
  assert.ok(!claimed.get('/about').includes('https://example.com/nope'), 'but it is the consumer\'s page, not the shortlink');
});

test('no socials block, no shortlinks — and nothing else moves', async () => {
  const bare = await buildWith(miniData, {}, 'social-pages-none');

  assert.ok(!bare.has('/twitter') && !bare.has('/spotify'), 'nothing generated');
  assert.ok(bare.has('/account'), 'the framework\'s own shortlink defaults are untouched');
});

test('the object form leaves every OTHER socials consumer reading the same values', () => {
  const home = pages.get('/');

  // JSON-LD sameAs (core/foot.html): profile URLs, one per entry — the object
  // form's handle derives its own exactly like a string entry.
  assert.ok(home.includes('"https://twitter.com/minico"'), 'the string form\'s profile URL');
  assert.ok(home.includes('"https://discord.gg/abc123"'));
  assert.ok(home.includes('"https://open.spotify.com/user/minico"'), 'the object form still names a PROFILE in sameAs, not its redirect');
  assert.ok(!home.includes('"https://open.spotify.com/artist/1k6DRF1jd1tmb1oxEQ0UNq"'), 'the redirect target is the shortlink\'s business alone');
  assert.ok(!home.includes('[object Object]'), 'no consumer prints a raw entry');

  // The twitter cards read the HANDLE, both forms.
  assert.ok(home.includes('<meta name="twitter:site" content="@minico"/>'));
  assert.ok(home.includes('<meta name="twitter:creator" content="@minico"/>'));
  assert.ok(pages.get('/humans.txt').includes('Twitter: minico'), 'and so does humans.txt');
});

test('an object-form TWITTER entry still hands every consumer a handle, never the entry', async () => {
  // twitter is the one platform read by NAME (the twitter cards, humans.txt),
  // so the object form has to collapse to its handle there too.
  const objectForm = await buildWith(
    { ...miniData, socials: { twitter: { handle: 'minico', redirect: 'https://x.com/minico' } } },
    {},
    'social-pages-object-twitter',
  );

  const home = objectForm.get('/');
  assert.ok(home.includes('<meta name="twitter:site" content="@minico"/>'));
  assert.ok(home.includes('<meta name="twitter:creator" content="@minico"/>'));
  assert.ok(home.includes('"https://twitter.com/minico"'), 'sameAs still names the profile');
  assert.ok(!home.includes('[object Object]'));

  assert.ok(objectForm.get('/humans.txt').includes('Twitter: minico'), 'humans.txt prints the handle, not the entry');
  assert.ok(objectForm.get('/twitter').includes('data-url="https://x.com/minico"'), 'and the shortlink goes to the redirect target');
});
