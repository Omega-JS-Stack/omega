/**
 * #451 — the contact blueprint's facts rail. The layout's median-reply
 * default shipped a RAW `<15m` into markup: production minification reads
 * the bogus tag, eats the value's closing `</span>` and the item's `</div>`,
 * the remaining three facts nest inside the first, and visitors read a
 * literal `< span>`. Pinned over a real PRODUCTION build (the minifier is
 * production-only) of the packaged contact page — no consumer data involved,
 * which is exactly how a brand riding the blueprint default meets the bug.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

module.exports = defineCases({
  type: 'group',
  description: 'contact-facts',
  tests: [
    {
      name: '#451: the facts rail survives minification — four sibling facts, no literal `< span>`',
      run: async (ctx) => {
        const pages = await buildSite(BARE, bareData, { environment: 'production' }, 'contact-facts');
        const html = pages.get('/contact');
        ctx.expect(html, 'the packaged contact page built').toBeTruthy();

        ctx.expect(!html.includes('< span>'), 'no swallowed tag leaks into the copy visitors read').toBeTruthy();
        ctx.expect(html.includes('&lt;15m'), 'the median-reply fact ships its angle bracket as an entity').toBeTruthy();
        ctx.expect((html.match(/omega-facts__item/g) || []).length, 'all four facts render').toBe(4);
        ctx.expect((html.match(/data-omega-countup>[^<]*<\/span>/g) || []).length, 'every fact value closes its own span — the four items stay siblings').toBe(4);
        ctx.expect((html.match(/omega-facts__sub/g) || []).length, 'and each keeps its sublabel').toBe(4);
      },
    },
  ],
});
