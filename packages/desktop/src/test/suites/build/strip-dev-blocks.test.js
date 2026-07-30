// @dev-only strip, desktop webpack lane (#18): production desktop bundles must not
// carry the dev-only blocks their inputs hold — @omega.js/client's src and the
// vendored theme assets both use the markers, and every one of them reaches a
// renderer bundle. The mechanism is the module rule gulp/tasks/webpack.js builds
// for each config (makeStripModule), so these tests compile a real fixture entry
// with that exact rule and read the emitted bundle back.
//
// The marker + cut themselves are @omega.js/devkit's (one home); pinned there.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const webpack = require(require.resolve('webpack', { paths: [FRAMEWORK_ROOT] }));
const { makeStripModule } = require(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'webpack.js'));

const FIXTURE = [
  '/* @dev-only:start */',
  'console.log("DEV_ONLY_SENTINEL");',
  '/* @dev-only:end */',
  'module.exports = { alwaysShips: "PROD_SENTINEL" };',
  '',
].join('\n');

// Compile the fixture with the module config the desktop lane builds for `isProd`,
// everything else held constant (development mode, no minifier) so the ONLY
// variable is the strip rule.
function compile(isProd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-desktop-strip-'));
  fs.writeFileSync(path.join(dir, 'entry.js'), FIXTURE);

  return new Promise((resolve, reject) => {
    webpack({
      mode: 'development',
      devtool: false,
      target: 'electron-main',
      entry: path.join(dir, 'entry.js'),
      output: { path: path.join(dir, 'dist'), filename: 'entry.bundle.js' },
      module: makeStripModule(isProd),
      optimization: { minimize: false },
    }, (err, stats) => {
      if (err) return reject(err);
      if (stats.hasErrors()) return reject(new Error(stats.toJson({ errors: true }).errors.map((e) => e.message).join('\n')));
      resolve(fs.readFileSync(path.join(dir, 'dist', 'entry.bundle.js'), 'utf8'));
    });
  }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'strip-dev-blocks — the desktop webpack lane cuts @dev-only blocks from production bundles',
  tests: [
    {
      name: 'production bundle drops the dev-only block and keeps the real code',
      run: async (ctx) => {
        const bundle = await compile(true);
        ctx.expect(bundle).toContain('PROD_SENTINEL');
        ctx.expect(bundle.includes('DEV_ONLY_SENTINEL')).toBe(false);
      },
    },

    {
      name: 'development bundle keeps the dev-only block',
      run: async (ctx) => {
        const bundle = await compile(false);
        ctx.expect(bundle).toContain('PROD_SENTINEL');
        ctx.expect(bundle).toContain('DEV_ONLY_SENTINEL');
      },
    },

    {
      // The rule existing is not the bug #18 reports — the bug was three configs
      // WITHOUT it. Pin the wiring itself: every config factory carries the rule.
      name: 'main, preload, and renderer configs all wire the strip rule',
      run: (ctx) => {
        const task = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'webpack.js'), 'utf8');
        const wired = task.split('module: makeStripModule(isProd)').length - 1;
        ctx.expect(wired).toBe(3);
      },
    },

    {
      name: 'the strip rule loads from the one home (@omega.js/devkit), production only',
      run: async (ctx) => {
        const prod = makeStripModule(true);
        ctx.expect(prod.rules.length).toBe(1);
        ctx.expect(prod.rules[0].use[0]).toContain(path.join('devkit', 'src', 'strip-dev-blocks-loader.js'));
        ctx.expect((makeStripModule(false).rules || []).length).toBe(0);
      },
    },
  ],
};
