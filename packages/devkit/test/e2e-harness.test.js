// Unit tests for src/test/e2e-harness.js — the generalized brand e2e harness.
//
// Real-execution only (no mocks): target discovery runs against temp-dir
// fixtures, step() accounting runs real (throwing/passing) functions, and the
// static site server serves real files over a real HTTP socket (including the
// path-traversal guard). The full boot flow (emulator + puppeteer) is left to
// the sandbox brand's live e2e — too heavy for a unit test.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { E2eHarness, discoverTargets } = require('../src/test/e2e-harness');

function makeTempBrand(structure) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-harness-test-'));
  for (const relative of structure) {
    const target = path.join(root, relative);
    if (relative.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, relative.endsWith('.json') ? '{}' : '');
    }
  }
  return root;
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: data, headers: response.headers }));
    }).on('error', reject);
  });
}

// ---- discoverTargets

test('discoverTargets finds backend and website app dirs', () => {
  const root = makeTempBrand(['apps/backend/package.json', 'apps/website/package.json']);
  const targets = discoverTargets(root);
  assert.equal(targets.backend, path.join(root, 'apps', 'backend'));
  assert.equal(targets.website, path.join(root, 'apps', 'website'));
});

test('discoverTargets returns nulls for missing apps and missing apps dir', () => {
  const partial = makeTempBrand(['apps/website/package.json']);
  assert.equal(discoverTargets(partial).backend, null);
  assert.equal(discoverTargets(partial).website, path.join(partial, 'apps', 'website'));

  const bare = makeTempBrand([]);
  assert.deepEqual(discoverTargets(bare), { backend: null, website: null });
});

test('discoverTargets ignores dot-dirs and plain files in apps/', () => {
  const root = makeTempBrand(['apps/.DS_Store', 'apps/notes.md', 'apps/backend/package.json']);
  const targets = discoverTargets(root);
  assert.equal(targets.backend, path.join(root, 'apps', 'backend'));
  assert.equal(targets.website, null);
});

// ---- step() accounting

test('step records failures and rethrows; passes do not accumulate', async () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);

  await harness.step('passing step', async () => 'detail');
  assert.equal(harness.failures.length, 0);

  await assert.rejects(
    () => harness.step('failing step', async () => { throw new Error('boom'); }),
    /boom/,
  );
  assert.equal(harness.failures.length, 1);
  assert.equal(harness.failures[0].name, 'failing step');
});

// ---- static site server

test('site server serves files, 404s missing paths, and blocks traversal', async () => {
  const root = makeTempBrand(['apps/website/package.json']);
  const distDir = path.join(root, 'apps', 'website', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<h1>harness fixture site</h1>');
  fs.writeFileSync(path.join(distDir, 'app.js'), 'console.log("hi");');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'must not be served');

  const harness = new E2eHarness(root, { sitePort: 4655 });
  const server = await harness._startSiteServer(distDir);

  try {
    const index = await get(`http://localhost:4655/`);
    assert.equal(index.status, 200);
    assert.match(index.body, /harness fixture site/);
    assert.match(index.headers['content-type'], /text\/html/);

    const js = await get(`http://localhost:4655/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers['content-type'], /text\/javascript/);

    const missing = await get(`http://localhost:4655/nope.html`);
    assert.equal(missing.status, 404);

    // Encoded traversal must not escape dist/
    const traversal = await get(`http://localhost:4655/..%2f..%2fsecret.txt`);
    assert.equal(traversal.status, 404);
  } finally {
    server.close();
  }
});

// ---- teardown

test('teardown writes page.log (even empty) and closes the site server', async () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root, { sitePort: 4656 });
  const distDir = path.join(root, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  harness.siteServer = await harness._startSiteServer(distDir);

  await harness.teardown();

  const pageLog = path.join(root, 'e2e', '.logs', 'page.log');
  assert.equal(fs.existsSync(pageLog), true, 'page.log must exist even with no console output');
  assert.equal(harness.siteServer, null);

  // Port must actually be free again
  await assert.rejects(() => get('http://localhost:4656/'));
});
