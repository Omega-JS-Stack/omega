/**
 * Dev surfaces never ship (#554, Ian's call 2026-08-24): a production build
 * emits NO page whose permalink is `/test` or sits under `/test/` — the
 * framework's own defaults (`/test`, `/test/styleguide`, `/test/libraries/*`,
 * `/test/translation`, …) and a consumer's own page at one of those URLs alike,
 * the same production omission the showcase gallery already rides. A dev build
 * keeps every one of them, which is the whole point of the lane.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// A consumer page at a /test URL, plus the near-miss the rule must NOT eat:
// `/testimonials` starts with the same five characters and is real brand content.
function makeConsumer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-testpages-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.html'), [
    '---', 'layout: frontend/core/base', 'permalink: /', '---', '<h1>Home</h1>', '',
  ].join('\n'));
  fs.writeFileSync(path.join(consumerDir, 'pages', 'scratch.html'), [
    '---', 'layout: frontend/core/base', 'permalink: /test/scratch', '---', '<h1>Consumer scratch page</h1>', '',
  ].join('\n'));
  fs.writeFileSync(path.join(consumerDir, 'pages', 'testimonials.html'), [
    '---', 'layout: frontend/core/base', 'permalink: /testimonials', '---', '<h1>What people say</h1>', '',
  ].join('\n'));
  return { tmp, consumerDir };
}

const testUrls = (pages) => [...pages.keys()].filter((url) => url === '/test' || url.startsWith('/test/')).sort();

test('#554: a production build emits no /test page — framework defaults or consumer', async () => {
  const { tmp, consumerDir } = makeConsumer();
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'production' }, 'test-pages-prod');

    assert.ok(pages.get('/'), 'the site still builds');
    assert.deepEqual(testUrls(pages), [], 'nothing under /test ships');
    assert.ok(!pages.get('/test'), 'the framework /test index is gone');
    assert.ok(!pages.get('/test/styleguide'), 'the styleguide is gone');
    assert.ok(!pages.get('/test/scratch'), "a consumer's own /test page is gone too");
    assert.ok(pages.get('/testimonials'), '/testimonials is real content — the rule stops at the path boundary');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#554: a dev build keeps every /test page', async () => {
  const { tmp, consumerDir } = makeConsumer();
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'test-pages-dev');

    assert.ok(pages.get('/test'), 'the framework /test index builds locally');
    assert.ok(pages.get('/test/styleguide'), 'so does the styleguide');
    assert.ok(pages.get('/test/libraries/cover'), 'so do the library pages');
    assert.ok(pages.get('/test/scratch'), "so does a consumer's own /test page");
    assert.ok(pages.get('/testimonials'), 'and real content is untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
