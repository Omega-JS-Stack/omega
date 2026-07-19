/**
 * The meta-only frontmatter guard (Ian's rule, 2026-07-19: "NOTHING EVEN
 * TRIES TO CONSUME FRONTMATTER"; softened same day: no build-fail): content
 * keys in a consumer page's frontmatter are STRIPPED from the cascade with a
 * warning — the build succeeds, but sections/components can never see the
 * values. The override lane doesn't silently work; it doesn't exist. Meta
 * keys (meta, sitemap, append) and plumbing (layout, permalink) stay legal,
 * and collection docs (_posts/…) are content entries the guard never touches.
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

test('content keys in page frontmatter are stripped (never rendered) and warned about', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'hero:',
    '  headline: "Smuggled content"',
    'mission:',
    '  title: "Also smuggled"',
  ]);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'fm-guard-strip');
    const html = pages.get('/');
    assert.ok(html, 'build succeeds — content keys are inert, not fatal');
    assert.ok(!html.includes('Smuggled content'), 'frontmatter hero value never reaches the render');
    assert.ok(!html.includes('Also smuggled'), 'frontmatter mission value never reaches the render');
    const warning = warnings.find((line) => line.includes('ignoring frontmatter content keys'));
    assert.ok(warning, `build warns about the stripped keys: ${warnings.join(' | ')}`);
    assert.ok(/hero/.test(warning) && /mission/.test(warning), 'warning lists the offending keys');
    assert.ok(/section/.test(warning), 'warning points at section calls as the home');
  } finally {
    console.warn = originalWarn;
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
