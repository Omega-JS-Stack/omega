/**
 * Targets keyed by NAME (#886): a brand runs two web-typed targets by
 * declaring two names, and every manager surface addresses them by that one
 * word. What this holds:
 *   - discovery types both dirs from the brand's own `type`, no dir convention;
 *   - the workspace structure op wants `targets/<name>` per declared name;
 *   - the testing service checks each target on ITS url (the name as a
 *     subdomain of the brand host, the brand url for the type-named one) and
 *     records deploys under the same name.
 * Real brand fixtures, recording fetch/exec fakes on the same seams as
 * testing.test.js.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677).
require('@omega.js/devkit/test/temp-home');

const { loadBrand } = require('../src/lib/brand.js');
const { OPERATIONS } = require('../src/config.js');
const structure = require('../src/services/workspace/ensure/structure.js');
const testingService = require('../src/services/testing/index.js');

const WEB_URL = 'https://fixture-brand.test';
const ADMIN_URL = 'https://admin.fixture-brand.test';

const TWO_WEB_CONFIG = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: '${WEB_URL}' },
  targets: {
    web: { type: 'web' },
    admin: { type: 'web' },
  },
}`;

function stageBrand({ config = TWO_WEB_CONFIG, dirs = ['web', 'admin'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-targets-'));
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

// Same recording fakes as testing.test.js: a reusable Error = network failure
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

// ─── Testing service: the backend's api-health record keys by NAME ───────────

const API_HEALTH_URL = 'https://api.fixture-brand.test/omega/health';

const NAMED_BACKEND_CONFIG = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: '${WEB_URL}' },
  targets: {
    web: { type: 'web' },
    api: { type: 'backend' },
  },
}`;

module.exports = defineCases({
  type: 'group',
  description: 'targets-by-name',
  tests: [
    // ─── Target discovery + structure op ─────────────────────────────────────────

    {
      name: 'discoverTargets types every declared name from the brand file, two web targets included',
      run: (ctx) => {
        const root = stageBrand();
        const brand = loadBrand(root);

        const byName = Object.fromEntries(brand.targets.map((entry) => [entry.name, entry.target]));
        ctx.expect(byName.web).toBe('web');
        ctx.expect(byName.admin, 'the second web target needs no naming convention').toBe('web');
        ctx.expect(brand.enabledTargets).toEqual(['web', 'admin']);
      },
    },

    {
      name: 'structure: every declared name has its own dir, and both names pass',
      run: async (ctx) => {
        const root = stageBrand();

        const result = await runStructure(root);
        ctx.expect(result.status).not.toBe('error');
      },
    },

    {
      name: 'structure: a declared name with no dir is the create-this-dir error',
      run: async (ctx) => {
        const root = stageBrand({ dirs: ['web'] });

        const result = await runStructure(root);
        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/declared target "admin" has no dir, create targets\/admin\//);

        // Creating the dir heals it
        jetpack.write(join(root, 'targets', 'admin', 'package.json'), { name: 'fixture-admin', private: true });
        const healed = await runStructure(root);
        ctx.expect(healed.status).not.toBe('error');
      },
    },

    // ─── Testing service: per-name live URLs + deploy records ────────────────────

    {
      name: 'testing: each target is checked on ITS url; a live record-less target adopts under its own name',
      run: async (ctx) => {
        const root = stageBrand();
        // web already deployed; admin has no record yet
        jetpack.write(join(root, '.omega', 'state.json'), { deploy: { web: { at: '2026-07-17T00:00:00.000Z' } } });

        const fetch = fakeFetch({ [WEB_URL]: { status: 200 }, [ADMIN_URL]: { status: 200 } });
        const result = await runTesting(root, { fetch });

        ctx.expect(result.status).toBe('success');
        ctx.expect(fetch.calls.includes(WEB_URL), 'the type-named target is the brand url').toBeTruthy();
        ctx.expect(fetch.calls.includes(ADMIN_URL), 'admin derives its own subdomain').toBeTruthy();

        const records = jetpack.read(join(root, '.omega', 'state.json'), 'json').deploy;
        ctx.expect(records.admin.adopted, 'the live hit adopted under the target name').toBe(true);
        ctx.expect(records.web.adopted, 'the existing record was not rewritten').toBe(undefined);
      },
    },

    {
      name: 'testing: a down record-less target nudges (not deployed yet) while a recorded live one passes',
      run: async (ctx) => {
        const root = stageBrand();
        jetpack.write(join(root, '.omega', 'state.json'), { deploy: { web: { at: '2026-07-17T00:00:00.000Z' } } });

        const fetch = fakeFetch({ [WEB_URL]: { status: 200 }, [ADMIN_URL]: new Error('getaddrinfo ENOTFOUND') });
        const result = await runTesting(root, { fetch });

        ctx.expect(result.status, 'a never-deployed admin warns, never errors').toBe('warned');
        const warned = result.output.results.warned.map((w) => w.name);
        ctx.expect(warned.includes('admin: homepage')).toBeTruthy();
        ctx.expect(result.output.results.passed.includes('web: homepage')).toBeTruthy();
      },
    },

    {
      name: 'testing: a down target WITH a deploy record is an honest per-target error',
      run: async (ctx) => {
        const root = stageBrand();
        jetpack.write(join(root, '.omega', 'state.json'), {
          deploy: {
            web: { at: '2026-07-17T00:00:00.000Z' },
            admin: { at: '2026-07-17T00:00:00.000Z' },
          },
        });

        const fetch = fakeFetch({ [WEB_URL]: { status: 200 }, [ADMIN_URL]: new Error('ECONNREFUSED') });
        const result = await runTesting(root, { fetch });

        ctx.expect(result.status).toBe('error');
        const failed = result.output.results.failed.map((f) => f.name);
        ctx.expect(failed, 'only the down target fails').toEqual(['admin: homepage']);
        ctx.expect(result.output.results.passed.includes('web: homepage')).toBeTruthy();
      },
    },

    {
      name: 'testing: a live backend named api adopts its deploy record under "api", not "backend"',
      run: async (ctx) => {
        const root = stageBrand({ config: NAMED_BACKEND_CONFIG, dirs: ['web'] });
        jetpack.write(join(root, 'targets', 'api', 'package.json'), { name: 'fixture-api', private: true });
        jetpack.write(join(root, 'targets', 'api', 'firebase.json'), { functions: {} });
        jetpack.write(join(root, 'targets', 'api', 'dist', 'package.json'), { name: 'fixture-api-dist' });
        jetpack.write(join(root, '.omega', 'state.json'), { deploy: { web: { at: '2026-07-17T00:00:00.000Z' } } });

        const fetch = fakeFetch({ [WEB_URL]: { status: 200 }, [API_HEALTH_URL]: { status: 200 } });
        const result = await runTesting(root, { fetch });

        ctx.expect(result.status).toBe('success');
        const records = jetpack.read(join(root, '.omega', 'state.json'), 'json').deploy;
        ctx.expect(records.api.adopted, 'the live hit adopted under the target name').toBe(true);
        ctx.expect(records.backend, 'nothing is keyed by the type word').toBe(undefined);
      },
    },

    {
      name: 'discoverTargets reads projectType from the backend-TYPED entry, whatever its name',
      run: (ctx) => {
        const root = stageBrand({
          config: `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: '${WEB_URL}' },
  targets: {
    web: { type: 'web' },
    api: { type: 'backend', projectType: 'custom' },
  },
}`,
          dirs: ['web', 'api'],
        });

        const brand = loadBrand(root);
        const api = brand.targets.find((entry) => entry.name === 'api');
        ctx.expect(api.target).toBe('backend');
        ctx.expect(api.projectType, 'the mode comes from the entry, not from a key named backend').toBe('custom');
      },
    },
  ],
});
