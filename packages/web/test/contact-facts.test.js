/**
 * #451 — the contact blueprint's facts rail. The layout's median-reply
 * default shipped a RAW `<15m` into markup: production minification reads
 * the bogus tag, eats the value's closing `</span>` and the item's `</div>`,
 * the remaining three facts nest inside the first, and visitors read a
 * literal `< span>`. Pinned over a real PRODUCTION build (the minifier is
 * production-only) of the packaged contact page — no consumer data involved,
 * which is exactly how a brand riding the blueprint default meets the bug.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

test('#451: the facts rail survives minification — four sibling facts, no literal `< span>`', async () => {
  const pages = await buildSite(BARE, bareData, { environment: 'production' }, 'contact-facts');
  const html = pages.get('/contact');
  assert.ok(html, 'the packaged contact page built');

  assert.ok(!html.includes('< span>'), 'no swallowed tag leaks into the copy visitors read');
  assert.ok(html.includes('&lt;15m'), 'the median-reply fact ships its angle bracket as an entity');
  assert.equal((html.match(/omega-facts__item/g) || []).length, 4, 'all four facts render');
  assert.equal(
    (html.match(/data-omega-countup>[^<]*<\/span>/g) || []).length,
    4,
    'every fact value closes its own span — the four items stay siblings',
  );
  assert.equal((html.match(/omega-facts__sub/g) || []).length, 4, 'and each keeps its sublabel');
});
