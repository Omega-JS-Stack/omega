// @dev-only strip, desktop bundle lane (#18): production desktop bundles must not
// carry the dev-only blocks their inputs hold — @omega.js/client's src and the
// vendored theme assets both use the markers, and every one of them reaches a
// renderer bundle. The mechanism is @omega.js/devkit's bundle wrapper, which
// registers the strip for PRODUCTION builds only (#737), so these tests build a
// real fixture entry through that wrapper from the desktop framework root and
// read the emitted bundle back.
//
// The marker + cut themselves are @omega.js/devkit's (one home); pinned there.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { bundle } = require('@omega.js/devkit/bundle');
const defineCases = require('@omega.js/devkit/test/define-cases');

const FIXTURE = [
  '/* @dev-only:start */',
  'console.log("DEV_ONLY_SENTINEL");',
  '/* @dev-only:end */',
  'module.exports = { alwaysShips: "PROD_SENTINEL" };',
  '',
].join('\n');

// Build the fixture the way the desktop lane builds its main bundle for `isProd`
// — `dev` is the ONE switch, so the strip is the only variable. Minify stays off
// the assertion's way by reading sentinels, which minification preserves.
async function compile(isProd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-desktop-strip-'));
  fs.writeFileSync(path.join(dir, 'entry.js'), FIXTURE);
  const outfile = path.join(dir, 'dist', 'entry.bundle.js');

  try {
    await bundle({
      frameworkRoot: FRAMEWORK_ROOT,
      entries: [path.join(dir, 'entry.js')],
      outfile,
      platform: 'node',
      format: 'cjs',
      dev: !isProd,
    });
    return fs.readFileSync(outfile, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'strip-dev-blocks — the desktop bundle lane cuts @dev-only blocks from production bundles',
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
      // The strip existing is not the bug #18 reports — the bug was three bundles
      // WITHOUT it. Pin the wiring itself: the run derives the production rule
      // once and ALL THREE bundles take it, which is what registers the strip
      // inside the wrapper.
      name: 'main, preload, and renderer bundles all take the production rule',
      run: (ctx) => {
        const task = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'bundle.js'), 'utf8');
        ctx.expect(task.includes('dev: !isProd')).toBe(true);
        ctx.expect(task.split('dev: shared.dev').length - 1).toBe(3);
      },
    },

    {
      name: 'the strip comes from the one home (@omega.js/devkit), production only',
      run: async (ctx) => {
        const seen = { prod: [], dev: [] };
        const spy = (into) => ({ name: 'spy', setup: (build) => { into.push(...build.initialOptions.plugins.map((p) => p.name)); } });
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-desktop-strip-plugins-'));
        fs.writeFileSync(path.join(dir, 'entry.js'), FIXTURE);

        try {
          for (const [lane, dev] of [['prod', false], ['dev', true]]) {
            await bundle({
              frameworkRoot: FRAMEWORK_ROOT,
              entries: [path.join(dir, 'entry.js')],
              outfile: path.join(dir, lane, 'entry.bundle.js'),
              platform: 'node',
              format: 'cjs',
              dev,
              plugins: [spy(seen[lane])],
            });
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }

        ctx.expect(seen.prod.includes('omega-strip-dev-blocks')).toBe(true);
        ctx.expect(seen.dev.includes('omega-strip-dev-blocks')).toBe(false);
      },
    },
  ],
});
