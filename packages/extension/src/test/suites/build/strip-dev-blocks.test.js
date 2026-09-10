// @dev-only strip, extension bundle lane (#18): production extension bundles must
// not carry the dev-only blocks their inputs hold — @omega.js/client's src and the
// vendored theme assets both use the markers, and every one of them reaches a
// popup / options / sidepanel bundle. The mechanism is @omega.js/devkit's bundle
// wrapper, which registers the strip for PRODUCTION builds only
// ([#738](https://github.com/Omega-JS-Stack/omega/issues/738) replaced the
// webpack loader this suite used to drive), so these tests build a real fixture
// entry through that wrapper from the extension framework root and read the
// emitted bundle back.
//
// The marker + cut themselves are @omega.js/devkit's (one home); pinned there.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { bundle } = require('@omega.js/devkit/bundle');
const Manager = new (require(path.join(FRAMEWORK_ROOT, 'src', 'build.js')));
const defineCases = require('@omega.js/devkit/test/define-cases');

const FIXTURE = [
  '/* @dev-only:start */',
  'console.log("DEV_ONLY_SENTINEL");',
  '/* @dev-only:end */',
  'globalThis.alwaysShips = "PROD_SENTINEL";',
  '',
].join('\n');

// Build the fixture the way the extension lane builds a component entry — `dev`
// is the ONE switch, so the strip is the only variable. Minify stays out of the
// assertion's way by reading sentinels, which minification preserves.
async function compile(isProd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-extension-strip-'));
  fs.writeFileSync(path.join(dir, 'entry.js'), FIXTURE);
  const outfile = path.join(dir, 'dist', 'entry.bundle.js');

  try {
    await bundle({
      frameworkRoot: FRAMEWORK_ROOT,
      entries: [path.join(dir, 'entry.js')],
      outfile,
      platform: 'browser',
      format: 'iife',
      dev: !isProd,
    });
    return fs.readFileSync(outfile, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'strip-dev-blocks — the extension bundle lane cuts @dev-only blocks from production bundles',
  timeout: 60000,
  tests: [
    {
      name: 'production bundle drops the dev-only block and keeps the real code',
      run: async (ctx) => {
        const built = await compile(true);
        ctx.expect(built).toContain('PROD_SENTINEL');
        ctx.expect(built.includes('DEV_ONLY_SENTINEL')).toBe(false);
      },
    },

    {
      name: 'development bundle keeps the dev-only block',
      run: async (ctx) => {
        const built = await compile(false);
        ctx.expect(built).toContain('PROD_SENTINEL');
        ctx.expect(built).toContain('DEV_ONLY_SENTINEL');
      },
    },

    {
      // `actLikeProduction()` is the rule, not `isBuildMode()`: an audit run
      // (OMEGA_AUDIT_FORCE) inspects the artifact a release would ship, so it
      // has to be built the way a release is — dev blocks cut. The old webpack
      // loader gated on the build-mode flag alone and left them in.
      name: 'OMEGA_AUDIT_FORCE builds like production — the dev-only block is cut there too',
      run: async (ctx) => {
        const previous = { build: process.env.OMEGA_BUILD_MODE, audit: process.env.OMEGA_AUDIT_FORCE };
        delete process.env.OMEGA_BUILD_MODE;
        process.env.OMEGA_AUDIT_FORCE = 'true';

        try {
          ctx.expect(Manager.isBuildMode()).toBe(false);
          ctx.expect(Manager.actLikeProduction()).toBe(true);

          const built = await compile(Manager.actLikeProduction());
          ctx.expect(built).toContain('PROD_SENTINEL');
          ctx.expect(built.includes('DEV_ONLY_SENTINEL')).toBe(false);
        } finally {
          restoreEnv('OMEGA_BUILD_MODE', previous.build);
          restoreEnv('OMEGA_AUDIT_FORCE', previous.audit);
        }
      },
    },

    {
      // The strip existing is not the bug #18 reports — the bug was a bundle
      // WITHOUT it. Pin the wiring itself: the task derives the production rule
      // from the same helper the rest of the build gates on, which is what
      // registers the strip inside the wrapper.
      name: 'the one bundle call takes the production rule',
      run: (ctx) => {
        const task = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'bundle.js'), 'utf8');
        ctx.expect(task).toContain('dev: !Manager.actLikeProduction()');
      },
    },
  ],
});
