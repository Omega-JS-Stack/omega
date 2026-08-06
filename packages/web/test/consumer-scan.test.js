/**
 * Consumer-scan permalink extraction — the regex that decides whether a
 * consumer page suppresses a framework default at the same URL.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { permalinkOf, scanConsumerPages } = require('../src/consumer-scan.js');

test('permalinkOf: bare value', () => {
  assert.strictEqual(permalinkOf('---\npermalink: /about\n---'), '/about');
});

test('permalinkOf: trailing slash stripped', () => {
  assert.strictEqual(permalinkOf('---\npermalink: /about/\n---'), '/about');
});

test('permalinkOf: root permalink preserved', () => {
  assert.strictEqual(permalinkOf('---\npermalink: /\n---'), '/');
});

test('permalinkOf: double-quoted value', () => {
  assert.strictEqual(permalinkOf('---\npermalink: "/about/"\n---'), '/about');
});

test('permalinkOf: single-quoted value', () => {
  assert.strictEqual(permalinkOf("---\npermalink: '/about/'\n---"), '/about');
});

test('permalinkOf: spaced path inside quotes (cp198)', () => {
  assert.strictEqual(permalinkOf('---\npermalink: "/my page/"\n---'), '/my page');
});

test('permalinkOf: Liquid-templated permalink (cp198)', () => {
  assert.strictEqual(
    permalinkOf('---\npermalink: /{{ page.lang }}/about/\n---'),
    '/{{ page.lang }}/about',
  );
});

test('permalinkOf: paginated blog default', () => {
  assert.strictEqual(
    permalinkOf('---\npermalink: /blog/page/:num/\n---'),
    '/blog/page/:num',
  );
});

test('permalinkOf: no permalink returns null', () => {
  assert.strictEqual(permalinkOf('---\ntitle: Hello\n---'), null);
});

test('permalinkOf: empty frontmatter returns null', () => {
  assert.strictEqual(permalinkOf(''), null);
});

test('permalinkOf: body-text permalink mention never claims a URL (cp199)', () => {
  assert.strictEqual(
    permalinkOf('---\ntitle: Docs\n---\nSet this in frontmatter:\n\npermalink: /terms/\n'),
    null,
  );
});

test('permalinkOf: file without frontmatter returns null (cp199)', () => {
  assert.strictEqual(permalinkOf('# Readme\npermalink: /terms/\n'), null);
});

test('permalinkOf: trailing YAML comment stripped from unquoted value (cp199)', () => {
  assert.strictEqual(permalinkOf('---\npermalink: /about/ # legal page\n---'), '/about');
});

test('permalinkOf: quoted value keeps its content when a comment follows (cp199)', () => {
  assert.strictEqual(permalinkOf('---\npermalink: "/my page/" # note\n---'), '/my page');
});

test('permalinkOf: BOM before frontmatter tolerated (cp199)', () => {
  assert.strictEqual(permalinkOf('\uFEFF---\npermalink: /about\n---'), '/about');
});

// ---- The scan itself (#200 Lane B): one entry per page, so a collision can
// name the FILES that claim a URL, not just the URL.

test('scanConsumerPages: one entry per permalinked page, recursively', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-scan-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, contents) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };

  write('pages/about.md', '---\npermalink: /about/\n---\nabout');
  write('pages/company/team.html', '---\npermalink: /team\n---\nteam');
  write('pages/no-permalink.md', '---\ntitle: Draft\n---\ndraft');
  write('pages/notes.txt', 'permalink: /notes');

  assert.deepEqual(scanConsumerPages(root).map((page) => ({ file: path.relative(root, page.file), url: page.url })).sort((a, b) => a.file.localeCompare(b.file)), [
    { file: path.join('pages', 'about.md'), url: '/about' },
    { file: path.join('pages', 'company', 'team.html'), url: '/team' },
  ]);
});

test('scanConsumerPages: a missing pages dir scans to nothing', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-scan-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(scanConsumerPages(root), []);
});
