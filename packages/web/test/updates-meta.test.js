/**
 * #143 — blueprint/updates/update's meta description. The layout's `default:`
 * fallback ran its `append` filters UNCONDITIONALLY, so an update WITH a
 * summary rendered "…this is the product.1.0.0 of MiniCo" — the version/brand
 * suffix glued onto the real summary. The suffix belongs to the summary-LESS
 * fallback only, and both surfaces (the page's own meta tag and the pages.json
 * entry the meta-file lane emits since #141) must carry the clean string.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const { buildSite, miniData } = require('./lib/build.js');

const SUMMARY = 'Everything before this was a promise; this is the product.';

let tmp;
let pages;
before(async () => {
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
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/**
 * The rendered `<meta name="description">` content of a page.
 * @param {string} url
 * @returns {string}
 */
function description(url) {
  const html = pages.get(url);
  assert.ok(html, `${url} rendered`);
  const match = html.match(/<meta name="description" content="([^"]*)"/);
  assert.ok(match, `${url} carries a meta description`);
  return match[1];
}

test('an update WITH a summary describes itself with the summary alone (#143)', () => {
  assert.strictEqual(description('/updates/v1.0.0'), SUMMARY, 'no version/brand suffix glued on');
});

test('an update WITHOUT a summary falls back to version + brand (#143)', () => {
  assert.strictEqual(description('/updates/v1.1.0'), 'Release notes for version 1.1.0 of MiniCo');
});

test('pages.json carries the same clean descriptions (the #141 lane)', () => {
  const index = JSON.parse(pages.get('/pages.json'));
  const withSummary = index.find((entry) => entry.url.endsWith('/updates/v1.0.0'));
  const without = index.find((entry) => entry.url.endsWith('/updates/v1.1.0'));

  assert.ok(withSummary && without, 'both updates indexed');
  assert.strictEqual(withSummary.desc, SUMMARY, 'summary reaches pages.json unsuffixed');
  assert.strictEqual(without.desc, 'Release notes for version 1.1.0 of MiniCo');
});
