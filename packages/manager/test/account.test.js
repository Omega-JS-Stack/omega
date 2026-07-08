/**
 * Account service tests — the users operation against method-level
 * recording fakes of the auth admin, Firestore, and backend clients, with
 * the password derivation and custom-token signing real. Proves skip
 * semantics, the ACCOUNT_PASSWORD_SEED .env writeback (and that dry runs
 * never write it), the converged zero-mutation no-op, account creation
 * with signup, password convergence, the leaf-path admin/plan merge (and
 * the no-products no-op omega-manager got wrong), the {domain} template,
 * marketing-only entries, the unauthorized-admin audit error, and the
 * dry-run zero-mutation guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { generateKeyPairSync, createVerify } = require('node:crypto');
const jetpack = require('fs-jetpack');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { derivePassword } = require('../src/services/account/lib/password.js');
const { createAuthAdmin, CUSTOM_TOKEN_AUD } = require('../src/lib/auth-admin.js');
const { writeEnvValue } = require('../src/lib/env-secret.js');
const service = require('../src/services/account/index.js');

delete process.env.ACCOUNT_PASSWORD_SEED;

const SEED = 'fixture-seed';
const DOMAIN = 'fixture-brand.test';
const EMAIL = `support@${DOMAIN}`;
const PASSWORD = derivePassword(SEED, EMAIL, DOMAIN);

const USER = { uid: 'uid-support', email: EMAIL, providerData: [{ providerId: 'google.com' }] };
const ADMIN_DOC = { roles: { admin: true }, subscription: { product: { id: 'pro', name: 'Pro' } } };
const ADMIN_QUERY = {
  from: [{ collectionId: 'users' }],
  where: {
    fieldFilter: {
      field: { fieldPath: 'roles.admin' },
      op: 'EQUAL',
      value: { booleanValue: true },
    },
  },
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

function stageBrand() {
  return mkdtempSync(join(tmpdir(), 'omega-account-'));
}

function brandConfig({ account, admins, products, firebase, url } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: url !== undefined ? url : `https://${DOMAIN}` },
    targets: { web: {}, backend: {} },
    firebase: firebase || { shared: false },
    payment: {
      products: products !== undefined ? products : [
        { id: 'basic', name: 'Basic' },
        { id: 'pro', name: 'Pro' },
      ],
    },
  };
  if (account !== undefined) {
    config.account = account;
  } else {
    config.account = {
      enabled: true,
      admins: admins || [{ email: 'support@{domain}', account: true, marketing: true }],
    };
  }
  return config;
}

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function makeFake(name, methods, mutating, responses) {
  const api = { calls: [] };

  for (const method of methods) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`${name}: unexpected call ${method}(${JSON.stringify(args[0])})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  api.mutations = () => api.calls.filter((c) => mutating.has(c.method));
  api.of = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

function fakeAuth(responses = {}) {
  return makeFake('fakeAuth', ['getUserByEmail', 'getUser', 'createUser', 'updateUser', 'createCustomToken'],
    new Set(['createUser', 'updateUser']), responses);
}

function fakeFirestore(responses = {}) {
  return makeFake('fakeFirestore', ['getDoc', 'patchDoc', 'runQuery'],
    new Set(['patchDoc']), responses);
}

function fakeBackend(responses = {}) {
  return makeFake('fakeBackend', ['verifyPassword', 'signup', 'syncMarketingContact'],
    new Set(['signup', 'syncMarketingContact']), responses);
}

/** Fakes for a fully converged brand (nothing to change). */
function convergedClients() {
  return {
    auth: fakeAuth({ getUserByEmail: USER, getUser: USER }),
    firestore: fakeFirestore({ getDoc: ADMIN_DOC, runQuery: [{ id: USER.uid, data: {} }] }),
    backend: fakeBackend({ verifyPassword: true, syncMarketingContact: undefined }),
  };
}

