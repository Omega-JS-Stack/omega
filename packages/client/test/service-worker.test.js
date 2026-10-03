const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, setPathPrefix, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

// Count the calls the real ServiceWorker module makes into the harness's inert
// navigator.serviceWorker container — the assertions watch the actual code path.
function instrumentContainer() {
  const container = navigator.serviceWorker;
  const original = {
    register: container.register,
    getRegistrations: container.getRegistrations,
  };
  const calls = { register: 0, getRegistrations: 0 };
  const registered = [];

  container.register = async (...args) => {
    calls.register++;
    registered.push({ url: args[0], options: args[1] });
    return original.register(...args);
  };
  container.getRegistrations = async (...args) => {
    calls.getRegistrations++;
    return original.getRegistrations(...args);
  };

  return {
    calls,
    registered,
    restore() {
      Object.assign(container, original);
    },
  };
}

// Swap the page origin: desktop windows load file:// and extension pages load
// chrome-extension://, both of which ship the API but cannot host a worker.
function setLocation(protocol, href, origin) {
  const previous = { ...global.window.location };

  Object.assign(global.window.location, { protocol, href, origin });

  return () => Object.assign(global.window.location, previous);
}

module.exports = defineCases({
  type: 'group',
  description: 'service-worker',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let container;
      let restoreLocation;

      const afterEachHook = () => {
        container?.restore();
        restoreLocation?.();
        container = null;
        restoreLocation = null;
      };

      cases.push({
        name: 'Service Worker origin gate > should skip registration entirely on a file:// origin',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook);
          restoreLocation = setLocation('file:', 'file:///Applications/Brand.app/index.html', 'file://');
          container = instrumentContainer();

          await getOmega().initialize({ ...TEST_CONFIG });

          ctx.expect(container.calls.register).toBe(0);
          ctx.expect(container.calls.getRegistrations).toBe(0);
        },
      });

      cases.push({
        name: 'Service Worker origin gate > should skip the disabled-branch sweep on a chrome-extension:// origin',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook);
          restoreLocation = setLocation('chrome-extension:', 'chrome-extension://abc/popup.html', 'chrome-extension://abc');
          container = instrumentContainer();

          await getOmega().initialize({ ...TEST_CONFIG, serviceWorker: { enabled: false } });

          ctx.expect(container.calls.register).toBe(0);
          ctx.expect(container.calls.getRegistrations).toBe(0);
        },
      });

      cases.push({
        name: 'Service Worker origin gate > should register on an http(s) origin when enabled',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook);
          container = instrumentContainer();

          await getOmega().initialize({ ...TEST_CONFIG });

          ctx.expect(container.calls.register).toBe(1);
          ctx.expect(container.calls.getRegistrations).toBe(0);
        },
      });

      cases.push({
        name: 'Service Worker origin gate > should sweep the origin on an http(s) origin when disabled',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook);
          container = instrumentContainer();

          await getOmega().initialize({ ...TEST_CONFIG, serviceWorker: { enabled: false } });

          ctx.expect(container.calls.register).toBe(0);
          ctx.expect(container.calls.getRegistrations).toBe(1);
        },
      });
      return cases;
    })(),

    // #360 — a site served under a URL path (#355) hosts its worker script at
    // /<prefix>/service-worker.js, which can only claim /<prefix>/. The page reads
    // the stamp the build wrote on <html> and hands the value to the worker on the
    // script URL's query string (a worker has no document to read it from).
    ...(() => {
      const cases = [];
      let container;
      let restorePrefix;

      const afterEachHook2 = () => {
        container?.restore();
        restorePrefix?.();
        container = null;
        restorePrefix = null;
      };

      cases.push({
        name: 'Service Worker under a URL-path mount > should register the mounted script at the mounted scope, carrying the prefix',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook2);
          restorePrefix = setPathPrefix('/workkit');
          container = instrumentContainer();

          await getOmega().initialize({ ...TEST_CONFIG });

          ctx.expect(container.registered).toEqual([{
            url: '/workkit/service-worker.js?omega-path-prefix=%2Fworkkit',
            options: { scope: '/workkit/', updateViaCache: 'none' },
          }]);
        },
      });

      cases.push({
        name: 'Service Worker under a URL-path mount > should mount an explicitly configured script path too',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook2);
          restorePrefix = setPathPrefix('/workkit');
          container = instrumentContainer();

          await getOmega().initialize({
            ...TEST_CONFIG,
            serviceWorker: { enabled: true, config: { path: '/sw.js' } },
          });

          ctx.expect(container.registered[0].url).toBe('/workkit/sw.js?omega-path-prefix=%2Fworkkit');
          ctx.expect(container.registered[0].options.scope).toBe('/workkit/');
        },
      });

      cases.push({
        name: 'Service Worker under a URL-path mount > should leave the unprefixed default byte-identical',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook2);
          container = instrumentContainer();

          await getOmega().initialize({ ...TEST_CONFIG });

          ctx.expect(container.registered).toEqual([{
            url: '/service-worker.js',
            options: { scope: '/', updateViaCache: 'none' },
          }]);
        },
      });
      return cases;
    })(),

    // #817: the worker payload's `environment` is read through the ONE
    // environment surface, the same module every OMEGA target answers from, never
    // off `config.environment` by hand: an artifact that baked no environment fails
    // the registration by name instead of handing the worker `undefined`.
    ...(() => {
      const cases = [];
      let container;

      const afterEachHook3 = () => {
        container?.restore();
        container = null;
      };

      cases.push({
        name: 'Service Worker environment fact > should fail registration by name when the artifact baked no environment',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook3);
          const omega = getOmega();
          const { environment, ...withoutEnvironment } = TEST_CONFIG;

          // Registered by hand, off a boot whose own SW branch is disabled, so the
          // rejection under test is this call's and not the boot's.
          await omega.initialize({ ...withoutEnvironment, serviceWorker: { enabled: false } });
          container = instrumentContainer();

          await ctx.expect((() => omega.serviceWorker.register({}))()).rejects.toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(container.calls.register, 'nothing was registered on a broken artifact').toBe(0);
        },
      });
      return cases;
    })(),
  ],
});
