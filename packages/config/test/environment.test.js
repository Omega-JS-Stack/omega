// Unit tests for src/environment.js, the ONE environment module
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)).
//
// The contract under test is the whole point of the issue: ONE input
// (`OMEGA_ENVIRONMENT` on Node, the baked `config.environment` in a browser
// context), no per-surface default, no sniffing, and a missing or unknown
// input is a loud error that NAMES the variable. The three is*() checks derive
// from getEnvironment(), so they can never disagree with it, and exactly one is
// true in every lane.

const { test } = require('node:test');
const assert = require('node:assert/strict');

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

test('the vocabulary is the three names, and the variable is named once', () => {
  assert.deepStrictEqual(ENV_ENVIRONMENTS, ['development', 'testing', 'production']);
  assert.strictEqual(ENVIRONMENT_VAR, 'OMEGA_ENVIRONMENT');
});

test('getEnvironment(): each of the three names, and exactly one is*() true in each', () => {
  for (const name of ENV_ENVIRONMENTS) {
    withVar(name, () => {
      assert.strictEqual(getEnvironment(), name);
      assert.strictEqual(isDevelopment(), name === 'development', `isDevelopment for ${name}`);
      assert.strictEqual(isTesting(), name === 'testing', `isTesting for ${name}`);
      assert.strictEqual(isProduction(), name === 'production', `isProduction for ${name}`);

      const trueCount = [isDevelopment(), isTesting(), isProduction()].filter(Boolean).length;
      assert.strictEqual(trueCount, 1, `exactly one is*() true for ${name}`);
    });
  }
});

test('isProduction() is a real positive check, never !isDevelopment()', () => {
  withVar('testing', () => {
    assert.strictEqual(isDevelopment(), false);
    assert.strictEqual(isProduction(), false);
    assert.strictEqual(isTesting(), true);
  });
});

test('a missing input is a loud error naming OMEGA_ENVIRONMENT', () => {
  withVar(undefined, () => {
    assert.throws(() => getEnvironment(), /OMEGA_ENVIRONMENT/);
    assert.throws(() => isDevelopment(), /OMEGA_ENVIRONMENT/);
    assert.throws(() => isProduction(), /OMEGA_ENVIRONMENT/);
    assert.throws(() => isTesting(), /OMEGA_ENVIRONMENT/);
  });
});

test('an unknown name is a loud error naming OMEGA_ENVIRONMENT and the value', () => {
  withVar('staging', () => {
    assert.throws(() => getEnvironment(), (error) => {
      assert.match(error.message, /OMEGA_ENVIRONMENT/);
      assert.match(error.message, /staging/);
      return true;
    });
  });
  withVar('', () => assert.throws(() => getEnvironment(), /OMEGA_ENVIRONMENT/));
});

test('a browser context reads the baked config.environment, and the variable wins when both exist', () => {
  const baked = { config: { environment: 'production' } };

  withVar(undefined, () => {
    assert.strictEqual(getEnvironment.call(baked), 'production');
    assert.strictEqual(isProduction.call(baked), true);
  });

  // Node's own input is the answer wherever it exists: a lane that named one
  // is never overruled by an artifact's record of what it was BUILT as.
  withVar('testing', () => {
    assert.strictEqual(getEnvironment.call(baked), 'testing');
  });

  // A context carrying an unknown word is the same loud error.
  withVar(undefined, () => {
    assert.throws(() => getEnvironment.call({ config: { environment: 'staging' } }), /OMEGA_ENVIRONMENT/);
    assert.throws(() => getEnvironment.call({ config: {} }), /OMEGA_ENVIRONMENT/);
    assert.throws(() => getEnvironment.call({}), /OMEGA_ENVIRONMENT/);
  });
});

test('setEnvironment(): the one writer, it validates, sets the variable and returns it', () => {
  withVar(undefined, () => {
    assert.strictEqual(setEnvironment('development'), 'development');
    assert.strictEqual(process.env[ENVIRONMENT_VAR], 'development');
    assert.strictEqual(getEnvironment(), 'development');

    assert.strictEqual(setEnvironment('production'), 'production');
    assert.strictEqual(getEnvironment(), 'production');

    // A fourth word never reaches the variable.
    assert.throws(() => setEnvironment('staging'), /OMEGA_ENVIRONMENT/);
    assert.throws(() => setEnvironment(undefined), /OMEGA_ENVIRONMENT/);
    assert.strictEqual(process.env[ENVIRONMENT_VAR], 'production', 'the refused value never landed');
  });
});

// The rule the desktop and extension BUILD lanes name at load, which each of
// them carried as its own copy of the same expression.
test('buildLaneEnvironment(): build mode wins, else the inherited word, else development', () => {
  withVar(undefined, () => {
    // 1. The build-mode flag is the lane saying it produces a PRODUCTION
    // artifact, and it beats anything inherited: a production build spawned
    // from a test run still bakes production.
    assert.strictEqual(buildLaneEnvironment(true), 'production');
  });

  withVar('testing', () => {
    assert.strictEqual(buildLaneEnvironment(true), 'production', 'the flag wins over an inherited word');

    // 2. Otherwise a lane that already named one keeps it (the test runners
    // spawn their children with `testing`).
    assert.strictEqual(buildLaneEnvironment(false), 'testing');
  });

  // 3. And a bare dev boot is development, never a guessed production.
  withVar(undefined, () => {
    assert.strictEqual(buildLaneEnvironment(false), 'development');
  });
});

test('no mixin: every framework calls the functions directly, so nothing attaches them to a class', () => {
  assert.strictEqual(require('../src/environment.js').attachTo, undefined);
  assert.strictEqual(require('../src/index.js').attachEnvironment, undefined);
});
