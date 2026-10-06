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
const defineCases = require('@omega.js/devkit/test/define-cases');

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

let pages;

module.exports = defineCases({
  type: 'group',
  description: 'social-pages',
  setup: async () => {
    pages = await buildWith({ ...miniData, socials: SOCIALS }, {}, 'social-pages');
  },
  tests: [
    {
      name: 'an unset block declares nothing',
      run: (ctx) => {
        ctx.expect(readSocials(undefined)).toEqual([]);
        ctx.expect(readSocials(null)).toEqual([]);
        ctx.expect(readSocials({})).toEqual([]);
        ctx.expect(socialPages(readSocials(undefined)), 'no socials, no pages').toEqual([]);
      },
    },

    {
      name: 'the string form is a handle, and the handle derives the destination',
      run: (ctx) => {
        ctx.expect(readSocials({ twitter: 'minico' })).toEqual([{
          key: 'twitter',
          handle: 'minico',
          url: 'https://twitter.com/minico',
          redirect: 'https://twitter.com/minico',
        }]);

        // Every platform pattern is template-kit's — the one home omega_social and
        // the JSON-LD sameAs list already read.
        const [discord] = readSocials({ discord: 'abc123' });
        ctx.expect(discord.redirect).toBe('https://discord.gg/abc123');
      },
    },

    {
      name: 'the object form carries a redirect target that WINS over the profile URL',
      run: (ctx) => {
        const [spotify] = readSocials({ spotify: { handle: 'minico', redirect: 'https://open.spotify.com/artist/1k6' } });

        ctx.expect(spotify.url, 'the profile URL still derives from the handle (sameAs)').toBe('https://open.spotify.com/user/minico');
        ctx.expect(spotify.redirect, 'the shortlink goes where the brand said').toBe('https://open.spotify.com/artist/1k6');

        // Redirect alone: a platform with no known pattern still gets its shortlink.
        ctx.expect(readSocials({ patreon: { redirect: 'https://patreon.com/minico' } })).toEqual([{
          key: 'patreon',
          handle: '',
          url: '',
          redirect: 'https://patreon.com/minico',
        }]);
      },
    },

    {
      name: 'an entry with nowhere to point generates no page, and says nothing about it',
      run: (ctx) => {
        // Legacy configs list every platform, most of them blank — the footer and
        // sameAs already skip those, and so does the shortlink lane.
        ctx.expect(readSocials({ twitter: '', youtube: null }), 'a placeholder handle is not an entry').toEqual([]);

        // A platform template-kit has no URL pattern for, with only a handle: there
        // is no destination to send anyone to.
        ctx.expect(readSocials({ patreon: 'minico' }), 'an underivable handle declares nothing').toEqual([]);
      },
    },

    {
      name: 'a shape the brand fat-fingered is an ERROR — a dropped entry is a site-wide broken link',
      run: (ctx) => {
        ctx.expect(() => readSocials([{ twitter: 'minico' }])).toThrow(/socials must be a map of platform → handle — got array/);
        ctx.expect(() => readSocials({ twitter: 12 })).toThrow(/socials\.twitter must be a handle string or \{ handle, redirect \} — got number/);
        ctx.expect(() => readSocials({ twitter: { handle: 'minico', url: 'https://x.com/minico' } })).toThrow(/socials\.twitter has an unknown key "url" — an entry carries handle and redirect/);
        ctx.expect(() => readSocials({ twitter: { handle: 12 } })).toThrow(/socials\.twitter\.handle must be a string/);
        ctx.expect(() => readSocials({ twitter: { handle: 'minico', redirect: 12 } })).toThrow(/socials\.twitter\.redirect must be a URL string/);
        ctx.expect(() => readSocials({ twitter: {} })).toThrow(/socials\.twitter carries neither a handle nor a redirect/);
        ctx.expect(() => readSocials({ 'Twitter X': 'minico' })).toThrow(/socials\."Twitter X" is not a usable platform key/);
      },
    },

    {
      name: 'every entry ships its shortlink at /<platform>, on the redirect module',
      run: (ctx) => {
        for (const url of ['/twitter', '/discord', '/spotify']) {
          ctx.expect(pages.has(url), `${url} is generated`).toBeTruthy();
        }

        ctx.expect(pages.get('/twitter').includes('data-url="https://twitter.com/minico"'), 'the derived profile URL is the destination').toBeTruthy();
        ctx.expect(pages.get('/discord').includes('data-url="https://discord.gg/abc123"')).toBeTruthy();
        ctx.expect(pages.get('/spotify').includes('data-url="https://open.spotify.com/artist/1k6DRF1jd1tmb1oxEQ0UNq"'), 'the object form\'s redirect target wins — the artist page, never the derived /user/ URL').toBeTruthy();
        ctx.expect(pages.get('/spotify').includes('/assets/js/layouts/modules/utilities/redirect-TEST.js'), 'the shortlink rides the redirect layout\'s script like a hand-written one').toBeTruthy();
      },
    },

    {
      name: 'a shortlink is noindex and out of every machine file',
      run: (ctx) => {
        ctx.expect(pages.get('/twitter').includes('<meta name="robots" content="noindex'), 'the redirect layout already says noindex').toBeTruthy();

        const sitemap = pages.get('/sitemap.xml');
        const pagesJson = pages.get('/pages.json');
        for (const url of ['/twitter', '/discord', '/spotify']) {
          ctx.expect(!sitemap.includes(`<loc>${miniData.url}${url}</loc>`), `${url} stays out of the sitemap`).toBeTruthy();
          ctx.expect(!pagesJson.includes(`"${url}"`), `${url} stays out of the search index`).toBeTruthy();
        }
      },
    },

    {
      name: 'a consumer page at the same URL takes it over, like any default page',
      run: async (ctx) => {
        // mini-site's own pages claim /about — declare a social on that key and the
        // consumer's page is what ships.
        const claimed = await buildWith({ ...miniData, socials: { about: { redirect: 'https://example.com/nope' } } }, {}, 'social-pages-claimed');

        ctx.expect(claimed.has('/about'), 'the URL still ships').toBeTruthy();
        ctx.expect(!claimed.get('/about').includes('https://example.com/nope'), 'but it is the consumer\'s page, not the shortlink').toBeTruthy();
      },
    },

    {
      name: 'no socials block, no shortlinks — and nothing else moves',
      run: async (ctx) => {
        const bare = await buildWith(miniData, {}, 'social-pages-none');

        ctx.expect(!bare.has('/twitter') && !bare.has('/spotify'), 'nothing generated').toBeTruthy();
        ctx.expect(bare.has('/account'), 'the framework\'s own shortlink defaults are untouched').toBeTruthy();
      },
    },

    {
      name: 'the object form leaves every OTHER socials consumer reading the same values',
      run: (ctx) => {
        const home = pages.get('/');

        // JSON-LD sameAs (core/foot.html): profile URLs, one per entry — the object
        // form's handle derives its own exactly like a string entry.
        ctx.expect(home.includes('"https://twitter.com/minico"'), 'the string form\'s profile URL').toBeTruthy();
        ctx.expect(home.includes('"https://discord.gg/abc123"')).toBeTruthy();
        ctx.expect(home.includes('"https://open.spotify.com/user/minico"'), 'the object form still names a PROFILE in sameAs, not its redirect').toBeTruthy();
        ctx.expect(!home.includes('"https://open.spotify.com/artist/1k6DRF1jd1tmb1oxEQ0UNq"'), 'the redirect target is the shortlink\'s business alone').toBeTruthy();
        ctx.expect(!home.includes('[object Object]'), 'no consumer prints a raw entry').toBeTruthy();

        // The twitter cards read the HANDLE, both forms.
        ctx.expect(home.includes('<meta name="twitter:site" content="@minico"/>')).toBeTruthy();
        ctx.expect(home.includes('<meta name="twitter:creator" content="@minico"/>')).toBeTruthy();
        ctx.expect(pages.get('/humans.txt').includes('Twitter: minico'), 'and so does humans.txt').toBeTruthy();
      },
    },

    {
      name: 'an object-form TWITTER entry still hands every consumer a handle, never the entry',
      run: async (ctx) => {
        // twitter is the one platform read by NAME (the twitter cards, humans.txt),
        // so the object form has to collapse to its handle there too.
        const objectForm = await buildWith(
          { ...miniData, socials: { twitter: { handle: 'minico', redirect: 'https://x.com/minico' } } },
          {},
          'social-pages-object-twitter',
        );

        const home = objectForm.get('/');
        ctx.expect(home.includes('<meta name="twitter:site" content="@minico"/>')).toBeTruthy();
        ctx.expect(home.includes('<meta name="twitter:creator" content="@minico"/>')).toBeTruthy();
        ctx.expect(home.includes('"https://twitter.com/minico"'), 'sameAs still names the profile').toBeTruthy();
        ctx.expect(!home.includes('[object Object]')).toBeTruthy();

        ctx.expect(objectForm.get('/humans.txt').includes('Twitter: minico'), 'humans.txt prints the handle, not the entry').toBeTruthy();
        ctx.expect(objectForm.get('/twitter').includes('data-url="https://x.com/minico"'), 'and the shortlink goes to the redirect target').toBeTruthy();
      },
    },
  ],
});
