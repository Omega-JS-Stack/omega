// Build-layer tests for build.getConfig() / getManifest() / getPackage() / getEnvironment().
// Stages a temp project dir with config/omega.json5 + src/manifest.json
// + package.json, sets process.cwd() to it, then exercises the build module's getters.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

function stageProject(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-getconfig-'));
  if (opts.config !== undefined) {
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), opts.config);
  }
  for (const [environment, contents] of Object.entries(opts.overlays || {})) {
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', `omega.${environment}.json5`), contents);
  }
  if (opts.manifest !== undefined) {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'manifest.json'), opts.manifest);
  }
  if (opts.pkg !== undefined) {
    fs.writeFileSync(path.join(tmp, 'package.json'), opts.pkg);
  }
  return tmp;
}

// Runs `fn` with the env vars in `vars` set (undefined = deleted); the
// originals come back after.
function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]]);
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Runs `fn` with process.cwd() pinned to `dir`. build.getConfig() / getManifest()
// resolve their files against process.cwd() at CALL time, so we hold the chdir until
// after the test body runs (not just during require()).
function inDir(dir, fn) {
  const oldCwd = process.cwd();
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/build.js')) delete require.cache[k];
  }
  try {
    process.chdir(dir);
    return fn(require(path.join(__dirname, '..', '..', '..', 'build.js')));
  } finally {
    process.chdir(oldCwd);
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'build module: config / manifest / package / environment getters',
  tests: [
    {
      name: 'getConfig resolves config/omega.json5 with the targets.extension overlay',
      run: (ctx) => {
        const tmp = stageProject({ config: `{
          // JSON5 comment on purpose
          brand: { id: 'somiibo', name: 'Somiibo' },
          theme: { id: 'classy' },
          liveReloadPort: 40000,
          targets: { extension: { type: 'extension', theme: { id: 'custom' } } },
        }` });
        try {
          inDir(tmp, (build) => {
            const cfg = build.getConfig();
            ctx.expect(cfg.brand.id).toBe('somiibo');
            ctx.expect(cfg.brand.name).toBe('Somiibo');
            // targets.extension overlays the top level
            ctx.expect(cfg.theme.id).toBe('custom');
            // custom top-level keys pass through
            ctx.expect(cfg.liveReloadPort).toBe(40000);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getConfig returns {} when no omega.json5 exists',
      run: (ctx) => {
        const tmp = stageProject({});
        try {
          inDir(tmp, (build) => {
            ctx.expect(build.getConfig()).toEqual({});
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getConfig hard-fails on secret-shaped keys',
      run: (ctx) => {
        const tmp = stageProject({ config: `{ brand: { id: 'x', name: 'X' }, analytics: { providers: { google: { id: '', secret: 'leak' } } }, targets: { extension: { type: 'extension' } } }` });
        try {
          inDir(tmp, (build) => {
            let threw = null;
            try { build.getConfig(); } catch (e) { threw = e; }
            ctx.expect(threw ? threw.message : '').toMatch(/[Ss]ecret/);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      // A retired key was renamed outright — nothing reads the old name, so the
      // settings under it are silently lost. Printing that as a "schema warning"
      // let every gulp task build on a config it knew was wrong and the run
      // still exited 0 ([#426](https://github.com/Omega-JS-Stack/omega/issues/426)).
      // Fatal on EVERY call, not once per process: tasks call getConfig() at
      // require time, one after another, and a warn-once flag left calls 2..n
      // reading the broken config in silence.
      name: 'getConfig hard-fails on a retired key — every call, not once per process',
      run: (ctx) => {
        const tmp = stageProject({ config: `{ brand: { id: 'x', name: 'X' }, payment: { processors: { stripe: {} } }, targets: { extension: { type: 'extension' } } }` });
        try {
          inDir(tmp, (build) => {
            let first = null;
            try { build.getConfig(); } catch (e) { first = e; }
            ctx.expect(first ? first.message : '').toMatch(/payment\.processors is retired/);

            let second = null;
            try { build.getConfig(); } catch (e) { second = e; }
            ctx.expect(second ? second.message : '').toMatch(/payment\.processors is retired/);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      // #856: the environment overlay a BUILD composes is the one the lane
      // names, not the one the machine answers. OMEGA_BUILD_MODE is the lane's
      // own word for a production bake (`omega build` sets it for the whole
      // gulp tree), and a dev boot is development
      // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)). Same rule,
      // same shape, in @omega.js/desktop.
      name: 'getConfig composes the PRODUCTION overlay in a build, the ambient one in a dev boot (#856)',
      run: (ctx) => {
        const tmp = stageProject({
          config: `{ brand: { id: 'somiibo', name: 'Somiibo' }, theme: { id: 'base' }, targets: { extension: { type: 'extension' } } }`,
          overlays: {
            production: `{ theme: { id: 'production' } }`,
            development: `{ theme: { id: 'development' } }`,
          },
        });
        try {
          // A fresh lane each time: OMEGA_ENVIRONMENT is the ONE input (#817) and
          // src/build.js sets it at LOAD from the build-mode flag, so each
          // sub-case re-enters inDir (which busts the module cache) inside its
          // own env rather than reusing a build module loaded under the other lane.
          const freshLane = { OMEGA_ENVIRONMENT: undefined, OMEGA_TEST_MODE: undefined, ENVIRONMENT: undefined, FUNCTIONS_EMULATOR: undefined, TERM_PROGRAM: undefined };

          withEnv({ ...freshLane, OMEGA_BUILD_MODE: 'true' }, () => {
            inDir(tmp, (build) => {
              ctx.expect(build.getConfig().theme.id).toBe('production');
              ctx.expect(build.getEnvironment()).toBe('production');
            });
          });
          // A dev boot names nothing and resolves development, rather than the
          // machine-sniffed answer the old copy gave (#817).
          withEnv({ ...freshLane, OMEGA_BUILD_MODE: undefined }, () => {
            inDir(tmp, (build) => {
              ctx.expect(build.getConfig().theme.id).toBe('development');
              ctx.expect(build.getEnvironment()).toBe('development');
            });
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getManifest returns parsed JSON5 from src/manifest.json',
      run: (ctx) => {
        const tmp = stageProject({ manifest: `{ manifest_version: 3, name: 'Test', version: '1.0.0' }` });
        try {
          inDir(tmp, (build) => {
            const m = build.getManifest();
            ctx.expect(m.manifest_version).toBe(3);
            ctx.expect(m.name).toBe('Test');
            ctx.expect(m.version).toBe('1.0.0');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getManifest returns {} when src/manifest.json is absent',
      run: (ctx) => {
        const tmp = stageProject({});
        try {
          inDir(tmp, (build) => {
            ctx.expect(build.getManifest()).toEqual({});
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getPackage("project") reads cwd package.json',
      run: (ctx) => {
        const tmp = stageProject({ pkg: `{ "name": "test-ext", "version": "2.0.0" }` });
        try {
          inDir(tmp, (build) => {
            const pkg = build.getPackage('project');
            ctx.expect(pkg.name).toBe('test-ext');
            ctx.expect(pkg.version).toBe('2.0.0');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getPackage("main") reads the framework\'s own package.json',
      run: (ctx) => {
        const build = require(path.join(__dirname, '..', '..', '..', 'build.js'));
        const pkg = build.getPackage('main');
        ctx.expect(pkg.name).toBe('@omega.js/extension');
      },
    },
    {
      // The environment reads ONE input, `OMEGA_ENVIRONMENT`
      // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)), and
      // src/build.js sets it at LOAD from the lane: OMEGA_BUILD_MODE means a
      // production bake, an inherited variable is kept, and a bare dev boot is
      // development. The manifest / NODE_ENV / OMEGA_TEST_MODE sniffs are gone.
      name: 'getEnvironment answers the one input the lane set',
      run: (ctx) => {
        const buildPath = path.join(__dirname, '..', '..', '..', 'build.js');
        const lane = (vars) => withEnv({ OMEGA_ENVIRONMENT: undefined, OMEGA_BUILD_MODE: undefined, OMEGA_TEST_MODE: undefined, NODE_ENV: undefined, ...vars }, () => {
          for (const key of Object.keys(require.cache)) {
            if (key.includes('/build.js')) delete require.cache[key];
          }
          return require(buildPath).getEnvironment();
        });

        ctx.expect(lane({ OMEGA_BUILD_MODE: 'true' })).toBe('production');
        ctx.expect(lane({})).toBe('development');
        ctx.expect(lane({ OMEGA_ENVIRONMENT: 'testing' })).toBe('testing');
        // A production build spawned from a test run still bakes production.
        ctx.expect(lane({ OMEGA_ENVIRONMENT: 'testing', OMEGA_BUILD_MODE: 'true' })).toBe('production');
      },
    },
    {
      name: 'the three checks derive from it, and a missing input is a loud error',
      run: (ctx) => {
        const build = require(path.join(__dirname, '..', '..', '..', 'build.js'));
        for (const name of ['development', 'testing', 'production']) {
          withEnv({ OMEGA_ENVIRONMENT: name }, () => {
            ctx.expect(build.getEnvironment()).toBe(name);
            ctx.expect(build.isDevelopment()).toBe(name === 'development');
            ctx.expect(build.isTesting()).toBe(name === 'testing');
            ctx.expect(build.isProduction()).toBe(name === 'production');
          });
        }
        withEnv({ OMEGA_ENVIRONMENT: undefined }, () => {
          ctx.expect(() => build.getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
        });
      },
    },
    {
      name: 'getLiveReloadPort defaults to 35729',
      run: (ctx) => {
        const build = require(path.join(__dirname, '..', '..', '..', 'build.js'));
        const original = process.env.OMEGA_LIVERELOAD_PORT;
        delete process.env.OMEGA_LIVERELOAD_PORT;
        try {
          ctx.expect(build.getLiveReloadPort()).toBe(35729);
        } finally {
          if (original !== undefined) process.env.OMEGA_LIVERELOAD_PORT = original;
        }
      },
    },
    {
      name: 'getRootPath("project") returns cwd, getRootPath("main") returns the framework root',
      run: (ctx) => {
        const build = require(path.join(__dirname, '..', '..', '..', 'build.js'));
        ctx.expect(build.getRootPath('project')).toBe(process.cwd());
        ctx.expect(build.getRootPath('main')).toBe(path.resolve(__dirname, '..', '..', '..', '..'));
      },
    },
  ],
});
