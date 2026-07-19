/**
 * The meta-only frontmatter guard (Ian's rule, 2026-07-19: "NOTHING EVEN
 * TRIES TO CONSUME FRONTMATTER"): a consumer page carrying content keys in
 * frontmatter FAILS the build with the move-it message — the override lane
 * doesn't silently work or silently no-op, it doesn't exist. Meta keys
 * (meta, sitemap, append) and plumbing (layout, permalink) stay legal, and
 * collection docs (_posts/…) are content entries the guard never touches.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

function makeConsumer(pageFrontmatter) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fmguard-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
    '---',
    'layout: blueprint/index',
    'permalink: /',
    ...pageFrontmatter,
    '---',
    '',
  ].join('\n'));
  return { tmp, consumerDir };
}

test('content keys in page frontmatter fail the build with the move-it message', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'hero:',
    '  headline: "Smuggled content"',
    'mission:',
    '  title: "Also smuggled"',
  ]);
  try {
    await assert.rejects(
      () => buildSite(consumerDir, bareData, { environment: 'development' }, 'fm-guard-reject'),
      (err) => {
        // Eleventy nests the real error: MapPagesError → BaseError → ours.
        let message = '';
        for (let e = err; e; e = e.originalError) message += String(e.message || '');
        assert.ok(/content keys/.test(message), `error names the violation: ${message}`);
        assert.ok(/hero/.test(message) && /mission/.test(message), 'error lists the offending keys');
        assert.ok(/section/.test(message), 'error points at section calls as the home');
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('meta-only frontmatter (meta, sitemap, append) builds clean', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'meta:',
    '  title: "Legal meta"',
    'sitemap: false',
    'append: true',
  ]);
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'fm-guard-allow');
    assert.ok(pages.get('/'), 'page built');
    assert.ok(pages.get('/').includes('<title>Legal meta</title>'), 'meta.title consumed — meta is the sanctioned lane');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
