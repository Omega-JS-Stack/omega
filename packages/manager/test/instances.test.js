/**
 * Multi-instance targets in the manager (_attic/plans/multi-instance-targets.md):
 * the workspace structure op's per-instance target-dir expectations (enabled
 * instance without its dir = the same create-this-dir error as today) and
 * the testing service's per-instance live-URL checks + per-instance deploy
 * records — real brand fixtures, recording fetch/exec fakes on the same
 * seams as testing.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { loadBrand } = require('../src/lib/brand.js');
const { OPERATIONS } = require('../src/config.js');
const structure = require('../src/services/workspace/ensure/structure.js');
const testingService = require('../src/services/testing/index.js');

const MAIN_URL = 'https://fixture-brand.test';
const ADMIN_URL = 'https://admin.fixture-brand.test';

const TWO_INSTANCE_CONFIG = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: '${MAIN_URL}' },
  targets: {
    web: [
      { id: 'main' },
      { id: 'admin', url: '${ADMIN_URL}' },
    ],
  },
}`;

function stageBrand({ config = TWO_INSTANCE_CONFIG, dirs = ['website', 'website-admin'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-instances-'));
  jetpack.write(join(root, 'package.json'), { name: 'fixture-brand', private: true, workspaces: ['targets/*'] });
  jetpack.write(join(root, 'config', 'omega.json5'), config);
  for (const dir of dirs) {
    jetpack.write(join(root, 'targets', dir, 'package.json'), { name: `fixture-${dir}`, private: true });
    jetpack.write(join(root, 'targets', dir, 'dist', 'index.html'), '<!doctype html><title>fixture</title>');
  }
  return root;
}

async function runStructure(root) {
  const brand = loadBrand(root);
  return structure({ brandRoot: root, brand, targets: brand.targets });
}

// Same recording fakes as testing.test.js — reusable Error = network failure
function fakeFetch(responses = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (!(url in responses)) throw new Error(`fakeFetch: unexpected fetch ${url}`);
    const spec = responses[url];
    if (spec instanceof Error) throw spec;
    return { status: spec.status, json: async () => { throw new Error('no body'); } };
  };
  fn.calls = calls;
  return fn;
}

async function runTesting(root, { fetch }) {
  const brand = loadBrand(root);
  return testingService.run({
    brandId: 'fixture-brand',
    brandRoot: root,
    brandConfig: brand.config,
    targets: brand.targets,
    operations: OPERATIONS.testing,
    options: { fetch, exec: () => { throw new Error('no exec in this test'); }, retryDelayMs: 0 },
    serviceData: {},
  });
}

// ─── Target discovery + structure op ─────────────────────────────────────────

test('discoverTargets maps instance dirs to their target; loadBrand keeps the array form intact', () => {
  const root = stageBrand();
  const brand = loadBrand(root);

  const byName = Object.fromEntries(brand.targets.map((entry) => [entry.name, entry.target]));
  assert.equal(byName['website'], 'web');
  assert.equal(byName['website-admin'], 'web');
  assert.ok(Array.isArray(brand.config.targets.web), 'the whole-file merge preserves the instances array');
});

test('structure: enabled instance without its dir is the create-this-dir error (same shape as today)', async () => {
  const root = stageBrand({ dirs: ['website'] });

  const result = await runStructure(root);
  assert.equal(result.status, 'error');
  assert.match(result.error, /enabled target "web" instance "admin" has no dir — create targets\/website-admin\//);

  // Creating the dir heals it
  jetpack.write(join(root, 'targets', 'website-admin', 'package.json'), { name: 'fixture-website-admin', private: true });
  const healed = await runStructure(root);
  assert.notEqual(healed.status, 'error');
});

test('structure: the main instance of an array-form target expects the canonical dir', async () => {
  const root = stageBrand({ dirs: ['website-admin'] });

  const result = await runStructure(root);
  assert.equal(result.status, 'error');
  assert.match(result.error, /instance "main" has no dir — create targets\/website\//);
});

test('structure: single-object form keeps today\'s any-dir-of-the-type check (zero breaking change)', async () => {
  const root = stageBrand({
    config: `{
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: '${MAIN_URL}' },
      targets: { web: {} },
    }`,
    dirs: ['website-docs'],
  });

  // A suffixed dir satisfies the object form — exactly as before
  const result = await runStructure(root);
  assert.notEqual(result.status, 'error');
});

// ─── Testing service: per-instance live URLs + deploy records ────────────────

test('testing: each web instance is checked on ITS url; a live record-less instance adopts under its own key', async () => {
  const root = stageBrand();
  // main already deployed; admin has no record yet
  jetpack.write(join(root, '.omega', 'deploys.json'), { web: { at: '2026-07-17T00:00:00.000Z' } });

  const fetch = fakeFetch({ [MAIN_URL]: { status: 200 }, [ADMIN_URL]: { status: 200 } });
  const result = await runTesting(root, { fetch });

  assert.equal(result.status, 'success');
  assert.ok(fetch.calls.includes(MAIN_URL), 'main checked on the brand url');
  assert.ok(fetch.calls.includes(ADMIN_URL), 'admin checked on the instance url');

  const records = jetpack.read(join(root, '.omega', 'deploys.json'), 'json');
  assert.equal(records['web:admin'].adopted, true, 'live hit adopted under the instance key');
  assert.equal(records.web.adopted, undefined, 'the primary record was not rewritten');
});

test('testing: a down record-less instance nudges (not deployed yet) while a recorded live main passes', async () => {
  const root = stageBrand();
  jetpack.write(join(root, '.omega', 'deploys.json'), { web: { at: '2026-07-17T00:00:00.000Z' } });

  const fetch = fakeFetch({ [MAIN_URL]: { status: 200 }, [ADMIN_URL]: new Error('getaddrinfo ENOTFOUND') });
  const result = await runTesting(root, { fetch });

  assert.equal(result.status, 'warned', 'never-deployed admin warns, never errors');
  const warned = result.output.results.warned.map((w) => w.name);
  assert.ok(warned.includes('website-admin: homepage'));
  assert.ok(result.output.results.passed.includes('website: homepage'));
});

test('testing: a down instance WITH a deploy record is an honest per-instance error', async () => {
  const root = stageBrand();
  jetpack.write(join(root, '.omega', 'deploys.json'), {
    web: { at: '2026-07-17T00:00:00.000Z' },
    'web:admin': { at: '2026-07-17T00:00:00.000Z' },
  });

  const fetch = fakeFetch({ [MAIN_URL]: { status: 200 }, [ADMIN_URL]: new Error('ECONNREFUSED') });
  const result = await runTesting(root, { fetch });

  assert.equal(result.status, 'error');
  const failed = result.output.results.failed.map((f) => f.name);
  assert.deepEqual(failed, ['website-admin: homepage'], 'only the down instance fails');
  assert.ok(result.output.results.passed.includes('website: homepage'));
});
