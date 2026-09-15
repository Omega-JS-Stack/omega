/**
 * Certificates service tests — the four Apple operations against a
 * URL-level recording fake of the App Store Connect client, with the LOCAL
 * pipeline kept real: openssl generates the fixture key/CSR/DER cert, CSR
 * generation and .p12 export run for real, and JWT signing is verified
 * with node:crypto. The keychain import is always a recorder — tests never
 * touch the real macOS keychain. Proves skip semantics, the converged
 * zero-mutation run, CSR reuse (the private key pairs with the issued
 * cert), manual-cert warning flow, bundle-ID/capability/profile
 * reconciliation, and the dry-run zero-write guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { generateKeyPairSync, verify } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { signJwt } = require('../src/lib/jwt.js');
const { API_BASE } = require('../src/services/certificates/lib/apple-api.js');
const { PORTAL_CREATE_URL } = require('../src/services/certificates/lib/manual-walkthrough.js');
const { setBrowserOpener } = require('@omega.js/devkit/flows');
const { openTtyPrompt } = require('./lib/interactive.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const service = require('../src/services/certificates/index.js');

// Tests must never see real credentials from the shell environment
const APPLE_ENV_VARS = ['APPLE_API_ISSUER', 'APPLE_API_KEY_ID', 'APPLE_TEAM_ID', 'CSC_KEY_PASSWORD', 'APPLE_KEYCHAIN_PASSWORD'];
for (const key of APPLE_ENV_VARS) {
  delete process.env[key];
}

const BRAND_ID = 'fixture-brand';
const BRAND_NAME = 'Fixture Brand';
const PREFIX = 'com.fixture';
// composeBundleId: brand-id dashes become dots (Android-safe segments)
const BUNDLE_IDENTIFIER = 'com.fixture.fixture.brand';
const ALL_TYPES = DEFAULTS.certificates.providers.apple.certificates.map((c) => c.type);
const AUTOMATED_TYPES = DEFAULTS.certificates.providers.apple.certificates.filter((c) => !c.manual).map((c) => c.type);
const FUTURE = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString();

// ─── Real openssl fixture material (one key, self-signed DER cert, CSR) ─────
// The cert derives from FIXTURE_KEY, so `openssl pkcs12 -export` accepts the
// pair — exactly the pairing constraint the CSR-reuse behavior protects.

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'omega-certs-fixture-'));
execSync(
  `openssl req -x509 -nodes -newkey rsa:2048 -keyout "${FIXTURE_DIR}/private.key" -out "${FIXTURE_DIR}/cert.cer" -days 365 -subj "/CN=Fixture/C=US" -outform DER`,
  { stdio: 'pipe' },
);
execSync(
  `openssl req -new -key "${FIXTURE_DIR}/private.key" -out "${FIXTURE_DIR}/request.csr" -subj "/emailAddress=TEAMTEST12@apple.com/CN=Fixture CSR/C=US"`,
  { stdio: 'pipe' },
);
// The same key, certificates with chosen lifetimes: the three validity rungs
// (#892) are measured from the FILE, so each rung needs a real one.
execSync(
  `openssl req -x509 -key "${FIXTURE_DIR}/private.key" -out "${FIXTURE_DIR}/soon.cer" -days 10 -subj "/CN=Fixture Soon/C=US" -outform DER`,
  { stdio: 'pipe' },
);
const asn1 = (days) => `${new Date(Date.now() + days * 86400000).toISOString().replace(/[-:T]/g, '').split('.')[0]}Z`;
execSync(
  `openssl req -x509 -key "${FIXTURE_DIR}/private.key" -out "${FIXTURE_DIR}/expired.cer" -not_before ${asn1(-400)} -not_after ${asn1(-5)} -subj "/CN=Fixture Expired/C=US" -outform DER`,
  { stdio: 'pipe' },
);

const FIXTURE_KEY = jetpack.read(join(FIXTURE_DIR, 'private.key'));
const FIXTURE_CSR = jetpack.read(join(FIXTURE_DIR, 'request.csr'));
const FIXTURE_CERT_DER = jetpack.read(join(FIXTURE_DIR, 'cert.cer'), 'buffer');
const FIXTURE_CERT_SOON_DER = jetpack.read(join(FIXTURE_DIR, 'soon.cer'), 'buffer');
const FIXTURE_CERT_EXPIRED_DER = jetpack.read(join(FIXTURE_DIR, 'expired.cer'), 'buffer');

/** Play Apple: issue a certificate from the key whose CSR was submitted. */
function issueFrom(keyPath) {
  const out = join(FIXTURE_DIR, `issued-${Math.random().toString(36).slice(2)}.cer`);
  execSync(
    `openssl req -x509 -key "${keyPath}" -out "${out}" -days 365 -subj "/CN=Fixture Issued/C=US" -outform DER`,
    { stdio: 'pipe' },
  );
  return jetpack.read(out, 'buffer');
}

function cleanCSR(csr) {
  return csr
    .replace('-----BEGIN CERTIFICATE REQUEST-----', '')
    .replace('-----END CERTIFICATE REQUEST-----', '')
    .replace(/\n/g, '');
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function stageBrand() {
  return mkdtempSync(join(tmpdir(), 'omega-certs-brand-'));
}

function appleDirOf(root) {
  return join(root, '.omega', 'certificates', 'apple');
}

function brandConfig({ certificates = {}, apple = {}, targets = { desktop: { type: 'desktop' } } } = {}) {
  return {
    brand: { id: BRAND_ID, name: BRAND_NAME, url: 'https://fixture-brand.test' },
    targets,
    certificates: certificates === false ? false : {
      ...structuredClone(DEFAULTS.certificates),
      ...certificates,
      providers: { apple: { ...structuredClone(DEFAULTS.certificates.providers.apple), bundleIdPrefix: PREFIX, ...apple } },
    },
  };
}

function fakeSecrets(overrides = {}) {
  return {
    issuerId: 'ISSUER-TEST',
    keyId: 'KEY-TEST',
    teamId: 'TEAMTEST12',
    privateKeyPath: null,
    certificatePassword: 'fixture-pass',
    keychainPassword: null,
    ...overrides,
  };
}

/**
 * URL-level recording fake of the App Store Connect client. paginate
 * responses key by path ('certificates'), request responses by
 * '<METHOD> <path>'. Unconfigured calls throw LOUDLY.
 */
function fakeApple(responses = {}) {
  const client = { calls: [] };

  function resolve(key, ...args) {
    if (!(key in responses)) {
      throw new Error(`fakeApple: unexpected call ${key}`);
    }
    const responder = responses[key];
    return structuredClone(typeof responder === 'function' ? responder(...args) : responder);
  }

  client.paginate = async (url) => {
    const path = url.replace(`${API_BASE}/`, '').split('?')[0];
    client.calls.push({ method: 'GET', path });
    return resolve(path, url);
  };

  client.request = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const path = url.replace(`${API_BASE}/`, '').split('?')[0];
    const body = options.body ? JSON.parse(options.body) : undefined;
    client.calls.push({ method, path, body });
    return resolve(`${method} ${path}`, url, options);
  };

  client.mutations = () => client.calls.filter((c) => c.method !== 'GET');
  return client;
}

