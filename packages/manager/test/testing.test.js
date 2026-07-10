/**
 * Testing service tests — per-app local checks and live checks against
 * recording fetch/exec fakes (injected via options, the same seam runManage
 * exposes), with the check pipeline, retry loop, and version comparison
 * real. Proves the all-green pass set, retry pins on network errors and
 * non-2xx statuses, the framework-version states (up to date / outdated /
 * unpublished / not installed), the shared-Firebase and no-URL gates,
 * working-tree and GitHub Actions outcomes, the dry-run zero-network
 * guarantee, and the honest error on missing build output.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { SERVICE_ORDER, OPERATIONS, TARGET_FRAMEWORKS } = require('../src/config.js');
const { compareVersions, installedVersion } = require('../src/services/testing/lib/checks.js');
const service = require('../src/services/testing/index.js');

const HOMEPAGE = 'https://fixture-brand.test';
const API_URL = 'https://api.fixture-brand.test/backend-manager/test/health';
const GH_CMD = 'gh run list --repo sandbox-org/fixture-brand --limit 1 --json status,conclusion,name';
const GIT_CMD = 'git status --porcelain -- .';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function stageBrand() {
  return mkdtempSync(join(tmpdir(), 'omega-testing-'));
}

function brandConfig(overrides = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: HOMEPAGE },
    targets: { web: {}, backend: {} },
    ...overrides,
  };
}

/** Stage apps/website — optionally with a built dist and a framework dep. */
function stageWebApp(root, { dist = true, declared = null, installed = null } = {}) {
  const appPath = join(root, 'apps', 'website');
  jetpack.write(join(appPath, 'package.json'), {
    name: 'fixture-website',
    private: true,
    ...(declared ? { dependencies: { '@omega.js/web': declared } } : {}),
  });
  if (dist) {
    jetpack.write(join(appPath, 'dist', 'index.html'), '<!doctype html><title>fixture</title>');
  }
  if (installed) {
    jetpack.write(join(appPath, 'node_modules', '@omega.js/web', 'package.json'), {
      name: '@omega.js/web',
      version: installed,
    });
  }
  return { name: 'website', dir: 'apps/website', path: appPath, target: 'web' };
}

/** Stage apps/backend — firebase.json + functions with a file: framework dep. */
function stageBackendApp(root, { installed = '5.9.0' } = {}) {
  const appPath = join(root, 'apps', 'backend');
  jetpack.write(join(appPath, 'package.json'), { name: 'fixture-backend', private: true });
  jetpack.write(join(appPath, 'firebase.json'), {});
  jetpack.write(join(appPath, 'functions', 'package.json'), {
    name: 'fixture-functions',
    private: true,
    dependencies: { '@omega.js/backend': 'file:../../../../packages/backend' },
  });
  if (installed) {
    jetpack.write(join(appPath, 'functions', 'node_modules', '@omega.js/backend', 'package.json'), {
      name: '@omega.js/backend',
      version: installed,
    });
  }
  return { name: 'backend', dir: 'apps/backend', path: appPath, target: 'backend' };
}

/**
 * Recording fetch fake keyed by URL. Spec per URL: { status, body? } (body
 * absent → json() throws like a non-JSON response), an Error (network
 * failure, reusable), or an array of those consumed one per call.
 */
function fakeFetch(responses = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (!(url in responses)) {
      throw new Error(`fakeFetch: unexpected fetch ${url}`);
    }
    let spec = responses[url];
    if (Array.isArray(spec)) {
      if (spec.length === 0) throw new Error(`fakeFetch: exhausted responses for ${url}`);
      spec = spec.shift();
    }
    if (spec instanceof Error) throw spec;
    return {
      status: spec.status,
      json: async () => {
        if (!('body' in spec)) throw new Error('no body');
        return structuredClone(spec.body);
      },
    };
  };
  fn.calls = calls;
  return fn;
}

/**
 * Recording exec fake keyed by exact command. Spec: stdout string or an
 * Error to throw. Records [command, cwd|null]. Unconfigured commands throw
 * — checks that swallow exec errors (git, gh, npm view) dim out by design.
 */
function fakeExec(responses = {}) {
  const calls = [];
  const fn = (command, options = {}) => {
    calls.push([command, options.cwd || null]);
    if (!(command in responses)) {
      throw new Error(`fakeExec: unexpected command ${command}`);
    }
    const spec = responses[command];
    if (spec instanceof Error) throw spec;
    return spec;
  };
  fn.calls = calls;
  return fn;
}

