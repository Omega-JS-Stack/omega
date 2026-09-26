// Build-layer tests for the ONE `omega` runtime each Electron process exports
// ([#945](https://github.com/Omega-JS-Stack/omega/issues/945)), and for the
// build-time module (build.js) beside them.
//
// main.js, preload.js and renderer.js each export ONE ready-made instance as the
// module and its class as `.Omega`; a consumer never writes `new`. The renderer
// extends @omega.js/client's base class and requires the preload's bridge, so it
// is loaded here with a `window.desktop` present (and pinned to refuse to load
// without one). Everything that needs a real Electron is the main layer's.

const fs = require('fs');
const path = require('path');
const build = require('../../../build.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/**
 * Load renderer.js fresh with `window` set to `win` (null = no window at all),
 * then put the globals back.
 * @param {object|null} win - the window the module loads under.
 * @returns {object} the module's export.
 */
function loadRenderer(win) {
  const file = require.resolve(path.join(ROOT, 'renderer.js'));
  const saved = globalThis.window;
  delete require.cache[file];
  if (win) globalThis.window = win;
  else delete globalThis.window;
  try {
    return require(file);
  } finally {
    delete require.cache[file];
    if (saved === undefined) delete globalThis.window;
    else globalThis.window = saved;
  }
}

// The production preload's `window.desktop` keys, in source order
const DESKTOP_KEYS = ['environment', 'ipc', 'storage', 'theme', 'fontawesome', 'logger', 'autoUpdater', 'analytics', 'context', 'usage', 'remoteConfig'];

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
  description: 'Omega runtimes (main, preload, renderer) + the build module (build.js)',
  tests: [
    {
      name: 'main and preload export ONE instance each, and .Omega is its constructor',
      run: (ctx) => {
        for (const file of ['main.js', 'preload.js']) {
          const omega = require(path.join(ROOT, file));
          ctx.expect(typeof omega.Omega).toBe('function');
          ctx.expect(omega).toBeInstanceOf(omega.Omega);
          ctx.expect(omega.constructor).toBe(omega.Omega);
          ctx.expect(typeof omega.initialize).toBe('function');
          ctx.expect(omega.ready).toBeInstanceOf(Promise);
        }
      },
    },
    {
      name: 'main carries every library as a plain property, `auth` among them and no `omega`',
      run: (ctx) => {
        const omega = require(path.join(ROOT, 'main.js'));
        ctx.expect(omega.auth).toBe(require(path.join(ROOT, 'lib', 'auth.js')));
        ctx.expect(omega.omega).toBeUndefined();
        for (const name of ['getEnvironment', 'isDevelopment', 'isProduction', 'isTesting', 'getVersion', 'getFunctionsUrl', 'getApiUrl', 'getWebsiteUrl', 'getAuthUrl', 'openAuthFlow', 'quit', 'relaunch', 'require']) {
          ctx.expect(typeof omega[name]).toBe('function');
        }
        ctx.expect(typeof omega.Omega.require).toBe('function');
      },
    },
    {
      name: 'preload initialize() outside a BrowserWindow settles ready with the instance',
      run: async (ctx) => {
        const { Omega } = require(path.join(ROOT, 'preload.js'));
        const preload = new Omega();
        ctx.expect(await preload.initialize()).toBe(preload);
        ctx.expect(await preload.ready).toBe(preload);
      },
    },
    {
      // A window built without the framework's preload has no bridge: a
      // programmer error, loud at load
      name: 'renderer refuses to load without window.desktop',
      run: (ctx) => {
        ctx.expect(() => loadRenderer(null)).toThrow(/window\.desktop is missing/);
        ctx.expect(() => loadRenderer({})).toThrow(/window\.desktop is missing/);
      },
    },
    {
      name: 'renderer exports ONE instance of a subclass of the client base, with omega.desktop the bridge',
      run: async (ctx) => {
        const { Omega: ClientOmega } = require('@omega.js/client');
        const desktop = { ipc: {}, storage: {} };
        const omega = loadRenderer({ desktop });

        ctx.expect(typeof omega.Omega).toBe('function');
        ctx.expect(omega).toBeInstanceOf(omega.Omega);
        ctx.expect(omega).toBeInstanceOf(ClientOmega);
        ctx.expect(omega.desktop).toBe(desktop);
        ctx.expect(omega.storage === desktop.storage).toBe(false);
        ctx.expect(omega.auth.user.constructor.name).toBe('User');
        ctx.expect(omega.auth.user.authenticated).toBe(false);
        for (const name of ['signOut', 'getMainUser', 'enableFontAwesome', 'getWebsiteUrl', 'getAuthUrl', 'getVersion']) {
          ctx.expect(typeof omega[name]).toBe('function');
        }
      },
    },
    {
      name: 'each process module defines class Omega and exports its instance (source pin)',
      run: (ctx) => {
        for (const file of ['main.js', 'preload.js', 'renderer.js']) {
          const source = read(file);
          ctx.expect(source).toMatch(/^const omega = new Omega\(\);$/m);
          ctx.expect(source).toMatch(/^module\.exports = omega;$/m);
          ctx.expect(source).toMatch(/^module\.exports\.Omega = Omega;$/m);
          ctx.expect(source.includes('attachTo')).toBe(false);
          ctx.expect(source.includes('build.prototype')).toBe(false);
        }
        ctx.expect(read('main.js')).toMatch(/^class Omega \{$/m);
        ctx.expect(read('preload.js')).toMatch(/^class Omega \{$/m);
        ctx.expect(read('renderer.js')).toMatch(/^class Omega extends ClientOmega \{$/m);
        ctx.expect(read('renderer.js').includes('this.shell = createShell(this);')).toBe(true);
        ctx.expect(read('main.js').includes('wmBridge')).toBe(false);
      },
    },
    {
      // The preload global keeps its name and its shape
      name: 'the production preload exposes window.desktop with the same namespaces (source pin)',
      run: (ctx) => {
        const source = read('preload.js');
        const start = source.indexOf("contextBridge.exposeInMainWorld('desktop', {");
        const block = source.slice(start, source.indexOf('    });\n', start));
        const keys = [...block.matchAll(/^      ([A-Za-z]+): /gm)].map((match) => match[1]);
        ctx.expect(keys).toEqual(DESKTOP_KEYS);
      },
    },
    {
      // `.` is the build-time entry; each process imports its instance by subpath
      name: 'the package root exports { version, build } and nothing else',
      run: (ctx) => {
        const root = require(path.join(ROOT, 'index.js'));
        ctx.expect(Object.keys(root).sort()).toEqual(['build', 'version']);
        ctx.expect(root.build).toBe(build);
      },
    },
    {
      name: 'the build module is one plain object: no class, no new',
      run: (ctx) => {
        ctx.expect(typeof build).toBe('object');
        ctx.expect(typeof build.getConfig).toBe('function');
        ctx.expect(read('build.js')).toMatch(/^module\.exports = \{$/m);
      },
    },
    {
      name: 'getMode returns the mode shape',
      run: (ctx) => {
        const mode = build.getMode();
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
            ctx.expect(build.getEnvironment()).toBe(name);
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
          ctx.expect(() => build.getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
          process.env.OMEGA_ENVIRONMENT = 'staging';
          ctx.expect(() => build.getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
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
            const e = build.getEnvironment();
            ctx.expect(e).toBe(name);
            ctx.expect(build.isDevelopment()).toBe(e === 'development');
            ctx.expect(build.isTesting()).toBe(e === 'testing');
            ctx.expect(build.isProduction()).toBe(e === 'production');
            const trueCount = [build.isDevelopment(), build.isTesting(), build.isProduction()].filter(Boolean).length;
            ctx.expect(trueCount).toBe(1);
          }
        });
      },
    },
    {
      name: 'getPackage("main") resolves to @omega.js/desktop package.json',
      run: (ctx) => {
        const pkg = build.getPackage('main');
        ctx.expect(pkg.name).toBe('@omega.js/desktop');
        ctx.expect(pkg).toHaveProperty('version');
        ctx.expect(pkg).toHaveProperty('exports');
      },
    },
    {
      name: 'getRootPath("main") returns a non-empty string',
      run: (ctx) => {
        const root = build.getRootPath('main');
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
          ctx.expect(build.getLiveReloadPort()).toBe(35729);
        } finally {
          if (prev !== undefined) process.env.OMEGA_LIVERELOAD_PORT = prev;
        }
      },
    },
    {
      name: 'getWindowsSignStrategy defaults to self-hosted when no config',
      run: (ctx) => {
        // Config is the only source of the strategy: no env var sets it.
        // Run from a cwd with no omega.json5 to confirm the default.
        const fs = require('fs'); const os = require('os'); const path = require('path');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-strategy-'));
        const orig = process.cwd();
        try {
          process.chdir(tmp);
          ctx.expect(build.getWindowsSignStrategy()).toBe('self-hosted');
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
          ctx.expect(build.getWindowsSignStrategy()).toBe('cloud');
        } finally {
          process.chdir(orig);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'logger returns a named logger',
      run: (ctx) => {
        const logger = build.logger('test-name');
        ctx.expect(logger.name).toBe('test-name');
        ctx.expect(typeof logger.log).toBe('function');
        ctx.expect(typeof logger.error).toBe('function');
      },
    },
  ],
});
