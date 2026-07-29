/**
 * merge.js — the ONE pairwise deep merge behind BOTH the resolved-data
 * cascade and the section tag's defaults ← data ← args chain. Its whole
 * reason for existing is the divergence from @omega.js/config's variadic
 * deepMerge: an explicit null in the later layer must REPLACE, not be
 * skipped as a falsy layer — a consumer clearing a value would otherwise
 * behave differently across the two lanes.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { deepMerge } = require('../src/merge.js');

test('later keys win and absent keys survive', () => {
  assert.deepStrictEqual(
    deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 }),
    { a: 1, b: 3, c: 4 },
  );
});

test('nested objects merge pairwise, not wholesale', () => {
  assert.deepStrictEqual(
    deepMerge({ seo: { title: 'a', description: 'd' } }, { seo: { title: 'b' } }),
    { seo: { title: 'b', description: 'd' } },
  );
});

test('an explicit null REPLACES — the reason this is not config deepMerge', () => {
  assert.deepStrictEqual(deepMerge({ a: 1 }, { a: null }), { a: null });
  assert.deepStrictEqual(deepMerge({ a: { b: 1 } }, { a: null }), { a: null });
  // Every other falsy value replaces too.
  assert.deepStrictEqual(deepMerge({ a: 1 }, { a: 0 }), { a: 0 });
  assert.deepStrictEqual(deepMerge({ a: 'x' }, { a: '' }), { a: '' });
  assert.deepStrictEqual(deepMerge({ a: true }, { a: false }), { a: false });
});

test('undefined on the later side KEEPS the earlier value', () => {
  assert.deepStrictEqual(deepMerge({ a: 1 }, { a: undefined }), { a: 1 });
  assert.strictEqual(deepMerge('kept', undefined), 'kept');
});

test('arrays replace wholesale — they are values, not containers to merge', () => {
  assert.deepStrictEqual(deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] }), { tags: ['c'] });
  assert.deepStrictEqual(deepMerge({ a: { b: 1 } }, { a: ['x'] }), { a: ['x'] });
  assert.deepStrictEqual(deepMerge(['a'], { b: 1 }), { b: 1 });
});

test('a scalar on either side means replace, never merge', () => {
  assert.strictEqual(deepMerge(1, 2), 2);
  assert.deepStrictEqual(deepMerge({ a: 1 }, 'scalar'), 'scalar');
  assert.deepStrictEqual(deepMerge('scalar', { a: 1 }), { a: 1 });
});

test('neither side is mutated — fresh containers all the way down', () => {
  const a = { seo: { title: 'a' }, keep: [1] };
  const b = { seo: { description: 'd' } };
  const out = deepMerge(a, b);

  out.seo.title = 'MUTATED';
  out.keep.push(2);

  assert.deepStrictEqual(a, { seo: { title: 'a' }, keep: [1, 2] }, 'arrays pass by reference (values, not merged containers)');
  assert.deepStrictEqual(b, { seo: { description: 'd' } });
  assert.strictEqual(a.seo.title, 'a', 'nested objects are fresh');
  assert.notStrictEqual(out.seo, a.seo);
});

test('null on the EARLIER side is replaced by the later object', () => {
  assert.deepStrictEqual(deepMerge({ a: null }, { a: { b: 1 } }), { a: { b: 1 } });
  assert.deepStrictEqual(deepMerge(null, { a: 1 }), { a: 1 });
});

test('three-deep cascade composes left to right', () => {
  const defaults = { section: { theme: 'classy', pad: { top: 1, bottom: 1 } } };
  const data = { section: { pad: { top: 2 } } };
  const args = { section: { theme: 'newsflash', pad: { bottom: null } } };

  assert.deepStrictEqual(
    deepMerge(deepMerge(defaults, data), args),
    { section: { theme: 'newsflash', pad: { top: 2, bottom: null } } },
  );
});
