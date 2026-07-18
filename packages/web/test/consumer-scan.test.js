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
