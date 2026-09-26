const { describe, it, before } = require('node:test');
const { User } = require('@omega.js/account');
const { getOmega, TEST_CONFIG, assert } = require('./helpers.js');

describe('Bindings Module', () => {

  before(async () => {
    await getOmega().initialize(TEST_CONFIG);
  });

  it('should expose expected methods', () => {
    const bindings = getOmega().bindings;
    assert(typeof bindings.update === 'function');
    assert(typeof bindings.getContext === 'function');
    assert(typeof bindings.clear === 'function');
  });

  it('should update and retrieve context', () => {
    const bindings = getOmega().bindings;
    bindings.update({ foo: 'bar', nested: { a: 1 } });
    const ctx = bindings.getContext();
    assert.strictEqual(ctx.foo, 'bar');
    assert.strictEqual(ctx.nested.a, 1);
  });

  it('should merge context on multiple updates', () => {
    const bindings = getOmega().bindings;
    bindings.update({ x: 1 });
    bindings.update({ y: 2 });
    const ctx = bindings.getContext();
    assert.strictEqual(ctx.x, 1);
    assert.strictEqual(ctx.y, 2);
  });

  it('should clear context', () => {
    const bindings = getOmega().bindings;
    bindings.update({ data: 'value' });
    bindings.clear();
    assert.deepStrictEqual(bindings.getContext(), {});
  });
});

describe('Bindings condition operators (wave-4 F2)', () => {

  before(async () => {
    await getOmega().initialize(TEST_CONFIG);
  });

  it('should evaluate >= and <= (longest-first alternation — > must not shadow >=)', () => {
    const bindings = getOmega().bindings;
    assert.strictEqual(bindings._evaluateCondition('count >= 5', { count: 5 }), true);
    assert.strictEqual(bindings._evaluateCondition('count >= 5', { count: 4 }), false);
    assert.strictEqual(bindings._evaluateCondition('count <= 5', { count: 5 }), true);
    assert.strictEqual(bindings._evaluateCondition('count <= 5', { count: 6 }), false);
    // Plain > and < keep working
    assert.strictEqual(bindings._evaluateCondition('count > 4', { count: 5 }), true);
    assert.strictEqual(bindings._evaluateCondition('count < 4', { count: 5 }), false);
  });
});

// #945: the account binds under ONE root, `auth.user`, the live User, so the
// derived facts (plan, active) resolve through its getters on every render.
describe('Bindings on the auth.user root (#945)', () => {

  before(async () => {
    await getOmega().initialize(TEST_CONFIG);
  });

  /** A bound element: the attribute, text, hidden state and class list bindings touch. */
  function boundElement(bind) {
    const attributes = { 'data-omega-bind': bind };
    return {
      textContent: '',
      getAttribute: (name) => attributes[name] ?? null,
      setAttribute: (name, value) => { attributes[name] = String(value); },
      removeAttribute: (name) => { delete attributes[name]; },
      hasAttribute: (name) => name in attributes,
      classList: { add: () => {}, remove: () => {} },
    };
  }

  it('should render a getter and evaluate a condition through a real User', () => {
    const bindings = getOmega().bindings;
    const $plan = boundElement('auth.user.plan');
    const $paid = boundElement('@show auth.user.active === true');
    const $free = boundElement('@hide auth.user.active === true');
    const original = document.querySelectorAll;

    document.querySelectorAll = (selector) => (selector === '[data-omega-bind]' ? [$plan, $paid, $free] : []);

    try {
      const user = new User(
        { subscription: { product: { id: 'pro' }, status: 'active' } },
        { uid: 'user-1', email: 'user@test.com' },
      );

      bindings.update({ auth: { user } });

      assert.strictEqual($plan.textContent, 'pro');
      assert.strictEqual($paid.hasAttribute('hidden'), false);
      assert.strictEqual($free.hasAttribute('hidden'), true);

      bindings.update({ auth: { user: new User() } });

      assert.strictEqual($plan.textContent, 'basic');
      assert.strictEqual($paid.hasAttribute('hidden'), true);
      assert.strictEqual($free.hasAttribute('hidden'), false);
    } finally {
      document.querySelectorAll = original;
      bindings.clear();
    }
  });
});