async function runService(config, { root, auth, firestore, backend, options = {}, seed = SEED, brandState } = {}) {
  const previousSeed = process.env.ACCOUNT_PASSWORD_SEED;
  if (seed === null) {
    delete process.env.ACCOUNT_PASSWORD_SEED;
  } else {
    process.env.ACCOUNT_PASSWORD_SEED = seed;
  }

  try {
    return await service.run({
      brandId: 'fixture-brand',
      brandRoot: root || stageBrand(),
      brandConfig: config,
      brandState: brandState !== undefined ? brandState : { firebase: { sdkConfig: { apiKey: 'fixture-api-key' } } },
      operations: OPERATIONS.account,
      options,
      serviceData: {},
      authAdmin: auth,
      firestore,
      accountBackend: backend,
    });
  } finally {
    if (previousSeed === undefined) {
      delete process.env.ACCOUNT_PASSWORD_SEED;
    } else {
      process.env.ACCOUNT_PASSWORD_SEED = previousSeed;
    }
  }
}

// ─── Registry / defaults / password pins ─────────────────────────────────────

test('account: registered after update, before testing, with the users operation', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('update') + 1], 'account');
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('account') + 1], 'migrations');
  assert.deepEqual(OPERATIONS.account.map((o) => o.name), ['users']);
  assert.deepEqual(DEFAULTS.account, {
    enabled: true,
    admins: [{ email: 'support@{domain}', account: true, marketing: true }],
  });
});

test('account: derivePassword is deterministic with guaranteed complexity classes', () => {
  assert.equal(derivePassword(SEED, EMAIL, DOMAIN), PASSWORD);
  assert.match(PASSWORD, /^A1![A-Za-z0-9_-]{20}$/);
});

test('account: derivePassword varies per email, domain, and seed', () => {
  assert.notEqual(derivePassword(SEED, 'other@x.com', DOMAIN), PASSWORD);
  assert.notEqual(derivePassword(SEED, EMAIL, 'other-brand.test'), PASSWORD);
  assert.notEqual(derivePassword('other-seed', EMAIL, DOMAIN), PASSWORD);
});

test('account: derivePassword uses the apex domain so subdomains do not rotate passwords', () => {
  const base = derivePassword(SEED, EMAIL, 'mybrand.com');
  assert.equal(derivePassword(SEED, EMAIL, 'www.mybrand.com'), base);
  assert.equal(derivePassword(SEED, EMAIL, 'api.mybrand.com'), base);
});

