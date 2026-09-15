// Build-layer tests for lib/auth-persistence.js `resolve()`: WHICH strategy a boot
// settles on ([#907](https://github.com/Omega-JS-Stack/omega/issues/907)).
//
// The managers are plain objects and `available()` is stubbed, so the production
// default is provable with no Electron and, above all, with no call into this box's
// OS keychain. The real-manager half lives in the main suite, which now runs under
// the forced test-mode strategy itself.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const authPersistence = require(path.join(__dirname, '..', '..', '..', 'lib', 'auth-persistence.js'));

// resolve() reports on the module logger; collect the lines instead of printing
// them into THIS run's output.
async function capture(lines, fn) {
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (...args) => lines.push(args.join(' '));
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    return await fn();
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
}

// Stand in for the OS vault, counting every time the boot asks it anything.
function stubSafeStorage() {
  const calls = { available: 0 };
  const strategy = authPersistence._strategies.safeStorage;
  const original = strategy.available;
  strategy.available = async () => { calls.available += 1; return true; };
  return { calls, restore: () => { strategy.available = original; } };
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'auth-persistence resolve(): the production default, and the test-mode override',
  tests: [
    {
      name: 'a production manager with no config still picks safeStorage; an unknown name warns to null',
      run: async (ctx) => {
        const vault = stubSafeStorage();
        const lines = [];
        try {
          const active = await capture(lines, () => authPersistence.resolve({ config: {}, isTesting: () => false }));
          ctx.expect(active.name).toBe('safeStorage');
          ctx.expect(vault.calls.available).toBe(1);

          const unknown = await capture(lines, () => authPersistence.resolve({
            config:    { omega: { authPersistence: 'does-not-exist' } },
            isTesting: () => false,
          }));
          ctx.expect(unknown).toBeNull();
          ctx.expect(lines.join('\n')).toMatch(/unknown authPersistence strategy "does-not-exist"/);
        } finally {
          vault.restore();
          authPersistence._active = null;
        }
      },
    },
    {
      name: 'a testing manager gets none before any config read, and the vault is never asked',
      run: async (ctx) => {
        const vault = stubSafeStorage();
        const lines = [];
        try {
          // An explicit consumer value too: the boot layer boots the brand's REAL config.
          const active = await capture(lines, () => authPersistence.resolve({
            config:    { omega: { authPersistence: 'safeStorage' } },
            isTesting: () => true,
          }));
          ctx.expect(active).toBeNull();
          ctx.expect(authPersistence.getActive()).toBeNull();
          ctx.expect(vault.calls.available).toBe(0);
          ctx.expect(lines.join('\n')).toMatch(/auth persistence: none \(test mode\)/);
        } finally {
          vault.restore();
          authPersistence._active = null;
        }
      },
    },
    {
      name: 'the boot lane is a test run too: the lane variable answers, over the word baked into its production artifact',
      run: async (ctx) => {
        const { isTesting, ENVIRONMENT_VAR } = require('@omega.js/config/environment');
        const vault = stubSafeStorage();
        const lines = [];
        const previous = process.env[ENVIRONMENT_VAR];
        try {
          // What the boot lane actually looks like from in here: the app under test is
          // the consumer's PRODUCTION bundle, so the config it booted from carries
          // `production`. The runner spawned it with the one input, main.js leaves an
          // explicit one alone ([#925](https://github.com/Omega-JS-Stack/omega/issues/925)),
          // and so the real isTesting() answers the lane, not the bake.
          process.env[ENVIRONMENT_VAR] = 'testing';
          const manager = {
            config:    { environment: 'production', omega: { authPersistence: 'safeStorage' } },
            isTesting,
          };
          ctx.expect(manager.isTesting()).toBe(true);

          const active = await capture(lines, () => authPersistence.resolve(manager));
          ctx.expect(active).toBeNull();
          ctx.expect(vault.calls.available).toBe(0);
          ctx.expect(lines.join('\n')).toMatch(/auth persistence: none \(test mode\)/);
        } finally {
          if (previous === undefined) delete process.env[ENVIRONMENT_VAR];
          else process.env[ENVIRONMENT_VAR] = previous;
          vault.restore();
          authPersistence._active = null;
        }
      },
    },
  ],
});
