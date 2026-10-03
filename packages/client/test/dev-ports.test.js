const defineCases = require('@omega.js/devkit/test/define-cases');
const { createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

// modules/dev-ports.js is the ONE home of the local port chain: the
// OMEGA_*_PORT env channel first, then the `dev.ports` map the caller was given,
// then a loud miss. The Omega class and desktop's and extension's url-helpers call it.
let devPorts;

const WRITER = 'the test bundle task';
const ENV_KEYS = ['OMEGA_HOSTING_PORT', 'OMEGA_HTTPS_PORT', 'OMEGA_FUNCTIONS_PORT', 'OMEGA_AUTH_PORT'];
const saved = {};

module.exports = defineCases({
  type: 'group',
  description: 'dev-ports',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        devPorts = await import('../src/modules/dev-ports.js');
        for (const key of ENV_KEYS) {
          saved[key] = process.env[key];
          delete process.env[key];
        }
      })()));

      const afterEachHook = () => {
        for (const key of ENV_KEYS) {
          delete process.env[key];
        }
      };

      const afterHook = () => {
        for (const key of ENV_KEYS) {
          if (saved[key] !== undefined) process.env[key] = saved[key];
        }
      };

      cases.push({
        name: 'dev-ports: the local port chain > the baked dev.ports value answers when no env channel is published',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          ctx.expect(devPorts.localPort({ hosting: 5012 }, 'hosting')).toBe(5012);
        },
      });

      cases.push({
        name: 'dev-ports: the local port chain > the OMEGA_*_PORT env channel wins over the baked value',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          process.env.OMEGA_HOSTING_PORT = '5022';
          ctx.expect(devPorts.localPort({ hosting: 5012 }, 'hosting')).toBe(5022);
        },
      });

      cases.push({
        name: 'dev-ports: the local port chain > an env value that is not a positive integer port falls through to the map',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          process.env.OMEGA_HOSTING_PORT = 'nope';
          ctx.expect(devPorts.localPort({ hosting: 5012 }, 'hosting')).toBe(5012);
        },
      });

      cases.push({
        name: 'dev-ports: the local port chain > requiredPort throws naming the port and the writer the caller passed',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          ctx.expect(() => devPorts.requiredPort(undefined, 'hosting', WRITER)).toThrow(/dev port for `hosting`/);
          ctx.expect(() => devPorts.requiredPort({}, 'hosting', WRITER)).toThrow(/the test bundle task/);
        },
      });

      cases.push({
        name: 'dev-ports: the local port chain > localApiUrl: a mapped https port is the mkcert proxy, over https',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          ctx.expect(devPorts.localApiUrl({ https: 5003, hosting: 5443 }, WRITER)).toBe('https://localhost:5003');
        },
      });

      // The emulator binds 127.0.0.1, and `localhost` can resolve to ::1 in Node.
      cases.push({
        name: 'dev-ports: the local port chain > localApiUrl: a mapped hosting port alone is the emulator, plain http on 127.0.0.1',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          ctx.expect(devPorts.localApiUrl({ hosting: 5012 }, WRITER)).toBe('http://127.0.0.1:5012');
        },
      });

      cases.push({
        name: 'dev-ports: the local port chain > localApiUrl: neither mapped throws naming the hosting port',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          ctx.expect(() => devPorts.localApiUrl({}, WRITER)).toThrow(/dev port for `hosting`/);
        },
      });

      cases.push({
        name: 'dev-ports: the local port chain > localFunctionsUrl: the functions emulator on 127.0.0.1, env port over the map',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          ctx.expect(devPorts.localFunctionsUrl({ functions: 5011 }, 'demo-app', WRITER)).toBe('http://127.0.0.1:5011/demo-app/us-central1');
          process.env.OMEGA_FUNCTIONS_PORT = '5021';
          ctx.expect(devPorts.localFunctionsUrl({ functions: 5011 }, 'demo-app', WRITER)).toBe('http://127.0.0.1:5021/demo-app/us-central1');
        },
      });

      cases.push({
        name: 'dev-ports: the local port chain > localAuthEmulatorUrl: the auth emulator on 127.0.0.1, and a loud miss without it',
        run: async (ctx) => {
          ctx.after(afterHook);
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.after(afterEachHook);
          ctx.expect(devPorts.localAuthEmulatorUrl({ auth: 9109 }, WRITER)).toBe('http://127.0.0.1:9109');
          ctx.expect(() => devPorts.localAuthEmulatorUrl({}, WRITER)).toThrow(/dev port for `auth`/);
        },
      });
      return cases;
    })(),
  ],
});
