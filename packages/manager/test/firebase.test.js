/**
 * Firebase service tests — the 13 operations against a method-level recording
 * fake of the FirebaseAPI surface (plus a Cloudflare fake for hosting's DNS
 * writes). Proves skip/shared semantics, the converged-project zero-mutation
 * no-op, per-operation drift writes, the de-ITW'd billing guidance, warned
 * manual flows (Google sign-in, VAPID), the omega.json5 firebaseConfig drift
 * check, and the dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/firebase/index.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// Tests must never see real credentials from the shell environment
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.CLOUDFLARE_TOKEN;

const DOMAIN = 'fixture-brand.test';
const PROJECT = 'fixture-proj';
const PROJECT_NUMBER = '123456789';
const SA_EMAIL = `firebase-adminsdk-x1@${PROJECT}.iam.gserviceaccount.com`;
const ZONE = { id: 'zone-1', name: DOMAIN, status: 'active' };

// The handler's REQUIRED_SERVICES list, pinned (drift here should fail loudly)
const ALL_SERVICES = [
  'serviceusage.googleapis.com', 'firebase.googleapis.com', 'firestore.googleapis.com',
  'firebasestorage.googleapis.com', 'firebasehosting.googleapis.com', 'firebasedatabase.googleapis.com',
  'identitytoolkit.googleapis.com', 'cloudfunctions.googleapis.com', 'cloudbuild.googleapis.com',
  'run.googleapis.com', 'artifactregistry.googleapis.com', 'iap.googleapis.com',
  'recaptchaenterprise.googleapis.com', 'fcm.googleapis.com',
];

// ─── Fixtures ────────────────────────────────────────────────────────────────

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-fb-'));
}

function brandConfig({ firebase = {}, firebaseConfig } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: `https://${DOMAIN}` },
    firebase: { ...structuredClone(DEFAULTS.firebase), projectId: PROJECT, ...firebase },
    targets: { web: {}, backend: {} },
  };
  if (firebaseConfig) {
    config.firebaseConfig = firebaseConfig;
  }
  return config;
}

const MUTATING_METHODS = new Set([
  'linkBillingAccount', 'enableService', 'enableServices', 'setIamPolicy',
  'updateProjectName', 'createWebApp', 'updateWebAppDisplayName', 'createBrand',
  'createServiceAccount', 'createServiceAccountKey', 'createHostingSite',
  'createCustomDomain', 'undeleteCustomDomain', 'createFirestoreDatabase',
  'enableFirestorePITR', 'createRealtimeDatabase', 'createDefaultStorageBucket',
  'initializeIdentityPlatform', 'updateIdentityConfig',
]);

const API_METHODS = [
  ...MUTATING_METHODS,
  'getProjectBillingInfo', 'listEnabledServices', 'getProjectNumber', 'getIamPolicy',
  'getGcpProject', 'listWebApps', 'getWebAppConfig', 'listBrands', 'listServiceAccounts',
  'listHostingSites', 'checkDomainStatus', 'getFirestoreDatabase', 'listRealtimeDatabases',
  'getIdentityConfig', 'getIdpConfig', 'getStorageBucket', 'isServiceEnabled',
];

/**
 * Recording fake FirebaseAPI. `responses` maps method name to a value or a
 * function of the call args (functions may throw to simulate API errors).
 * Static values are cloned per call so handlers can't mutate shared fixtures;
 * missing keys throw, so any unexpected call fails loudly.
 */
function fakeFirebase(responses = {}) {
  const api = { calls: [], responses };

  for (const name of API_METHODS) {
    api[name] = async (...args) => {
      api.calls.push({ method: name, args });
      const responder = api.responses[name];
      if (responder === undefined) {
        throw new Error(`fakeFirebase: no response for "${name}"`);
      }
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  api.mutations = () => api.calls.filter((c) => MUTATING_METHODS.has(c.method));
  api.callsTo = (name) => api.calls.filter((c) => c.method === name);
  return api;
}

/** Cloudflare fake for hosting's DNS reads/writes. */
function fakeCf({ zone = ZONE, records = [] } = {}) {
  const api = { calls: [], records };

  api.getZoneByName = async () => zone;
  api.makeRequest = async (endpoint, options = {}) => {
    const method = options.method || 'GET';
    api.calls.push({ method, endpoint, body: options.body ? JSON.parse(options.body) : undefined });

    if (method === 'GET') {
      const url = new URL(`https://cf.test${endpoint}`);
      const type = url.searchParams.get('type');
      const name = url.searchParams.get('name');
      return { success: true, result: api.records.filter((r) => r.type === type && r.name === name) };
    }

    return { success: true, result: {} };
  };

  api.mutations = () => api.calls.filter((c) => c.method !== 'GET');
  return api;
}

function runService(config, { firebase, cloudflare, options = {}, serviceData = {}, brandRoot, apps = [] } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || tmpRoot(),
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps },
    brandState: {},
    apps,
    operations: OPERATIONS.firebase,
    options,
    serviceData,
    firebaseApi: firebase,
    cloudflareApi: cloudflare,
  });
}

