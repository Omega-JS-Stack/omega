// An ESM-only dependency, bundled into main and preload
// ([#906](https://github.com/Omega-JS-Stack/omega/issues/906)).
//
// Both Node bundles are CommonJS (`format: 'cjs'`, `platform: 'node'`), and
// esbuild rewrites `import.meta` to `{}` in that output: a dependency doing
// `createRequire(import.meta.url)` was handed `undefined` and threw
// ERR_INVALID_ARG_VALUE the moment a packaged app booted (found porting an
// electron-manager app that depends on yargs 18). @omega.js/devkit's `bundle()`
// composes the answer for every cjs+node build, so nothing here wires it.
//
// The proof is a RUN, not a read of the bundle text: the fixture package
// (@omega.js/devkit's `test/fixtures/esm-only-package`, the one every target
// proves this with) is installed into a staged project the way a brand installs
// a dependency, the REAL bundle task builds it, and the emitted bundle is
// executed under Node exactly as Electron executes `dist/main.bundle.js`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { installEsmOnlyFixture, FIXTURE_NAME, NODE_MARKER } = require('@omega.js/devkit/test/esm-only-fixture');

const SRC = path.join(__dirname, '..', '..', '..');
const TASK = path.join(SRC, 'gulp', 'tasks', 'bundle.js');

// What each entry prints once it has loaded the ESM-only dependency: the run's
// whole answer, on one line, so the test reads it out of stdout.
function probe(name) {
  return [
    `const fixture = require(${JSON.stringify(FIXTURE_NAME)});`,
    `console.log('${name}:' + JSON.stringify({ fileUrl: fixture.fileUrl, viaRequire: fixture.viaRequire, marker: fixture.marker }));`,
    '',
  ].join('\n');
}

// A desktop project with the fixture installed, built by the real task. The
// task reads its project (package.json / config / dist) from cwd at require
// time, so the module is flushed and required fresh inside the staged dir, the
// way every other build suite drives it.
async function buildStagedProject() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-esm-only-')));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{ "name": "staged-desktop", "version": "1.0.0" }');

  const write = (relative, contents) => {
    const full = path.join(tmp, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  write('config/omega.json5', `{
    brand: { id: 'staged', name: 'Staged' },
    cloud: { config: { apiKey: 'AIza-staged', projectId: 'demo-staged' } },
    targets: { desktop: { type: 'desktop' } },
  }`);
  write('src/main.js', probe('main'));
  write('src/preload.js', probe('preload'));

  // The dependency as npm installs one: a package directory under the
  // consumer's own node_modules, found by the bundler's normal resolution.
  installEsmOnlyFixture(tmp);

  const oldCwd = process.cwd();
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
  };

  flush();
  try {
    process.chdir(tmp);
    const task = require(TASK);
    await new Promise((resolve, reject) => task((error) => (error ? reject(error) : resolve())));
  } finally {
    process.chdir(oldCwd);
    flush();
  }

  return tmp;
}

// Run an emitted Node bundle the way Electron runs it: a plain Node process on
// the file the build wrote.
function run(file, name) {
  const ran = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  const line = (ran.stdout || '').split('\n').find((text) => text.startsWith(`${name}:`));

  return {
    status: ran.status,
    stderr: ran.stderr,
    result: line ? JSON.parse(line.slice(name.length + 1)) : null,
  };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'an ESM-only dependency bundles into main and preload, and RUNS (#906)',
  timeout: 180000,
  tests: [
    {
      name: 'main and preload each carry the ESM-only dependency and boot with a real import.meta.url',
      run: async (ctx) => {
        const tmp = await buildStagedProject();
        try {
          for (const name of ['main', 'preload']) {
            const bundleFile = path.join(tmp, 'dist', `${name}.bundle.js`);
            ctx.expect(fs.existsSync(bundleFile)).toBe(true);

            const { status, stderr, result } = run(bundleFile, name);
            // Without the composed define this is where it ends: createRequire
            // gets `undefined` and throws before the app's first line.
            ctx.expect(status).toBe(0);
            ctx.expect(stderr.includes('ERR_INVALID_ARG_VALUE')).toBe(false);

            ctx.expect(result.marker).toBe(NODE_MARKER);
            ctx.expect(result.fileUrl.startsWith('file://')).toBe(true);
            // The require the dependency opened for itself actually works.
            ctx.expect(result.viaRequire).toBe(true);
          }
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
