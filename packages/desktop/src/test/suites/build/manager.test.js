// Build-time tests for the Manager class (build.js).

const Manager = require('../../../build.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

// The one input and the two lane flags that decide it, saved and restored
// around every case that touches them (#817).
const LANE_KEYS = ['OMEGA_ENVIRONMENT', 'OMEGA_BUILD_MODE', 'OMEGA_TEST_MODE', 'NODE_ENV'];

/**
 * Run `fn` with exactly `vars` set on the lane keys (null clears them all).
 * @param {object|null} vars - the lane env for this case.
 * @param {function} fn - the body.
 * @returns {*} whatever `fn` returns.
 */
function withEnvironment(vars, fn) {
  const saved = {};
  for (const key of LANE_KEYS) saved[key] = process.env[key];
  try {
    for (const key of LANE_KEYS) delete process.env[key];
    Object.assign(process.env, vars || {});
    return fn();
  } finally {
    for (const key of LANE_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/**
 * What src/build.js resolves at LOAD for a given lane. build.js sets the input
 * once, at require time, so this loads a fresh copy of it per lane.
 * @param {object} vars - the lane env.
 * @returns {string} the resolved environment.
 */
function laneEnvironment(vars) {
  const buildPath = require.resolve('../../../build.js');
  return withEnvironment(vars, () => {
    const saved = require.cache[buildPath];
    delete require.cache[buildPath];
    try {
      return require(buildPath).getEnvironment();
    } finally {
      if (saved) require.cache[buildPath] = saved;
      else delete require.cache[buildPath];
    }
  });
}

module.exports = defineCases({
  type: 'group', // independent tests; run all even on failure
  layer: 'build',
  description: 'Manager (build.js)',
  tests: [
    {
      name: 'class is exported and instantiable',
      run: (ctx) => {
        ctx.expect(typeof Manager).toBe('function');
        ctx.expect(new Manager()).toBeInstanceOf(Manager);
      },
    },
    {
      name: 'getMode returns the mode shape',
      run: (ctx) => {
        const mode = Manager.getMode();
        ctx.expect(mode).toHaveProperty('build');
        ctx.expect(mode).toHaveProperty('publish');
        ctx.expect(mode).toHaveProperty('server');
        ctx.expect(mode).toHaveProperty('environment');
        ctx.expect(['development', 'testing', 'production']).toContain(mode.environment);
      },
    },
    {
      // The environment reads ONE input, `OMEGA_ENVIRONMENT`
      // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)), and the
      // lane that boots or builds this app sets it (src/build.js does, at load).
      // Nothing sniffs NODE_ENV, app.isPackaged or OMEGA_TEST_MODE any more.
      name: 'getEnvironment answers the one input, for each of the three names',
      run: (ctx) => {
        withEnvironment(null, () => {
          for (const name of ['development', 'testing', 'production']) {
            process.env.OMEGA_ENVIRONMENT = name;
            ctx.expect(Manager.getEnvironment()).toBe(name);
          }
        });
      },
    },
    {
      // The bug this replaced: with no signal desktop's own copy answered
      // 'production', so a plain `npm start` bundled itself as a production
      // artifact, while @omega.js/extension's copy of the same function
      // answered 'development' from the same inputs (#817).
      name: 'the build lane resolves production, a dev boot resolves development',
      run: (ctx) => {
        const buildLane = laneEnvironment({ OMEGA_BUILD_MODE: 'true' });
        ctx.expect(buildLane).toBe('production');

        const devBoot = laneEnvironment({});
        ctx.expect(devBoot).toBe('development');

        // A lane that already named one keeps it, EXCEPT a build lane: a
        // production build spawned from a test run still bakes production.
        ctx.expect(laneEnvironment({ OMEGA_ENVIRONMENT: 'testing' })).toBe('testing');
        ctx.expect(laneEnvironment({ OMEGA_ENVIRONMENT: 'testing', OMEGA_BUILD_MODE: 'true' })).toBe('production');
      },
    },
    {
      name: 'no input at all is a loud error naming OMEGA_ENVIRONMENT, never a default',
      run: (ctx) => {
        withEnvironment(null, () => {
          delete process.env.OMEGA_ENVIRONMENT;
          ctx.expect(() => Manager.getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
          process.env.OMEGA_ENVIRONMENT = 'staging';
          ctx.expect(() => Manager.getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
        });
      },
    },
    {
      // The core invariant: is*() DERIVE from getEnvironment(), so they can
      // NEVER disagree with it, and exactly one is always true.
      name: 'invariant: is*() exactly matches getEnvironment() + mutually exclusive (every scenario)',
      run: (ctx) => {
        withEnvironment(null, () => {
          for (const name of ['development', 'testing', 'production']) {
            process.env.OMEGA_ENVIRONMENT = name;
            const e = Manager.getEnvironment();
            ctx.expect(e).toBe(name);
            ctx.expect(Manager.isDevelopment()).toBe(e === 'development');
            ctx.expect(Manager.isTesting()).toBe(e === 'testing');
            ctx.expect(Manager.isProduction()).toBe(e === 'production');
            const trueCount = [Manager.isDevelopment(), Manager.isTesting(), Manager.isProduction()].filter(Boolean).length;
            ctx.expect(trueCount).toBe(1);
          }
        });
      },
    },
    {
      name: 'getPackage("main") resolves to @omega.js/desktop package.json',
      run: (ctx) => {
        const pkg = Manager.getPackage('main');
        ctx.expect(pkg.name).toBe('@omega.js/desktop');
        ctx.expect(pkg).toHaveProperty('version');
        ctx.expect(pkg).toHaveProperty('exports');
      },
    },
    {
      name: 'getRootPath("main") returns a non-empty string',
      run: (ctx) => {
        const root = Manager.getRootPath('main');
        ctx.expect(typeof root).toBe('string');
        ctx.expect(root.length).toBeGreaterThan(0);
      },
    },
    {
      name: 'getLiveReloadPort defaults to 35729',
      run: (ctx) => {
        const prev = process.env.OMEGA_LIVERELOAD_PORT;
        delete process.env.OMEGA_LIVERELOAD_PORT;
        try {
          ctx.expect(Manager.getLiveReloadPort()).toBe(35729);
        } finally {
          if (prev !== undefined) process.env.OMEGA_LIVERELOAD_PORT = prev;
        }
      },
    },
    {
      name: 'getWindowsSignStrategy defaults to self-hosted when no config',
      run: (ctx) => {
        // No EM_WIN_SIGN_STRATEGY env-var support anymore — config is the only source.
        // Run from a cwd with no omega.json5 to confirm the default.
        const fs = require('fs'); const os = require('os'); const path = require('path');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-strategy-'));
        const orig = process.cwd();
        try {
          process.chdir(tmp);
          ctx.expect(Manager.getWindowsSignStrategy()).toBe('self-hosted');
        } finally {
          process.chdir(orig);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getWindowsSignStrategy reads config platforms.windows.signing.strategy',
      run: (ctx) => {
        const fs = require('fs'); const os = require('os'); const path = require('path');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-strategy-'));
        fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'),
          `{ targets: { desktop: { type: 'desktop', platforms: { windows: { signing: { strategy: 'cloud' } } } } } }`);
        const orig = process.cwd();
        try {
          process.chdir(tmp);
          ctx.expect(Manager.getWindowsSignStrategy()).toBe('cloud');
        } finally {
          process.chdir(orig);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'logger returns a named logger',
      run: (ctx) => {
        const m = new Manager();
        const logger = m.logger('test-name');
        ctx.expect(logger.name).toBe('test-name');
        ctx.expect(typeof logger.log).toBe('function');
        ctx.expect(typeof logger.error).toBe('function');
      },
    },
  ],
});
