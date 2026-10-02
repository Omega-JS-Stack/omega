/**
 * The one spelling of a config path: keys joined with `.`, a list position in
 * brackets. keyPath and itemPath build it, pathSteps alone reads it back.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { keyPath, itemPath, pathSteps, spellSteps } = require('../src/paths.js');

test('keyPath: a key at the root is the key alone, under a parent it joins with a dot', () => {
  assert.equal(keyPath('', 'seo'), 'seo');
  assert.equal(keyPath('seo.github', 'content'), 'seo.github.content');
});

test('itemPath: a list position is spelled in brackets', () => {
  assert.equal(itemPath('seo.github.content', 0), 'seo.github.content[0]');
});

test('pathSteps: a bracketed position reads back as a number step', () => {
  assert.deepStrictEqual(pathSteps('seo.github.content[0].org'), ['seo', 'github', 'content', 0, 'org']);
});

test('the builders and the parser round-trip', () => {
  const built = keyPath(itemPath(keyPath(keyPath(keyPath('', 'seo'), 'github'), 'content'), 0), 'org');

  assert.equal(built, 'seo.github.content[0].org');
  assert.deepStrictEqual(pathSteps(built), ['seo', 'github', 'content', 0, 'org']);
  assert.equal(spellSteps(['seo', 'github', 'content', 0, 'org']), built);

  // A path with no position: its steps join back to the same path
  assert.deepStrictEqual(pathSteps('marketing.campaigns.enabled'), ['marketing', 'campaigns', 'enabled']);
  assert.equal(pathSteps('marketing.campaigns.enabled').join('.'), 'marketing.campaigns.enabled');
});
