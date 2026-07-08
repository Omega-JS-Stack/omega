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
const service = require('../src/services/certificates/index.js');

// Tests must never see real credentials from the shell environment
const APPLE_ENV_VARS = ['APPLE_API_ISSUER', 'APPLE_API_KEY_ID', 'APPLE_TEAM_ID', 'CSC_KEY_PASSWORD', 'APPLE_KEYCHAIN_PASSWORD'];
for (const key of APPLE_ENV_VARS) {
  delete process.env[key];
}

const BRAND_ID = 'fixture-brand';
const BRAND_NAME = 'Fixture Brand';
const PREFIX = 'com.fixture';
const BUNDLE_IDENTIFIER = `${PREFIX}.${BRAND_ID}`;
const ALL_TYPES = DEFAULTS.certificates.apple.certificates.map((c) => c.type);
const AUTOMATED_TYPES = DEFAULTS.certificates.apple.certificates.filter((c) => !c.manual).map((c) => c.type);
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
const FIXTURE_KEY = jetpack.read(join(FIXTURE_DIR, 'private.key'));
const FIXTURE_CSR = jetpack.read(join(FIXTURE_DIR, 'request.csr'));
const FIXTURE_CERT_DER = jetpack.read(join(FIXTURE_DIR, 'cert.cer'), 'buffer');

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

