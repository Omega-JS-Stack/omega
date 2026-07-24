// Unit tests for src/npm-registry.js — registry reads over real HTTP against a
// local server (no live-registry dependency, no mocks).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { getPackageManifest, getLatestVersion } = require('../src/npm-registry');

const MANIFESTS = {
  '/left-pad/latest': { name: 'left-pad', version: '9.9.9', peerDependencies: { chalk: '^5.0.0' } },
  '/@omega.js%2Fbackend/latest': { name: '@omega.js/backend', version: '0.1.0' },
};

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const manifest = MANIFESTS[req.url];
      if (!manifest) {
        res.statusCode = 404;
        return res.end('{"error":"Not found"}');
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(manifest));
    });
    server.listen(0, '127.0.0.1', () => {
      const registryUrl = `http://127.0.0.1:${server.address().port}`;
      fn(registryUrl)
        .then(resolve, reject)
        .finally(() => server.close());
    });
  });
}

test('getPackageManifest returns the full latest manifest', () => withServer(async (registryUrl) => {
  const manifest = await getPackageManifest('left-pad', { registryUrl });
  assert.equal(manifest.version, '9.9.9');
  assert.deepEqual(manifest.peerDependencies, { chalk: '^5.0.0' });
}));

test('scoped package names keep the leading @ and encode the slash', () => withServer(async (registryUrl) => {
  const manifest = await getPackageManifest('@omega.js/backend', { registryUrl });
  assert.equal(manifest.name, '@omega.js/backend');
}));

test('getLatestVersion returns the version string', () => withServer(async (registryUrl) => {
  assert.equal(await getLatestVersion('left-pad', { registryUrl }), '9.9.9');
}));

test('unknown package (404) resolves null, never throws', () => withServer(async (registryUrl) => {
  assert.equal(await getPackageManifest('no-such-package', { registryUrl }), null);
  assert.equal(await getLatestVersion('no-such-package', { registryUrl }), null);
}));

test('unreachable registry resolves null, never throws', async () => {
  // Port 1 is never listening — connection refused is the expected condition
  const manifest = await getPackageManifest('left-pad', { registryUrl: 'http://127.0.0.1:1', timeout: 2000 });
  assert.equal(manifest, null);
});
