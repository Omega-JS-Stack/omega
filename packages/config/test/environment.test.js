// Unit tests for src/environment.js, the ONE environment module
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)).
//
// The contract under test is the whole point of the issue: ONE input
// (`OMEGA_ENVIRONMENT` on Node, the baked `config.environment` in a browser
// context), no per-surface default, no sniffing, and a missing or unknown
// input is a loud error that NAMES the variable. The three is*() checks derive
// from getEnvironment(), so they can never disagree with it, and exactly one is
// true in every lane.

const defineCases = require('@omega.js/devkit/test/define-cases');

const {
  ENV_ENVIRONMENTS,
  ENVIRONMENT_VAR,
  getEnvironment,
  isDevelopment,
  isProduction,
  isTesting,
  setEnvironment,
  buildLaneEnvironment,
} = require('../src/environment.js');

// Run a thunk with OMEGA_ENVIRONMENT set to exactly `value` (absent when
// undefined), restoring the real one afterwards. It is the ONLY input on Node,
// so this is the whole raw-signal surface.
function withVar(value, fn) {
  const saved = process.env[ENVIRONMENT_VAR];
  try {
    if (value === undefined) delete process.env[ENVIRONMENT_VAR];
    else process.env[ENVIRONMENT_VAR] = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env[ENVIRONMENT_VAR];
    else process.env[ENVIRONMENT_VAR] = saved;
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'environment',
  tests: [
    {
      name: 'the vocabulary is the three names, and the variable is named once',
      run: (ctx) => {
        ctx.expect(ENV_ENVIRONMENTS).toEqual(['development', 'testing', 'production']);
        ctx.expect(ENVIRONMENT_VAR).toBe('OMEGA_ENVIRONMENT');
      },
    },

    {
      name: 'getEnvironment(): each of the three names, and exactly one is*() true in each',
      run: (ctx) => {
        for (const name of ENV_ENVIRONMENTS) {
          withVar(name, () => {
            ctx.expect(getEnvironment()).toBe(name);
            ctx.expect(isDevelopment(), `isDevelopment for ${name}`).toBe(name === 'development');
            ctx.expect(isTesting(), `isTesting for ${name}`).toBe(name === 'testing');
            ctx.expect(isProduction(), `isProduction for ${name}`).toBe(name === 'production');

            const trueCount = [isDevelopment(), isTesting(), isProduction()].filter(Boolean).length;
            ctx.expect(trueCount, `exactly one is*() true for ${name}`).toBe(1);
          });
        }
      },
    },

    {
      name: 'isProduction() is a real positive check, never !isDevelopment()',
      run: (ctx) => {
        withVar('testing', () => {
          ctx.expect(isDevelopment()).toBe(false);
          ctx.expect(isProduction()).toBe(false);
          ctx.expect(isTesting()).toBe(true);
        });
      },
    },

    {
      name: 'a missing input is a loud error naming OMEGA_ENVIRONMENT',
      run: (ctx) => {
        withVar(undefined, () => {
          ctx.expect(() => getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(() => isDevelopment()).toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(() => isProduction()).toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(() => isTesting()).toThrow(/OMEGA_ENVIRONMENT/);
        });
      },
    },

    {
      name: 'an unknown name is a loud error naming OMEGA_ENVIRONMENT and the value',
      run: (ctx) => {
        withVar('staging', () => {
          ctx.expect(() => getEnvironment()).toThrow((error) => {
            ctx.expect(error.message).toMatch(/OMEGA_ENVIRONMENT/);
            ctx.expect(error.message).toMatch(/staging/);
            return true;
          });
        });
        withVar('', () => ctx.expect(() => getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/));
      },
    },

    {
      name: 'a browser context reads the baked config.environment, and the variable wins when both exist',
      run: (ctx) => {
        const baked = { config: { environment: 'production' } };

        withVar(undefined, () => {
          ctx.expect(getEnvironment.call(baked)).toBe('production');
          ctx.expect(isProduction.call(baked)).toBe(true);
        });

        // Node's own input is the answer wherever it exists: a lane that named one
        // is never overruled by an artifact's record of what it was BUILT as.
        withVar('testing', () => {
          ctx.expect(getEnvironment.call(baked)).toBe('testing');
        });

        // A context carrying an unknown word is the same loud error.
        withVar(undefined, () => {
          ctx.expect(() => getEnvironment.call({ config: { environment: 'staging' } })).toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(() => getEnvironment.call({ config: {} })).toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(() => getEnvironment.call({})).toThrow(/OMEGA_ENVIRONMENT/);
        });
      },
    },

    {
      name: 'setEnvironment(): the one writer, it validates, sets the variable and returns it',
      run: (ctx) => {
        withVar(undefined, () => {
          ctx.expect(setEnvironment('development')).toBe('development');
          ctx.expect(process.env[ENVIRONMENT_VAR]).toBe('development');
          ctx.expect(getEnvironment()).toBe('development');

          ctx.expect(setEnvironment('production')).toBe('production');
          ctx.expect(getEnvironment()).toBe('production');

          // A fourth word never reaches the variable.
          ctx.expect(() => setEnvironment('staging')).toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(() => setEnvironment(undefined)).toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(process.env[ENVIRONMENT_VAR], 'the refused value never landed').toBe('production');
        });
      },
    },

    // The rule the desktop and extension BUILD lanes name at load, which each of
    // them carried as its own copy of the same expression.
    {
      name: 'buildLaneEnvironment(): build mode wins, else the inherited word, else development',
      run: (ctx) => {
        withVar(undefined, () => {
          // 1. The build-mode flag is the lane saying it produces a PRODUCTION
          // artifact, and it beats anything inherited: a production build spawned
          // from a test run still bakes production.
          ctx.expect(buildLaneEnvironment(true)).toBe('production');
        });

        withVar('testing', () => {
          ctx.expect(buildLaneEnvironment(true), 'the flag wins over an inherited word').toBe('production');

          // 2. Otherwise a lane that already named one keeps it (the test runners
          // spawn their children with `testing`).
          ctx.expect(buildLaneEnvironment(false)).toBe('testing');
        });

        // 3. And a bare dev boot is development, never a guessed production.
        withVar(undefined, () => {
          ctx.expect(buildLaneEnvironment(false)).toBe('development');
        });
      },
    },

    {
      name: 'no mixin: every framework calls the functions directly, so nothing attaches them to a class',
      run: (ctx) => {
        ctx.expect(require('../src/environment.js').attachTo).toBe(undefined);
        ctx.expect(require('../src/index.js').attachEnvironment).toBe(undefined);
      },
    },
  ],
});
