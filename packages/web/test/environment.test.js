/**
 * The environment surface (#717), answered by the ONE module since
 * [#817](https://github.com/Omega-JS-Stack/omega/issues/817):
 * `getEnvironment()` + `isDevelopment()` / `isProduction()` / `isTesting()`,
 * re-exported from the package and called directly, never mixed into a class.
 *
 * Web is a pure Node target, so its input is the one input: the
 * `OMEGA_ENVIRONMENT` variable its verbs set (`omega build` names production,
 * `omega dev` names development). Nothing here sniffs, and nothing defaults.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const helpers = require('@omega.js/config/environment');
const web = require('../src/index.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');

const CALLS = ['getEnvironment', 'isDevelopment', 'isProduction', 'isTesting'];

/**
 * Resolve the surface with OMEGA_ENVIRONMENT set to exactly `value` (absent
 * when undefined). Restores the real one afterwards.
 * @param {string|undefined} value - the one input
 * @returns {{ environment: string, development: boolean, production: boolean, testing: boolean }}
 */
function lane(value) {
  const saved = process.env.OMEGA_ENVIRONMENT;
  if (value === undefined) delete process.env.OMEGA_ENVIRONMENT;
  else process.env.OMEGA_ENVIRONMENT = value;
  try {
    return {
      environment: helpers.getEnvironment(),
      development: helpers.isDevelopment(),
      production: helpers.isProduction(),
      testing: helpers.isTesting(),
    };
  } finally {
    if (saved === undefined) delete process.env.OMEGA_ENVIRONMENT;
    else process.env.OMEGA_ENVIRONMENT = saved;
  }
}

test('getEnvironment(): the three lanes, and exactly one is*() true in each', () => {
  assert.deepStrictEqual(lane('development'), { environment: 'development', development: true, production: false, testing: false });
  assert.deepStrictEqual(lane('production'), { environment: 'production', development: false, production: true, testing: false });
  assert.deepStrictEqual(lane('testing'), { environment: 'testing', development: false, production: false, testing: true });
});

test('an unset or unknown input is a loud error naming the variable, never a default', () => {
  assert.throws(() => lane(undefined), /OMEGA_ENVIRONMENT/);
  assert.throws(() => lane('staging'), /OMEGA_ENVIRONMENT/);
});

test('the four calls are on the package export', () => {
  for (const name of CALLS) {
    assert.strictEqual(typeof web[name], 'function', `@omega.js/web exports ${name}()`);
  }
});

// The cross-package pin (#717, one implementation since #817): one capability,
// one call form on every surface, and now ONE module behind all of them. Web
// and the backend reach it directly; desktop and extension re-export it from
// their mode-helpers module, so those are pinned to the identical function
// objects rather than to a lookalike copy.
test('parity: all four frameworks answer with the ONE environment module', () => {
  const shared = require('@omega.js/config/environment');

  for (const [framework, file] of Object.entries({
    desktop: path.join(ROOT, 'packages', 'desktop', 'src', 'utils', 'mode-helpers.js'),
    extension: path.join(ROOT, 'packages', 'extension', 'src', 'utils', 'mode-helpers.js'),
  })) {
    const exported = require(file);
    for (const name of CALLS) {
      assert.strictEqual(exported[name], shared[name], `@omega.js/${framework} re-exports the shared ${name}(), not a copy`);
    }
  }

  for (const name of CALLS) {
    assert.strictEqual(web[name], shared[name], `@omega.js/web re-exports the shared ${name}()`);
  }

  // The backend's Omega class forwards each to the shared module; it cannot be
  // instantiated without firebase-admin and a resolved project, so that surface
  // is pinned at its definition site.
  const backend = fs.readFileSync(path.join(ROOT, 'packages', 'backend', 'src', 'omega', 'index.js'), 'utf8');
  for (const name of CALLS) {
    assert.match(backend, new RegExp(`\\n  ${name}\\(\\) \\{\\n    return environment\\.${name}\\(\\);`), `@omega.js/backend's Omega forwards ${name}() to the shared module`);
  }
});

// Nothing carries a second copy of the resolution any more (#817): the four
// framework mode-helpers files held the same four functions with four
// different defaults, which is exactly how a desktop dev boot baked itself as
// production. Web's copy is gone outright.
test('web carries no environment copy of its own', () => {
  assert.strictEqual(fs.existsSync(path.join(PKG, 'src', 'mode-helpers.js')), false, 'src/mode-helpers.js is gone');
});
