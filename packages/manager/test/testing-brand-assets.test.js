/**
 * Testing service: the live brand-asset probes. After the homepage passes, a
 * brand whose logo source is `assets/logo/brandmark.svg` has its live favicon
 * and brandmark asked for; a miss fails naming the URL, and a dry run lists
 * the probes instead of making them.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

// Fixtures write into a temp home, never the developer's ~/.omega.
require('@omega.js/devkit/test/temp-home');

const {
  HOMEPAGE, GIT_CMD, stageBrand, seedDeployRecord, brandConfig, stageWebTarget, fakeFetch, fakeExec, runService,
} = require('./lib/testing-fixtures.js');

const FAVICON = 'https://fixture-brand.test/favicon.ico';
const BRANDMARK = 'https://fixture-brand.test/assets/images/brand/brandmark.png';

/** A deployed web-only brand carrying the given `assets/logo/` files, run against `responses`. */
async function runAssetProbes({ logo = ['brandmark.svg'], responses = {}, options = {} } = {}) {
  const root = stageBrand();
  seedDeployRecord(root, 'web');
  for (const file of logo) jetpack.write(join(root, 'assets', 'logo', file), '<svg/>');
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 }, ...responses });
  const exec = fakeExec({ [GIT_CMD]: '' });
  const report = await runService(brandConfig({ targets: { web: { type: 'web' } } }), { root, targets: [stageWebTarget(root)], fetch, exec, options });
  return { report, fetch };
}

module.exports = defineCases({
  type: 'group',
  description: 'testing-brand-assets',
  tests: [
    {
      name: 'testing: a brandmark source → the live favicon and brandmark are probed after the homepage, 200 passes',
      run: async (ctx) => {
        const { report, fetch } = await runAssetProbes({ responses: { [FAVICON]: { status: 200 }, [BRANDMARK]: { status: 200 } } });

        ctx.expect(report.status).toBe('success');
        ctx.expect([fetch.calls[0], ...fetch.calls.slice(1).sort()], 'the homepage first').toEqual([HOMEPAGE, BRANDMARK, FAVICON]);
      },
    },

    {
      name: 'testing: a live brand asset answering 404 fails the service, naming the URL',
      run: async (ctx) => {
        const { report } = await runAssetProbes({ responses: { [FAVICON]: { status: 200 }, [BRANDMARK]: { status: 404 } } });

        ctx.expect(report.status).toBe('error');
        const { failed } = report.output.results;
        ctx.expect(failed.length === 1 && failed[0].error.includes(BRANDMARK), JSON.stringify(failed)).toBeTruthy();
      },
    },

    {
      name: 'testing: no logo sources → neither asset is probed',
      run: async (ctx) => {
        const { report, fetch } = await runAssetProbes({ logo: [] });

        ctx.expect(report.status).toBe('success');
        ctx.expect(fetch.calls).toEqual([HOMEPAGE]);
      },
    },

    {
      name: 'testing: a wordmark with no brandmark source → neither asset is probed',
      run: async (ctx) => {
        const { report, fetch } = await runAssetProbes({ logo: ['wordmark.svg'] });

        ctx.expect(report.status).toBe('success');
        ctx.expect(fetch.calls).toEqual([HOMEPAGE]);
      },
    },

    {
      name: 'testing: dry-run with a brandmark source lists both asset probes and fetches nothing',
      run: async (ctx) => {
        const lines = [];
        const originalLog = console.log;
        console.log = (...args) => lines.push(args.join(' '));
        let fetch;
        try {
          ({ fetch } = await runAssetProbes({ options: { dryRun: true } }));
        } finally {
          console.log = originalLog;
        }

        ctx.expect(fetch.calls).toEqual([]);
        for (const url of [FAVICON, BRANDMARK]) {
          ctx.expect(lines.some((line) => line.includes('would') && line.includes(url)), `a would-line for ${url}`).toBeTruthy();
        }
      },
    },
  ],
});
