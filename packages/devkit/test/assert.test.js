// Unit tests for src/test/assert.js — the tiny expect() every framework
// runner hands its tests (backend, desktop, extension via runner-core).
//
// This is the assertion engine itself: a matcher that silently passes when it
// should fail turns whole suites green for nothing, so each matcher is proven
// on BOTH sides (passes what it must, throws on what it must) plus its .not
// inversion, and the thrown error is proven to be a named AssertionError.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const expect = require('../src/test/assert.js');

// Assert that fn() throws the AssertionError shape the runners catch.
function throws(fn) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error.name, 'AssertionError');
    assert.strictEqual(typeof error.message, 'string');
    assert.ok(error.message.length > 0, 'failure carries a message');
    return true;
  });
}

test('toBe compares by identity', () => {
  expect(1).toBe(1);
  expect('a').toBe('a');
  expect(null).toBe(null);
  throws(() => expect(1).toBe('1'));
  throws(() => expect({}).toBe({}));

  expect(1).not.toBe(2);
  throws(() => expect(1).not.toBe(1));
});

test('toEqual compares structurally, by own keys', () => {
  expect({ a: 1, b: [2, { c: 3 }] }).toEqual({ a: 1, b: [2, { c: 3 }] });
  expect([]).toEqual([]);
  expect(null).toEqual(null);

  throws(() => expect({ a: 1 }).toEqual({ a: 1, b: 2 }));
  throws(() => expect({ a: 1, b: 2 }).toEqual({ a: 1 }));
  throws(() => expect([1, 2]).toEqual([2, 1]));
  throws(() => expect([1]).toEqual({ 0: 1 }));
  throws(() => expect(null).toEqual({}));

  expect({ a: 1 }).not.toEqual({ a: 2 });
  throws(() => expect({ a: 1 }).not.toEqual({ a: 1 }));
});

test('truthiness matchers follow JS truthiness', () => {
  expect(1).toBeTruthy();
  expect('x').toBeTruthy();
  expect([]).toBeTruthy();
  throws(() => expect(0).toBeTruthy());
  throws(() => expect('').toBeTruthy());

  expect(0).toBeFalsy();
  expect(null).toBeFalsy();
  expect(undefined).toBeFalsy();
  throws(() => expect('0').toBeFalsy());
});

test('defined/undefined/null are distinct checks', () => {
  expect(0).toBeDefined();
  expect(null).toBeDefined();
  throws(() => expect(undefined).toBeDefined());

  expect(undefined).toBeUndefined();
  throws(() => expect(null).toBeUndefined());

  expect(null).toBeNull();
  throws(() => expect(undefined).toBeNull());
  throws(() => expect(0).toBeNull());
});

test('toContain works on arrays (identity) and strings (substring)', () => {
  expect([1, 2, 3]).toContain(2);
  expect('hello world').toContain('world');
  throws(() => expect([1, 2, 3]).toContain(4));
  throws(() => expect('hello').toContain('bye'));
  // Anything else is not a container.
  throws(() => expect({ a: 1 }).toContain('a'));
  throws(() => expect(null).toContain('a'));

  expect([1]).not.toContain(2);
  throws(() => expect([1]).not.toContain(1));
});

test('toHaveProperty checks OWN properties only', () => {
  expect({ a: 1 }).toHaveProperty('a');
  // Present-but-undefined still counts as owned.
  expect({ a: undefined }).toHaveProperty('a');
  throws(() => expect({ a: 1 }).toHaveProperty('b'));
  // Inherited keys are not own properties.
  throws(() => expect({}).toHaveProperty('toString'));
  throws(() => expect(null).toHaveProperty('a'));
});

test('toMatch tests a regex against the value', () => {
  expect('omega-web').toMatch(/^omega/);
  throws(() => expect('omega-web').toMatch(/^web/));

  expect('omega').not.toMatch(/zzz/);
  throws(() => expect('omega').not.toMatch(/^omega/));
});

test('toBeInstanceOf checks the prototype chain', () => {
  expect(new Error('x')).toBeInstanceOf(Error);
  expect([]).toBeInstanceOf(Array);
  expect(new TypeError('x')).toBeInstanceOf(Error);
  throws(() => expect({}).toBeInstanceOf(Error));
});

test('numeric comparisons are strict (no equality)', () => {
  expect(2).toBeGreaterThan(1);
  throws(() => expect(1).toBeGreaterThan(1));
  throws(() => expect(0).toBeGreaterThan(1));

  expect(1).toBeLessThan(2);
  throws(() => expect(1).toBeLessThan(1));
});

test('toThrow awaits the function and matches the message', async () => {
  await expect(() => { throw new Error('boom happened'); }).toThrow();
  await expect(() => { throw new Error('boom happened'); }).toThrow('boom');
  await expect(() => { throw new Error('boom happened'); }).toThrow(/^boom/);

  // Async throws are awaited too — the matcher is the async lane's proof.
  await expect(async () => { throw new Error('async boom'); }).toThrow('async boom');

  await assert.rejects(
    async () => expect(() => 'no throw').toThrow(),
    (error) => error.name === 'AssertionError',
  );
  await assert.rejects(
    async () => expect(() => { throw new Error('boom'); }).toThrow('different'),
    (error) => error.name === 'AssertionError',
  );
  await assert.rejects(
    async () => expect(() => { throw new Error('boom'); }).toThrow(/different/),
    (error) => error.name === 'AssertionError',
  );
});

test('not.toThrow passes for a clean call and fails when it throws', async () => {
  await expect(() => 'fine').not.toThrow();

  await assert.rejects(
    async () => expect(() => { throw new Error('boom'); }).not.toThrow(),
    (error) => error.name === 'AssertionError',
  );
});

test('failure messages name both sides so a red run is readable', () => {
  assert.throws(() => expect('got').toBe('want'), /expected "got" to be "want"/);
  assert.throws(() => expect('got').not.toBe('got'), /expected "got" not to be "got"/);
  assert.throws(() => expect(undefined).toBeDefined(), /expected undefined to be defined/);
});
