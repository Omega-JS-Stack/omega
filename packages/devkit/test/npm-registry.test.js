// Unit tests for src/npm-registry.js — registry reads over real HTTP against a
// local server (no live-registry dependency, no mocks).

const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'npm-registry',
  tests: [
    {
      name: 'getPackageManifest returns the full latest manifest',
      run: (ctx) => withServer(async (registryUrl) => {
        const manifest = await getPackageManifest('left-pad', { registryUrl });
        ctx.expect(manifest.version).toBe('9.9.9');
        ctx.expect(manifest.peerDependencies).toEqual({ chalk: '^5.0.0' });
      }),
    },

    {
      name: 'scoped package names keep the leading @ and encode the slash',
      run: (ctx) => withServer(async (registryUrl) => {
        const manifest = await getPackageManifest('@omega.js/backend', { registryUrl });
        ctx.expect(manifest.name).toBe('@omega.js/backend');
      }),
    },

    {
      name: 'getLatestVersion returns the version string',
      run: (ctx) => withServer(async (registryUrl) => {
        ctx.expect(await getLatestVersion('left-pad', { registryUrl })).toBe('9.9.9');
      }),
    },

    {
      name: 'unknown package (404) resolves null, never throws',
      run: (ctx) => withServer(async (registryUrl) => {
        ctx.expect(await getPackageManifest('no-such-package', { registryUrl })).toBe(null);
        ctx.expect(await getLatestVersion('no-such-package', { registryUrl })).toBe(null);
      }),
    },

    {
      name: 'unreachable registry resolves null, never throws',
      run: async (ctx) => {
        // Port 1 is never listening — connection refused is the expected condition
        const manifest = await getPackageManifest('left-pad', { registryUrl: 'http://127.0.0.1:1', timeout: 2000 });
        ctx.expect(manifest).toBe(null);
      },
    },
  ],
});
