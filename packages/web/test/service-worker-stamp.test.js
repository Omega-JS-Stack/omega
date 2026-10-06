/**
 * The service worker's `/build.js` import carries the build stamp: the same
 * `?cb=` value the page's head tag carries, baked into the worker bundle at
 * build time as `__OMEGA_BUILD_STAMP__`. That shared stamp is what lets the
 * edge cache `/build.js` for a year: no loader can ever ask for a stale copy.
 *
 * One real build (the `omega build` orchestration, not a fixture of half of
 * it) writes both the pages and `/service-worker.js`, so the two stamps come
 * out of the same process the way they do on a deploy.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { setEnvironment } = require('@omega.js/config/environment');
const { buildSite } = require('../src/build.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const SITE = path.join(__dirname, 'fixtures', 'contract-site');
const OUT = path.join(PKG, '.omega', `service-worker-stamp-out-${process.pid}`);

let pageStamp;
let workerSource;

/**
 * Run the BUILT worker bundle as a browser runs a classic worker script: one
 * iife against a worker global. Records every URL handed to importScripts.
 * @param {string} scriptUrl - the URL the worker was registered at
 * @returns {string[]} the imported URLs, in order
 */
function runWorker(scriptUrl) {
  const imported = [];
  const scope = {
    location: new URL(scriptUrl),
    addEventListener: () => {},
    skipWaiting: () => {},
    clients: { claim: async () => {}, openWindow: async () => {} },
    registration: { showNotification: () => {} },
    caches: { keys: async () => [], delete: async () => true, open: async () => ({ addAll: async () => {} }) },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL,
    URLSearchParams,
    importScripts: (...urls) => {
      imported.push(...urls);
      // What /build.js does when it runs: hand the worker its snapshot. No
      // cloud config, so the worker never reaches for the Firebase CDN.
      if (urls.some((url) => url.includes('build.js'))) {
        scope.OMEGA_BUILD_JSON = {
          config: { brand: { id: 'contract' }, environment: 'development', buildTime: 1 },
          package: { name: 'contract', version: '1.0.0' },
        };
      }
    },
  };
  scope.self = scope;
  scope.globalThis = scope;

  vm.runInNewContext(workerSource, scope, { filename: 'service-worker.js' });

  return imported;
}

module.exports = defineCases({
  type: 'group',
  description: 'service-worker-stamp',
  setup: async (ctx) => {
    setEnvironment('development');
    await buildSite({
      consumerDir: SITE,
      siteData: JSON.parse(fs.readFileSync(path.join(SITE, 'site-data.json'), 'utf8')),
      outDir: OUT,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      skipPurge: true,
    });

    const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
    const tag = html.match(/<script src="\/build\.js\?cb=([^"&]*)"><\/script>/);
    ctx.expect(tag, 'the rendered page loads /build.js with a ?cb= stamp').toBeTruthy();
    pageStamp = tag[1];

    workerSource = fs.readFileSync(path.join(OUT, 'service-worker.js'), 'utf8');
  },
  cleanup: () => fs.rmSync(OUT, { recursive: true, force: true }),
  tests: [
    {
      name: 'the page and the worker carry the same non-empty build stamp',
      run: (ctx) => {
        ctx.expect(pageStamp, 'the head stamp is the build timestamp').toMatch(/^\d+$/);
        ctx.expect(workerSource.includes(pageStamp), 'the stamp is baked into the worker bundle at build time').toBeTruthy();

        const buildImports = runWorker('https://example.com/service-worker.js').filter((url) => url.includes('build.js'));
        ctx.expect(buildImports).toEqual([`/build.js?cb=${pageStamp}`]);
      },
    },

    {
      name: 'under a mount, the stamped import still carries the prefix',
      run: (ctx) => {
        const buildImports = runWorker('https://example.com/workkit/service-worker.js?omega-path-prefix=%2Fworkkit')
          .filter((url) => url.includes('build.js'));

        ctx.expect(buildImports).toEqual([`/workkit/build.js?cb=${pageStamp}`]);
      },
    },
  ],
});
