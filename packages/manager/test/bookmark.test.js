/**
 * Bookmark service tests — link derivation from new-world config shapes
 * (single monorepo repo, unslugged Stripe, per-target backend API link) and
 * the WebSocket sync against a REAL ws client standing in for the
 * extension: ack → success, refusal → warned, no-connection timeout →
 * warned, non-interactive → clean skip, dry-run → planned groups with no
 * server opened.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const WebSocket = require('ws');

const { run } = require('../src/services/bookmark/index.js');
const { generateLinks } = require('../src/services/bookmark/ensure/sync.js');
const { OPERATIONS, SERVICE_ORDER } = require('../src/config.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const FULL_CONFIG = {
  brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.example' },
  cloud: { config: { projectId: 'fixture-project' } },
  analytics: { providers: { google: { accountId: '111', propertyId: '222' } } },
  repo: { providers: { github: { org: 'fixture-org' } } },
  payment: { providers: { stripe: { publishableKey: 'pk_fixture' } } },
};

function runService(context) {
  return run({
    brandId: context.brandConfig.brand.id,
    brandRoot: context.brandRoot || '/nonexistent',
    brandConfig: context.brandConfig,
    targets: context.targets || [],
    operations: OPERATIONS.bookmark,
    options: context.options || {},
    serviceData: {},
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// ─── link derivation ─────────────────────────────────────────────────────────

test('bookmark: full config derives every group with new-world shapes', () => {
  const targets = [{ name: 'backend', target: 'backend' }, { name: 'web', target: 'web' }];
  const links = generateLinks(FULL_CONFIG, targets, { deployedFunctions: ['omega_api', 'omega_signup'] });

  assert.deepEqual(Object.keys(links), ['Cloud', 'Firebase', 'Analytics', 'Search', 'Stripe', 'GitHub', 'Live']);

  // Cloud: 3 console links + separator + one log link per deployed function
  assert.equal(links.Cloud.length, 6);
  assert.ok(links.Cloud[4].title === 'omega_api()' && links.Cloud[4].url.includes('function_name%3D%22omega_api%22'));

  // Analytics URLs embed accountId + propertyId
  assert.ok(links.Analytics[0].url.includes('#/a111p222/'));

  // Search Console keyed by the sc-domain of brand.url
  assert.ok(links.Search[0].url.includes('sc-domain:fixture.example'));

  // Stripe links carry NO account slug (per-brand keys)
  assert.ok(links.Stripe.every((l) => l.url.startsWith('https://dashboard.stripe.com/')));

  // GitHub: the ONE brand monorepo (repo defaults to `<brand.id>-omega`)
  assert.deepEqual(links.GitHub.map((l) => l.url), [
    'https://github.com/fixture-org/fixture-omega',
    'https://github.com/fixture-org/fixture-omega/actions',
  ]);

  // Live: website + API subdomain (backend target present)
  assert.deepEqual(links.Live.map((l) => l.url), ['https://fixture.example', 'https://api.fixture.example']);
});

test('bookmark: groups with unmet inputs are absent', () => {
  const links = generateLinks({ brand: { id: 'bare', name: 'Bare' } }, []);
  assert.deepEqual(links, {});

  // github.repo overrides the derived repo name; no backend target → no API link
  const partial = generateLinks(
    { brand: { id: 'p', url: 'https://p.example' }, repo: { providers: { github: { org: 'o', repo: 'custom-repo' } } } },
    [{ name: 'web', target: 'web' }],
  );
  assert.deepEqual(Object.keys(partial), ['Search', 'GitHub', 'Live']);
  assert.equal(partial.GitHub[0].url, 'https://github.com/o/custom-repo');
  assert.deepEqual(partial.Live.map((l) => l.title), ['Website']);
});

test('bookmark: an owner/name slug carries its OWN owner, never repo.providers.github.org', () => {
  // The real shape this protects: ../omega-omega declares org Omega-JS-Stack and
  // repo "itw-creative-works/omega-omega", so an owner read off `org` links to a
  // repo that does not exist.
  const links = generateLinks(
    { brand: { id: 'acme', url: 'https://acme.example' }, repo: { providers: { github: { org: 'Acme-Org', repo: 'itw-creative-works/acme-app' } } } },
    [{ name: 'web', target: 'web' }],
  );

  assert.deepEqual(links.GitHub.map((l) => l.url), [
    'https://github.com/itw-creative-works/acme-app',
    'https://github.com/itw-creative-works/acme-app/actions',
  ]);
});

// ─── registration ────────────────────────────────────────────────────────────

test('bookmark: registered between migrations and testing', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('migrations') + 1], 'bookmark');
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('bookmark') + 1], 'testing');
  assert.deepEqual(OPERATIONS.bookmark.map((op) => op.name), ['sync']);
});

// ─── sync operation ──────────────────────────────────────────────────────────

test('bookmark: non-interactive run skips cleanly without opening a server', async () => {
  const result = await runService({ brandConfig: FULL_CONFIG });

  assert.equal(result.status, 'success');
  assert.equal(result.output.sync.reason, 'non-interactive');
});

test('bookmark: dry-run reports the planned groups without a server', async () => {
  const result = await runService({
    brandConfig: FULL_CONFIG,
    targets: [{ name: 'backend', target: 'backend' }],
    options: { dryRun: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.sync.planned, ['Cloud', 'Firebase', 'Analytics', 'Search', 'Stripe', 'GitHub', 'Live']);
});

test('bookmark: extension ack lands the sync as success', async () => {
  const port = await freePort();
  process.env.OMEGA_EXTENSION_PORT = String(port);

  // No cloud.config.projectId → no gcloud shell-out during the test
  const config = { brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.example' }, repo: { providers: { github: { org: 'o' } } } };

  const tty = openTtyPrompt();
  try {
    const running = runService({ brandConfig: config, targets: [] });

    // The "extension": connect, receive the sync message, ack it
    const received = await new Promise((resolve, reject) => {
      const tryConnect = () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.on('error', () => setTimeout(tryConnect, 25)); // server not up yet
        ws.on('message', (data) => {
          ws.send(JSON.stringify({ success: true }));
          resolve(JSON.parse(data.toString()));
        });
      };
      tryConnect();
      setTimeout(() => reject(new Error('sync message never arrived')), 3000);
    });

    assert.equal(received.type, 'OMEGA_BOOKMARK_SYNC');
    assert.deepEqual(received.brand, { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.example' });
    assert.deepEqual(Object.keys(received.links), ['Search', 'GitHub', 'Live']);

    const result = await running;
    assert.equal(result.status, 'success');
    assert.equal(result.output.sync.synced, true);
  } finally {
    tty.close();
    delete process.env.OMEGA_EXTENSION_PORT;
  }
});

test('bookmark: extension refusal warns with its error', async () => {
  const port = await freePort();
  process.env.OMEGA_EXTENSION_PORT = String(port);

  const tty = openTtyPrompt();
  try {
    const running = runService({ brandConfig: { brand: { id: 'x', name: 'X' } } });

    await new Promise((resolve) => {
      const tryConnect = () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.on('error', () => setTimeout(tryConnect, 25));
        ws.on('message', () => {
          ws.send(JSON.stringify({ success: false, error: 'bookmarks API unavailable' }));
          resolve();
        });
      };
      tryConnect();
    });

    const result = await running;
    assert.equal(result.status, 'warned');
    assert.equal(result.output.sync.reason, 'bookmarks API unavailable');
  } finally {
    tty.close();
    delete process.env.OMEGA_EXTENSION_PORT;
  }
});

test('bookmark: no extension → warned after the connect timeout', async () => {
  const port = await freePort();
  process.env.OMEGA_EXTENSION_PORT = String(port);
  process.env.OMEGA_EXTENSION_TIMEOUT = '150';

  const tty = openTtyPrompt();
  try {
    const result = await runService({ brandConfig: { brand: { id: 'x', name: 'X' } } });

    assert.equal(result.status, 'warned');
    assert.equal(result.output.sync.reason, 'extension not connected');
  } finally {
    tty.close();
    delete process.env.OMEGA_EXTENSION_PORT;
    delete process.env.OMEGA_EXTENSION_TIMEOUT;
  }
});
