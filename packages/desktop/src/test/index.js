// Public test API — what consumers see.
//
// Test files export a test definition. Three forms:
//
// Standalone:
//   module.exports = {
//     layer: 'build',                  // 'build' | 'main' | 'renderer' | 'boot'
//     description: 'config has brand.id',
//     timeout: 5000,
//     run: async (ctx) => {
//       const cfg = require('../build.js').getConfig();
//       ctx.expect(cfg.brand.id).toBeTruthy();
//     },
//     cleanup: async (ctx) => { ... },
//   };
//
// Boot layer — spawns the consumer's actual built main bundle (dist/main.bundle.js)
// and runs `inspect` against the live omega instance. Replaces shell-level `npm start && sleep && kill`
// smoke tests with deterministic, signal-driven pass/fail. Use this to verify the WHOLE
// integration: consumer scaffolds, brand config, custom integrations, real boot order.
//
//   module.exports = {
//     layer: 'boot',
//     description: 'tray boots with default items',
//     timeout: 15000,
//     inspect: async ({ omega, expect, projectRoot }) => {
//       expect(omega.tray.has('open')).toBe(true);
//       expect(omega.tray.has('check-for-updates')).toBe(true);
//       expect(omega.menu.isRendered()).toBe(true);
//     },
//   };
//
// Suite (sequential, shared state, stop on first failure):
//   module.exports = {
//     type: 'suite',
//     layer: 'main',
//     description: 'storage round-trip',
//     tests: [
//       { name: 'set value', run: async (ctx) => { ctx.state.key = 'foo'; ctx.omega.storage.set('foo', 'bar'); } },
//       { name: 'get value', run: async (ctx) => { ctx.expect(ctx.omega.storage.get('foo')).toBe('bar'); } },
//       { name: 'delete',    run: async (ctx) => { ctx.omega.storage.delete('foo'); } },
//     ],
//   };
//
// Group (sequential, shared state, runs ALL tests even if some fail):
//   module.exports = {
//     type: 'group',
//     layer: 'build',
//     tests: [ ... ],
//   };
//
// Array form (treated as group):
//   module.exports = [ { name, run }, ... ];
//
// The ctx (context) provided to every run/cleanup includes:
//   - ctx.expect       — Jest-compatible assertion library
//   - ctx.state        — shared object across tests in a suite/group
//   - ctx.skip(reason) — throw to skip the current test at runtime
//   - ctx.layer        — current layer name
//   - ctx.omega        : the booted @omega.js/desktop main-process instance (main layer only)
//   - ctx.page         — BrowserWindow page (renderer layer only — added in 2.3c)

module.exports = {
  expect: require('./assert.js'),
};
