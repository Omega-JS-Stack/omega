/**
 * The environment surface (#717): @omega.js/web answers `getEnvironment()` +
 * `isDevelopment()` / `isProduction()` / `isTesting()` in the SAME call form as
 * its three siblings (backend's Manager, desktop's and extension's
 * mode-helpers), attached to web's Manager equivalent — the CLI Main class every
 * bin instantiates. The three environments are mutually exclusive (testing
 * wins), the is*() checks DERIVE from getEnvironment(), and `isProduction()` is
 * a real positive check, never `!isDevelopment()`.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const helpers = require('../src/mode-helpers.js');
const web = require('../src/index.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');

const SIGNALS = ['OMEGA_TEST_MODE', 'OMEGA_BUILD_MODE', 'NODE_ENV'];

/**
 * Resolve the environment with ONLY the given raw signals set (every other
 * signal removed), on the given context — the shape web's build/CLI options
 * objects have. Restores the real env afterwards.
 * @param {object} vars - raw process.env signals for this lane
 * @param {object} [context] - the `this` the surface reads (`{ environment }`)
 * @returns {{ environment: string, development: boolean, production: boolean, testing: boolean }}
 */
function lane(vars, context) {
  const saved = Object.fromEntries(SIGNALS.map((name) => [name, process.env[name]]));
  for (const name of SIGNALS) delete process.env[name];
  Object.assign(process.env, vars);
  try {
    return {
      environment: helpers.getEnvironment.call(context),
      development: helpers.isDevelopment.call(context),
      production: helpers.isProduction.call(context),
      testing: helpers.isTesting.call(context),
    };
  } finally {
    for (const name of SIGNALS) {
      if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    }
  }
}

test('getEnvironment(): the three lanes, and exactly one is*() true in each', () => {
  const development = lane({}, { environment: 'development' });
  assert.deepStrictEqual(development, { environment: 'development', development: true, production: false, testing: false });

  const production = lane({}, { environment: 'production' });
  assert.deepStrictEqual(production, { environment: 'production', development: false, production: true, testing: false });

  const testing = lane({ OMEGA_TEST_MODE: 'true' }, {});
  assert.deepStrictEqual(testing, { environment: 'testing', development: false, production: false, testing: true });
});

test('getEnvironment(): testing wins over every other signal', () => {
  assert.strictEqual(lane({ OMEGA_TEST_MODE: 'true' }, { environment: 'production' }).environment, 'testing');
  assert.strictEqual(lane({ OMEGA_TEST_MODE: 'true', OMEGA_BUILD_MODE: 'true' }, {}).environment, 'testing');
});

test('getEnvironment(): the context override beats the build signals, and a bare context is development', () => {
  // The explicit environment web's verbs already thread (`omega build` →
  // production, `omega dev` → development) is the deliberate answer.
  assert.strictEqual(lane({ NODE_ENV: 'development' }, { environment: 'production' }).environment, 'production');
  assert.strictEqual(lane({ OMEGA_BUILD_MODE: 'true' }, { environment: 'development' }).environment, 'development');

  // Build signals, then the UJM-lineage default: a bare context is tooling.
  assert.strictEqual(lane({ OMEGA_BUILD_MODE: 'true' }, {}).environment, 'production');
  assert.strictEqual(lane({ NODE_ENV: 'production' }, {}).environment, 'production');
  assert.strictEqual(lane({ NODE_ENV: 'development' }, {}).environment, 'development');
  assert.strictEqual(lane({}, {}).environment, 'development');
  assert.strictEqual(lane({}, undefined).environment, 'development');

  // A junk override is not one of the three names — it never resolves to itself.
  assert.strictEqual(lane({}, { environment: 'staging' }).environment, 'development');
});

test('the surface is attached to web CLI Main — statically and on the prototype', () => {
  const Main = require('../src/cli.js');
  for (const name of ['getEnvironment', 'isDevelopment', 'isProduction', 'isTesting']) {
    assert.strictEqual(typeof Main[name], 'function', `Main.${name}() is the static call form`);
    assert.strictEqual(typeof Main.prototype[name], 'function', `Main#${name}() is the instance call form`);
  }
  assert.strictEqual(Main.getEnvironment(), new Main().getEnvironment(), 'both entry points resolve identically');
});

test('the four calls are on the package export', () => {
  for (const name of ['getEnvironment', 'isDevelopment', 'isProduction', 'isTesting']) {
    assert.strictEqual(typeof web[name], 'function', `@omega.js/web exports ${name}()`);
  }
});

// The cross-package pin (#717): one capability, one call form on every surface.
// Web/desktop/extension expose the four from a module; the backend defines them
// on the Manager instance (self.<name> = ...), which cannot be instantiated
// without firebase-admin and a resolved project — so that surface is pinned at
// its assignment site.
test('parity: all four frameworks name the same four environment calls', () => {
  const CALLS = ['getEnvironment', 'isDevelopment', 'isProduction', 'isTesting'];

  const modules = {
    web: path.join(PKG, 'src', 'mode-helpers.js'),
    desktop: path.join(ROOT, 'packages', 'desktop', 'src', 'utils', 'mode-helpers.js'),
    extension: path.join(ROOT, 'packages', 'extension', 'src', 'utils', 'mode-helpers.js'),
  };
  for (const [framework, file] of Object.entries(modules)) {
    const exported = require(file);
    for (const name of CALLS) {
      assert.strictEqual(typeof exported[name], 'function', `@omega.js/${framework} exports ${name}()`);
    }
    assert.strictEqual(typeof exported.attachTo, 'function', `@omega.js/${framework} attaches its surface via attachTo()`);
  }

  const backend = fs.readFileSync(path.join(ROOT, 'packages', 'backend', 'src', 'manager', 'index.js'), 'utf8');
  for (const name of CALLS) {
    assert.match(backend, new RegExp(`self\\.${name}\\s*=`), `@omega.js/backend's Manager defines ${name}()`);
  }
});