function fakeKeychain() {
  const recorder = { calls: [] };
  recorder.fn = (opts) => {
    recorder.calls.push(opts);
    return { imported: 0, skipped: 0, failed: 0 };
  };
  return recorder;
}

function certRecord(type, id = `cert-${type}`) {
  return { id, type: 'certificates', attributes: { certificateType: type, expirationDate: FUTURE } };
}

function bundleRecord(id = 'bundle-1') {
  return { id, type: 'bundleIds', attributes: { identifier: BUNDLE_IDENTIFIER, name: BRAND_NAME, platform: 'IOS' } };
}

function profileRecord(profileType, name, id = `profile-${profileType}`) {
  return { id, type: 'profiles', attributes: { name, profileType, expirationDate: FUTURE } };
}

/** Stage a local .cer (+ paired key, + fresh .p12) as a converged brand has. */
function stageLocalCert(root, type, { key = true, p12 = true, cert = FIXTURE_CERT_DER } = {}) {
  const dir = appleDirOf(root);
  jetpack.write(join(dir, 'certificates', `${type}.cer`), cert);
  if (key) {
    jetpack.write(join(dir, 'csr', type, 'private.key'), FIXTURE_KEY);
  }
  if (p12) {
    // Written after the .cer → newer mtime → exportToP12 no-ops (fresh)
    jetpack.write(join(dir, 'certificates', `${type}.p12`), Buffer.from('fixture-p12'));
  }
}

function runService(config, { root, client, options = {}, keychain, secrets, operations = OPERATIONS.certificates, serviceData = {}, downloadsDir, companyRoot = null } = {}) {
  return service.run({
    brandId: BRAND_ID,
    brandRoot: root,
    companyRoot,
    brandConfig: config,
    brand: { id: BRAND_ID, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations,
    options,
    serviceData,
    appleClient: client,
    appleSecrets: client ? (secrets ?? fakeSecrets()) : undefined,
    // Default to a silent fake so no test can ever touch the real keychain
    keychainImport: keychain || (() => ({ imported: 0, skipped: 0, failed: 0 })),
    // The manual-cert walkthrough scans this instead of ~/Downloads
    ...(downloadsDir ? { downloadsDir } : {}),
  });
}

const ONLY = (name) => OPERATIONS.certificates.filter((o) => o.name === name);

// ─── Registry / defaults pins ────────────────────────────────────────────────

test('certificates: registered after assets with the four apple operations', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('assets') + 1], 'certificates');
  assert.deepEqual(OPERATIONS.certificates.map((o) => o.name), ['api-key', 'certificates', 'bundle-ids', 'profiles']);
});

