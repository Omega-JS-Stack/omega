// Build-layer tests for config validation via @omegajs/config — EM's integration
// surface only. The engine semantics (required/type/match/enum, conditional required,
// secrets, targets sanity) are deep-tested in the config package's own suite; here we
// prove the vendored package loads from dist, the desktop refinements apply, and the
// shipped defaults stay compatible with the shared schema.

const { validateConfig, runSchema, formatErrors, loadConfig } = require('@omegajs/config');

const path = require('path');
const Manager = require('../../../build.js');
const root = Manager.getRootPath('main');

// Minimal "good" config — passes every required check.
const VALID = {
  brand: { id: 'myapp', name: 'MyApp' },
};

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'config validation — @omegajs/config integration',
  tests: [
    {
      name: 'package loads with the full validation surface',
      run: (ctx) => {
        ctx.expect(typeof validateConfig).toBe('function');
        ctx.expect(typeof runSchema).toBe('function');
        ctx.expect(typeof formatErrors).toBe('function');
      },
    },
    {
      name: 'minimal valid config passes the shared schema',
      run: (ctx) => {
        const { errors } = validateConfig(VALID, { target: 'desktop' });
        ctx.expect(errors).toEqual([]);
      },
    },
    {
      name: 'missing brand.id / brand.name are reported',
      run: (ctx) => {
        const { errors } = validateConfig({}, { target: 'desktop' });
        ctx.expect(errors.some((e) => e.includes('brand.id is required'))).toBe(true);
        ctx.expect(errors.some((e) => e.includes('brand.name is required'))).toBe(true);
      },
    },
    {
      name: 'desktop refinements apply only with target: desktop',
      run: (ctx) => {
        const cfg = { ...VALID, startup: { mode: 'tray-only' } };
        // Without a target, startup.mode is just an unknown key — silent.
        ctx.expect(validateConfig(cfg).errors).toEqual([]);
        // With the desktop target, the enum refinement fires.
        const { errors } = validateConfig(cfg, { target: 'desktop' });
        ctx.expect(errors.some((e) => e.includes('startup.mode') && e.includes('not allowed'))).toBe(true);
      },
    },
    {
      name: 'platforms.win.signing.strategy enum enforced under desktop',
      run: (ctx) => {
        const cfg = { ...VALID, platforms: { win: { signing: { strategy: 'banana' } } } };
        const { errors } = validateConfig(cfg, { target: 'desktop' });
        ctx.expect(errors.some((e) => e.includes('platforms.win.signing.strategy'))).toBe(true);
      },
    },
    {
      name: 'secret-shaped keys are validation errors',
      run: (ctx) => {
        const { errors } = validateConfig({ ...VALID, updaterSecret: 'x' }, { target: 'desktop' });
        ctx.expect(errors.some((e) => e.includes('looks like a secret'))).toBe(true);
      },
    },
    {
      name: 'formatErrors renders a numbered block',
      run: (ctx) => {
        ctx.expect(formatErrors([])).toBe('');
        ctx.expect(formatErrors(['a', 'b'])).toBe('  1. a\n  2. b');
      },
    },
    {
      name: 'EM shipped defaults resolve + validate clean for desktop',
      run: (ctx) => {
        // Anything failing here means our defaults are incompatible with the shared schema.
        const { errors, enabled } = loadConfig(path.join(root, 'dist', 'defaults'), 'desktop');
        ctx.expect(errors).toEqual([]);
        ctx.expect(enabled).toBe(true);
      },
    },
  ],
};
