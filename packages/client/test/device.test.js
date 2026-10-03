const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'device',
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
        name: 'Device Module > should expose expected methods',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const device = getOmega().device;
          ctx.expect(typeof device.getUsageDuration === 'function').toBeTruthy();
          ctx.expect(typeof device.getSessionDuration === 'function').toBeTruthy();
          ctx.expect(typeof device.getInstalledDate === 'function').toBeTruthy();
          ctx.expect(typeof device.getSessionCount === 'function').toBeTruthy();
          ctx.expect(typeof device.getBindingData === 'function').toBeTruthy();
          ctx.expect(typeof device.reset === 'function').toBeTruthy();
        },
      });

      cases.push({
        name: 'Device Module > should return positive usage duration',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const ms = getOmega().device.getUsageDuration('milliseconds');
          ctx.expect(ms >= 0).toBeTruthy();
        },
      });

      cases.push({
        name: 'Device Module > should return duration in different units',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const ms = getOmega().device.getUsageDuration('milliseconds');
          const sec = getOmega().device.getUsageDuration('seconds');
          ctx.expect(ms >= sec).toBeTruthy();
        },
      });

      cases.push({
        name: 'Device Module > should return session count >= 1',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(getOmega().device.getSessionCount() >= 1).toBeTruthy();
        },
      });

      cases.push({
        name: 'Device Module > should return installed date as Date object',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const date = getOmega().device.getInstalledDate();
          ctx.expect(date instanceof Date).toBeTruthy();
        },
      });

      cases.push({
        name: 'Device Module > should return binding data with expected structure',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const data = getOmega().device.getBindingData();
          ctx.expect(typeof data.installed === 'number').toBeTruthy();
          ctx.expect(typeof data.session.count === 'number').toBeTruthy();
          ctx.expect(typeof data.duration.total.seconds === 'number').toBeTruthy();
          ctx.expect(typeof data.duration.session.seconds === 'number').toBeTruthy();
          ctx.expect(typeof data.version.isNew === 'boolean').toBeTruthy();
        },
      });

      cases.push({
        name: 'Device Module > should reset usage data',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const device = getOmega().device;
          await device.reset();
          ctx.expect(device.getSessionCount()).toBe(1);
          ctx.expect(device.isNewVersion).toBe(false);
        },
      });
      return cases;
    })(),

    ...(() => {
      const cases = [];
      let priorLocalStorage;

      let beforeHook2Run;
      const beforeHook2 = (ctx) => (beforeHook2Run ||= Promise.resolve().then(() => (async () => {
        await getOmega().initialize(TEST_CONFIG);
      })()));

      // Earlier suite files remove/replace global.localStorage — install a
      // known-good one for this test (device.js reads the bare identifier)
      // and restore whatever was there afterwards.
      const beforeEachHook2 = () => {
        priorLocalStorage = global.localStorage;
        const store = {};
        global.localStorage = {
          getItem: (key) => (key in store ? store[key] : null),
          setItem: (key, value) => { store[key] = String(value); },
          removeItem: (key) => { delete store[key]; },
          clear: () => { Object.keys(store).forEach((key) => delete store[key]); },
        };
      };

      const afterEachHook = () => {
        global.localStorage = priorLocalStorage;
      };

      cases.push({
        name: 'Device Module — malformed stored data (wave-4 F6) > should survive a stored entry missing the session branch',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          // Raw JSON.parse output is unvalidated external state — an entry with a
          // stale lastActive and NO session key must not break initialize().
          global.localStorage.setItem('omega_device', JSON.stringify({
            installed: 1,
            lastActive: 1,
          }));

          const DeviceModule = (await import('../src/modules/device.js')).default;
          const device = new DeviceModule(getOmega());
          const data = await device.initialize();

          // installed: 1 proves the stored entry was actually read (a fresh
          // first-time payload would stamp installed with the current time)
          ctx.expect(data.installed).toBe(1);
          ctx.expect(data.session.count).toBe(1);
          ctx.expect(typeof data.session.started === 'number').toBeTruthy();
        },
      });
      return cases;
    })(),

    ...(() => {
      const cases = [];
      let priorLocalStorage;

      let beforeHook3Run;
      const beforeHook3 = (ctx) => (beforeHook3Run ||= Promise.resolve().then(() => (async () => {
        await getOmega().initialize(TEST_CONFIG);
      })()));

      const beforeEachHook3 = () => {
        priorLocalStorage = global.localStorage;
        const store = {};
        global.localStorage = {
          getItem: (key) => (key in store ? store[key] : null),
          setItem: (key, value) => { store[key] = String(value); },
          removeItem: (key) => { delete store[key]; },
          clear: () => { Object.keys(store).forEach((key) => delete store[key]); },
        };
      };

      const afterEachHook2 = () => {
        global.localStorage = priorLocalStorage;
      };

      cases.push({
        name: 'Device Module — primitive stored data (wave-4 B3) > should treat a stored primitive as first-time data, not break boot',
        run: async (ctx) => {
          await beforeHook3(ctx);
          await beforeEachHook();
          beforeEachHook3();
          ctx.after(afterEachHook2);
          global.localStorage.setItem('omega_device', JSON.stringify(5));

          const DeviceModule = (await import('../src/modules/device.js')).default;
          const device = new DeviceModule(getOmega());
          const data = await device.initialize();

          ctx.expect(data.session.count).toBe(1);
          ctx.expect(typeof data.installed === 'number').toBeTruthy();
        },
      });
      return cases;
    })(),
  ],
});