test('account: custom tokens carry the Firebase audience and uid, signed by the service account', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const client = createAuthAdmin({
    project_id: 'fixture-project',
    client_email: 'sa@fixture-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });

  const token = client.createCustomToken('uid-42');
  const [header, payload, signature] = token.split('.');

  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.aud, CUSTOM_TOKEN_AUD);
  assert.equal(claims.uid, 'uid-42');
  assert.equal(claims.iss, 'sa@fixture-project.iam.gserviceaccount.com');
  assert.equal(claims.sub, claims.iss);

  const verifier = createVerify('SHA256');
  verifier.update(`${header}.${payload}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, 'base64url')), true);
});

// ─── env-secret shared lib ───────────────────────────────────────────────────

test('env-secret: writeEnvValue appends to a fresh .env and replaces in place on rerun', () => {
  const root = stageBrand();

  writeEnvValue(root, 'FIXTURE_SECRET', 'first');
  assert.equal(jetpack.read(join(root, '.env')), 'FIXTURE_SECRET="first"\n');

  jetpack.write(join(root, '.env'), 'OTHER_VAR="keep"\nFIXTURE_SECRET="first"\nTRAILING_VAR="keep"\n');
  writeEnvValue(root, 'FIXTURE_SECRET', 'second');
  assert.equal(
    jetpack.read(join(root, '.env')),
    'OTHER_VAR="keep"\nFIXTURE_SECRET="second"\nTRAILING_VAR="keep"\n',
  );
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('account: account.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ account: { enabled: false } }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /account\.enabled/);
});

test('account: scalar account: false skips the service', async () => {
  const result = await runService(brandConfig({ account: false }));
  assert.equal(result.status, 'skipped');
});

test('account: no backend target skips the service', async () => {
  const config = brandConfig();
  delete config.targets.backend;
  const result = await runService(config);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no backend target/);
});

test('account: shared Firebase project skips the service', async () => {
  const result = await runService(brandConfig({ firebase: { shared: true } }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /shared Firebase project/);
});

test('account: missing brand.url skips the service', async () => {
  const result = await runService(brandConfig({ url: '' }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no brand\.url/);
});

test('account: empty admins list skips the service', async () => {
  const result = await runService(brandConfig({ account: { enabled: true, admins: [] } }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no account\.admins/);
});

test('account: missing service account skips with firebase-service guidance', async () => {
  const root = stageBrand();
  const result = await runService(brandConfig(), { root });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /\.omega\/secrets\/service-account\.json.*firebase service/);
  // The skip happened before seed resolution — nothing written
  assert.equal(jetpack.exists(join(root, '.env')), false);
});

// ─── Seed writeback ──────────────────────────────────────────────────────────

test('account: generates ACCOUNT_PASSWORD_SEED, persists it to .env, and derives from it', async () => {
  const root = stageBrand();
  const auth = fakeAuth({ getUserByEmail: USER, getUser: USER, updateUser: undefined });
  const firestore = fakeFirestore({ getDoc: ADMIN_DOC, runQuery: [{ id: USER.uid, data: {} }] });
  const backend = fakeBackend({ verifyPassword: false, syncMarketingContact: undefined });

  const result = await runService(brandConfig(), { root, auth, firestore, backend, seed: null });
  assert.equal(result.status, 'success');

  const envContent = jetpack.read(join(root, '.env'));
  const seedMatch = envContent.match(/^ACCOUNT_PASSWORD_SEED="([A-Za-z0-9_-]{32})"$/m);
  assert.ok(seedMatch, `.env should carry the generated seed, got: ${envContent}`);

  // The password pushed to Firebase Auth derives from the seed just persisted
  assert.deepEqual(auth.of('updateUser')[0].args, [USER.uid, { password: derivePassword(seedMatch[1], EMAIL, DOMAIN) }]);
});

// ─── Convergence / mutations ─────────────────────────────────────────────────

test('account: a converged brand is a zero-mutation no-op with only the marketing push', async () => {
  const { auth, firestore, backend } = convergedClients();
  const result = await runService(brandConfig(), { auth, firestore, backend });

  assert.equal(result.status, 'success');
  assert.equal(result.state, null);
  assert.equal(auth.mutations().length, 0);
  assert.equal(firestore.mutations().length, 0);
  assert.deepEqual(backend.of('verifyPassword')[0].args, [EMAIL, PASSWORD]);
  assert.deepEqual(backend.of('syncMarketingContact')[0].args, [USER.uid]);
  assert.equal(backend.of('signup').length, 0);
  assert.deepEqual(result.output.users, {
    ok: 1, created: 0, updated: 0, adminUpdated: 0, planned: 0, marketingSynced: 1,
  });
});

test('account: the admin audit runs the pinned roles.admin structured query', async () => {
  const { auth, firestore, backend } = convergedClients();
  await runService(brandConfig(), { auth, firestore, backend });

  assert.deepEqual(firestore.of('runQuery')[0].args, [ADMIN_QUERY]);
  assert.deepEqual(auth.of('getUser')[0].args, [USER.uid]);
});

test('account: a drifted password is updated to the derived value', async () => {
  const auth = fakeAuth({ getUserByEmail: USER, getUser: USER, updateUser: undefined });
  const firestore = fakeFirestore({ getDoc: ADMIN_DOC, runQuery: [{ id: USER.uid, data: {} }] });
  const backend = fakeBackend({ verifyPassword: false, syncMarketingContact: undefined });

  const result = await runService(brandConfig(), { auth, firestore, backend });

  assert.equal(result.status, 'success');
  assert.deepEqual(auth.of('updateUser')[0].args, [USER.uid, { password: PASSWORD }]);
  assert.equal(result.output.users.updated, 1);
});

test('account: a missing account is created, gets admin + plan, and completes signup', async () => {
  const auth = fakeAuth({
    getUserByEmail: null,
    getUser: { uid: 'uid-new', email: EMAIL, providerData: [] },
    createUser: ({ email }) => ({ uid: 'uid-new', email }),
  });
  const firestore = fakeFirestore({ getDoc: null, patchDoc: undefined, runQuery: [{ id: 'uid-new', data: {} }] });
  const backend = fakeBackend({ signup: undefined });

  const result = await runService(brandConfig(), { auth, firestore, backend });

  assert.equal(result.status, 'success');
  assert.deepEqual(auth.of('createUser')[0].args, [{ email: EMAIL, password: PASSWORD }]);
  assert.deepEqual(firestore.of('patchDoc')[0].args, [
    'users/uid-new',
    {
      roles: { admin: true },
      subscription: { product: { id: 'pro', name: 'Pro' }, status: 'active' },
    },
    ['roles.admin', 'subscription.product.id', 'subscription.product.name', 'subscription.status'],
  ]);
  assert.deepEqual(backend.of('signup')[0].args, ['uid-new']);
  // Fresh creates rely on signup for marketing inference — no direct sync
  assert.equal(backend.of('syncMarketingContact').length, 0);
  assert.deepEqual(result.output.users, {
    ok: 0, created: 1, updated: 0, adminUpdated: 1, planned: 0, marketingSynced: 0,
  });
});

test('account: creation without a Firebase API key warns and skips the signup call', async () => {
  const auth = fakeAuth({
    getUserByEmail: null,
    getUser: { uid: 'uid-new', email: EMAIL, providerData: [] },
    createUser: ({ email }) => ({ uid: 'uid-new', email }),
  });
  const firestore = fakeFirestore({ getDoc: null, patchDoc: undefined, runQuery: [{ id: 'uid-new', data: {} }] });
  const backend = fakeBackend({});

  const result = await runService(brandConfig(), { auth, firestore, backend, brandState: {} });

  assert.equal(result.status, 'warned');
  assert.equal(backend.of('signup').length, 0);
  assert.equal(result.output.users.created, 1);
});

test('account: a failed signup call downgrades to warned and the run continues', async () => {
  const auth = fakeAuth({
    getUserByEmail: null,
    getUser: { uid: 'uid-new', email: EMAIL, providerData: [] },
    createUser: ({ email }) => ({ uid: 'uid-new', email }),
  });
  const firestore = fakeFirestore({ getDoc: null, patchDoc: undefined, runQuery: [{ id: 'uid-new', data: {} }] });
  const backend = fakeBackend({
    signup: () => { throw new Error('POST /backend-manager/user/signup failed (503)'); },
  });

  const result = await runService(brandConfig(), { auth, firestore, backend });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.users.created, 1);
  assert.equal(firestore.of('runQuery').length, 1); // audit still ran
});

test('account: {domain} templates resolve in admin emails, tolerant of spaces', async () => {
  const { auth, firestore, backend } = convergedClients();
  const config = brandConfig({
    admins: [{ email: 'support@{ domain }', account: true, marketing: true }],
  });
  await runService(config, { auth, firestore, backend });

  assert.deepEqual(auth.of('getUserByEmail')[0].args, [EMAIL]);
});

test('account: admin set but wrong plan patches only the subscription leaf paths', async () => {
  const auth = fakeAuth({ getUserByEmail: USER, getUser: USER });
  const firestore = fakeFirestore({
    getDoc: { roles: { admin: true }, subscription: { product: { id: 'basic', name: 'Basic' } } },
    patchDoc: undefined,
    runQuery: [{ id: USER.uid, data: {} }],
  });
  const backend = fakeBackend({ verifyPassword: true, syncMarketingContact: undefined });

  const result = await runService(brandConfig(), { auth, firestore, backend });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('patchDoc')[0].args, [
    `users/${USER.uid}`,
    { subscription: { product: { id: 'pro', name: 'Pro' }, status: 'active' } },
    ['subscription.product.id', 'subscription.product.name', 'subscription.status'],
  ]);
  assert.equal(result.output.users.adminUpdated, 1);
});

test('account: no payment products manages only the role — no write when converged', async () => {
  // omega-manager issued an empty merge write on every run in this case
  const auth = fakeAuth({ getUserByEmail: USER, getUser: USER });
  const firestore = fakeFirestore({ getDoc: { roles: { admin: true } }, runQuery: [{ id: USER.uid, data: {} }] });
  const backend = fakeBackend({ verifyPassword: true, syncMarketingContact: undefined });

  const result = await runService(brandConfig({ products: [] }), { auth, firestore, backend });

  assert.equal(result.status, 'success');
  assert.equal(firestore.mutations().length, 0);
});

// ─── Marketing-only entries ──────────────────────────────────────────────────

test('account: a marketing-only entry syncs when the auth user exists', async () => {
  const auth = fakeAuth({ getUserByEmail: USER });
  const firestore = fakeFirestore({ runQuery: [] });
  const backend = fakeBackend({ syncMarketingContact: undefined });

  const result = await runService(
    brandConfig({ admins: [{ email: EMAIL, marketing: true }] }),
    { auth, firestore, backend },
  );

  assert.equal(result.status, 'success');
  assert.deepEqual(backend.of('syncMarketingContact')[0].args, [USER.uid]);
  assert.equal(auth.mutations().length, 0);
});

test('account: a marketing-only entry with no auth user is skipped quietly', async () => {
  const auth = fakeAuth({ getUserByEmail: null });
  const firestore = fakeFirestore({ runQuery: [] });
  const backend = fakeBackend({});

  const result = await runService(
    brandConfig({ admins: [{ email: EMAIL, marketing: true }] }),
    { auth, firestore, backend },
  );

  assert.equal(result.status, 'success');
  assert.equal(backend.of('syncMarketingContact').length, 0);
  assert.deepEqual(result.output.users.marketingSynced, 0);
});

// ─── Admin audit ─────────────────────────────────────────────────────────────

test('account: an unauthorized admin fails the service with its email and uid', async () => {
  const { backend } = convergedClients();
  const auth = fakeAuth({
    getUserByEmail: USER,
    getUser: (uid) => (uid === USER.uid ? structuredClone(USER) : { uid, email: 'evil@example.com', providerData: [] }),
  });
  const firestore = fakeFirestore({
    getDoc: ADMIN_DOC,
    runQuery: [{ id: USER.uid, data: {} }, { id: 'uid-evil', data: {} }],
  });

  const result = await runService(brandConfig(), { auth, firestore, backend });

  assert.equal(result.status, 'error');
  assert.match(result.error, /Unauthorized admin accounts found: evil@example\.com \(uid-evil\)/);
});

test('account: an admin doc with no auth record is unauthorized', async () => {
  const { backend } = convergedClients();
  const auth = fakeAuth({
    getUserByEmail: USER,
    getUser: (uid) => (uid === USER.uid ? structuredClone(USER) : null),
  });
  const firestore = fakeFirestore({
    getDoc: ADMIN_DOC,
    runQuery: [{ id: USER.uid, data: {} }, { id: 'uid-ghost', data: {} }],
  });

  const result = await runService(brandConfig(), { auth, firestore, backend });

  assert.equal(result.status, 'error');
  assert.match(result.error, /uid-ghost/);
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('account: dry run plans a missing account without touching anything', async () => {
  const auth = fakeAuth({ getUserByEmail: null });
  const firestore = fakeFirestore({ runQuery: [] });
  const backend = fakeBackend({});

  const result = await runService(brandConfig(), {
    auth, firestore, backend, options: { dryRun: true },
  });

  assert.equal(result.status, 'success');
  assert.equal(auth.mutations().length, 0);
  assert.equal(firestore.mutations().length, 0);
  assert.equal(backend.of('signup').length, 0);
  assert.equal(result.output.users.planned, 1);
  assert.equal(firestore.of('runQuery').length, 1); // the audit is read-only and still runs
});

test('account: dry run plans password + admin + marketing on a drifted account, zero mutations', async () => {
  const auth = fakeAuth({ getUserByEmail: USER, getUser: USER });
  const firestore = fakeFirestore({ getDoc: {}, runQuery: [{ id: USER.uid, data: {} }] });
  const backend = fakeBackend({ verifyPassword: false });

  const result = await runService(brandConfig(), {
    auth, firestore, backend, options: { dryRun: true },
  });

  assert.equal(result.status, 'success');
  assert.equal(auth.mutations().length, 0);
  assert.equal(firestore.mutations().length, 0);
  assert.equal(result.output.users.planned, 3);
});

test('account: dry run without a seed plans passwords and never writes .env', async () => {
  const root = stageBrand();
  const auth = fakeAuth({ getUserByEmail: USER, getUser: USER });
  const firestore = fakeFirestore({ getDoc: ADMIN_DOC, runQuery: [{ id: USER.uid, data: {} }] });
  const backend = fakeBackend({});

  const result = await runService(brandConfig(), {
    root, auth, firestore, backend, seed: null, options: { dryRun: true },
  });

  assert.equal(result.status, 'success');
  assert.equal(jetpack.exists(join(root, '.env')), false);
  assert.equal(backend.of('verifyPassword').length, 0); // no seed → nothing to verify against
  assert.equal(result.output.users.planned, 2); // password pending + marketing sync
});
