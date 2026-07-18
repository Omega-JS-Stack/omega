/**
 * Consumer-scan permalink extraction — the regex that decides whether a
 * consumer page suppresses a framework default at the same URL.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { permalinkOf } = require('../src/consumer-scan.js');

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