function brandConfig({ certificates = {}, apple = {}, targets = { desktop: {} } } = {}) {
  return {
    brand: { id: BRAND_ID, name: BRAND_NAME, url: 'https://fixture-brand.test' },
    targets,
    certificates: certificates === false ? false : {
      ...structuredClone(DEFAULTS.certificates),
      ...certificates,
      apple: { ...structuredClone(DEFAULTS.certificates.apple), bundleIdPrefix: PREFIX, ...apple },
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
function stageLocalCert(root, type, { key = true, p12 = true } = {}) {
  const dir = appleDirOf(root);
  jetpack.write(join(dir, 'certificates', `${type}.cer`), FIXTURE_CERT_DER);
  if (key) {
    jetpack.write(join(dir, 'csr', type, 'private.key'), FIXTURE_KEY);
  }
  if (p12) {
    // Written after the .cer → newer mtime → exportToP12 no-ops (fresh)
    jetpack.write(join(dir, 'certificates', `${type}.p12`), Buffer.from('fixture-p12'));
  }
}

function runService(config, { root, client, options = {}, keychain, secrets, operations = OPERATIONS.certificates, serviceData = {} } = {}) {
  return service.run({
    brandId: BRAND_ID,
    brandRoot: root,
    brandConfig: config,
    brand: { id: BRAND_ID, config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations,
    options,
    serviceData,
    appleClient: client,
    appleSecrets: client ? (secrets ?? fakeSecrets()) : undefined,
    // Default to a silent fake so no test can ever touch the real keychain
    keychainImport: keychain || (() => ({ imported: 0, skipped: 0, failed: 0 })),
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
  assert.equal(DEFAULTS.certificates.apple.bundleIdPrefix, null);
  assert.deepEqual(DEFAULTS.certificates.apple.capabilities, ['APPLE_ID_AUTH']);
  assert.deepEqual(DEFAULTS.certificates.apple.profiles, ['IOS_DISTRIBUTION', 'MAC_APP_DISTRIBUTION', 'DEVELOPER_ID_APPLICATION_G2']);
  assert.deepEqual(DEFAULTS.certificates.apple.certificates, [
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
  const result = await runService(brandConfig({ targets: { web: {}, backend: {} } }), { root: stageBrand() });
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
  jetpack.write(join(dir, 'profiles', 'MAC_APP_DISTRIBUTION', 'MACOS.mobileprovision'), 'staged');
  jetpack.write(join(dir, 'profiles', 'DEVELOPER_ID_APPLICATION_G2', 'MACOS.mobileprovision'), 'staged');

  const client = fakeApple({
    certificates: ALL_TYPES.map((type) => certRecord(type)),
    bundleIds: [bundleRecord()],
    'bundleIds/bundle-1/bundleIdCapabilities': [{ id: 'cap-1', attributes: { capabilityType: 'APPLE_ID_AUTH' } }],
    profiles: [
      profileRecord('MAC_APP_STORE', `${BRAND_NAME} - MAC_APP_DISTRIBUTION (MACOS)`),
      profileRecord('MAC_APP_DIRECT', `${BRAND_NAME} - DEVELOPER_ID_APPLICATION_G2 (MACOS)`),
    ],
  });
  const keychain = fakeKeychain();

  const result = await runService(brandConfig(), { root, client, keychain: keychain.fn });

  assert.equal(result.status, 'success');
  assert.deepEqual(client.mutations(), []);
  assert.deepEqual(result.output.certificates, { synced: 6, downloaded: 0, created: 0 });
  assert.deepEqual(result.output.bundleIds, { synced: true });
  assert.deepEqual(result.output.profiles, { synced: 2, downloaded: 0, created: 0 });

  // Durable state: trimmed cert records + the resolved bundle ID + profiles
  assert.deepEqual(Object.keys(result.state.certificateMap).sort(), [...ALL_TYPES].sort());
  assert.deepEqual(result.state.certificateMap.DEVELOPMENT, {
    id: 'cert-DEVELOPMENT', certificateType: 'DEVELOPMENT', expirationDate: FUTURE,
  });
  assert.deepEqual(result.state.bundleId, { identifier: BUNDLE_IDENTIFIER, id: 'bundle-1', platforms: ['MACOS'] });
  assert.deepEqual(Object.keys(result.state.profiles).sort(), [
    'developer_id_application_g2-macos', 'mac_app_distribution-macos',
  ]);

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

  const client = fakeApple({
    certificates: ALL_TYPES.filter((t) => t !== 'DEVELOPMENT').map((t) => certRecord(t)),
    'POST certificates': { data: certRecord('DEVELOPMENT', 'cert-dev') },
    'GET certificates/cert-dev': { data: { attributes: { certificateContent: FIXTURE_CERT_DER.toString('base64') } } },
  });

  const result = await runService(brandConfig(), { root, client, operations: ONLY('certificates') });

  assert.equal(result.status, 'success');
  const csrOnDisk = jetpack.read(join(dir, 'csr', 'DEVELOPMENT', 'request.csr'));
  assert.ok(jetpack.exists(join(dir, 'csr', 'DEVELOPMENT', 'private.key')));
  assert.equal(client.mutations()[0].body.data.attributes.csrContent, cleanCSR(csrOnDisk));
  assert.equal(result.output.certificates.created, 1);
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
  // Manual G2 certs exist locally only (no API record, no private key)
  stageLocalCert(root, 'DEVELOPER_ID_APPLICATION_G2', { key: false, p12: false });
  stageLocalCert(root, 'DEVELOPER_ID_INSTALLER_G2', { key: false, p12: false });

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
    brandConfig({ targets: { desktop: {}, mobile: {} } }),
    { root: stageBrand(), client, operations: ONLY('bundle-ids') },
  );

  assert.deepEqual(result.state.bundleId.platforms, ['IOS', 'MACOS']);
});

test('certificates: an unset bundleIdPrefix is a config error', async () => {
  const result = await runService(
    brandConfig({ apple: { bundleIdPrefix: null } }),
    { root: stageBrand(), client: fakeApple(), operations: ONLY('bundle-ids') },
  );

  assert.equal(result.status, 'error');
  assert.match(result.error, /bundleIdPrefix/);
});

// ─── Profiles ────────────────────────────────────────────────────────────────

const CERT_STATE = {
  MAC_APP_DISTRIBUTION: { id: 'cert-mad', certificateType: 'MAC_APP_DISTRIBUTION', expirationDate: FUTURE },
  DEVELOPER_ID_APPLICATION_G2: { id: 'cert-devid', certificateType: 'DEVELOPER_ID_APPLICATION_G2', expirationDate: FUTURE },
};
const BUNDLE_STATE = { identifier: BUNDLE_IDENTIFIER, id: 'bundle-1', platforms: ['MACOS'] };

test('certificates: missing profiles are created against the bundle ID + cert and downloaded', async () => {
  const root = stageBrand();
  const client = fakeApple({
    profiles: [],
    'POST profiles': (url, options) => {
      const body = JSON.parse(options.body);
      return { data: profileRecord(body.data.attributes.profileType, body.data.attributes.name, `new-${body.data.attributes.profileType}`) };
    },
    'GET profiles/new-MAC_APP_STORE': { data: { attributes: { profileContent: Buffer.from('fixture-profile').toString('base64') } } },
    'GET profiles/new-MAC_APP_DIRECT': { data: { attributes: { profileContent: Buffer.from('fixture-profile').toString('base64') } } },
  });

  const result = await runService(brandConfig(), {
    root, client, operations: ONLY('profiles'),
    serviceData: { bundleId: BUNDLE_STATE, certificateMap: CERT_STATE },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.profiles, { synced: 0, downloaded: 0, created: 2 });

  const [storePost, directPost] = client.mutations();
  assert.deepEqual(storePost.body.data.attributes, { name: `${BRAND_NAME} - MAC_APP_DISTRIBUTION (MACOS)`, profileType: 'MAC_APP_STORE' });
  assert.equal(storePost.body.data.relationships.bundleId.data.id, 'bundle-1');
  assert.deepEqual(storePost.body.data.relationships.certificates.data, [{ type: 'certificates', id: 'cert-mad' }]);
  assert.equal(storePost.body.data.relationships.devices, undefined);
  assert.deepEqual(directPost.body.data.relationships.certificates.data, [{ type: 'certificates', id: 'cert-devid' }]);

  // Distribution profiles never fetch the device list
  assert.equal(client.calls.some((c) => c.path === 'devices'), false);

  const written = jetpack.read(join(appleDirOf(root), 'profiles', 'MAC_APP_DISTRIBUTION', 'MACOS.mobileprovision'));
  assert.equal(written, 'fixture-profile');
});

test('certificates: a cert known only from its local file cannot back a new profile', async () => {
  const result = await runService(brandConfig(), {
    root: stageBrand(),
    client: fakeApple({ profiles: [] }),
    operations: ONLY('profiles'),
    serviceData: {
      bundleId: BUNDLE_STATE,
      certificateMap: { DEVELOPER_ID_APPLICATION_G2: { id: 'manual', certificateType: 'DEVELOPER_ID_APPLICATION_G2', expirationDate: FUTURE } },
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
