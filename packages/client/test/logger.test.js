/**
 * logger tests — the client's runtime tag shape ([#12]): every module logs
 * `[@omega.js/client:<module>] message` with NO timestamp (devtools stamps
 * runtime lines; only the build-time devkit logger prefixes [HH:MM:SS]).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'logger',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let createLogger;

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        ({ createLogger } = await import('../src/modules/logger.js'));
      })()));

      // Capture one console[method] call; returns its raw args.
      const captured = {};
      const originals = {};
      const beforeEachHook2 = () => {
        ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
          originals[method] = console[method];
          console[method] = (...args) => { captured[method] = args; };
        });
      };
      const afterEachHook = () => {
        Object.keys(originals).forEach((method) => { console[method] = originals[method]; });
      };

      cases.push({
        name: 'Logger Module > prefixes exactly [@omega.js/client:<module>] with no timestamp',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          createLogger('push').log('Subscribed');
          ctx.expect(captured.log[0]).toBe('[@omega.js/client:push]');
          ctx.expect(captured.log[1]).toBe('Subscribed');
        },
      });

      cases.push({
        name: 'Logger Module > carries sub-module segments verbatim',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          createLogger('push:sync').log('Synced');
          ctx.expect(captured.log[0]).toBe('[@omega.js/client:push:sync]');
        },
      });

      cases.push({
        name: 'Logger Module > exposes log/info/warn/error/debug, each routed to its own console method',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const logger = createLogger('verts');
          ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
            logger[method]('m', { a: 1 });
            ctx.expect(captured[method][0]).toBe('[@omega.js/client:verts]');
            ctx.expect(captured[method][1]).toBe('m');
            ctx.expect(captured[method][2]).toEqual({ a: 1 });
          });
        },
      });

      cases.push({
        name: 'Logger Module > exposes the tag itself',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          ctx.expect(createLogger('device').tag).toBe('[@omega.js/client:device]');
        },
      });
      return cases;
    })(),
  ],
});