test('certificates: defaults pin — no company bundle prefix, G2-only manual types', () => {
  assert.equal(DEFAULTS.certificates.enabled, true);
  assert.equal(DEFAULTS.certificates.providers.apple.bundleIdPrefix, null);
  assert.deepEqual(DEFAULTS.certificates.providers.apple.capabilities, ['APPLE_ID_AUTH']);
  assert.deepEqual(DEFAULTS.certificates.providers.apple.profiles, ['IOS_DISTRIBUTION', 'MAC_APP_DISTRIBUTION', 'DEVELOPER_ID_APPLICATION_G2']);
  assert.deepEqual(DEFAULTS.certificates.providers.apple.certificates, [
    { type: 'DEVELOPMENT' },
    { type: 'IOS_DISTRIBUTION' },
    { type: 'MAC_INSTALLER_DISTRIBUTION' },
    { type: 'MAC_APP_DISTRIBUTION' },
    { type: 'DEVELOPER_ID_APPLICATION_G2', manual: true },
    { type: 'DEVELOPER_ID_INSTALLER_G2', manual: true },
  ]);
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('certificates: certificates.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ certificates: { enabled: false } }), { root: stageBrand() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /certificates\.enabled/);
});

test('certificates: scalar certificates: false skips the service', async () => {
  const result = await runService(brandConfig({ certificates: false }), { root: stageBrand() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /certificates\.enabled/);
});

test('certificates: skips without a desktop or mobile target', async () => {
  const result = await runService(brandConfig({ targets: { web: { type: 'web' }, backend: { type: 'backend' } } }), { root: stageBrand() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no desktop or mobile target/);
});

test('certificates: skips without Apple credentials in .env', async () => {
  const result = await runService(brandConfig(), { root: stageBrand() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /APPLE_API_ISSUER, APPLE_API_KEY_ID, APPLE_TEAM_ID/);
});

test('certificates: skips when the AuthKey .p8 is missing', async () => {
  process.env.APPLE_API_ISSUER = 'issuer-test';
  process.env.APPLE_API_KEY_ID = 'key-test';
  process.env.APPLE_TEAM_ID = 'TEAMTEST12';
  try {
    const result = await runService(brandConfig(), { root: stageBrand() });
    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /AuthKey_<KEYID>\.p8/);
  } finally {
    for (const key of APPLE_ENV_VARS) delete process.env[key];
  }
});

// ─── CSC_KEY_PASSWORD generation ─────────────────────────────────────────────

function stageP8(root) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  jetpack.write(
    join(appleDirOf(root), 'AuthKey_TESTKEY.p8'),
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );
}

test('certificates: CSC_KEY_PASSWORD is generated and persisted to the brand .env', async () => {
  const root = stageBrand();
  stageP8(root);
  jetpack.write(join(root, '.env'), 'EXISTING_VAR="keep-me"\n');
  process.env.APPLE_API_ISSUER = 'issuer-test';
  process.env.APPLE_API_KEY_ID = 'key-test';
  process.env.APPLE_TEAM_ID = 'TEAMTEST12';
  try {
    const result = await runService(brandConfig(), { root, operations: ONLY('api-key') });

    assert.equal(result.status, 'success');
    const env = jetpack.read(join(root, '.env'));
    assert.match(env, /^EXISTING_VAR="keep-me"$/m);
    assert.match(env, /^CSC_KEY_PASSWORD="[A-Za-z0-9_-]{20,}"$/m);
  } finally {
    for (const key of APPLE_ENV_VARS) delete process.env[key];
  }
});

test('certificates: dry run never writes CSC_KEY_PASSWORD to .env', async () => {
  const root = stageBrand();
  stageP8(root);
  process.env.APPLE_API_ISSUER = 'issuer-test';
  process.env.APPLE_API_KEY_ID = 'key-test';
  process.env.APPLE_TEAM_ID = 'TEAMTEST12';
  try {
    const result = await runService(brandConfig(), { root, operations: ONLY('api-key'), options: { dryRun: true } });

    assert.equal(result.status, 'success');
    assert.equal(jetpack.exists(join(root, '.env')), false);
    assert.equal(process.env.CSC_KEY_PASSWORD, undefined);
  } finally {
    for (const key of APPLE_ENV_VARS) delete process.env[key];
  }
});

// ─── Converged full run ──────────────────────────────────────────────────────

test('certificates: a fully converged brand is a zero-mutation no-op across all four operations', async () => {
  const root = stageBrand();
  for (const type of ALL_TYPES) {
    stageLocalCert(root, type);
  }
  const dir = appleDirOf(root);
  // Developer ID needs NO profile (#891), so the converged set is the App
  // Store one alone.
  jetpack.write(join(dir, 'profiles', BRAND_ID, 'MAC_APP_DISTRIBUTION', 'MACOS.mobileprovision'), 'staged');

  const client = fakeApple({
    certificates: ALL_TYPES.map((type) => certRecord(type)),
    bundleIds: [bundleRecord()],
    'bundleIds/bundle-1/bundleIdCapabilities': [{ id: 'cap-1', attributes: { capabilityType: 'APPLE_ID_AUTH' } }],
    profiles: [
      profileRecord('MAC_APP_STORE', `${BRAND_NAME} - MAC_APP_DISTRIBUTION (MACOS)`),
    ],
  });
  const keychain = fakeKeychain();

  const result = await runService(brandConfig(), { root, client, keychain: keychain.fn });

  assert.equal(result.status, 'success');
  assert.deepEqual(client.mutations(), []);
  assert.deepEqual(result.output.certificates, { synced: 6, downloaded: 0, created: 0 });
  assert.deepEqual(result.output.bundleIds, { synced: true });
  assert.deepEqual(result.output.profiles, { synced: 1, downloaded: 0, created: 0 });

  // Durable state: trimmed cert records + the resolved bundle ID + profiles
  assert.deepEqual(Object.keys(result.state.certificateMap).sort(), [...ALL_TYPES].sort());
  assert.deepEqual(result.state.certificateMap.DEVELOPMENT, {
    id: 'cert-DEVELOPMENT', certificateType: 'DEVELOPMENT', expirationDate: FUTURE,
  });
  assert.deepEqual(result.state.bundleId, { identifier: BUNDLE_IDENTIFIER, id: 'bundle-1', platforms: ['MACOS'] });
  assert.deepEqual(Object.keys(result.state.profiles).sort(), ['mac_app_distribution-macos']);

  // Keychain import ran once, restricted to the config-listed types
  assert.equal(keychain.calls.length, 1);
  assert.deepEqual(keychain.calls[0].allowedTypes, ALL_TYPES);
  assert.equal(keychain.calls[0].certificatePassword, 'fixture-pass');
});

// ─── Certificate creation (real CSR pipeline) ────────────────────────────────

test('certificates: a missing cert is created reusing the preserved CSR, and the .p12 exports for real', async () => {
  const root = stageBrand();
  const dir = appleDirOf(root);
  // Preserved CSR from a previous run — its key pairs with the issued cert
  jetpack.write(join(dir, 'csr', 'MAC_APP_DISTRIBUTION', 'private.key'), FIXTURE_KEY);
  jetpack.write(join(dir, 'csr', 'MAC_APP_DISTRIBUTION', 'request.csr'), FIXTURE_CSR);

  const listed = ALL_TYPES.filter((t) => t !== 'MAC_APP_DISTRIBUTION').map((t) => certRecord(t));
  for (const type of ALL_TYPES.filter((t) => t !== 'MAC_APP_DISTRIBUTION')) {
    stageLocalCert(root, type);
  }

  const client = fakeApple({
    certificates: listed,
    'POST certificates': { data: certRecord('MAC_APP_DISTRIBUTION', 'cert-new') },
    'GET certificates/cert-new': { data: { attributes: { certificateContent: FIXTURE_CERT_DER.toString('base64') } } },
  });
  const keychain = fakeKeychain();

  const result = await runService(brandConfig(), { root, client, keychain: keychain.fn, operations: ONLY('certificates') });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.certificates, { synced: 5, downloaded: 0, created: 1 });

  // The POST carried the preserved CSR verbatim (key/cert pairing survives)
  const post = client.mutations()[0];
  assert.equal(post.path, 'certificates');
  assert.equal(post.body.data.attributes.certificateType, 'MAC_APP_DISTRIBUTION');
  assert.equal(post.body.data.attributes.csrContent, cleanCSR(FIXTURE_CSR));
  assert.equal(jetpack.read(join(dir, 'csr', 'MAC_APP_DISTRIBUTION', 'private.key')), FIXTURE_KEY);

  // Real download + real openssl .p12 export (DER SEQUENCE magic on both)
  const cer = jetpack.read(join(dir, 'certificates', 'MAC_APP_DISTRIBUTION.cer'), 'buffer');
  assert.deepEqual(cer, FIXTURE_CERT_DER);
  const p12 = jetpack.read(join(dir, 'certificates', 'MAC_APP_DISTRIBUTION.p12'), 'buffer');
  assert.equal(p12[0], 0x30);
  assert.equal(result.state.certificateMap.MAC_APP_DISTRIBUTION.id, 'cert-new');
});

test('certificates: a first-time cert generates a fresh CSR whose content matches the POST', async () => {
  const root = stageBrand();
  const dir = appleDirOf(root);
  for (const type of ALL_TYPES.filter((t) => t !== 'DEVELOPMENT')) {
    stageLocalCert(root, type);
  }

  // Apple issues FROM the submitted CSR, so the issued cert pairs with the key
  // the service just generated: the .p12 export has its pair (#892).
  const client = fakeApple({
    certificates: ALL_TYPES.filter((t) => t !== 'DEVELOPMENT').map((t) => certRecord(t)),
    'POST certificates': { data: certRecord('DEVELOPMENT', 'cert-dev') },
    'GET certificates/cert-dev': () => ({
      data: { attributes: { certificateContent: issueFrom(join(dir, 'csr', 'DEVELOPMENT', 'private.key')).toString('base64') } },
    }),
  });

  const result = await runService(brandConfig(), { root, client, operations: ONLY('certificates') });

  assert.equal(result.status, 'success');
  const csrOnDisk = jetpack.read(join(dir, 'csr', 'DEVELOPMENT', 'request.csr'));
  assert.ok(jetpack.exists(join(dir, 'csr', 'DEVELOPMENT', 'private.key')));
  assert.equal(client.mutations()[0].body.data.attributes.csrContent, cleanCSR(csrOnDisk));
  assert.equal(result.output.certificates.created, 1);
});

// ─── Company-shared signing tree ─────────────────────────────────────────────
// One Apple account signs everything a company ships: a brand of a company
// (context.companyRoot: the company TREE the walk resolved from its
// `company: { id }`, #677) resolves the WHOLE signing tree: CSRs, certs,
// .p12s, the .p8, CSC_KEY_PASSWORD, there; standalone brands stay brand-local
// (every other test in this file, which passes no companyRoot).

test('certificates: a brand of a company signs from the COMPANY tree', async () => {
  const root = stageBrand();
  const companyRoot = mkdtempSync(join(tmpdir(), 'omega-certs-company-'));
  const companyDir = appleDirOf(companyRoot);

  // The company tree already holds the preserved CSR (a sibling brand — or
  // this one, last run — generated it); the issued cert pairs with ITS key
  jetpack.write(join(companyDir, 'csr', 'DEVELOPMENT', 'private.key'), FIXTURE_KEY);
  jetpack.write(join(companyDir, 'csr', 'DEVELOPMENT', 'request.csr'), FIXTURE_CSR);

  const client = fakeApple({
    certificates: [],
    'POST certificates': { data: certRecord('DEVELOPMENT', 'cert-dev') },
    'GET certificates/cert-dev': { data: { attributes: { certificateContent: FIXTURE_CERT_DER.toString('base64') } } },
  });

  const config = brandConfig({ apple: { certificates: [{ type: 'DEVELOPMENT' }] } });
  const result = await runService(config, { root, client, operations: ONLY('certificates'), companyRoot });

  assert.equal(result.status, 'success');
  // The COMPANY tree's CSR was reused (not regenerated) and everything
  // lands beside it; the brand tree is never created
  assert.equal(jetpack.read(join(companyDir, 'csr', 'DEVELOPMENT', 'private.key')), FIXTURE_KEY);
  assert.ok(jetpack.exists(join(companyDir, 'certificates', 'DEVELOPMENT.cer')));
  assert.ok(jetpack.exists(join(companyDir, 'certificates', 'DEVELOPMENT.p12')));
  assert.equal(jetpack.exists(appleDirOf(root)), false);
});

test('certificates: interactive p8 rescue files the download into the signing tree and lands CSC in its .env', async () => {
  const root = stageBrand();
  const companyRoot = mkdtempSync(join(tmpdir(), 'omega-certs-company-'));
  const downloads = mkdtempSync(join(tmpdir(), 'omega-certs-downloads-'));

  process.env.APPLE_API_ISSUER = 'ISSUER-TEST';
  process.env.APPLE_API_KEY_ID = 'TEST123AB';
  process.env.APPLE_TEAM_ID = 'TEAMTEST12';
  delete process.env.CSC_KEY_PASSWORD;

  const tty = openTtyPrompt();
  setBrowserOpener(async () => {
    // Play the browser download: the fresh .p8 lands in Downloads
    jetpack.write(join(downloads, 'AuthKey_TEST123AB.p8'), 'fixture-p8-key');
    return true;
  });

  try {
    const run = runService(brandConfig(MANUAL_ONLY_CONFIG), {
      root, operations: [], companyRoot, downloadsDir: downloads,
    });
    await tty.answer('Press Enter to open the App Store Connect API keys page', '\r');
    const result = await run;

    assert.equal(result.status, 'success');
    // The .p8 MOVED out of Downloads into the COMPANY signing tree
    assert.equal(jetpack.read(join(appleDirOf(companyRoot), 'AuthKey_TEST123AB.p8')), 'fixture-p8-key');
    assert.equal(jetpack.exists(join(downloads, 'AuthKey_TEST123AB.p8')), false);
    // The shared .p12 password landed in the COMPANY .env (the env chain
    // loads it under every sibling brand's own .env)
    assert.match(jetpack.read(join(companyRoot, '.env')) || '', /CSC_KEY_PASSWORD="/);
    assert.equal(jetpack.exists(join(root, '.env')), false);
  } finally {
    tty.close();
    setBrowserOpener(null);
    for (const key of APPLE_ENV_VARS) {
      delete process.env[key];
    }
  }
});

// ─── Reuse, never mint over a valid cert (#892) ──────────────────────────────
// Apple only issues so many certificates: a valid cert on the account is REUSED
// by pairing it with a local key, and a type that cannot produce its .p12 is an
// ERROR with the fix in it (#891), never a warning that counts as synced.

test('certificates: a valid cert pairs with the COMPANY key and is reused, with no create call', async () => {
  const root = stageBrand();
  const companyRoot = mkdtempSync(join(tmpdir(), 'omega-certs-company-'));
  const companyDir = appleDirOf(companyRoot);

  // The company tree holds the cert AND the key it was issued from: the brand
  // tree holds nothing at all
  jetpack.write(join(companyDir, 'certificates', 'DEVELOPER_ID_APPLICATION_G2.cer'), FIXTURE_CERT_DER);
  jetpack.write(join(companyDir, 'csr', 'DEVELOPER_ID_APPLICATION_G2', 'private.key'), FIXTURE_KEY);

  const client = fakeApple({ certificates: [certRecord('DEVELOPER_ID_APPLICATION_G2')] });
  const config = brandConfig({ apple: { certificates: [{ type: 'DEVELOPER_ID_APPLICATION_G2', manual: true }] } });

  const result = await runService(config, { root, client, operations: ONLY('certificates'), companyRoot });

  assert.equal(result.status, 'success');
  assert.deepEqual(client.mutations(), [], 'a valid cert is never minted over');
  assert.deepEqual(result.output.certificates, { synced: 1, downloaded: 0, created: 0 });
  // The .p12 was exported from the COMPANY key, into the COMPANY tree
  const p12 = jetpack.read(join(companyDir, 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12'), 'buffer');
  assert.equal(p12[0], 0x30);
  assert.equal(jetpack.exists(appleDirOf(root)), false);
});

test('certificates: a valid cert with no paired key ERRORS, naming the key path and the fix, and never POSTs', async () => {
  // The live failure (#891 proof run one): the .cer downloaded into the brand
  // tree, no key anywhere, the type counted as synced and the mac build shipped
  // unsigned.
  const root = stageBrand();
  const companyRoot = mkdtempSync(join(tmpdir(), 'omega-certs-company-'));
  jetpack.write(join(appleDirOf(companyRoot), 'certificates', 'DEVELOPER_ID_APPLICATION_G2.cer'), FIXTURE_CERT_DER);

  const client = fakeApple({ certificates: [certRecord('DEVELOPER_ID_APPLICATION_G2')] });
  const config = brandConfig({ apple: { certificates: [{ type: 'DEVELOPER_ID_APPLICATION_G2', manual: true }] } });

  const result = await runService(config, { root, client, operations: ONLY('certificates'), companyRoot });

  assert.equal(result.status, 'error');
  assert.deepEqual(client.mutations(), [], 'no create call happens on the unpaired path');
  assert.match(result.error, /DEVELOPER_ID_APPLICATION_G2/);
  assert.match(result.error, /csr\/DEVELOPER_ID_APPLICATION_G2\/private\.key/);
  assert.match(result.error, new RegExp(appleDirOf(companyRoot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.error, /revoke the certificate/);
  assert.equal(result.output.certificates.failed, 1);
  assert.equal(jetpack.exists(join(appleDirOf(companyRoot), 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12')), false);
});

test('certificates: an unpaired key that is merely PRESENT does not count as paired', async () => {
  const root = stageBrand();
  // A key from a different CSR: present, and unable to sign this certificate
  const strangerDir = mkdtempSync(join(tmpdir(), 'omega-certs-stranger-'));
  execSync(`openssl req -x509 -nodes -newkey rsa:2048 -keyout "${strangerDir}/private.key" -out "${strangerDir}/cert.cer" -days 365 -subj "/CN=Stranger/C=US" -outform DER`, { stdio: 'pipe' });
  jetpack.write(join(appleDirOf(root), 'certificates', 'DEVELOPER_ID_APPLICATION_G2.cer'), FIXTURE_CERT_DER);
  jetpack.copy(join(strangerDir, 'private.key'), join(appleDirOf(root), 'csr', 'DEVELOPER_ID_APPLICATION_G2', 'private.key'));

  const client = fakeApple({ certificates: [certRecord('DEVELOPER_ID_APPLICATION_G2')] });
  const config = brandConfig({ apple: { certificates: [{ type: 'DEVELOPER_ID_APPLICATION_G2', manual: true }] } });

  const result = await runService(config, { root, client, operations: ONLY('certificates') });

  assert.equal(result.status, 'error');
  assert.match(result.error, /no private key in the signing tree pairs with it/);
});

// ─── The three validity rungs (#892) ────────────────────────────────────────
// One expiry function (@omega.js/devkit/certs) answers for the walk and for the
// desktop's validate-certs step: fine, under 30 days warns, expired errors.

test('certificates: a cert expiring within 30 days WARNS, and an expired one ERRORS', async () => {
  const soonRoot = stageBrand();
  stageLocalCert(soonRoot, 'DEVELOPER_ID_APPLICATION_G2', { cert: FIXTURE_CERT_SOON_DER, p12: false });
  const config = brandConfig({ apple: { certificates: [{ type: 'DEVELOPER_ID_APPLICATION_G2', manual: true }] } });

  const soon = await runService(config, {
    root: soonRoot,
    client: fakeApple({ certificates: [certRecord('DEVELOPER_ID_APPLICATION_G2')] }),
    operations: ONLY('certificates'),
  });

  assert.equal(soon.status, 'warned');
  assert.equal(soon.output.certificates.expiringSoon, 1);
  assert.match(soon.warned[0].reason, /expire within 30 days/);
  // It still SIGNS: a cert with days left is delivered, it is only a warning
  assert.ok(jetpack.exists(join(appleDirOf(soonRoot), 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12')));

  const expiredRoot = stageBrand();
  stageLocalCert(expiredRoot, 'DEVELOPER_ID_APPLICATION_G2', { cert: FIXTURE_CERT_EXPIRED_DER, p12: false });

  const expired = await runService(config, {
    root: expiredRoot,
    client: fakeApple({ certificates: [certRecord('DEVELOPER_ID_APPLICATION_G2')] }),
    operations: ONLY('certificates'),
  });

  assert.equal(expired.status, 'error');
  assert.match(expired.error, /EXPIRED/);
  assert.equal(expired.output.certificates.failed, 1);
});

// ─── Manual certificates ─────────────────────────────────────────────────────

test('certificates: missing manual certs warn with portal guidance and never POST', async () => {
  const root = stageBrand();
  for (const type of AUTOMATED_TYPES) {
    stageLocalCert(root, type);
  }

  const client = fakeApple({
    certificates: AUTOMATED_TYPES.map((t) => certRecord(t)),
  });

  const result = await runService(brandConfig(), { root, client, operations: ONLY('certificates') });

  assert.equal(result.status, 'warned');
  assert.deepEqual(client.mutations(), []);
  assert.equal(result.output.certificates.manualMissing, 2);
  assert.equal(result.output.certificates.synced, 4);
  assert.equal(result.state.certificateMap.DEVELOPER_ID_APPLICATION_G2, undefined);
});

test('certificates: a valid local manual cert passes openssl validation and syncs', async () => {
  const root = stageBrand();
  for (const type of AUTOMATED_TYPES) {
    stageLocalCert(root, type);
  }
  // Manual G2 certs exist locally only (no API record): the paired key is what
  // makes them signing material, so the .p12 exports for real from it
  stageLocalCert(root, 'DEVELOPER_ID_APPLICATION_G2', { p12: false });
  stageLocalCert(root, 'DEVELOPER_ID_INSTALLER_G2', { p12: false });

  const client = fakeApple({
    certificates: AUTOMATED_TYPES.map((t) => certRecord(t)),
  });

  const result = await runService(brandConfig(), { root, client, operations: ONLY('certificates') });

  assert.equal(result.status, 'success');
  assert.deepEqual(client.mutations(), []);
  assert.equal(result.output.certificates.synced, 6);
  assert.equal(result.state.certificateMap.DEVELOPER_ID_APPLICATION_G2.id, 'manual');
  assert.match(result.state.certificateMap.DEVELOPER_ID_APPLICATION_G2.expirationDate, /^\d{4}-/);
});

// ─── Manual-cert interactive walkthrough ─────────────────────────────────────
// Real prompts on fake TTY streams, a stubbed browser opener playing Apple
// (issuing a cert against the CSR the SERVICE staged), and a temp dir as
// Downloads — the whole rescue path runs for real except the portal itself.

const MANUAL_ONLY_CONFIG = { apple: { certificates: [{ type: 'DEVELOPER_ID_INSTALLER_G2', manual: true }] } };

function issueCert({ keyPath, cn, outPath, newKeyPath = null }) {
  const keyArgs = newKeyPath
    ? `-nodes -newkey rsa:2048 -keyout "${newKeyPath}"`
    : `-key "${keyPath}"`;
  execSync(
    `openssl req -x509 ${keyArgs} -days 365 -subj "/CN=${cn}/C=US" -outform DER -out "${outPath}"`,
    { stdio: 'pipe' },
  );
}

test('certificates: walkthrough stages the CSR, opens the portal, and installs the paired download', async () => {
  const root = stageBrand();
  const downloads = mkdtempSync(join(tmpdir(), 'omega-certs-downloads-'));
  const client = fakeApple({ certificates: [] });
  const keychain = fakeKeychain();
  const certPath = join(appleDirOf(root), 'certificates', 'DEVELOPER_ID_INSTALLER_G2.cer');

  const tty = openTtyPrompt();
  const opened = [];
  setBrowserOpener(async (url) => {
    opened.push(url);
    // Play Apple: issue the cert from the CSR key the service just staged
    issueCert({
      keyPath: join(appleDirOf(root), 'csr', 'DEVELOPER_ID_INSTALLER_G2', 'private.key'),
      cn: 'Developer ID Installer: Fixture (TEAMTEST12)',
      outPath: join(downloads, 'developerID_installer.cer'),
    });
    return true;
  });

  try {
    const run = runService(brandConfig(MANUAL_ONLY_CONFIG), {
      root, client, keychain: keychain.fn, operations: ONLY('certificates'), downloadsDir: downloads,
    });
    await tty.answer('Press Enter to open the Apple Developer portal', '\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.output.certificates.synced, 1);
    assert.equal(result.output.certificates.manualMissing, undefined);
    assert.equal(result.state.certificateMap.DEVELOPER_ID_INSTALLER_G2.id, 'manual');
    assert.deepEqual(opened, [PORTAL_CREATE_URL]);
    // The picker-friendly CSR copy was staged into Downloads
    assert.ok(jetpack.exists(join(downloads, 'omega-DEVELOPER_ID_INSTALLER_G2.certSigningRequest')));
    // Installed + REAL .p12 export from the paired key + keychain import
    assert.ok(jetpack.exists(certPath));
    assert.ok(jetpack.exists(join(appleDirOf(root), 'certificates', 'DEVELOPER_ID_INSTALLER_G2.p12')));
    assert.equal(keychain.calls.length, 1);
    // Portal-only stays portal-only: nothing was ever POSTed to Apple
    assert.deepEqual(client.mutations(), []);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('certificates: walkthrough rejects a download of the wrong type and (s) keeps the warn contract', async () => {
  const root = stageBrand();
  const downloads = mkdtempSync(join(tmpdir(), 'omega-certs-downloads-'));
  const client = fakeApple({ certificates: [] });
  const certPath = join(appleDirOf(root), 'certificates', 'DEVELOPER_ID_INSTALLER_G2.cer');

  const tty = openTtyPrompt();
  setBrowserOpener(async () => {
    // Right CSR, wrong portal choice: the CN says Developer ID APPLICATION
    issueCert({
      keyPath: join(appleDirOf(root), 'csr', 'DEVELOPER_ID_INSTALLER_G2', 'private.key'),
      cn: 'Developer ID Application: Fixture (TEAMTEST12)',
      outPath: join(downloads, 'developerID_application.cer'),
    });
    return true;
  });

  try {
    const run = runService(brandConfig(MANUAL_ONLY_CONFIG), {
      root, client, operations: ONLY('certificates'), downloadsDir: downloads,
    });
    await tty.answer('Press Enter to open the Apple Developer portal', '\r');
    await tty.answer('(s)=skip', 's');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.equal(result.output.certificates.manualMissing, 1);
    assert.ok(!jetpack.exists(certPath));
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('certificates: walkthrough rejects a cert that does not pair with the staged CSR key', async () => {
  const root = stageBrand();
  const downloads = mkdtempSync(join(tmpdir(), 'omega-certs-downloads-'));
  const client = fakeApple({ certificates: [] });
  const certPath = join(appleDirOf(root), 'certificates', 'DEVELOPER_ID_INSTALLER_G2.cer');

  const tty = openTtyPrompt();
  setBrowserOpener(async () => {
    // Right CN, WRONG key — e.g. a cert issued from a Keychain Access CSR
    issueCert({
      newKeyPath: join(downloads, 'throwaway.key'),
      cn: 'Developer ID Installer: Fixture (TEAMTEST12)',
      outPath: join(downloads, 'developerID_installer.cer'),
    });
    return true;
  });

  try {
    const run = runService(brandConfig(MANUAL_ONLY_CONFIG), {
      root, client, operations: ONLY('certificates'), downloadsDir: downloads,
    });
    await tty.answer('Press Enter to open the Apple Developer portal', '\r');
    await tty.answer('(s)=skip', 's');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.equal(result.output.certificates.manualMissing, 1);
    assert.ok(!jetpack.exists(certPath));
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

// ─── Bundle IDs ──────────────────────────────────────────────────────────────

test('certificates: a missing bundle ID is created with the APPLE_ID_AUTH consent settings', async () => {
  const client = fakeApple({
    bundleIds: [],
    'POST bundleIds': { data: bundleRecord('bundle-new') },
    'POST bundleIdCapabilities': { data: { id: 'cap-new' } },
  });

  const result = await runService(brandConfig(), { root: stageBrand(), client, operations: ONLY('bundle-ids') });

  assert.equal(result.status, 'success');
  const [createPost, capPost] = client.mutations();
  assert.equal(createPost.path, 'bundleIds');
  assert.deepEqual(createPost.body.data.attributes, { identifier: BUNDLE_IDENTIFIER, name: BRAND_NAME, platform: 'IOS' });
  assert.equal(capPost.path, 'bundleIdCapabilities');
  assert.equal(capPost.body.data.attributes.capabilityType, 'APPLE_ID_AUTH');
  assert.deepEqual(capPost.body.data.attributes.settings, [
    { key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT', enabled: true }] },
  ]);
  assert.equal(capPost.body.data.relationships.bundleId.data.id, 'bundle-new');
  assert.deepEqual(result.output.bundleIds, { created: true });
  assert.deepEqual(result.state.bundleId, { identifier: BUNDLE_IDENTIFIER, id: 'bundle-new', platforms: ['MACOS'] });
});

test('certificates: a missing bundleIdPrefix is ASKED for and the pass continues on it (#635)', async () => {
  const root = makeBrandRoot('{\n  brand: { id: "fixture-brand" },\n  certificates: { providers: { apple: {} } }, // the prefix lands here\n}\n');
  const client = fakeApple({
    bundleIds: [],
    'POST bundleIds': { data: bundleRecord('bundle-new') },
    'POST bundleIdCapabilities': { data: { id: 'cap-new' } },
  });

  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();
  try {
    const run = runService(brandConfig({ apple: { bundleIdPrefix: null } }), { root, client, operations: ONLY('bundle-ids') });
    await tty.answer('Apple bundle id prefix', 'com.fixture\r');
    const result = await run;

    assert.equal(result.status, 'success');
    // The pass continued on the prefix just entered
    assert.deepEqual(result.output.bundleIds, { created: true });
    assert.equal(client.mutations()[0].body.data.attributes.identifier, BUNDLE_IDENTIFIER);
    // ...and it landed in config, comments intact, so nothing asks again
    const written = readConfigSource(root);
    assert.match(written, /bundleIdPrefix: "com\.fixture"/);
    assert.match(written, /\/\/ the prefix lands here/);
    assert.deepEqual(opened, ['https://developer.apple.com/account/resources/identifiers/list']);
  } finally {
    setBrowserOpener(null);
    tty.close();
  }
});

test('certificates: no bundleIdPrefix on a headless run is a warned skip, never an error (#635)', async () => {
  const root = makeBrandRoot('{\n  brand: { id: "fixture-brand" },\n}\n');
  const client = fakeApple({ bundleIds: [] });

  const result = await runService(brandConfig({ apple: { bundleIdPrefix: null } }), { root, client, operations: ONLY('bundle-ids') });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.bundleIds, { skipped: 'no bundleIdPrefix' });
  assert.deepEqual(client.mutations(), []);
  // Nothing was written for a value nobody was asked for
  assert.doesNotMatch(readConfigSource(root), /bundleIdPrefix/);
});

test('certificates: a missing capability on an existing bundle ID is added', async () => {
  const client = fakeApple({
    bundleIds: [bundleRecord()],
    'bundleIds/bundle-1/bundleIdCapabilities': [],
    'POST bundleIdCapabilities': { data: { id: 'cap-new' } },
  });

  const result = await runService(brandConfig(), { root: stageBrand(), client, operations: ONLY('bundle-ids') });

  assert.equal(result.status, 'success');
  assert.equal(client.mutations().length, 1);
  assert.deepEqual(result.output.bundleIds, { capabilitiesAdded: 1 });
});

test('certificates: mobile + desktop targets derive both platforms', async () => {
  const client = fakeApple({
    bundleIds: [bundleRecord()],
    'bundleIds/bundle-1/bundleIdCapabilities': [{ id: 'cap-1', attributes: { capabilityType: 'APPLE_ID_AUTH' } }],
  });

  const result = await runService(
    brandConfig({ targets: { desktop: { type: 'desktop' }, mobile: { type: 'mobile' } } }),
    { root: stageBrand(), client, operations: ONLY('bundle-ids') },
  );

  assert.deepEqual(result.state.bundleId.platforms, ['IOS', 'MACOS']);
});

// The bundle-id policy itself is @omega.js/config's now (#909), pinned by
// packages/config/test/bundle-id.test.js: one derivation for the id this
// service registers and the id the desktop build signs under.

// ─── Profiles ────────────────────────────────────────────────────────────────

const CERT_STATE = {
  MAC_APP_DISTRIBUTION: { id: 'cert-mad', certificateType: 'MAC_APP_DISTRIBUTION', expirationDate: FUTURE },
  DEVELOPER_ID_APPLICATION_G2: { id: 'cert-devid', certificateType: 'DEVELOPER_ID_APPLICATION_G2', expirationDate: FUTURE },
};
const BUNDLE_STATE = { identifier: BUNDLE_IDENTIFIER, id: 'bundle-1', platforms: ['MACOS'] };

test('certificates: a missing profile is created against the bundle ID + cert and downloaded; Developer ID asks for none (#891)', async () => {
  const root = stageBrand();
  const client = fakeApple({
    profiles: [],
    'POST profiles': (url, options) => {
      const body = JSON.parse(options.body);
      return { data: profileRecord(body.data.attributes.profileType, body.data.attributes.name, `new-${body.data.attributes.profileType}`) };
    },
    'GET profiles/new-MAC_APP_STORE': { data: { attributes: { profileContent: Buffer.from('fixture-profile').toString('base64') } } },
  });

  const result = await runService(brandConfig(), {
    root, client, operations: ONLY('profiles'),
    serviceData: { bundleId: BUNDLE_STATE, certificateMap: CERT_STATE },
  });

  assert.equal(result.status, 'success');
  // Developer ID is DIRECT distribution: signed, notarized, no profile (#891),
  // so the App Store profile is the ONLY one created.
  assert.deepEqual(result.output.profiles, { synced: 0, downloaded: 0, created: 1 });

  const [storePost, ...rest] = client.mutations();
  assert.deepEqual(rest, [], 'nothing is requested for DEVELOPER_ID_APPLICATION_G2');
  assert.deepEqual(storePost.body.data.attributes, { name: `${BRAND_NAME} - MAC_APP_DISTRIBUTION (MACOS)`, profileType: 'MAC_APP_STORE' });
  assert.equal(storePost.body.data.relationships.bundleId.data.id, 'bundle-1');
  assert.deepEqual(storePost.body.data.relationships.certificates.data, [{ type: 'certificates', id: 'cert-mad' }]);
  assert.equal(storePost.body.data.relationships.devices, undefined);

  // Distribution profiles never fetch the device list
  assert.equal(client.calls.some((c) => c.path === 'devices'), false);

  const written = jetpack.read(join(appleDirOf(root), 'profiles', BRAND_ID, 'MAC_APP_DISTRIBUTION', 'MACOS.mobileprovision'));
  assert.equal(written, 'fixture-profile');
});

test('certificates: a cert known only from its local file cannot back a new profile', async () => {
  const result = await runService(brandConfig(), {
    root: stageBrand(),
    client: fakeApple({ profiles: [] }),
    operations: ONLY('profiles'),
    serviceData: {
      bundleId: BUNDLE_STATE,
      certificateMap: { MAC_APP_DISTRIBUTION: { id: 'manual', certificateType: 'MAC_APP_DISTRIBUTION', expirationDate: FUTURE } },
    },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.profiles, { synced: 0, downloaded: 0, created: 0 });
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('certificates: dry run on an empty account plans everything and writes nothing', async () => {
  const root = stageBrand();
  const client = fakeApple({ certificates: [], bundleIds: [] });
  const keychain = fakeKeychain();

  const result = await runService(brandConfig(), { root, client, keychain: keychain.fn, options: { dryRun: true } });

  // Manual certs are still missing in a dry run — the warning is real
  assert.equal(result.status, 'warned');
  assert.deepEqual(client.mutations(), []);
  assert.equal(keychain.calls.length, 0);
  assert.deepEqual(result.output.certificates.planned, AUTOMATED_TYPES.map((t) => `create ${t}`));
  assert.equal(result.output.certificates.manualMissing, 2);
  assert.deepEqual(result.output.bundleIds, { planned: [`create ${BUNDLE_IDENTIFIER}`] });
  assert.deepEqual(result.output.profiles, { planned: 'after bundle ID exists' });

  // ZERO files written — not even directories
  assert.equal(jetpack.exists(appleDirOf(root)), false);
});

// ─── JWT (shared lib backing both Apple ES256 and Firestore RS256) ──────────

test('jwt: ES256 tokens carry the kid header and a raw r||s signature that verifies', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const token = signJwt(
    { alg: 'ES256', kid: 'KEY-TEST', typ: 'JWT' },
    { iss: 'issuer-test', aud: 'appstoreconnect-v1' },
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );

  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'ES256', kid: 'KEY-TEST', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), { iss: 'issuer-test', aud: 'appstoreconnect-v1' });

  const sig = Buffer.from(signature, 'base64url');
  assert.equal(sig.length, 64); // JOSE raw r||s, not ASN.1/DER
  assert.equal(
    verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig),
    true,
  );
});

test('jwt: RS256 tokens verify (the firestore-rest service-account grant path)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    { iss: 'sa@project.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/datastore' },
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );

  const [header, payload, signature] = token.split('.');
  assert.equal(
    verify('sha256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')),
    true,
  );
});

// ─── Apple agreements ladder (live find, 2026-07-14 first exercise) ─────────

test('certificates: Apple\'s agreements-expired 403 downgrades to WARNED with guidance (live message shape, no code)', async () => {
  // The LIVE failure: message carried only title+detail — no
  // FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED code — and errored raw.
  const client = fakeApple({
    certificates: [], // list is empty — the failure fires on CREATE, the live shape
    'POST certificates': () => {
      throw new Error('Apple API request failed (POST https://api.appstoreconnect.apple.com/v1/certificates): A required agreement is missing or has expired.: This request requires an in-effect agreement that has not been signed or has expired.');
    },
  });

  const result = await runService(brandConfig(), {
    root: stageBrand(),
    client,
    operations: ONLY('certificates'),
  });

  assert.equal(result.status, 'warned', 'human-gated prerequisite = warn ladder, not service error');
  assert.match(JSON.stringify(result.output), /developer\.apple\.com\/account/, 'guidance rides the output');
  assert.match(JSON.stringify(result.output), /"agreements":"pending"/);
});

test('certificates: the code-carrying agreements variant warns too, and other Apple errors still fail', async () => {
  const coded = fakeApple({
    certificates: [],
    'POST certificates': () => {
      throw new Error('Apple API request failed (POST …/certificates): [FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED] Forbidden: agreements');
    },
  });
  const warned = await runService(brandConfig(), { root: stageBrand(), client: coded, operations: ONLY('certificates') });
  assert.equal(warned.status, 'warned');

  const broken = fakeApple({
    certificates: [],
    'POST certificates': () => {
      throw new Error('Apple API request failed (POST …/certificates): [INTERNAL_SERVER_ERROR] boom');
    },
  });
  const failed = await runService(brandConfig(), { root: stageBrand(), client: broken, operations: ONLY('certificates') });
  assert.equal(failed.status, 'error', 'only the agreements 403 downgrades');
});
