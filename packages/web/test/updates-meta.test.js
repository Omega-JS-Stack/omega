/**
 * #143 — blueprint/updates/update's meta description. The layout's `default:`
 * fallback ran its `append` filters UNCONDITIONALLY, so an update WITH a
 * summary rendered "…this is the product.1.0.0 of MiniCo" — the version/brand
 * suffix glued onto the real summary. The suffix belongs to the summary-LESS
 * fallback only, and both surfaces (the page's own meta tag and the pages.json
 * entry the meta-file lane emits since #141) must carry the clean string.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');

const { buildSite, miniData } = require('./lib/build.js');

const SUMMARY = 'Everything before this was a promise; this is the product.';

let tmp;
let pages;

/**
 * The rendered `<meta name="description">` content of a page.
 * @param {string} url
 * @returns {string}
 */
function description(url) {
  const html = pages.get(url);
  expect(html, `${url} rendered`).toBeTruthy();
  const match = html.match(/<meta name="description" content="([^"]*)"/);
  expect(match, `${url} carries a meta description`).toBeTruthy();
  return match[1];
}

module.exports = defineCases({
  type: 'group',
  description: 'updates-meta',
  setup: async () => {
    // A consumer _updates set (own content suppresses the sample corpus) with
    // both shapes: a summary-carrying release and a summary-less one.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-updates-meta-'));
    const consumerDir = path.join(tmp, 'src');
    fs.mkdirSync(path.join(consumerDir, '_updates'), { recursive: true });
    fs.writeFileSync(path.join(consumerDir, '_updates', 'v1.0.0.md'), [
      '---',
      'layout: blueprint/updates/update',
      'update:',
      '  version: "1.0.0"',
      '  title: "Hello, world"',
      '  date: 2026-04-22',
      `  summary: "${SUMMARY}"`,
      '---',
      'The first release.',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(consumerDir, '_updates', 'v1.1.0.md'), [
      '---',
      'layout: blueprint/updates/update',
      'update:',
      '  version: "1.1.0"',
      '  title: "Quiet fixes"',
      '  date: 2026-05-30',
      '---',
      'A summary-less release.',
      '',
    ].join('\n'));

    pages = await buildSite(consumerDir, miniData, {}, 'updates-meta');
  },
  cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  tests: [
    {
      name: 'an update WITH a summary describes itself with the summary alone (#143)',
      run: (ctx) => {
        ctx.expect(description('/updates/v1.0.0'), 'no version/brand suffix glued on').toBe(SUMMARY);
      },
    },

    {
      name: 'an update WITHOUT a summary falls back to version + brand (#143)',
      run: (ctx) => {
        ctx.expect(description('/updates/v1.1.0')).toBe('Release notes for version 1.1.0 of MiniCo');
      },
    },

    {
      name: 'pages.json carries the same clean descriptions (the #141 lane)',
      run: (ctx) => {
        const index = JSON.parse(pages.get('/pages.json'));
        const withSummary = index.find((entry) => entry.url.endsWith('/updates/v1.0.0'));
        const without = index.find((entry) => entry.url.endsWith('/updates/v1.1.0'));

        ctx.expect(withSummary && without, 'both updates indexed').toBeTruthy();
        ctx.expect(withSummary.desc, 'summary reaches pages.json unsuffixed').toBe(SUMMARY);
        ctx.expect(without.desc).toBe('Release notes for version 1.1.0 of MiniCo');
      },
    },
  ],
});
