/**
 * #286 — `site.characters`, the literal-character set the core templates
 * interpolate. head.html's copyright meta reads `site.characters.copyright`;
 * nothing in OMEGA defined the set, so every page fleet-wide shipped
 * `content=" 2026 Brand"`. The engine composes it beside site.omega (the
 * other UJM-runtime site values the core includes read).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { buildWith, miniData } = require('./lib/build.js');

module.exports = defineCases({
  type: 'group',
  description: 'site-characters',
  tests: [
    {
      name: 'the copyright meta carries the © character, the year, and the brand',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'site-characters');
        const html = pages.get('/');
        const match = html.match(/<meta name="copyright" content="([^"]*)"/);

        ctx.expect(match, 'the head renders a copyright meta').toBeTruthy();
        ctx.expect(match[1]).toBe(`© ${new Date().getFullYear()} MiniCo`);
      },
    },

    {
      name: 'a brand may override a character; the rest of the set still stands',
      run: async (ctx) => {
        const pages = await buildWith(
          { ...miniData, characters: { copyright: '(c)' } },
          {},
          'site-characters-override',
        );
        const html = pages.get('/');

        ctx.expect(html.includes(`<meta name="copyright" content="(c) ${new Date().getFullYear()} MiniCo"`), 'the brand value wins').toBeTruthy();
      },
    },
  ],
});
