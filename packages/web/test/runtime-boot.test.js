/**
 * The boot runtime's LAYOUT door, `bootLayout(namespace)` in runtime/boot.js.
 *
 * A layout bundle hands over the module's whole namespace, because a layout's
 * default export is optional: chrome that must act before the client is ready
 * runs at import time and exports nothing. So the door has two promises: a
 * default runs through the page handshake, and a namespace without one is a
 * quiet no-op, never an error on every page that wears the layout.
 *
 * The REAL boot runtime through esbuild, with the web instance and the icon
 * resolver stubbed at their imports, since neither exists off a page.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const PKG = path.join(__dirname, '..');
const CORE_DIR = path.join(PKG, 'core');
const BOOT = path.join(PKG, 'runtime', 'boot.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runtime-boot-'));
const BUNDLE = path.join(BUNDLE_DIR, 'boot.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [BOOT],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    logLevel: 'silent',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^\.\/omega\.js$/ }, () => ({ path: 'omega', namespace: 'runtime-stub' }));
        build.onResolve({ filter: /^\.\/icons\.js$/ }, () => ({ path: 'icons', namespace: 'runtime-stub' }));
        build.onLoad({ filter: /^omega$/, namespace: 'runtime-stub' }, () => {
          return { contents: 'export default globalThis.__webRuntime;' };
        });
        build.onLoad({ filter: /^icons$/, namespace: 'runtime-stub' }, () => {
          return { contents: 'export function createIconResolver() { return () => null; }' };
        });
      },
    }],
  });

  return building;
}

/**
 * A fresh boot runtime on a page at /pricing, with a web instance that records
 * its own initialize, and every console.error the boot wrote.
 *
 * @returns {Promise<object>} { boot, omega, order, errors, restore }
 */
async function freshBoot() {
  await bundleOnce();

  const order = [];
  const errors = [];
  const omega = {
    initialize: async () => { order.push('initialize'); },
    icons: { start: () => {} },
    isDevelopment: () => false,
  };

  globalThis.__webRuntime = omega;
  globalThis.document = { documentElement: { dataset: { pagePath: '/pricing' } } };
  globalThis.window = { OMEGA_BUILD_JSON: { config: {} } };

  const realError = console.error;
  console.error = (...args) => errors.push(args);

  delete require.cache[require.resolve(BUNDLE)];

  return { boot: require(BUNDLE), omega, order, errors, restore: () => { console.error = realError; } };
}

module.exports = defineCases({
  type: 'group',
  description: 'runtime-boot',
  tests: [
    {
      name: 'bootLayout: a namespace with a default runs it through the page handshake',
      run: async (ctx) => {
        const { boot, omega, order, errors, restore } = await freshBoot();
        const received = [];

        try {
          await boot.bootLayout({
            default: (context) => {
              order.push('layout');
              received.push(context);
            },
          });
        } finally {
          restore();
        }

        ctx.expect(order, 'the layout runs once, after the runtime is initialized').toEqual(['initialize', 'layout']);
        ctx.expect(received[0].omega, 'with the one web instance').toBe(omega);
        ctx.expect(received[0].options.paths.pagePath, 'and the page context bootPage hands every module').toBe('/pricing');
        ctx.expect(errors, 'nothing went wrong on the way').toEqual([]);
      },
    },

    {
      name: 'bootLayout: a namespace without a default is a no-op',
      run: async (ctx) => {
        const { boot, errors, restore } = await freshBoot();
        const called = [];
        let answer;

        try {
          answer = await boot.bootLayout({ hop: () => called.push('hop') });
        } finally {
          restore();
        }

        ctx.expect(answer, 'it resolves with nothing').toBe(undefined);
        ctx.expect(called, 'a named export is never mistaken for the entry').toEqual([]);
        ctx.expect(errors, 'and no page logs a module error for a layout that exports none').toEqual([]);
      },
    },
  ],
});