async function runService(config, { root, apps, fetch, exec, options = {} }) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: root,
    brandConfig: config,
    brandState: {},
    apps,
    operations: OPERATIONS.testing,
    options: { fetch, exec, retryDelayMs: 0, ...options },
    serviceData: {},
  });
}

// ─── Registry / lib units ────────────────────────────────────────────────────

test('testing: last in SERVICE_ORDER, with the target-checks operation', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.length - 1], 'testing');
  assert.deepEqual(OPERATIONS.testing, [{ name: 'target-checks', ensure: true }]);
});

test('testing: TARGET_FRAMEWORKS maps every checkable target, mobile reserved', () => {
  assert.deepEqual(TARGET_FRAMEWORKS, {
    web: '@omega.js/web',
    backend: '@omega.js/backend',
    extension: '@omega.js/extension',
    desktop: '@omega.js/desktop',
  });
});

test('compareVersions: numeric x.y.z ordering', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.3', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('installedVersion: resolves through the node_modules climb, null when absent', () => {
  const root = stageBrand();
  const app = stageWebApp(root, { installed: '1.4.2' });

  // From a nested dir inside the app, the climb still finds it
  assert.equal(installedVersion(join(app.path, 'dist'), '@omega.js/web'), '1.4.2');
  assert.equal(installedVersion(app.path, 'no-such-package'), null);
});

// ─── Full stack all-green ────────────────────────────────────────────────────

test('testing: web + backend all green — exact pass set, single npm view per package, one fetch per URL', async () => {
  const root = stageBrand();
  const apps = [
    stageWebApp(root, { declared: '^1.0.0', installed: '1.0.0' }),
    stageBackendApp(root, { installed: '5.9.0' }),
  ];
  const fetch = fakeFetch({
    [HOMEPAGE]: { status: 200 },
    [API_URL]: { status: 200, body: { status: 'healthy', backendVersion: '5.9.0' } },
  });
  const exec = fakeExec({
    'npm view @omega.js/web version': '1.0.0\n',
    'npm view @omega.js/backend version': '5.9.0\n',
    [GIT_CMD]: '',
  });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'success');
  assert.deepEqual(report.output, {
    results: {
      passed: [
        'website: package.json',
        'website: build output',
        'website: @omega.js/web',
        'website: homepage',
        'backend: package.json',
        'backend: firebase.json',
        'backend: functions/package.json',
        'backend: @omega.js/backend',
        'backend: API health',
        'backend: deployed backend',
        'working tree',
      ],
      warned: [],
      failed: [],
    },
    counts: { passed: 11, warned: 0, failed: 0 },
  });

  // One fetch per URL, one npm view per package (deployed check hits the
  // cache), git scoped to the brand root
  assert.deepEqual(fetch.calls, [HOMEPAGE, API_URL]);
  assert.deepEqual(exec.calls, [
    ['npm view @omega.js/web version', null],
    ['npm view @omega.js/backend version', null],
    [GIT_CMD, root],
  ]);
});

// ─── Framework version states ────────────────────────────────────────────────

test('testing: outdated framework → warned with the version delta', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root, { declared: '^1.0.0', installed: '1.0.0' })];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const exec = fakeExec({ 'npm view @omega.js/web version': '1.2.0\n', [GIT_CMD]: '' });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'warned');
  assert.deepEqual(report.output.results.warned, [
    { name: 'website: @omega.js/web', warning: 'outdated (1.0.0 → 1.2.0)' },
  ]);
});

test('testing: unpublished framework (npm view fails) dims out — no warning, no pass entry', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root, { declared: '^1.0.0', installed: '1.0.0' })];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const exec = fakeExec({
    'npm view @omega.js/web version': new Error('404 Not Found - @omega.js/web'),
    [GIT_CMD]: '',
  });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'success');
  assert.ok(!report.output.results.passed.includes('website: @omega.js/web'));
  assert.deepEqual(report.output.results.warned, []);
});

test('testing: framework declared via file: but not installed → dim note, npm never consulted', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root, { declared: 'file:../../packages/web' })];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const exec = fakeExec({ [GIT_CMD]: '' });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'success');
  assert.deepEqual(exec.calls, [[GIT_CMD, root]]);
});

// ─── Homepage ────────────────────────────────────────────────────────────────

