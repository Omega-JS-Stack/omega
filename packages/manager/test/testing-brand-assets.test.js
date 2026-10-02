/**
 * Testing service: the live brand-asset probes. After the homepage passes, a
 * brand whose logo source is `assets/logo/brandmark.svg` has its live favicon
 * and brandmark asked for; a miss fails naming the URL, and a dry run lists
 * the probes instead of making them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
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

test('testing: a brandmark source → the live favicon and brandmark are probed after the homepage, 200 passes', async () => {
  const { report, fetch } = await runAssetProbes({ responses: { [FAVICON]: { status: 200 }, [BRANDMARK]: { status: 200 } } });

  assert.equal(report.status, 'success');
  assert.deepEqual([fetch.calls[0], ...fetch.calls.slice(1).sort()], [HOMEPAGE, BRANDMARK, FAVICON], 'the homepage first');
});

test('testing: a live brand asset answering 404 fails the service, naming the URL', async () => {
  const { report } = await runAssetProbes({ responses: { [FAVICON]: { status: 200 }, [BRANDMARK]: { status: 404 } } });

  assert.equal(report.status, 'error');
  const { failed } = report.output.results;
  assert.ok(failed.length === 1 && failed[0].error.includes(BRANDMARK), JSON.stringify(failed));
});

test('testing: no logo sources → neither asset is probed', async () => {
  const { report, fetch } = await runAssetProbes({ logo: [] });

  assert.equal(report.status, 'success');
  assert.deepEqual(fetch.calls, [HOMEPAGE]);
});

test('testing: a wordmark with no brandmark source → neither asset is probed', async () => {
  const { report, fetch } = await runAssetProbes({ logo: ['wordmark.svg'] });

  assert.equal(report.status, 'success');
  assert.deepEqual(fetch.calls, [HOMEPAGE]);
});

test('testing: dry-run with a brandmark source lists both asset probes and fetches nothing', async () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  let fetch;
  try {
    ({ fetch } = await runAssetProbes({ options: { dryRun: true } }));
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(fetch.calls, []);
  for (const url of [FAVICON, BRANDMARK]) {
    assert.ok(lines.some((line) => line.includes('would') && line.includes(url)), `a would-line for ${url}`);
  }
});
