// Build-layer pin for the background SW's auth-emulator gate (#46).
//
// The SW connects Firebase Auth to the local emulator ONLY on a testing build.
// Its whole signal is what the bundle task BAKED into OMEGA_BUILD_JSON: a
// service worker has no `process.env`, so `Manager.isTesting()` resolves from
// `config.environment`, the ONE input a browser context has
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)). This suite
// drives that for real (the actual composeBuildJson undereach build lane,
// feeding the actual snapshot into the actual helpers) and then pins that the
// emulator call sits behind exactly that check. background.js itself is a
// browser-context ES module, so the call site is pinned by source, same model as
// cache-warming.test.js / verts-binding.test.js.
//
// Nothing reads `chrome.runtime.getManifest().update_url` any more: what an
// artifact WAS BUILT AS is what it answers, wherever it is loaded from.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const SRC       = path.join(__dirname, '..', '..', '..');
const TASK_PATH = path.join(SRC, 'gulp', 'tasks', 'bundle.js');
const helpers   = require(path.join(SRC, 'utils', 'mode-helpers.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');
const BACKGROUND = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');

// Compose a real snapshot under the given build mode and hand back its `config`
// blob — exactly what the SW reads out of OMEGA_BUILD_JSON.
async function bakeConfig(mode) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-emulator-gate-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), `{ "name": "gate-ext", "version": "1.0.0" }`);

  const oldCwd = process.cwd();
  // Each lane the way a real run states it: `omega build` sets OMEGA_BUILD_MODE,
  // `omega test` names OMEGA_ENVIRONMENT=testing, and a dev boot names nothing.
  const env = { OMEGA_ENVIRONMENT: null, OMEGA_TEST_MODE: null, OMEGA_BUILD_MODE: null, NODE_ENV: null };
  if (mode === 'testing')    env.OMEGA_ENVIRONMENT = 'testing';
  if (mode === 'production') env.OMEGA_BUILD_MODE  = 'true';

  const originals = {};
  for (const [k, v] of Object.entries(env)) {
    originals[k] = process.env[k];
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC + path.sep)) delete require.cache[key];
  }

  try {
    process.chdir(tmp);
    return (await require(TASK_PATH).composeBuildJson()).config;
  } finally {
    process.chdir(oldCwd);
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The SW's own resolution: no process.env, config-baked signals only.
function isTestingInServiceWorker(config) {
  const originals = {};
  for (const k of ['OMEGA_ENVIRONMENT', 'OMEGA_TEST_MODE', 'OMEGA_BUILD_MODE', 'NODE_ENV']) {
    originals[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return helpers.isTesting.call({ config });
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'background auth-emulator gate — testing builds only',
  tests: [
    {
      name: 'a testing build bakes environment=testing and the SW resolves isTesting() true',
      run: async (ctx) => {
        const config = await bakeConfig('testing');
        ctx.expect(config.environment).toBe('testing');
        ctx.expect(isTestingInServiceWorker(config)).toBe(true);
      },
    },
    {
      name: 'a production build never trips the gate',
      run: async (ctx) => {
        const config = await bakeConfig('production');
        ctx.expect(config.environment).toBe('production');
        ctx.expect(isTestingInServiceWorker(config)).toBe(false);
      },
    },
    {
      name: 'a dev build never trips the gate',
      run: async (ctx) => {
        const config = await bakeConfig('development');
        ctx.expect(config.environment).toBe('development');
        ctx.expect(isTestingInServiceWorker(config)).toBe(false);
      },
    },
    {
      name: 'the SW calls connectAuthEmulator once, only inside the isTesting() gate',
      run: (ctx) => {
        const calls = BACKGROUND.match(/connectAuthEmulator\(/g) || [];
        ctx.expect(calls.length).toBe(1);
        ctx.expect(/if \(this\.isTesting\(\)\) \{[\s\S]*?const port = requiredPort\(this, 'OMEGA_AUTH_PORT', 'auth'\);\s*this\.authLogger\.log\([^\n]*\);\s*connectAuthEmulator\(this\.libraries\.firebaseAuth, `http:\/\/localhost:\$\{port\}`/.test(BACKGROUND)).toBe(true);
        // The baked map is the ONLY source (#300: a SW can't read a bumped
        // OMEGA_AUTH_PORT, so the bake carries it). The classic 9099 that used
        // to sit under it as a fallback is gone (#834), numbers and all.
        ctx.expect(BACKGROUND.includes('AUTH_EMULATOR_PORT')).toBe(false);
        ctx.expect(BACKGROUND.includes('9099')).toBe(false);
      },
    },
  ],
});
