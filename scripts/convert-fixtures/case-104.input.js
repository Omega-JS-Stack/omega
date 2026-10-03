const { test } = require('node:test');
const assert = require('node:assert/strict');

const boom = () => {
  throw new Error('boom');
};
const calm = () => {};

test('strictEqual', () => {
  assert.strictEqual(1, 1);
  assert.strictEqual(2, 2, 'msg-se');
  assert.strictEqual(
    3,
    3
  );
  assert.strictEqual(
    4,
    4,
    'msg-se-multi'
  );
});

test('equal', () => {
  assert.equal(1, 1);
  assert.equal(2, 2, 'msg-eq');
  assert.equal(
    3,
    3
  );
  assert.equal(
    4,
    4,
    'msg-eq-multi'
  );
});

test('deepStrictEqual', () => {
  assert.deepStrictEqual({ a: 1 }, { a: 1 });
  assert.deepStrictEqual({ a: 2 }, { a: 2 }, 'msg-dse');
  assert.deepStrictEqual(
    { a: 3 },
    { a: 3 }
  );
  assert.deepStrictEqual(
    { a: 4 },
    { a: 4 },
    'msg-dse-multi'
  );
});

test('deepEqual', () => {
  assert.deepEqual([1], [1]);
  assert.deepEqual([2], [2], 'msg-de');
  assert.deepEqual(
    [3],
    [3]
  );
  assert.deepEqual(
    [4],
    [4],
    'msg-de-multi'
  );
});

test('notStrictEqual', () => {
  assert.notStrictEqual(1, 10);
  assert.notStrictEqual(2, 20, 'msg-nse');
  assert.notStrictEqual(
    3,
    30
  );
  assert.notStrictEqual(
    4,
    40,
    'msg-nse-multi'
  );
});

test('notEqual', () => {
  assert.notEqual(1, 10);
  assert.notEqual(2, 20, 'msg-ne');
  assert.notEqual(
    3,
    30
  );
  assert.notEqual(
    4,
    40,
    'msg-ne-multi'
  );
});

test('notDeepStrictEqual', () => {
  assert.notDeepStrictEqual({ a: 1 }, { a: 10 });
  assert.notDeepStrictEqual({ a: 2 }, { a: 20 }, 'msg-ndse');
  assert.notDeepStrictEqual(
    { a: 3 },
    { a: 30 }
  );
  assert.notDeepStrictEqual(
    { a: 4 },
    { a: 40 },
    'msg-ndse-multi'
  );
});

test('notDeepEqual', () => {
  assert.notDeepEqual([1], [10]);
  assert.notDeepEqual([2], [20], 'msg-nde');
  assert.notDeepEqual(
    [3],
    [30]
  );
  assert.notDeepEqual(
    [4],
    [40],
    'msg-nde-multi'
  );
});

test('ok', () => {
  assert.ok(1);
  assert.ok(2, 'msg-ok');
  assert.ok(
    3
  );
  assert.ok(
    4,
    'msg-ok-multi'
  );
});

test('bare call', () => {
  assert(1);
  assert(2, 'msg-bare');
  assert(
    3
  );
  assert(
    4,
    'msg-bare-multi'
  );
});

test('match', () => {
  assert.match('a1', /1/);
  assert.match('a2', /2/, 'msg-match');
  assert.match(
    'a3',
    /3/
  );
  assert.match(
    'a4',
    /4/,
    'msg-match-multi'
  );
});

test('doesNotMatch', () => {
  assert.doesNotMatch('b1', /x/);
  assert.doesNotMatch('b2', /x/, 'msg-dnm');
  assert.doesNotMatch(
    'b3',
    /x/
  );
  assert.doesNotMatch(
    'b4',
    /x/,
    'msg-dnm-multi'
  );
});

test('throws', () => {
  assert.throws(boom);
  assert.throws(boom, /boom/, 'msg-throws');
  assert.throws(
    boom
  );
  assert.throws(
    boom,
    /boom/,
    'msg-throws-multi'
  );
});

test('doesNotThrow', () => {
  assert.doesNotThrow(calm);
  assert.doesNotThrow(
    calm
  );
});

test('rejects', async () => {
  await assert.rejects(Promise.reject(new Error('r1')));
  await assert.rejects(Promise.reject(new Error('r2')), /r2/, 'msg-rejects');
  await assert.rejects(
    Promise.reject(new Error('r3'))
  );
  await assert.rejects(
    Promise.reject(new Error('r4')),
    /r4/,
    'msg-rejects-multi'
  );
});

test('fail', () => {
  if (boom === calm) assert.fail('msg-fail');
  if (boom === calm) {
    assert.fail(
      'msg-fail-multi'
    );
  }
});