// Direct-handler context (bypasses setup — for focused per-operation tests)
function handlerContext(config, firebase, extra = {}) {
  return {
    firebaseApi: firebase,
    cloudflareApi: null,
    brandId: 'fixture-brand',
    brandRoot: tmpRoot(),
    brandConfig: config,
    projectId: PROJECT,
    domain: DOMAIN,
    apexDomain: DOMAIN,
    isSubdomainProject: false,
    apps: [],
    serviceData: {},
    options: {},
    ...extra,
  };
}

/** The SDK config the converged fixture serves (authDomain pre-swap). */
const RAW_SDK = {
  apiKey: 'AIzaFAKE12345',
  authDomain: `${PROJECT}.firebaseapp.com`,
  projectId: PROJECT,
  storageBucket: `${PROJECT}.firebasestorage.app`,
  messagingSenderId: PROJECT_NUMBER,
  appId: `1:${PROJECT_NUMBER}:web:abc123`,
  measurementId: 'G-FAKE1',
};

/** What sdk-config derives from RAW_SDK (custom authDomain + default RTDB URL). */
const EXPECTED_SDK = {
  ...RAW_SDK,
  authDomain: DOMAIN,
  databaseURL: `https://${PROJECT}-default-rtdb.firebaseio.com`,
};

/** Every read a fully-converged project answers. */
function convergedResponses() {
  return {
    getProjectBillingInfo: { billingEnabled: true, billingAccountName: 'billingAccounts/FIXTURE' },
    listEnabledServices: [...ALL_SERVICES],
    getProjectNumber: PROJECT_NUMBER,
    getIamPolicy: () => ({
      bindings: [
        ...['roles/storage.objectAdmin', 'roles/cloudbuild.builds.builder', 'roles/artifactregistry.writer']
          .map((role) => ({ role, members: [`serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com`] })),
        ...['roles/firebase.admin', 'roles/firebaseauth.admin', 'roles/datastore.owner', 'roles/serviceusage.serviceUsageConsumer']
          .map((role) => ({ role, members: [`serviceAccount:${SA_EMAIL}`] })),
      ],
    }),
    getGcpProject: { displayName: 'Fixture Brand' },
    listWebApps: [{ appId: 'app-1', displayName: 'Web App' }],
    getWebAppConfig: { ...RAW_SDK },
    listBrands: [{ name: `projects/${PROJECT_NUMBER}/brands/b1`, applicationTitle: 'Fixture Brand', supportEmail: `support@${DOMAIN}` }],
    listServiceAccounts: [{ email: SA_EMAIL }],
    listHostingSites: [{ name: `projects/${PROJECT}/sites/${PROJECT}` }],
    checkDomainStatus: { exists: true, verified: true, ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', requiredDnsUpdates: [] },
    getFirestoreDatabase: { locationId: 'nam5', pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED' },
    listRealtimeDatabases: [{ name: `projects/${PROJECT}/locations/us-central1/instances/${PROJECT}-default-rtdb`, databaseUrl: `https://${PROJECT}-default-rtdb.firebaseio.com` }],
    getIdentityConfig: {
      signIn: { email: { enabled: true, passwordRequired: true } },
      emailPrivacyConfig: { enableImprovedEmailPrivacy: true },
      autodeleteAnonymousUsers: true,
      passwordPolicyConfig: {
        passwordPolicyEnforcementState: 'ENFORCE',
        forceUpgradeOnSignin: false,
        passwordPolicyVersions: [{ customStrengthOptions: { minPasswordLength: 8, maxPasswordLength: 128 } }],
      },
      authorizedDomains: [DOMAIN, `${PROJECT}.firebaseapp.com`, `${PROJECT}.web.app`, 'localhost'],
    },
    getIdpConfig: { enabled: true, clientId: `${PROJECT_NUMBER}-abc.apps.googleusercontent.com`, clientSecret: 'fixture-secret' },
    getStorageBucket: { name: `${PROJECT}.firebasestorage.app` },
    isServiceEnabled: () => true,
  };
}

/** Brand root pre-staged with the downloaded service-account key. */
function stagedRoot() {
  const root = tmpRoot();
  jetpack.write(path.join(root, '.omega', 'secrets', 'service-account.json'), { client_email: SA_EMAIL });
  return root;
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('firebase: skips without firebase.projectId', async () => {
  const config = brandConfig();
  config.firebase.projectId = null;

  const result = await runService(config, { firebase: fakeFirebase() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /firebase\.projectId/);
});

test('firebase: firebase.enabled = false skips the service', async () => {
  const config = brandConfig({ firebase: { enabled: false } });
  const result = await runService(config, { firebase: fakeFirebase() });
  assert.equal(result.status, 'skipped');
});

test('firebase: skips without GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET', async () => {
  const result = await runService(brandConfig());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /GOOGLE_CLIENT_ID/);
});

test('firebase: shared project only runs service-account + sdk-config', async () => {
  const config = brandConfig({
    firebase: { shared: true },
    firebaseConfig: { ...EXPECTED_SDK },
  });
  const api = fakeFirebase(convergedResponses());

  const result = await runService(config, {
    firebase: api,
    brandRoot: stagedRoot(),
  });

  assert.equal(result.status, 'success');
  // No project-level reads happened — billing/identity/hosting stayed untouched
  assert.equal(api.callsTo('getProjectBillingInfo').length, 0);
  assert.equal(api.callsTo('getIdentityConfig').length, 0);
  assert.equal(api.callsTo('listHostingSites').length, 0);
  assert.ok(api.callsTo('listWebApps').length > 0);
  assert.equal(api.mutations().length, 0);
});

// ─── The flagship: converged project = zero-mutation no-op ───────────────────

test('firebase: fully converged project is a zero-mutation no-op across all 13 operations', async () => {
  const config = brandConfig({ firebaseConfig: { ...EXPECTED_SDK } });
  const api = fakeFirebase(convergedResponses());
  const cf = fakeCf({
    records: [{ id: 'c1', type: 'CNAME', name: `api.${DOMAIN}`, content: `${PROJECT}.web.app`, proxied: true }],
  });

  const result = await runService(config, {
    firebase: api,
    cloudflare: cf,
    brandRoot: stagedRoot(),
    serviceData: {
      authentication: { oauthRedirectsConfigured: true },
      cloudMessaging: { vapidPublicKey: 'B'.repeat(87), vapidPrivateKey: 'p'.repeat(43) },
    },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.deepEqual(cf.mutations(), []);

  // Durable IDs accumulated for later services
  assert.equal(result.state.serviceAccount.email, SA_EMAIL);
  assert.equal(result.state.sdkConfig.authDomain, DOMAIN);
  assert.equal(result.state.hosting.domains[0].status, 'verified');
});

// ─── Billing (de-ITW'd) ──────────────────────────────────────────────────────

test('billing: Spark plan with no firebase.billingAccount warns instead of linking', async () => {
  const handler = require('../src/services/firebase/ensure/billing.js');
  const api = fakeFirebase({ getProjectBillingInfo: { billingEnabled: false } });

  const result = await handler(handlerContext(brandConfig(), api));

  assert.equal(result.status, 'warned');
  assert.equal(api.mutations().length, 0);
});

test('billing: Spark plan with a configured account links it', async () => {
  const handler = require('../src/services/firebase/ensure/billing.js');
  const api = fakeFirebase({
    getProjectBillingInfo: { billingEnabled: false },
    linkBillingAccount: {},
  });
  const config = brandConfig({ firebase: { billingAccount: 'billingAccounts/MY-OWN' } });

  const result = await handler(handlerContext(config, api));

  assert.equal(result.state.billing.enabled, true);
  assert.deepEqual(api.callsTo('linkBillingAccount')[0].args, [PROJECT, 'billingAccounts/MY-OWN']);
});

// ─── Services (diff-first — omega-manager batch-enabled every run) ───────────

test('services: only the missing APIs are enabled', async () => {
  const handler = require('../src/services/firebase/ensure/services.js');
  const converged = convergedResponses();
  const api = fakeFirebase({
    ...converged,
    listEnabledServices: ALL_SERVICES.filter((s) => s !== 'fcm.googleapis.com' && s !== 'iap.googleapis.com'),
    enableServices: {},
  });

  await handler(handlerContext(brandConfig(), api));

  const batch = api.callsTo('enableServices');
  assert.equal(batch.length, 1);
  assert.deepEqual(batch[0].args[1], ['iap.googleapis.com', 'fcm.googleapis.com']);
  assert.equal(api.callsTo('setIamPolicy').length, 0); // compute roles already present
});

test('project-settings: drifted name is patched, matching web app untouched', async () => {
  const handler = require('../src/services/firebase/ensure/project-settings.js');
  const api = fakeFirebase({
    ...convergedResponses(),
    getGcpProject: { displayName: 'Old Name' },
    updateProjectName: {},
  });

  const result = await handler(handlerContext(brandConfig(), api));

  assert.equal(api.callsTo('updateProjectName').length, 1);
  assert.equal(api.callsTo('updateWebAppDisplayName').length, 0);
  assert.equal(result.state.settings.projectName, 'Fixture Brand');
});

// ─── Service account key lifecycle ───────────────────────────────────────────

test('service-account: missing key is created, saved to .omega/secrets, and copied to the backend app', async () => {
  const handler = require('../src/services/firebase/ensure/service-account.js');
  const api = fakeFirebase({
    ...convergedResponses(),
    createServiceAccountKey: { type: 'service_account', client_email: SA_EMAIL, private_key: 'FAKE' },
  });

  const brandRoot = tmpRoot(); // no key staged
  const backendPath = path.join(brandRoot, 'apps', 'backend');
  jetpack.dir(path.join(backendPath, 'functions'));

  const result = await handler(handlerContext(brandConfig(), api, {
    brandRoot,
    apps: [{ name: 'backend', dir: 'apps/backend', path: backendPath, target: 'backend' }],
  }));

  assert.equal(result.state.serviceAccount.email, SA_EMAIL);
  assert.equal(api.callsTo('createServiceAccountKey').length, 1);
  assert.equal(api.callsTo('createServiceAccount').length, 0); // account existed
  assert.equal(jetpack.read(path.join(brandRoot, '.omega', 'secrets', 'service-account.json'), 'json').client_email, SA_EMAIL);
  assert.equal(jetpack.read(path.join(backendPath, 'functions', 'service-account.json'), 'json').client_email, SA_EMAIL);
});

// ─── Authentication (manual flows → warned, config diffs → PATCH) ────────────

test('authentication: disabled email sign-in is enabled; missing Google sign-in warns', async () => {
  const handler = require('../src/services/firebase/ensure/authentication.js');
  const converged = convergedResponses();
  const identityConfig = structuredClone(converged.getIdentityConfig);
  identityConfig.signIn.email.enabled = false;

  const api = fakeFirebase({
    ...converged,
    getIdentityConfig: identityConfig,
    getIdpConfig: null, // Google sign-in not set up
    updateIdentityConfig: {},
  });

  const result = await handler(handlerContext(brandConfig(), api));

  assert.equal(result.status, 'warned'); // Google sign-in needs the console
  const patches = api.callsTo('updateIdentityConfig');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].args[1].signIn.email.enabled, true);
  assert.equal(api.callsTo('initializeIdentityPlatform').length, 0); // config existed
});

test('authentication: wrong-project OAuth client is flagged, credentials not saved', async () => {
  const handler = require('../src/services/firebase/ensure/authentication.js');
  const api = fakeFirebase({
    ...convergedResponses(),
    getIdpConfig: { enabled: true, clientId: '999999-other.apps.googleusercontent.com', clientSecret: 's' },
  });

  const context = handlerContext(brandConfig(), api);
  const result = await handler(context);

  assert.equal(result.status, 'warned');
  assert.equal(jetpack.exists(path.join(context.brandRoot, '.omega', 'secrets', 'google-oauth.json')), false);
});

test('authentication: interactive redirect-URI confirm records completion in state', async () => {
  const handler = require('../src/services/firebase/ensure/authentication.js');
  const api = fakeFirebase(convergedResponses());
  const tty = openTtyPrompt();

  try {
    const run = handler(handlerContext(brandConfig(), api));
    await tty.answer('Origins + redirect URIs configured in the OAuth client?', 'y\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.state.authentication.oauthRedirectsConfigured, true);
  } finally {
    tty.close();
  }
});

// ─── Cloud messaging ─────────────────────────────────────────────────────────

test('cloud-messaging: missing VAPID key pair warns with console guidance', async () => {
  const handler = require('../src/services/firebase/ensure/cloud-messaging.js');
  const api = fakeFirebase({ isServiceEnabled: () => true });

  const result = await handler(handlerContext(brandConfig(), api));

  assert.equal(result.status, 'warned');
  assert.equal(api.mutations().length, 0);
});

test('cloud-messaging: interactive paste-back validates lengths and lands both keys in state', async () => {
  const handler = require('../src/services/firebase/ensure/cloud-messaging.js');
  const api = fakeFirebase({ isServiceEnabled: () => true });
  const tty = openTtyPrompt();

  try {
    const run = handler(handlerContext(brandConfig(), api));
    await tty.answer('VAPID public key:', 'too-short\r');
    // \x15 (ctrl-U) clears the rejected line before retyping
    await tty.answer('must be exactly 87 characters', `\x15${'B'.repeat(87)}\r`);
    await tty.answer('VAPID private key:', `${'p'.repeat(43)}\r`);
    const result = await run;

    assert.deepEqual(result.state.cloudMessaging, {
      vapidPublicKey: 'B'.repeat(87),
      vapidPrivateKey: 'p'.repeat(43),
    });
    assert.notEqual(result.status, 'warned');
    assert.equal(api.mutations().length, 0);
  } finally {
    tty.close();
  }
});

// ─── SDK config drift check ──────────────────────────────────────────────────

test('sdk-config: missing omega.json5 firebaseConfig warns but still lands state', async () => {
  const handler = require('../src/services/firebase/ensure/sdk-config.js');
  const api = fakeFirebase(convergedResponses());

  const result = await handler(handlerContext(brandConfig(), api)); // no firebaseConfig in config

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.state.sdkConfig, EXPECTED_SDK);
  assert.equal(api.callsTo('createWebApp').length, 0);
});

// ─── Hosting (one-pass converge) ─────────────────────────────────────────────

test('hosting: missing domain is created, ownership TXT + unproxied CNAME written, warned pending', async () => {
  const handler = require('../src/services/firebase/ensure/hosting.js');
  let created = false;
  const api = fakeFirebase({
    ...convergedResponses(),
    checkDomainStatus: () => (created
      ? {
        exists: true,
        verified: false,
        ownershipState: 'OWNERSHIP_PENDING',
        hostState: 'HOST_UNHOSTED',
        requiredDnsUpdates: [{
          domainName: `api.${DOMAIN}`,
          desired: { records: [
            { type: 'TXT', rdata: `hosting-site=${PROJECT}` },
            { type: 'A', rdata: '199.36.158.100' }, // must be skipped
          ] },
        }],
      }
      : { verified: false, exists: false }),
    createCustomDomain: () => { created = true; return {}; },
  });
  const cf = fakeCf();

  const result = await handler(handlerContext(brandConfig(), api, { cloudflareApi: cf }));

  assert.equal(result.status, 'warned');
  assert.equal(result.state.hosting.domains[0].status, 'pending');
  assert.equal(api.callsTo('createCustomDomain').length, 1);

  const writes = cf.mutations();
  const txt = writes.find((w) => w.body?.type === 'TXT');
  const cname = writes.find((w) => w.body?.type === 'CNAME');
  assert.equal(txt.body.content, `hosting-site=${PROJECT}`);
  assert.equal(cname.body.content, `${PROJECT}.web.app`);
  assert.equal(cname.body.proxied, false); // unproxied until verified
  assert.ok(!writes.some((w) => w.body?.type === 'A')); // A records skipped
});

test('hosting: firebase.apiSubdomain = false skips without touching anything', async () => {
  const handler = require('../src/services/firebase/ensure/hosting.js');
  const api = fakeFirebase({});
  const config = brandConfig({ firebase: { apiSubdomain: false } });

  const result = await handler(handlerContext(config, api));

  assert.deepEqual(result, {});
  assert.equal(api.calls.length, 0);
});

// ─── Dry run: drifted everywhere, zero mutations ─────────────────────────────

test('firebase: dry-run on a fully drifted project performs zero mutations', async () => {
  const config = brandConfig({ firebase: { billingAccount: 'billingAccounts/MY-OWN' } });
  const api = fakeFirebase({
    getProjectBillingInfo: { billingEnabled: false },
    listEnabledServices: [],
    getProjectNumber: PROJECT_NUMBER,
    getIamPolicy: () => ({ bindings: [] }),
    getGcpProject: { displayName: 'Old Name' },
    listWebApps: [],
    listBrands: [],
    listServiceAccounts: [],
    listHostingSites: [],
    getFirestoreDatabase: null,
    listRealtimeDatabases: [],
    getIdentityConfig: null,
    getStorageBucket: null,
    isServiceEnabled: () => false,
  });
  const cf = fakeCf();
  const brandRoot = tmpRoot();

  const result = await runService(config, {
    firebase: api,
    cloudflare: cf,
    brandRoot,
    options: { dryRun: true },
  });

  assert.notEqual(result.status, 'error');
  assert.deepEqual(api.mutations(), []);
  assert.deepEqual(cf.mutations(), []);
  // No key file or secrets materialized either
  assert.equal(jetpack.exists(path.join(brandRoot, '.omega', 'secrets')), false);
});
