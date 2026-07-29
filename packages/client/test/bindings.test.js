const { describe, it, before } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

describe('Bindings Module', () => {

  before(async () => {
    await getManager().initialize(TEST_CONFIG);
  });

  it('should expose expected methods', () => {
    const bindings = getManager().bindings();
    assert(typeof bindings.update === 'function');
    assert(typeof bindings.getContext === 'function');
    assert(typeof bindings.clear === 'function');
  });

  it('should update and retrieve context', () => {
    const bindings = getManager().bindings();
    bindings.update({ foo: 'bar', nested: { a: 1 } });
    const ctx = bindings.getContext();
    assert.strictEqual(ctx.foo, 'bar');
    assert.strictEqual(ctx.nested.a, 1);
  });

  it('should merge context on multiple updates', () => {
    const bindings = getManager().bindings();
    bindings.update({ x: 1 });
    bindings.update({ y: 2 });
    const ctx = bindings.getContext();
    assert.strictEqual(ctx.x, 1);
    assert.strictEqual(ctx.y, 2);
  });

  it('should clear context', () => {
    const bindings = getManager().bindings();
    bindings.update({ data: 'value' });
    bindings.clear();
    assert.deepStrictEqual(bindings.getContext(), {});
  });
});

describe('Bindings condition operators (wave-4 F2)', () => {

  before(async () => {
    await getManager().initialize(TEST_CONFIG);
  });

  it('should evaluate >= and <= (longest-first alternation — > must not shadow >=)', () => {
    const bindings = getManager().bindings();
    assert.strictEqual(bindings._evaluateCondition('count >= 5', { count: 5 }), true);
    assert.strictEqual(bindings._evaluateCondition('count >= 5', { count: 4 }), false);
    assert.strictEqual(bindings._evaluateCondition('count <= 5', { count: 5 }), true);
    assert.strictEqual(bindings._evaluateCondition('count <= 5', { count: 6 }), false);
    // Plain > and < keep working
    assert.strictEqual(bindings._evaluateCondition('count > 4', { count: 5 }), true);
    assert.strictEqual(bindings._evaluateCondition('count < 4', { count: 5 }), false);
  });
});