test('testing: homepage network error retries 3× then fails the service', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root)];
  const fetch = fakeFetch({ [HOMEPAGE]: new Error('getaddrinfo ENOTFOUND fixture-brand.test') });
  const exec = fakeExec({ [GIT_CMD]: '' });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'error');
  assert.deepEqual(fetch.calls, [HOMEPAGE, HOMEPAGE, HOMEPAGE]);
  assert.deepEqual(report.output.results.failed, [
    { name: 'website: homepage', error: `${HOMEPAGE} → getaddrinfo ENOTFOUND fixture-brand.test` },
  ]);
  assert.match(report.error, /website: homepage/);
});

test('testing: homepage 500 then 200 — non-2xx retries and recovers', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root)];
  const fetch = fakeFetch({ [HOMEPAGE]: [{ status: 500 }, { status: 200 }] });
  const exec = fakeExec({ [GIT_CMD]: '' });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'success');
  assert.deepEqual(fetch.calls, [HOMEPAGE, HOMEPAGE]);
  assert.ok(report.output.results.passed.includes('website: homepage'));
});

// ─── API health ──────────────────────────────────────────────────────────────

test('testing: shared Firebase project → API health dims out, zero fetches', async () => {
  const root = stageBrand();
  const apps = [stageBackendApp(root)];
  const fetch = fakeFetch({});
  const exec = fakeExec({ 'npm view @omega.js/backend version': '5.9.0\n', [GIT_CMD]: '' });

  const report = await runService(brandConfig({ firebase: { shared: true }, targets: { backend: {} } }), { root, apps, fetch, exec });

  assert.equal(report.status, 'success');
  assert.deepEqual(fetch.calls, []);
});

test('testing: deployed backend older than npm latest → warned', async () => {
  const root = stageBrand();
  const apps = [stageBackendApp(root, { installed: '5.9.0' })];
  const fetch = fakeFetch({ [API_URL]: { status: 200, body: { backendVersion: '5.0.0' } } });
  const exec = fakeExec({ 'npm view @omega.js/backend version': '5.9.0\n', [GIT_CMD]: '' });

  const report = await runService(brandConfig({ targets: { backend: {} } }), { root, apps, fetch, exec });

  assert.equal(report.status, 'warned');
  assert.deepEqual(report.output.results.warned, [
    { name: 'backend: deployed backend', warning: 'outdated (5.0.0 → 5.9.0)' },
  ]);
});

test('testing: API returning 503 retries 3× then fails', async () => {
  const root = stageBrand();
  const apps = [stageBackendApp(root, { installed: null })];
  const fetch = fakeFetch({ [API_URL]: { status: 503 } });
  const exec = fakeExec({ 'npm view @omega.js/backend version': '5.9.0\n', [GIT_CMD]: '' });

  const report = await runService(brandConfig({ targets: { backend: {} } }), { root, apps, fetch, exec });

  assert.equal(report.status, 'error');
  assert.deepEqual(fetch.calls, [API_URL, API_URL, API_URL]);
  assert.deepEqual(report.output.results.failed, [
    { name: 'backend: API health', error: `${API_URL} → 503` },
  ]);
});

test('testing: no brand.url → homepage and API health warn, zero fetches', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root), stageBackendApp(root)];
  const fetch = fakeFetch({});
  const exec = fakeExec({ 'npm view @omega.js/backend version': '5.9.0\n', [GIT_CMD]: '' });

  const config = brandConfig();
  delete config.brand.url;
  const report = await runService(config, { root, apps, fetch, exec });

  assert.equal(report.status, 'warned');
  assert.deepEqual(fetch.calls, []);
  assert.deepEqual(report.output.results.warned.map((w) => w.name), [
    'website: homepage',
    'backend: API health',
  ]);
});

// ─── Repo-level checks ───────────────────────────────────────────────────────

test('testing: dirty working tree → warned with the file count', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root)];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const exec = fakeExec({ [GIT_CMD]: ' M src/a.js\n?? notes.txt\n' });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'warned');
  assert.deepEqual(report.output.results.warned, [
    { name: 'working tree', warning: '2 uncommitted files' },
  ]);
});

test('testing: not a git repository → working tree check silently absent', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root)];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const exec = fakeExec({ [GIT_CMD]: new Error('fatal: not a git repository') });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'success');
  const names = [
    ...report.output.results.passed,
    ...report.output.results.warned.map((w) => w.name),
    ...report.output.results.failed.map((f) => f.name),
  ];
  assert.ok(!names.includes('working tree'));
});

