const defineCases = require('@omega.js/devkit/test/define-cases');
const { User } = require('@omega.js/account');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'bindings',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        await getOmega().initialize(TEST_CONFIG);
      })()));

      cases.push({
        name: 'Bindings Module > should expose expected methods',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const bindings = getOmega().bindings;
          ctx.expect(typeof bindings.update === 'function').toBeTruthy();
          ctx.expect(typeof bindings.getContext === 'function').toBeTruthy();
          ctx.expect(typeof bindings.clear === 'function').toBeTruthy();
        },
      });

      cases.push({
        name: 'Bindings Module > should update and retrieve context',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const bindings = getOmega().bindings;
          bindings.update({ foo: 'bar', nested: { a: 1 } });
          const context = bindings.getContext();
          ctx.expect(context.foo).toBe('bar');
          ctx.expect(context.nested.a).toBe(1);
        },
      });

      cases.push({
        name: 'Bindings Module > should merge context on multiple updates',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const bindings = getOmega().bindings;
          bindings.update({ x: 1 });
          bindings.update({ y: 2 });
          const context = bindings.getContext();
          ctx.expect(context.x).toBe(1);
          ctx.expect(context.y).toBe(2);
        },
      });

      cases.push({
        name: 'Bindings Module > should clear context',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const bindings = getOmega().bindings;
          bindings.update({ data: 'value' });
          bindings.clear();
          ctx.expect(bindings.getContext()).toEqual({});
        },
      });
      return cases;
    })(),

    ...(() => {
      const cases = [];
      let beforeHook2Run;
      const beforeHook2 = (ctx) => (beforeHook2Run ||= Promise.resolve().then(() => (async () => {
        await getOmega().initialize(TEST_CONFIG);
      })()));

      cases.push({
        name: 'Bindings condition operators (wave-4 F2) > should evaluate >= and <= (longest-first alternation — > must not shadow >=)',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const bindings = getOmega().bindings;
          ctx.expect(bindings._evaluateCondition('count >= 5', { count: 5 })).toBe(true);
          ctx.expect(bindings._evaluateCondition('count >= 5', { count: 4 })).toBe(false);
          ctx.expect(bindings._evaluateCondition('count <= 5', { count: 5 })).toBe(true);
          ctx.expect(bindings._evaluateCondition('count <= 5', { count: 6 })).toBe(false);
          // Plain > and < keep working
          ctx.expect(bindings._evaluateCondition('count > 4', { count: 5 })).toBe(true);
          ctx.expect(bindings._evaluateCondition('count < 4', { count: 5 })).toBe(false);
        },
      });
      return cases;
    })(),

    // #945: the account binds under ONE root, `auth.user`, the live User, so the
    // derived facts (plan, active) resolve through its getters on every render.
    ...(() => {
      const cases = [];
      let beforeHook3Run;
      const beforeHook3 = (ctx) => (beforeHook3Run ||= Promise.resolve().then(() => (async () => {
        await getOmega().initialize(TEST_CONFIG);
      })()));

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

      cases.push({
        name: 'Bindings on the auth.user root (#945) > should render a getter and evaluate a condition through a real User',
        run: async (ctx) => {
          await beforeHook3(ctx);
          await beforeEachHook();
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

            ctx.expect($plan.textContent).toBe('pro');
            ctx.expect($paid.hasAttribute('hidden')).toBe(false);
            ctx.expect($free.hasAttribute('hidden')).toBe(true);

            bindings.update({ auth: { user: new User() } });

            ctx.expect($plan.textContent).toBe('basic');
            ctx.expect($paid.hasAttribute('hidden')).toBe(true);
            ctx.expect($free.hasAttribute('hidden')).toBe(false);
          } finally {
            document.querySelectorAll = original;
            bindings.clear();
          }
        },
      });
      return cases;
    })(),
  ],
});
