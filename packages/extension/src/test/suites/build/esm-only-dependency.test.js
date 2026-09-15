// An ESM-only dependency, bundled into an extension context
// ([#906](https://github.com/Omega-JS-Stack/omega/issues/906)).
//
// The bug that opened the issue is CommonJS-only (esbuild rewrites
// `import.meta` to `{}` there, and @omega.js/devkit's `bundle()` composes the
// answer for every cjs+node build), and every bundle here is browser iife. What
// this suite pins is the other half of the same promise, on this target: a
// package that ships ESM ONLY resolves, bundles and RUNS, with a real value on
// the other side. The fixture is the one every target proves it with
// (@omega.js/devkit's `test/esm-only-fixture`), installed into the staged
// project the way npm installs a dependency, and its BROWSER entry is what an
// extension bundle gets by export condition.
//
// The task module reads its project (package.json / config / dist) from cwd at
// REQUIRE time, so the test stages a temp project, chdirs into it, and requires
// the task fresh: the same model as build-json-bake.test.js.

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const vm   = require('vm');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { installEsmOnlyFixture, FIXTURE_NAME, BROWSER_MARKER } = require('@omega.js/devkit/test/esm-only-fixture');

const SRC       = path.join(__dirname, '..', '..', '..');
const TASK_PATH = path.join(SRC, 'gulp', 'tasks', 'bundle.js');

// A popup entry that does nothing but use the ESM-only dependency: the values
// it publishes are computed by the bundled copy at RUN time, so reading them
// back proves the module evaluated rather than proving its text survived.
const PROBE_ENTRY = [
  `import { describeFixture, marker, flavor } from '${FIXTURE_NAME}';`,
  'globalThis.__described = describeFixture();',
  'globalThis.__marker = marker;',
  'globalThis.__flavor = flavor;',
  '',
].join('\n');

// Stage a temp extension project with the fixture installed.
function stageProject() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'extension-esm-only-')));

  fs.writeFileSync(path.join(tmp, 'package.json'), '{ "name": "staged-ext", "version": "1.0.0" }');
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), `{
    brand: { id: 'staged', name: 'Staged' },
    targets: { extension: { type: 'extension' } },
  }`);

  const entry = path.join(tmp, 'src', 'assets', 'js', 'components', 'popup', 'index.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, PROBE_ENTRY);

  installEsmOnlyFixture(tmp);

  return tmp;
}

// Run `fn(task)` with cwd pinned to `dir` and the task module loaded fresh.
async function inProject(dir, fn) {
  const oldCwd = process.cwd();
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
  };

  flush();
  try {
    process.chdir(dir);
    return await fn(require(TASK_PATH));
  } finally {
    process.chdir(oldCwd);
    flush();
  }
}

// Run an emitted bundle the way a browser context does: a self-contained iife
// against a worker-or-page global, with nothing else in scope.
function runBundleFile(file) {
  const scope = {};
  scope.self = scope;
  scope.globalThis = scope;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), scope);
  return scope;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'an ESM-only dependency bundles into an extension context, and RUNS (#906)',
  timeout: 180000,
  tests: [
    {
      name: 'the popup bundle carries the ESM-only dependency and its exports answer at run time',
      run: async (ctx) => {
        const tmp = stageProject();
        try {
          await inProject(tmp, async (task) => {
            const failure = await new Promise((resolve) => task.bundleTask(resolve));
            ctx.expect(failure).toBe(undefined);

            const emitted = path.join(tmp, 'dist', 'assets', 'js', 'components', 'popup.bundle.js');
            ctx.expect(fs.existsSync(emitted)).toBe(true);

            const ran = runBundleFile(emitted);
            ctx.expect(ran.__marker).toBe(BROWSER_MARKER);
            ctx.expect(ran.__described).toBe(`${BROWSER_MARKER}:browser`);
            // The BROWSER entry is what an extension bundle resolves to: the
            // node half would have dragged node:module into a browser context.
            ctx.expect(ran.__flavor).toBe('browser');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
