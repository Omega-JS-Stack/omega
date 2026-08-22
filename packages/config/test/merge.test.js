/**
 * Unit tests for @omega.js/config's merge module — the one agnostic deep
 * merge every config layer composes through.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { deepMerge } = require('../src/index.js');

test('objects merge recursively, later layers win', () => {
  const result = deepMerge(
    { brand: { id: 'a', name: 'A' }, theme: { id: 'classy' } },
    { brand: { name: 'B' } },
  );

  assert.deepStrictEqual(result, { brand: { id: 'a', name: 'B' }, theme: { id: 'classy' } });
});

test('arrays replace whole — payment.products never concatenates', () => {
  const result = deepMerge(
    { payment: { products: [{ id: 'basic' }, { id: 'premium' }] } },
    { payment: { products: [{ id: 'ultimate' }] } },
  );

  assert.deepStrictEqual(result.payment.products, [{ id: 'ultimate' }]);
});

test('null replaces, undefined is skipped', () => {
  const result = deepMerge(
    { monitoring: { providers: { sentry: { dsn: 'https://a' } } }, theme: { id: 'classy' } },
    { monitoring: { providers: { sentry: { dsn: null } } }, theme: { id: undefined } },
  );

  assert.strictEqual(result.monitoring.providers.sentry.dsn, null);
  assert.strictEqual(result.theme.id, 'classy');
});

test('falsy layers are skipped — optional brand file / target section', () => {
  const result = deepMerge(null, { brand: { id: 'a' } }, undefined, { brand: { name: 'A' } });

  assert.deepStrictEqual(result, { brand: { id: 'a', name: 'A' } });
});

test('inputs are never mutated and share no references with the result', () => {
  const base = { brand: { id: 'a' }, payment: { products: [{ id: 'basic' }] } };
  const overlay = { brand: { name: 'A' } };

  const result = deepMerge(base, overlay);
  result.brand.id = 'changed';
  result.payment.products[0].id = 'changed';

  assert.strictEqual(base.brand.id, 'a');
  assert.strictEqual(base.payment.products[0].id, 'basic');
  assert.deepStrictEqual(overlay, { brand: { name: 'A' } });
});
