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
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'environment',
  tests: [
    {
      name: 'getEnvironment(): the three lanes, and exactly one is*() true in each',
      run: (ctx) => {
        ctx.expect(lane('development')).toEqual({ environment: 'development', development: true, production: false, testing: false });
        ctx.expect(lane('production')).toEqual({ environment: 'production', development: false, production: true, testing: false });
        ctx.expect(lane('testing')).toEqual({ environment: 'testing', development: false, production: false, testing: true });
      },
    },

    {
      name: 'an unset or unknown input is a loud error naming the variable, never a default',
      run: (ctx) => {
        ctx.expect(() => lane(undefined)).toThrow(/OMEGA_ENVIRONMENT/);
        ctx.expect(() => lane('staging')).toThrow(/OMEGA_ENVIRONMENT/);
      },
    },

    {
      name: 'the four calls are on the package export',
      run: (ctx) => {
        for (const name of CALLS) {
          ctx.expect(typeof web[name], `@omega.js/web exports ${name}()`).toBe('function');
        }
      },
    },

    // The cross-package pin (#717, one implementation since #817): one capability,
    // one call form on every surface, and now ONE module behind all of them. Web
    // and the backend reach it directly; desktop and extension re-export it from
    // their mode-helpers module, so those are pinned to the identical function
    // objects rather than to a lookalike copy.
    {
      name: 'parity: all four frameworks answer with the ONE environment module',
      run: (ctx) => {
        const shared = require('@omega.js/config/environment');

        for (const [framework, file] of Object.entries({
          desktop: path.join(ROOT, 'packages', 'desktop', 'src', 'utils', 'mode-helpers.js'),
          extension: path.join(ROOT, 'packages', 'extension', 'src', 'utils', 'mode-helpers.js'),
        })) {
          const exported = require(file);
          for (const name of CALLS) {
            ctx.expect(exported[name], `@omega.js/${framework} re-exports the shared ${name}(), not a copy`).toBe(shared[name]);
          }
        }

        for (const name of CALLS) {
          ctx.expect(web[name], `@omega.js/web re-exports the shared ${name}()`).toBe(shared[name]);
        }

        // The backend's Omega class forwards each to the shared module; it cannot be
        // instantiated without firebase-admin and a resolved project, so that surface
        // is pinned at its definition site.
        const backend = fs.readFileSync(path.join(ROOT, 'packages', 'backend', 'src', 'omega', 'index.js'), 'utf8');
        for (const name of CALLS) {
          ctx.expect(backend, `@omega.js/backend's Omega forwards ${name}() to the shared module`).toMatch(new RegExp(`\\n  ${name}\\(\\) \\{\\n    return environment\\.${name}\\(\\);`));
        }
      },
    },

    // Nothing carries a second copy of the resolution any more (#817): the four
    // framework mode-helpers files held the same four functions with four
    // different defaults, which is exactly how a desktop dev boot baked itself as
    // production. Web's copy is gone outright.
    {
      name: 'web carries no environment copy of its own',
      run: (ctx) => {
        ctx.expect(fs.existsSync(path.join(PKG, 'src', 'mode-helpers.js')), 'src/mode-helpers.js is gone').toBe(false);
      },
    },
  ],
});
