/**
 * The footer socials row — the brand's `socials` config block IS the list
 * (#462). No default platform set: a brand that declares nothing gets no row
 * at all (never five icons with empty hrefs), a declared handle prints its
 * profile link with the platform's FA brand icon, and an entry with nothing
 * to point at prints nothing.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { buildWith, miniData } = require('./lib/build.js');

const ROW = /<div class="omega-footer__social"[^>]*>([\s\S]*?)<\/div>/;

function socialsRow(html) {
  const match = html.match(ROW);
  return match ? match[1] : null;
}

module.exports = defineCases({
  type: 'group',
  description: 'footer-socials',
  tests: [
    {
      name: 'no socials configured → no row, not one empty link',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'footer-socials-none');
        const home = pages.get('/');

        ctx.expect(socialsRow(home), 'the whole row stays out of the markup').toBe(null);
        ctx.expect(!home.includes('omega-footer__social-link'), 'no social link anywhere').toBeTruthy();
        ctx.expect(!/fa-(?:twitter|facebook|instagram|linkedin|github)\b/.test(home), 'no default platform icons').toBeTruthy();
      },
    },

    {
      name: 'one declared handle → exactly that link, with the platform brand icon',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, socials: { twitter: 'minico' } }, {}, 'footer-socials-one');
        const row = socialsRow(pages.get('/'));

        ctx.expect(row, 'a declared social brings the row').toBeTruthy();
        const links = row.match(/<a\s/g) || [];
        ctx.expect(links.length, `exactly one link: ${row}`).toBe(1);
        ctx.expect(row.includes('href="https://twitter.com/minico"'), `the profile URL: ${row}`).toBeTruthy();
        ctx.expect(/data-omega-fa="brands\/twitter"><svg/.test(row), `the FA brand icon inlined: ${row}`).toBeTruthy();
        ctx.expect(!/facebook|instagram|linkedin|github/.test(row), 'nothing the brand never declared').toBeTruthy();
      },
    },

    {
      name: 'an entry with nothing to point at prints nothing',
      run: async (ctx) => {
        // A blank placeholder handle, and a platform whose profile URL the handle
        // can never derive — omega_social resolves neither, so neither renders.
        const pages = await buildWith(
          { ...miniData, socials: { twitter: 'minico', facebook: '', patreon: { redirect: 'https://patreon.com/minico' } } },
          {},
          'footer-socials-blank',
        );
        const row = socialsRow(pages.get('/'));

        const links = row.match(/<a\s/g) || [];
        ctx.expect(links.length, `only the entry that resolves: ${row}`).toBe(1);
        ctx.expect(row.includes('href="https://twitter.com/minico"'), `the resolvable one: ${row}`).toBeTruthy();
        ctx.expect(!row.includes('href=""'), 'never an empty href').toBeTruthy();
      },
    },
  ],
});
