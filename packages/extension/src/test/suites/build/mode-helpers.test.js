// Build-layer test for utils/mode-helpers.js — verifies the cross-context helpers
// (isDevelopment / isProduction / isTesting / getVersion) behave correctly in a
// Node context (no `chrome` global).
//
// The environment four are the ONE module's since
// [#817](https://github.com/Omega-JS-Stack/omega/issues/817): this file re-exports
// them beside the extension's own getVersion(), and they read ONE input, the
// `OMEGA_ENVIRONMENT` variable in Node and the baked `config.environment` in an
// extension context. The manifest.update_url / OMEGA_BUILD_MODE / NODE_ENV sniffs
// are gone, along with the per-surface `development` default that disagreed with
// @omega.js/desktop's `production` one.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const helpers = require(path.join(__dirname, '..', '..', '..', 'utils', 'mode-helpers.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

function withEnv(overrides, fn) {
  const originals = {};
  for (const [k, v] of Object.entries(overrides)) {
    originals[k] = process.env[k];
    if (v === null) delete process.env[k];
    else            process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else                 process.env[k] = v;
    }
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'utils/mode-helpers — cross-context isDevelopment/isTesting/getVersion',
  tests: [
    {
      name: 'exports { attachTo, getEnvironment, isDevelopment, isProduction, isTesting, getVersion }',
      run: (ctx) => {
        ctx.expect(typeof helpers.attachTo).toBe('function');
        ctx.expect(typeof helpers.getEnvironment).toBe('function');
        ctx.expect(typeof helpers.isDevelopment).toBe('function');
        ctx.expect(typeof helpers.isProduction).toBe('function');
        ctx.expect(typeof helpers.isTesting).toBe('function');
        ctx.expect(typeof helpers.getVersion).toBe('function');
      },
    },
    {
      name: 'the four calls ARE the shared module\'s, not a copy',
      run: (ctx) => {
        const shared = require('@omega.js/config/environment');
        ctx.expect(helpers.getEnvironment).toBe(shared.getEnvironment);
        ctx.expect(helpers.isDevelopment).toBe(shared.isDevelopment);
        ctx.expect(helpers.isProduction).toBe(shared.isProduction);
        ctx.expect(helpers.isTesting).toBe(shared.isTesting);
      },
    },
    {
      name: 'the three checks answer the one input, in Node',
      run: (ctx) => {
        for (const name of ['development', 'testing', 'production']) {
          withEnv({ OMEGA_ENVIRONMENT: name }, () => {
            ctx.expect(helpers.getEnvironment()).toBe(name);
            ctx.expect(helpers.isDevelopment()).toBe(name === 'development');
            ctx.expect(helpers.isTesting()).toBe(name === 'testing');
            ctx.expect(helpers.isProduction()).toBe(name === 'production');
          });
        }
      },
    },
    {
      name: 'an extension context answers the BAKED config.environment',
      run: (ctx) => {
        // No process.env in a packed extension: the build bakes the word it was
        // built as into every bundle, and that is what the context reads.
        withEnv({ OMEGA_ENVIRONMENT: null }, () => {
          for (const name of ['development', 'testing', 'production']) {
            const context = { config: { environment: name } };
            ctx.expect(helpers.getEnvironment.call(context)).toBe(name);
            ctx.expect(helpers.isTesting.call(context)).toBe(name === 'testing');
          }
        });
      },
    },
    {
      name: 'no input at all is a loud error naming OMEGA_ENVIRONMENT, never a default',
      run: (ctx) => {
        withEnv({ OMEGA_ENVIRONMENT: null }, () => {
          ctx.expect(() => helpers.getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
          ctx.expect(() => helpers.isDevelopment()).toThrow(/OMEGA_ENVIRONMENT/);
        });
        withEnv({ OMEGA_ENVIRONMENT: 'staging' }, () => {
          ctx.expect(() => helpers.getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
        });
      },
    },
    {
      name: 'attachTo() mixes helpers into a constructor + its prototype',
      run: (ctx) => {
        function FakeManager() {}
        helpers.attachTo(FakeManager);
        ctx.expect(typeof FakeManager.getEnvironment).toBe('function');
        ctx.expect(typeof FakeManager.prototype.getEnvironment).toBe('function');
        ctx.expect(typeof FakeManager.isDevelopment).toBe('function');
        ctx.expect(typeof FakeManager.prototype.isDevelopment).toBe('function');
        ctx.expect(typeof FakeManager.isTesting).toBe('function');
        ctx.expect(typeof FakeManager.prototype.isTesting).toBe('function');
        ctx.expect(typeof FakeManager.getVersion).toBe('function');
      },
    },
    {
      // The core invariant: is*() DERIVE from getEnvironment(), so they can
      // NEVER disagree with it, and exactly one is always true.
      name: 'invariant: is*() exactly matches getEnvironment() + mutually exclusive (every scenario)',
      run: (ctx) => {
        for (const name of ['development', 'testing', 'production']) {
          withEnv({ OMEGA_ENVIRONMENT: name }, () => {
            const e = helpers.getEnvironment();
            ctx.expect(e).toBe(name);
            ctx.expect(helpers.isDevelopment()).toBe(e === 'development');
            ctx.expect(helpers.isTesting()).toBe(e === 'testing');
            ctx.expect(helpers.isProduction()).toBe(e === 'production');
            const trueCount = [helpers.isDevelopment(), helpers.isTesting(), helpers.isProduction()].filter(Boolean).length;
            ctx.expect(trueCount).toBe(1);
          });
        }
      },
    },
    {
      name: 'getVersion() reads cwd package.json#version in Node context',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-modehelpers-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '9.9.9' }));
        const oldCwd = process.cwd();
        try {
          process.chdir(tmp);
          ctx.expect(helpers.getVersion()).toBe('9.9.9');
        } finally {
          process.chdir(oldCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
