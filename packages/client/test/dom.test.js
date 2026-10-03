const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'dom',
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
        name: 'DOM Module > should expose loadScript and ready',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const dom = getOmega().dom;
          ctx.expect(typeof dom.loadScript === 'function').toBeTruthy();
          ctx.expect(typeof dom.ready === 'function').toBeTruthy();
        },
      });

      cases.push({
        name: 'DOM Module > ready should resolve immediately when DOM is complete',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          await getOmega().dom.ready();
        },
      });

      cases.push({
        name: 'DOM Module > loadScript should reject when no src provided',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          try {
            await getOmega().dom.loadScript({});
            ctx.expect.fail('Should have thrown');
          } catch (e) {
            ctx.expect(e.message.includes('source is required')).toBeTruthy();
          }
        },
      });

      cases.push({
        name: 'DOM Module > replaceChildren clears and appends where the browser has no native replaceChildren',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const calls = [];
          const el = {
            children: ['stale'],
            set innerHTML(value) {
              calls.push(`innerHTML=${JSON.stringify(value)}`);
              this.children = [];
            },
            append(...nodes) {
              calls.push('append');
              this.children.push(...nodes);
            },
          };

          getOmega().dom.replaceChildren(el, 'a', 'b');

          ctx.expect(calls).toEqual(['innerHTML=""', 'append']);
          ctx.expect(el.children).toEqual(['a', 'b']);
        },
      });
      return cases;
    })(),
  ],
});
