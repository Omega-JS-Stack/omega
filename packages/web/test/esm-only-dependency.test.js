/**
 * An ESM-only dependency, through @omega.js/web's two bundle lanes
 * ([#906](https://github.com/Omega-JS-Stack/omega/issues/906)).
 *
 * The bug that opened the issue is CommonJS-only (esbuild rewrites
 * `import.meta` to `{}` there, and @omega.js/devkit's `bundle()` composes the
 * answer for every cjs+node build); web emits browser output, esm for page
 * assets and iife for the service worker. What these cases pin is the other
 * half of the same promise, on this target: a package that ships ESM ONLY
 * resolves, bundles and RUNS.
 *
 * The dependency is the ONE fixture every target proves this with
 * (@omega.js/devkit's `test/esm-only-fixture`), installed into a temp site the
 * way npm installs a dependency. Its BROWSER entry is what a web bundle gets,
 * by export condition.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { buildAssets } = require('../src/assets.js');
const { buildServiceWorker } = require('../src/service-worker.js');
const { installEsmOnlyFixture, FIXTURE_NAME, BROWSER_MARKER } = require('@omega.js/devkit/test/esm-only-fixture');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const CLIENT_ENTRY = path.join(ROOT, 'packages', 'client', 'src', 'index.js');

// One temp site per process (#182's rule for this suite's out dirs), holding
// the installed dependency, the page module that imports it and the service
// worker that imports it.
const SITE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `web-esm-only-${process.pid}-`)));
const OUT = path.join(SITE, 'out');

function write(relative, contents) {
  const full = path.join(SITE, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

write('js/pages/index.js', [
  `import { describeFixture, marker } from '${FIXTURE_NAME}';`,
  'export default function initialize() {',
  '  return { described: describeFixture(), marker };',
  '}',
  '',
].join('\n'));

write('sw/service-worker.js', [
  `import { describeFixture, marker } from '${FIXTURE_NAME}';`,
  'self.__described = describeFixture();',
  'self.__marker = marker;',
  '',
].join('\n'));

installEsmOnlyFixture(SITE);

module.exports = defineCases({
  type: 'group',
  description: 'esm-only-dependency',
  cleanup: () => fs.rmSync(SITE, { recursive: true, force: true }),
  tests: [
    {
      name: 'the page-asset lane bundles an ESM-only dependency (esm + splitting, browser)',
      run: async (ctx) => {
        const manifest = await buildAssets({
          layers: [SITE],
          themeRoots: [],
          sectionRoots: [],
          themesDir: path.join(PKG, 'themes'),
          coreDir: path.join(PKG, 'core'),
          outDir: OUT,
          clientEntry: CLIENT_ENTRY,
          only: 'js',
          dev: true,
        });

        const urls = manifest.js.pages.index;
        ctx.expect(urls && urls.length, `the page module is an entry (${JSON.stringify(manifest.js.pages)})`).toBeTruthy();

        // The dependency's own code is IN the output graph: its text lands in the
        // entry chunk or in a shared chunk beside it, which is esbuild's call.
        const emitted = fs.readdirSync(path.join(OUT, 'assets', 'js'), { recursive: true })
          .map((rel) => path.join(OUT, 'assets', 'js', String(rel)))
          .filter((file) => file.endsWith('.js') && fs.statSync(file).isFile())
          .map((file) => fs.readFileSync(file, 'utf8'));

        ctx.expect(emitted.some((source) => source.includes(BROWSER_MARKER)), 'the ESM-only dependency was bundled into the page assets').toBeTruthy();
      },
    },

    {
      name: 'the service worker bundles an ESM-only dependency and RUNS it (iife, browser)',
      run: async (ctx) => {
        const url = await buildServiceWorker({
          consumerDir: path.join(SITE, 'sw'),
          outDir: OUT,
          clientEntry: CLIENT_ENTRY,
          dev: true,
        });
        ctx.expect(url).toBe('/service-worker.js');

        // Evaluated the way a browser evaluates a classic worker script: one
        // self-contained iife, against a worker global and nothing else.
        const scope = {};
        scope.self = scope;
        scope.globalThis = scope;
        vm.runInNewContext(fs.readFileSync(path.join(OUT, 'service-worker.js'), 'utf8'), scope);

        ctx.expect(scope.__marker).toBe(BROWSER_MARKER);
        ctx.expect(scope.__described).toBe(`${BROWSER_MARKER}:browser`);
      },
    },
  ],
});
