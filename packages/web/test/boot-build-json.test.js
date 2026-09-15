/**
 * The boot runtime initializes @omega.js/client from the page's ONE build
 * snapshot ([#894](https://github.com/Omega-JS-Stack/omega/issues/894)).
 *
 * `runtime/boot.js` used to read `window.Configuration`, the legacy UJM name
 * web alone carried. It reads `window.OMEGA_BUILD_JSON.config` now, the same
 * name and the same `.config` a desktop renderer and every extension context
 * read, and the page bakes it in `core/_includes/core/foot.html` (pinned by
 * config-rekey.test.js).
 *
 * Same convention as the wakeup-ping suite: the REAL module through esbuild
 * behind its bundler aliases, with the client stubbed at its boundary.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const RUNTIME = path.join(__dirname, '..', 'runtime', 'boot.js');
const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-boot-build-json-'));

let bundled = null;

// The boot runtime, bundled once: the client is the stub every assertion reads,
// and the icon watcher is a DOM walker with nothing to say here.
function bundleOnce() {
  if (!bundled) {
    const outfile = path.join(BUNDLE_DIR, 'boot.cjs');

    bundled = esbuild.build({
      entryPoints: [RUNTIME],
      outfile,
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      plugins: [{
        name: 'harness-aliases',
        setup(build) {
          build.onResolve({ filter: /^@omega\.js\/client$/ }, () => ({ path: 'client', namespace: 'omega-client-stub' }));
          build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => ({
            contents: 'export default globalThis.__omegaClient;',
          }));
          // The dev palette is a development-only dynamic import; a run with no
          // bake reads as development, so it is answered rather than left to
          // fail loudly into the log.
          build.onResolve({ filter: /^__main_assets__\// }, () => ({ path: 'dev', namespace: 'omega-dev-stub' }));
          build.onLoad({ filter: /.*/, namespace: 'omega-dev-stub' }, () => ({
            contents: 'export default () => {};',
          }));
          build.onResolve({ filter: /\/icons\.js$/ }, () => ({ path: 'icons', namespace: 'omega-icons-stub' }));
          build.onLoad({ filter: /.*/, namespace: 'omega-icons-stub' }, () => ({
            contents: 'export const createIconWatcher = () => ({ start: () => {} });',
          }));
        },
      }],
    }).then(() => outfile);
  }

  return bundled;
}

/**
 * Boot the real runtime against a page that baked `buildJson`.
 * @param {object|undefined} buildJson - what the page assigned to the global
 * @returns {Promise<object>} the calls the client stub recorded
 */
async function boot(buildJson) {
  const bundle = await bundleOnce();
  const initialized = [];

  globalThis.window = {
    ...(buildJson === undefined ? {} : { OMEGA_BUILD_JSON: buildJson }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = {
    documentElement: { dataset: { pagePath: '/pricing' } },
    addEventListener: () => {},
    querySelectorAll: () => [],
  };
  globalThis.__omegaClient = {
    initialize: async (configuration) => { initialized.push(configuration); },
    isDevelopment: () => false,
  };

  delete require.cache[require.resolve(bundle)];
  const runtime = require(bundle);
  await runtime.bootMain(() => {});

  return { initialized };
}

test('#894: bootMain hands @omega.js/client the page\'s OMEGA_BUILD_JSON.config', async () => {
  const config = {
    runtime: 'web',
    environment: 'production',
    brand: { id: 'boot', name: 'Boot' },
    client: { consent: { enabled: true } },
  };
  const { initialized } = await boot({ config, package: { name: 'boot', version: '1.0.0' }, mode: { environment: 'production' } });

  assert.strictEqual(initialized.length, 1, 'the singleton is initialized exactly once');
  // The `config` blob and nothing around it: the wrapper's own facts (package,
  // mode, license, builtAt) are never part of the client contract.
  assert.deepStrictEqual(initialized[0], config);
});

test('#894: a page with no bake initializes with undefined, never a crash', async () => {
  // A minimal fixture page (no foot include) still boots: the client fills its
  // own defaults, and a TypeError here would take every page module with it.
  const { initialized } = await boot(undefined);

  assert.deepStrictEqual(initialized, [undefined]);
});
