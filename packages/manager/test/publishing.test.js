// Tests for the publishing service ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)):
// the manage walk's owner of every SHIP credential, which is the store API
// keys, the snap login, the Windows signing set, and the per-listing ids.
//
// Nothing here is a list this service types. The ask list is DERIVED from the
// brand's own declaration (`targets.<name>.platforms.<platform>.formats`)
// through @omega.js/config's format table, so a brand that drops a store is
// never asked for its keys and a brand that adds one is asked without anybody
// editing the manager. The human half of every ask (label, mint page, hint)
// comes from the env schema, which is its one home.
//
// The three outcomes: an interactive run pastes, a run that CANNOT ask fails
// loudly naming the key and the walk (a shipped store with no credential is a
// publish that dies in CI), and a listing id only a human can create is warned
// with the manual step instead.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { setPromptStreams } = require('@omega.js/devkit/prompt');
const { setBrowserOpener } = require('@omega.js/devkit/flows');

const { REQUIRES, SERVICE_ORDER, OPERATIONS, serviceInputSpec } = require('../src/config.js');
const { run } = require('../src/services/publishing/index.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const DOWN = '\x1B[B';

const SHIP_KEYS = [
  'WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT',
  'SSLCOM_USERNAME', 'SSLCOM_PASSWORD', 'SSLCOM_CREDENTIAL_ID',
  'DIGICERT_API_KEY', 'DIGICERT_KEYPAIR_ALIAS',
  'SNAPCRAFT_STORE_CREDENTIALS',
  'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN',
  'FIREFOX_API_KEY', 'FIREFOX_API_SECRET',
  'EDGE_CLIENT_ID', 'EDGE_API_KEY',
];

function cleanup() {
  for (const name of SHIP_KEYS) delete process.env[name];
}

/** Stub the real browser launch: pressEnterToOpen's seam and the config flow's. */
function stubBrowser() {
  const promptModule = require('@omega.js/devkit/prompt');
  const real = promptModule.openInBrowser;
  const opened = [];

  promptModule.openInBrowser = (url) => { opened.push(url); return true; };
  setBrowserOpener(async (url) => { opened.push(url); return true; });

  return {
    opened,
    restore: () => {
      promptModule.openInBrowser = real;
      setBrowserOpener(null);
      setPromptStreams(null);
    },
  };
}

function context(brandRoot, brandConfig, options = {}) {
  return {
    brandId: 'b',
    brandRoot,
    brandConfig,
    operations: OPERATIONS.publishing,
    options,
  };
}

/** A brand whose only target is an extension shipping just the Edge store. */
function edgeOnlyBrand() {
  const source = `{\n  brand: { id: 'b' },\n  // keep me\n  targets: {\n    extension: { type: 'extension', platforms: { chrome: false, firefox: false } },\n  },\n}\n`;
  const brandConfig = {
    brand: { id: 'b' },
    targets: { extension: { type: 'extension', platforms: { chrome: false, firefox: false } } },
  };

  return { brandRoot: makeBrandRoot(source), brandConfig };
}

// ─── the registry ────────────────────────────────────────────────────────────

test('publishing: the registry declares every ship credential the format table names', () => {
  const declaration = REQUIRES.publishing;

  assert.equal(declaration.label, 'Publishing');
  assert.equal(declaration.disablePath, 'publishing.enabled');
  assert.deepEqual(declaration.env.map((entry) => entry.name).sort(), [...SHIP_KEYS].sort());

  for (const entry of declaration.env) {
    assert.equal(entry.prompted, true, `${entry.name} is collected mid-run on a TTY`);
    assert.equal(entry.gates, false, `${entry.name} is optional: preflight never gates a walk on a ship credential`);
  }

  // The human half comes from the schema, never from the registry (#867)
  const spec = serviceInputSpec('publishing');
  const chrome = spec.inputs.find((input) => input.name === 'CHROME_CLIENT_ID');
  assert.equal(chrome.label, 'Chrome Web Store OAuth client ID');
  assert.match(chrome.url, /^https:\/\//);
  assert.ok(chrome.hint);

  // It runs after certificates, which keeps the Apple material
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('certificates') + 1], 'publishing');
  assert.deepEqual(OPERATIONS.publishing.map((operation) => operation.name), ['keys', 'listings']);
});

test('publishing: the ask list follows the brand DECLARATION, not a typed list', () => {
  const declaration = REQUIRES.publishing;
  const asked = (config) => declaration.env.filter((entry) => entry.when(config)).map((entry) => entry.name);

  // No desktop and no extension target: nothing to ship, nothing to ask
  assert.deepEqual(asked({ targets: { web: { type: 'web' } } }), []);

  // An undeclared extension ships all three stores, so it owes all seven keys
  assert.deepEqual(asked({ targets: { extension: { type: 'extension' } } }), [
    'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN',
    'FIREFOX_API_KEY', 'FIREFOX_API_SECRET',
    'EDGE_CLIENT_ID', 'EDGE_API_KEY',
  ]);

  // Dropping a store drops its keys with it
  assert.deepEqual(
    asked({ targets: { extension: { type: 'extension', platforms: { chrome: { formats: { store: false } }, edge: false } } } }),
    ['FIREFOX_API_KEY', 'FIREFOX_API_SECRET'],
  );

  // A desktop brand owes the snap login only where it DECLARES the snap, and
  // the Windows set only for the strategy it configured
  assert.deepEqual(asked({ targets: { desktop: { type: 'desktop' } } }), []);
  assert.deepEqual(
    asked({ targets: { desktop: { type: 'desktop', platforms: { linux: { formats: { snap: {} } }, windows: { signing: { strategy: 'self-hosted' } } } } } }),
    ['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD', 'SNAPCRAFT_STORE_CREDENTIALS'],
  );

  // Two targets in one brand: the union, in schema order
  assert.deepEqual(
    asked({ targets: { extension: { type: 'extension', platforms: { chrome: false, firefox: false } }, desktop: { type: 'desktop', platforms: { linux: { formats: { snap: true } } } } } }),
    ['SNAPCRAFT_STORE_CREDENTIALS', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'],
  );
});

// ─── the gates ───────────────────────────────────────────────────────────────

test('publishing: a brand with no desktop or extension target skips before any ask', async () => {
  cleanup();
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n  targets: { web: { type: "web" } },\n}\n');

  try {
    const result = await run(context(brandRoot, { brand: { id: 'b' }, targets: { web: { type: 'web' } } }));
    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /no desktop or extension target/);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('publishing: publishing.enabled = false skips the whole service', async () => {
  cleanup();
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
  const brandConfig = { publishing: { enabled: false }, targets: { extension: { type: 'extension' } } };

  try {
    const result = await run(context(brandRoot, brandConfig));
    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /publishing\.enabled/);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

// ─── asking ──────────────────────────────────────────────────────────────────

test('publishing: PROVIDE opens the mint page and lands the key in the brand .env', async () => {
  cleanup();
  // A desktop brand that DECLARES the snap owes exactly one credential, and
  // the Snap Store has no listing id to collect
  const source = `{\n  brand: { id: 'b' },\n  // keep me\n  targets: {\n    desktop: { type: 'desktop', platforms: { linux: { formats: { snap: {} } } } },\n  },\n}\n`;
  const brandRoot = makeBrandRoot(source);
  const brandConfig = {
    brand: { id: 'b' },
    targets: { desktop: { type: 'desktop', platforms: { linux: { formats: { snap: {} } } } } },
  };
  fs.writeFileSync(path.join(brandRoot, '.env'), 'EXISTING_KEY="keep-me"\n');

  const tty = openTtyPrompt();
  const browser = stubBrowser();
  try {
    const running = run(context(brandRoot, brandConfig));
    await tty.answer('Set up now?', '\r');                                     // Provide
    await tty.answer('Press Enter to open the Snap Store credentials page', '\r');
    await tty.answer('Paste SNAPCRAFT_STORE_CREDENTIALS', 'snap-blob\r');
    const result = await running;

    assert.equal(result.status, 'success');
    assert.equal(process.env.SNAPCRAFT_STORE_CREDENTIALS, 'snap-blob');
    assert.deepEqual(browser.opened, ['https://snapcraft.io/account']);

    const env = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
    assert.match(env, /EXISTING_KEY="keep-me"/);
    assert.match(env, /SNAPCRAFT_STORE_CREDENTIALS="snap-blob"/);
    assert.equal(readConfigSource(brandRoot), source, 'a key is never config');
  } finally {
    tty.close();
    browser.restore();
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('publishing: the listing id is asked for and lands in CONFIG, never the .env', async () => {
  cleanup();
  const { brandRoot, brandConfig } = edgeOnlyBrand();
  process.env.EDGE_CLIENT_ID = 'edge-client';
  process.env.EDGE_API_KEY = 'edge-key';

  const tty = openTtyPrompt();
  const browser = stubBrowser();
  try {
    const running = run(context(brandRoot, brandConfig));
    await tty.answer('Set up now?', '\r');                                     // Provide
    await tty.answer('Microsoft Edge Add-ons listing id', 'edge-product-guid\r');
    const result = await running;

    assert.equal(result.status, 'success');
    assert.deepEqual(browser.opened, ['https://partner.microsoft.com/dashboard/microsoftedge/']);

    // The id is CONFIG (#893), and the brand's own file is EDITED
    const source = readConfigSource(brandRoot);
    assert.match(source, /id: "edge-product-guid"/);
    assert.match(source, /\/\/ keep me/);
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false);
  } finally {
    tty.close();
    browser.restore();
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('publishing: "not yet" on a listing id writes nothing and warns with the manual step', async () => {
  cleanup();
  const { brandRoot, brandConfig } = edgeOnlyBrand();
  process.env.EDGE_CLIENT_ID = 'edge-client';
  process.env.EDGE_API_KEY = 'edge-key';

  const tty = openTtyPrompt();
  const browser = stubBrowser();
  try {
    const running = run(context(brandRoot, brandConfig));
    await tty.answer('Set up now?', `${DOWN}\r`);                              // Skip for now: not yet
    const result = await running;

    assert.equal(result.status, 'warned');
    assert.match(result.warned[0].reason, /targets\.extension\.listings\.edge\.id/);
    assert.doesNotMatch(readConfigSource(brandRoot), /listings/);
  } finally {
    tty.close();
    browser.restore();
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('publishing: everything present is asked for nothing and writes nothing', async () => {
  cleanup();
  const source = `{\n  brand: { id: 'b' },\n  targets: {\n    extension: { type: 'extension', platforms: { chrome: false, firefox: false }, listings: { edge: { id: 'already' } } },\n  },\n}\n`;
  const brandRoot = makeBrandRoot(source);
  const brandConfig = {
    brand: { id: 'b' },
    targets: { extension: { type: 'extension', platforms: { chrome: false, firefox: false }, listings: { edge: { id: 'already' } } } },
  };
  process.env.EDGE_CLIENT_ID = 'edge-client';
  process.env.EDGE_API_KEY = 'edge-key';

  const tty = openTtyPrompt();
  try {
    const result = await run(context(brandRoot, brandConfig));

    assert.equal(result.status, 'success');
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false, 'nothing was written');
    assert.equal(readConfigSource(brandRoot), source, 'the brand file is byte-identical');
  } finally {
    tty.close();
    setPromptStreams(null);
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

// ─── the runs that cannot ask ────────────────────────────────────────────────

test('publishing: a headless run FAILS on a missing developer key, naming the key and the walk', async () => {
  cleanup();
  const { brandRoot, brandConfig } = edgeOnlyBrand();

  try {
    const result = await run(context(brandRoot, brandConfig, { dryRun: true }));

    assert.equal(result.status, 'error');
    assert.match(result.error, /EDGE_CLIENT_ID \(required by platforms\.edge\.formats\.store\)/);
    assert.match(result.error, /EDGE_API_KEY/);
    assert.match(result.error, /omega manage --service publishing/);
    // Nothing was asked and nothing was written
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false);
  } finally {
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('publishing: a headless run with the keys present WARNS on the missing listing id', async () => {
  cleanup();
  const { brandRoot, brandConfig } = edgeOnlyBrand();
  process.env.EDGE_CLIENT_ID = 'edge-client';
  process.env.EDGE_API_KEY = 'edge-key';

  const lines = [];
  const realLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const result = await run(context(brandRoot, brandConfig, { dryRun: true }));

    assert.equal(result.status, 'warned');
    assert.match(result.warned[0].reason, /targets\.extension\.listings\.edge\.id/);

    const printed = lines.join('\n');
    assert.match(printed, /Microsoft Edge Add-ons has no listing id yet/);
    assert.match(printed, /partner\.microsoft\.com/);
    assert.match(printed, /targets\.extension\.listings\.edge\.id/);
  } finally {
    console.log = realLog;
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('publishing: a brand that ships no store and declares no signing has nothing to collect', async () => {
  cleanup();
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
  const brandConfig = { brand: { id: 'b' }, targets: { desktop: { type: 'desktop' } } };

  try {
    const result = await run(context(brandRoot, brandConfig, { dryRun: true }));

    assert.equal(result.status, 'success');
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});