test('testing: GitHub Actions success — exact gh command, repo defaults to brandId', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root)];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const exec = fakeExec({
    [GIT_CMD]: '',
    [GH_CMD]: '[{"status":"completed","conclusion":"success","name":"Build"}]',
  });

  const report = await runService(brandConfig({ github: { org: 'sandbox-org' } }), { root, apps, fetch, exec });

  assert.equal(report.status, 'success');
  assert.ok(report.output.results.passed.includes('GitHub Actions'));
  assert.ok(exec.calls.some(([cmd]) => cmd === GH_CMD));
});

test('testing: github.repo overrides the repo name in the gh command', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root)];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const cmd = 'gh run list --repo sandbox-org/custom-repo --limit 1 --json status,conclusion,name';
  const exec = fakeExec({
    [GIT_CMD]: '',
    [cmd]: '[{"status":"completed","conclusion":"success","name":"Build"}]',
  });

  const report = await runService(
    brandConfig({ github: { org: 'sandbox-org', repo: 'custom-repo' } }),
    { root, apps, fetch, exec },
  );

  assert.equal(report.status, 'success');
  assert.ok(exec.calls.some(([c]) => c === cmd));
});

test('testing: failed GitHub Actions run → error', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root)];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const exec = fakeExec({
    [GIT_CMD]: '',
    [GH_CMD]: '[{"status":"completed","conclusion":"failure","name":"Build"}]',
  });

  const report = await runService(brandConfig({ github: { org: 'sandbox-org' } }), { root, apps, fetch, exec });

  assert.equal(report.status, 'error');
  assert.deepEqual(report.output.results.failed, [
    { name: 'GitHub Actions', error: 'Build → failure' },
  ]);
});

test('testing: in-progress GitHub Actions run → warned; gh unavailable → dim, still success', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root)];

  const inProgress = await runService(brandConfig({ github: { org: 'sandbox-org' } }), {
    root,
    apps,
    fetch: fakeFetch({ [HOMEPAGE]: { status: 200 } }),
    exec: fakeExec({ [GIT_CMD]: '', [GH_CMD]: '[{"status":"in_progress","conclusion":null,"name":"Build"}]' }),
  });
  assert.equal(inProgress.status, 'warned');
  assert.deepEqual(inProgress.output.results.warned, [
    { name: 'GitHub Actions', warning: 'Build → in progress' },
  ]);

  const unavailable = await runService(brandConfig({ github: { org: 'sandbox-org' } }), {
    root,
    apps,
    fetch: fakeFetch({ [HOMEPAGE]: { status: 200 } }),
    exec: fakeExec({ [GIT_CMD]: '', [GH_CMD]: new Error('gh: command not found') }),
  });
  assert.equal(unavailable.status, 'success');
});

// ─── Dry run / local failures ────────────────────────────────────────────────

test('testing: dry-run — zero network, local checks still run', async () => {
  const root = stageBrand();
  const apps = [
    stageWebApp(root, { declared: '^1.0.0', installed: '1.0.0' }),
    stageBackendApp(root),
  ];
  const fetch = fakeFetch({});
  const exec = fakeExec({ [GIT_CMD]: '' });

  const report = await runService(
    brandConfig({ github: { org: 'sandbox-org' } }),
    { root, apps, fetch, exec, options: { dryRun: true } },
  );

  assert.equal(report.status, 'success');
  // No fetches; the only subprocess is the local git status
  assert.deepEqual(fetch.calls, []);
  assert.deepEqual(exec.calls, [[GIT_CMD, root]]);
  assert.deepEqual(report.output.results.passed, [
    'website: package.json',
    'website: build output',
    'backend: package.json',
    'backend: firebase.json',
    'backend: functions/package.json',
    'working tree',
  ]);
});

test('testing: missing build output → honest error naming the update service', async () => {
  const root = stageBrand();
  const apps = [stageWebApp(root, { dist: false })];
  const fetch = fakeFetch({ [HOMEPAGE]: { status: 200 } });
  const exec = fakeExec({ [GIT_CMD]: '' });

  const report = await runService(brandConfig(), { root, apps, fetch, exec });

  assert.equal(report.status, 'error');
  assert.deepEqual(report.output.results.failed, [
    { name: 'website: build output', error: 'dist/index.html missing — run the update service' },
  ]);
});
