/**
 * Firebase service tests — the 13 operations against a method-level recording
 * fake of the FirebaseAPI surface (plus a Cloudflare fake for hosting's DNS
 * writes). Proves skip/shared semantics, the converged-project zero-mutation
 * no-op, per-operation drift writes, the de-ITW'd billing guidance, warned
 * manual flows (Google sign-in, VAPID), the omega.json5 cloud.config drift
 * check, and the dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/cloud/index.js');
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
const DOWN = '\x1B[B'; // arrow-down escape for select() answers

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

function brandConfig({ firebase = {}, gcp = {}, firebaseConfig } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: `https://${DOMAIN}` },
    firebase: { ...structuredClone(DEFAULTS.firebase), projectId: PROJECT, ...firebase },
    gcp: { ...structuredClone(DEFAULTS.gcp), ...gcp },
    targets: { web: {}, backend: {} },
  };
  if (firebaseConfig) {
    config.cloud = { provider: 'firebase', config: firebaseConfig };
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
  'getAuthenticatedEmail', 'listBillingAccounts', 'listOrganizations',
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

/**
 * Cloudflare fake for hosting's DNS reads/writes + TLS-coverage lookups.
 * Defaults model a free zone: /acm/total_tls rejects (no ACM entitlement,
 * like the real API) and the only certificate pack is the Universal one.
 * Pass an Error as certPacks/totalTls to simulate a lookup failure.
 */
function fakeCf({ zone = ZONE, records = [], certPacks, totalTls } = {}) {
  const api = { calls: [], records };

  api.getZoneByName = async () => zone;
  api.makeRequest = async (endpoint, options = {}) => {
    const method = options.method || 'GET';
    api.calls.push({ method, endpoint, body: options.body ? JSON.parse(options.body) : undefined });

    if (method === 'GET') {
      if (endpoint.includes('/acm/total_tls')) {
        if (totalTls instanceof Error) throw totalTls;
        if (!totalTls) throw new Error('Cloudflare API Error: [{"code":1001,"message":"no ACM entitlement"}]');
        return { success: true, result: totalTls };
      }
      if (endpoint.includes('/ssl/certificate_packs')) {
        if (certPacks instanceof Error) throw certPacks;
        return {
          success: true,
          result: certPacks || [{ type: 'universal', status: 'active', hosts: [zone.name, `*.${zone.name}`] }],
        };
      }
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
    operations: OPERATIONS.cloud,
    options,
    serviceData,
    firebaseApi: firebase,
    cloudflareApi: cloudflare,
  });
}

// Direct-handler context (bypasses setup — for focused per-operation tests)
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');

// Writeback target for the sdk-config drift tests.
const FIREBASE_WRITEBACK_CONFIG = `// Fixture Brand — hand-edited writeback target
{
  brand: { id: 'fixture-brand' },
}
`;

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

test('cloud: skips without firebase.projectId', async () => {
  const config = brandConfig();
  config.firebase.projectId = null;

  const result = await runService(config, { firebase: fakeFirebase() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /firebase\.projectId/);
});

test('cloud: derives projectId from cloud.config when firebase.projectId is absent (framework-first brands)', async () => {
  const config = brandConfig();
  config.firebase.projectId = null;
  config.cloud = { provider: 'firebase', config: { projectId: PROJECT } };

  const result = await runService(config, { firebase: fakeFirebase() });
  assert.notEqual(result.status, 'skipped', 'cloud.config.projectId names the project — no skip');
});

test('cloud: firebase.enabled = false skips the service', async () => {
  const config = brandConfig({ firebase: { enabled: false } });
  const result = await runService(config, { firebase: fakeFirebase() });
  assert.equal(result.status, 'skipped');
});

test('cloud: skips without GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET', async () => {
  const result = await runService(brandConfig());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /GOOGLE_CLIENT_ID/);
});

test('cloud: shared project only runs service-account + sdk-config', async () => {
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

test('cloud: fully converged project is a zero-mutation no-op across all 13 operations', async () => {
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

// ─── Hosting: TLS coverage → proxy eligibility (cp114b/cp115) ────────────────

/** Direct-handler context for a subdomain project (api.play.{DOMAIN}). */
function deepProjectContext(firebase, cloudflare) {
  return {
    firebaseApi: firebase,
    cloudflareApi: cloudflare,
    brandConfig: {},
    projectId: PROJECT,
    domain: `play.${DOMAIN}`,
    apexDomain: DOMAIN,
    isSubdomainProject: true,
    options: {},
    serviceData: {},
  };
}

/** Firebase fake for a project whose api domain is already verified. */
function verifiedDomainFirebase() {
  return fakeFirebase({
    listHostingSites: [{ name: `projects/${PROJECT}/sites/${PROJECT}` }],
    checkDomainStatus: { exists: true, verified: true },
  });
}

test('hosting: deep subdomain-project api domain comes back to DNS-only (Universal SSL limit)', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');

  // Universal SSL: apex + one label ride the proxy, deeper never does
  assert.equal(handler.universalSslCovers(DOMAIN, DOMAIN), true);
  assert.equal(handler.universalSslCovers(`api.${DOMAIN}`, DOMAIN), true);
  assert.equal(handler.universalSslCovers(`api.play.${DOMAIN}`, DOMAIN), false);

  // Certificate-host matching: a TLS wildcard spans exactly ONE label
  assert.equal(handler.certHostMatches(`api.play.${DOMAIN}`, `api.play.${DOMAIN}`), true);
  assert.equal(handler.certHostMatches(`*.play.${DOMAIN}`, `api.play.${DOMAIN}`), true);
  assert.equal(handler.certHostMatches(`*.${DOMAIN}`, `api.play.${DOMAIN}`), false);
  assert.equal(handler.certHostMatches(DOMAIN, `api.${DOMAIN}`), false);

  // Live-found shape (api.playground.omegajs.dev on a free zone): verified
  // domain, CNAME proxied:true from the pre-fix run → must be PATCHed down
  // to DNS-only so Firebase can serve the certificate.
  const cf = fakeCf({
    records: [{ id: 'c9', type: 'CNAME', name: `api.play.${DOMAIN}`, content: `${PROJECT}.web.app`, proxied: true }],
  });

  const result = await handler(deepProjectContext(verifiedDomainFirebase(), cf));

  assert.equal(result.state.hosting.domains[0].status, 'verified');
  const patch = cf.mutations().find((c) => c.method === 'PATCH');
  assert.ok(patch, 'expected the proxied CNAME to be PATCHed');
  assert.equal(patch.body.proxied, false);
});

test('hosting: deep api domain rides the proxy when the zone has Total TLS', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');

  // Converged DNS-only from a free-era run; the zone since gained Total TLS,
  // which mints a certificate for every proxied hostname → PATCH up.
  const cf = fakeCf({
    totalTls: { enabled: true, certificate_authority: 'lets_encrypt' },
    records: [{ id: 'c9', type: 'CNAME', name: `api.play.${DOMAIN}`, content: `${PROJECT}.web.app`, proxied: false }],
  });

  const result = await handler(deepProjectContext(verifiedDomainFirebase(), cf));

  assert.equal(result.state.hosting.domains[0].status, 'verified');
  const patch = cf.mutations().find((c) => c.method === 'PATCH');
  assert.ok(patch, 'expected the DNS-only CNAME to be PATCHed up to proxied');
  assert.equal(patch.body.proxied, true);
});

test('hosting: deep api domain rides the proxy only once a covering cert pack is ACTIVE', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');
  const universalPack = { type: 'universal', status: 'active', hosts: [DOMAIN, `*.${DOMAIN}`] };
  const deepPack = (status) => ({ type: 'advanced', status, hosts: [`*.play.${DOMAIN}`] });

  // Pending validation → not covered yet → CNAME created DNS-only
  const pendingCf = fakeCf({ certPacks: [universalPack, deepPack('pending_validation')] });
  await handler(deepProjectContext(verifiedDomainFirebase(), pendingCf));
  const pendingPost = pendingCf.mutations().find((c) => c.method === 'POST');
  assert.equal(pendingPost.body.proxied, false);

  // Active → covered → CNAME created proxied
  const activeCf = fakeCf({ certPacks: [universalPack, deepPack('active')] });
  await handler(deepProjectContext(verifiedDomainFirebase(), activeCf));
  const activePost = activeCf.mutations().find((c) => c.method === 'POST');
  assert.equal(activePost.body.proxied, true);
});

test('hosting: TLS-coverage lookups failing falls back to DNS-only', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');
  const cf = fakeCf({ totalTls: new Error('boom'), certPacks: new Error('boom') });

  const result = await handler(deepProjectContext(verifiedDomainFirebase(), cf));

  assert.equal(result.state.hosting.domains[0].status, 'verified');
  const post = cf.mutations().find((c) => c.method === 'POST');
  assert.equal(post.body.proxied, false);
});

test('hosting: no Cloudflare client — verified domain reports without DNS writes', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');

  const result = await handler(deepProjectContext(verifiedDomainFirebase(), null));

  assert.equal(result.state.hosting.domains[0].status, 'verified');
});

// ─── Billing (de-ITW'd) ──────────────────────────────────────────────────────

test('billing: Spark plan with no gcp.billingAccount warns instead of linking', async () => {
  const handler = require('../src/services/cloud/ensure/billing.js');
  const api = fakeFirebase({ getProjectBillingInfo: { billingEnabled: false } });

  const result = await handler(handlerContext(brandConfig(), api));

  assert.equal(result.status, 'warned');
  assert.equal(api.mutations().length, 0);
  // #32: the skip announces itself to the run-summary aggregate
  assert.ok(result.output.billing.needsInteractive.includes('billing account'));
});

test('billing: gcp.billingAccount: false = the user chose Spark — clean success, no nagging, no link', async () => {
  const handler = require('../src/services/cloud/ensure/billing.js');
  const api = fakeFirebase({ getProjectBillingInfo: { billingEnabled: false } });
  const config = brandConfig({ gcp: { billingAccount: false } });

  const result = await handler(handlerContext(config, api));

  assert.equal(result.status, undefined); // success — an opt-out is a clean state
  assert.equal(api.mutations().length, 0);
  assert.ok(result.output.billing.note.includes('opted out'));
});

test('billing: interactive flow lists accounts, lands the pick in omega.json5, links it', async () => {
  const handler = require('../src/services/cloud/ensure/billing.js');
  const api = fakeFirebase({
    getProjectBillingInfo: { billingEnabled: false },
    listBillingAccounts: [
      { name: 'billingAccounts/OTHER-111', displayName: 'Other Org', open: true },
      { name: 'billingAccounts/FIXTURE-222', displayName: 'Fixture Brand', open: true },
    ],
    linkBillingAccount: {},
  });
  const brandRoot = makeBrandRoot(FIREBASE_WRITEBACK_CONFIG);
  const config = brandConfig();
  const tty = openTtyPrompt();

  try {
    const run = handler(handlerContext(config, api, { brandRoot }));
    await tty.answer('Set up now?', '\r'); // Yes
    // "+ Create new" lists first but the cursor lands on the brand match
    await tty.answer('Select Billing account:', '\r');
    const result = await run;

    assert.equal(result.state.billing.enabled, true);
    assert.deepEqual(api.callsTo('linkBillingAccount')[0].args, [PROJECT, 'billingAccounts/FIXTURE-222']);
    assert.equal(config.gcp.billingAccount, 'billingAccounts/FIXTURE-222');
    assert.ok(readConfigSource(brandRoot).includes('billingAccount: "billingAccounts/FIXTURE-222"'));
  } finally {
    tty.close();
  }
});

test('billing: interactive opt-out lands gcp.billingAccount: false and stays on Spark', async () => {
  const handler = require('../src/services/cloud/ensure/billing.js');
  const api = fakeFirebase({
    getProjectBillingInfo: { billingEnabled: false },
    listBillingAccounts: [
      { name: 'billingAccounts/FIXTURE-222', displayName: 'Fixture Brand', open: true },
    ],
    // no linkBillingAccount response — any link attempt fails loudly
  });
  const brandRoot = makeBrandRoot(FIREBASE_WRITEBACK_CONFIG);
  const config = brandConfig();
  const tty = openTtyPrompt();

  try {
    const run = handler(handlerContext(config, api, { brandRoot }));
    await tty.answer('Set up now?', '\r'); // Yes
    // Choices: + Create new, Fixture Brand, Stay on the Spark plan — cursor on the brand match
    await tty.answer('Select Billing account:', `${DOWN}\r`);
    const result = await run;

    assert.equal(result.status, undefined); // success — an opt-out is a clean state
    assert.ok(result.output.billing.note.includes('opted out'));
    assert.equal(config.gcp.billingAccount, false);
    assert.ok(readConfigSource(brandRoot).includes('billingAccount: false'));
    assert.equal(api.mutations().length, 0);
  } finally {
    tty.close();
  }
});

test('billing: Spark plan with a configured account links it', async () => {
  const handler = require('../src/services/cloud/ensure/billing.js');
  const api = fakeFirebase({
    getProjectBillingInfo: { billingEnabled: false },
    linkBillingAccount: {},
  });
  const config = brandConfig({ gcp: { billingAccount: 'billingAccounts/MY-OWN' } });

  const result = await handler(handlerContext(config, api));

  assert.equal(result.state.billing.enabled, true);
  assert.deepEqual(api.callsTo('linkBillingAccount')[0].args, [PROJECT, 'billingAccounts/MY-OWN']);
});

// ─── Services (diff-first — omega-manager batch-enabled every run) ───────────

test('services: only the missing APIs are enabled', async () => {
  const handler = require('../src/services/cloud/ensure/services.js');
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
  const handler = require('../src/services/cloud/ensure/project-settings.js');
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

test('service-account: missing key is created and saved to .omega/secrets (the ONE home — the backend stage reads it from there)', async () => {
  const handler = require('../src/services/cloud/ensure/service-account.js');
  const api = fakeFirebase({
    ...convergedResponses(),
    createServiceAccountKey: { type: 'service_account', client_email: SA_EMAIL, private_key: 'FAKE' },
  });

  const brandRoot = tmpRoot(); // no key staged
  const backendPath = path.join(brandRoot, 'apps', 'backend');

  const result = await handler(handlerContext(brandConfig(), api, {
    brandRoot,
    apps: [{ name: 'backend', dir: 'apps/backend', path: backendPath, target: 'backend' }],
  }));

  assert.equal(result.state.serviceAccount.email, SA_EMAIL);
  assert.equal(api.callsTo('createServiceAccountKey').length, 1);
  assert.equal(api.callsTo('createServiceAccount').length, 0); // account existed
  assert.equal(jetpack.read(path.join(brandRoot, '.omega', 'secrets', 'service-account.json'), 'json').client_email, SA_EMAIL);
  // No per-app copy: dist/ staging pulls from .omega/secrets at build time
  assert.equal(jetpack.exists(path.join(backendPath, 'functions', 'service-account.json')), false);
  assert.equal(jetpack.exists(path.join(backendPath, 'service-account.json')), false);
});

// ─── Authentication (manual flows → warned, config diffs → PATCH) ────────────

test('authentication: disabled email sign-in is enabled; missing Google sign-in warns', async () => {
  const handler = require('../src/services/cloud/ensure/authentication.js');
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
  const handler = require('../src/services/cloud/ensure/authentication.js');
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
  const handler = require('../src/services/cloud/ensure/authentication.js');
  const prompt = require('@omega.js/devkit/prompt');
  const api = fakeFirebase(convergedResponses());
  const tty = openTtyPrompt();

  // Stub the real browser launch behind the press-Enter-to-open step
  const opened = [];
  const realOpen = prompt.openInBrowser;
  prompt.openInBrowser = (url) => { opened.push(url); return true; };

  try {
    const run = handler(handlerContext(brandConfig(), api));
    await tty.answer('Press Enter to open the OAuth client settings', '\r');
    await tty.answer('Origins + redirect URIs configured in the OAuth client?', 'y\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.state.authentication.oauthRedirectsConfigured, true);
    assert.equal(opened.length, 1, 'Enter opened the OAuth client settings');
  } finally {
    prompt.openInBrowser = realOpen;
    tty.close();
  }
});

// ─── Cloud messaging ─────────────────────────────────────────────────────────

test('cloud-messaging: missing VAPID key pair warns with console guidance', async () => {
  const handler = require('../src/services/cloud/ensure/cloud-messaging.js');
  const api = fakeFirebase({ isServiceEnabled: () => true });

  const result = await handler(handlerContext(brandConfig(), api));

  assert.equal(result.status, 'warned');
  assert.equal(api.mutations().length, 0);
});

test('cloud-messaging: interactive paste-back validates lengths and lands both keys in state', async () => {
  const handler = require('../src/services/cloud/ensure/cloud-messaging.js');
  const prompt = require('@omega.js/devkit/prompt');
  const api = fakeFirebase({ isServiceEnabled: () => true });
  const tty = openTtyPrompt();

  const realOpen = prompt.openInBrowser;
  prompt.openInBrowser = () => true;

  try {
    const run = handler(handlerContext(brandConfig(), api));
    await tty.answer('Press Enter to open the Cloud Messaging settings', '\r');
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
    prompt.openInBrowser = realOpen;
    tty.close();
  }
});

// ─── SDK config drift check ──────────────────────────────────────────────────

test('sdk-config: missing omega.json5 cloud.config is written back, comments intact', async () => {
  const handler = require('../src/services/cloud/ensure/sdk-config.js');
  const api = fakeFirebase(convergedResponses());
  const brandRoot = makeBrandRoot(FIREBASE_WRITEBACK_CONFIG);

  const result = await handler(handlerContext(brandConfig(), api, { brandRoot })); // no cloud.config in config

  assert.equal(result.status, undefined); // drift healed — success, not warned
  assert.deepEqual(result.state.sdkConfig, EXPECTED_SDK);
  assert.deepEqual(result.output.sdkConfig.updated.slice().sort(), Object.keys(EXPECTED_SDK).filter((k) => EXPECTED_SDK[k]).sort());
  assert.equal(api.callsTo('createWebApp').length, 0);

  const written = readConfigSource(brandRoot);
  assert.ok(written.includes(`apiKey: "${EXPECTED_SDK.apiKey}"`));
  assert.ok(written.includes(`authDomain: "${DOMAIN}"`)); // the custom auth domain, not firebaseapp.com
  assert.ok(written.includes('// Fixture Brand — hand-edited writeback target'));
});

test('sdk-config: dry run warns with the paste block and leaves omega.json5 untouched', async () => {
  const handler = require('../src/services/cloud/ensure/sdk-config.js');
  const api = fakeFirebase(convergedResponses());
  const brandRoot = makeBrandRoot(FIREBASE_WRITEBACK_CONFIG);
  const before = readConfigSource(brandRoot);

  const result = await handler(handlerContext(brandConfig(), api, { brandRoot, options: { dryRun: true } }));

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.state.sdkConfig, EXPECTED_SDK);
  assert.equal(readConfigSource(brandRoot), before);
});

// ─── Hosting (one-pass converge) ─────────────────────────────────────────────

test('hosting: missing domain is created, ownership TXT + unproxied CNAME written, warned pending', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');
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
  const handler = require('../src/services/cloud/ensure/hosting.js');
  const api = fakeFirebase({});
  const config = brandConfig({ firebase: { apiSubdomain: false } });

  const result = await handler(handlerContext(config, api));

  assert.deepEqual(result, {});
  assert.equal(api.calls.length, 0);
});

// ─── Dry run: drifted everywhere, zero mutations ─────────────────────────────

test('cloud: dry-run on a fully drifted project performs zero mutations', async () => {
  const config = brandConfig({ gcp: { billingAccount: 'billingAccounts/MY-OWN' } });
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

// ─── OAuth consent: supportEmail must be OWNABLE by the caller (#29) ─────────

const ensureOAuthConsent = require('../src/services/cloud/ensure/oauth-consent.js');

test('oauth-consent: defaults supportEmail to the AUTHORIZING user, never support@domain (#29)', async () => {
  const api = fakeFirebase({
    listBrands: [],
    getAuthenticatedEmail: 'owner@example.com',
    createBrand: (projectId, title, email) => ({ name: 'projects/123/brands/b9', applicationTitle: title, supportEmail: email }),
  });

  const result = await ensureOAuthConsent({ firebaseApi: api, brandConfig: brandConfig(), projectId: PROJECT, domain: DOMAIN });

  assert.deepEqual(api.callsTo('createBrand')[0].args, [PROJECT, 'Fixture Brand', 'owner@example.com']);
  assert.equal(result.state.oauthConsent.supportEmail, 'owner@example.com');
});

test('oauth-consent: config supportEmail (owned Google Group) wins; no email at all warns without mutating', async () => {
  const grp = fakeFirebase({
    listBrands: [],
    createBrand: (projectId, title, email) => ({ name: 'b', applicationTitle: title, supportEmail: email }),
  });
  await ensureOAuthConsent({
    firebaseApi: grp,
    brandConfig: brandConfig({ firebase: { supportEmail: 'team@groups.example.com' } }),
    projectId: PROJECT,
    domain: DOMAIN,
  });
  assert.deepEqual(grp.callsTo('createBrand')[0].args, [PROJECT, 'Fixture Brand', 'team@groups.example.com']);
  assert.equal(grp.callsTo('getAuthenticatedEmail').length, 0, 'config wins — no lookup');

  const none = fakeFirebase({ listBrands: [], getAuthenticatedEmail: null });
  const result = await ensureOAuthConsent({ firebaseApi: none, brandConfig: brandConfig(), projectId: PROJECT, domain: DOMAIN });
  assert.equal(result.status, 'warned');
  assert.equal(none.callsTo('createBrand').length, 0, 'never sends a doomed value');
});

// ─── Interactive project selection/creation (config-landing flow) ────────────

const { resolveFirebaseProject } = require('../src/services/cloud/lib/project-flow.js');

const PROJECT_FLOW_CONFIG = `{
  // Fixture Brand — firebase writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  firebase: {}, // projectId lands next to this
  gcp: { organizationId: "123456789" },
}
`;

function projectFlowContext(brandRoot) {
  return {
    brandId: 'fixture-brand',
    brandRoot,
    options: {},
    brandConfig: {
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
      firebase: {},
      gcp: { organizationId: '123456789' },
    },
  };
}

test('project-flow: selecting an existing project lands firebase.projectId in omega.json5', async () => {
  const api = {
    listProjects: async () => [
      { projectId: 'other-proj', displayName: 'Other' },
      { projectId: 'fixture-brand', displayName: 'Fixture Brand' },
    ],
  };
  const brandRoot = makeBrandRoot(PROJECT_FLOW_CONFIG);
  const context = projectFlowContext(brandRoot);
  const tty = openTtyPrompt();

  try {
    const run = resolveFirebaseProject(context, api);
    await tty.answer('Set up now?', '\r'); // Yes
    // Cursor lands on the brand match "Fixture Brand (fixture-brand)"
    await tty.answer('Select Firebase project:', '\r');
    const projectId = await run;

    assert.equal(projectId, 'fixture-brand');
    assert.equal(context.brandConfig.firebase.projectId, 'fixture-brand');
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes('projectId: "fixture-brand"'));
    assert.ok(written.includes('// projectId lands next to this'));
  } finally {
    tty.close();
  }
});

test('project-flow: create-new prompts id + name and creates inside the configured organization', async () => {
  const created = [];
  const api = {
    listProjects: async () => [], // also drives the quota print (0/30)
    createProject: async (projectId, displayName, organizationId) => {
      created.push({ projectId, displayName, organizationId });
      return { projectId, displayName };
    },
  };
  const brandRoot = makeBrandRoot(PROJECT_FLOW_CONFIG);
  const context = projectFlowContext(brandRoot);
  const tty = openTtyPrompt();

  try {
    const run = resolveFirebaseProject(context, api);
    await tty.answer('Set up now?', '\r');
    await tty.answer('Select Firebase project:', '\r'); // "+ Create new" is the only choice
    await tty.answer('Enter project ID', '\r');   // accept the default (brand id)
    await tty.answer('Enter display name', '\r'); // accept the default (brand name)
    const projectId = await run;

    assert.equal(projectId, 'fixture-brand');
    assert.deepEqual(created, [{ projectId: 'fixture-brand', displayName: 'Fixture Brand', organizationId: '123456789' }]);
    assert.ok(readConfigSource(brandRoot).includes('projectId: "fixture-brand"'));
  } finally {
    tty.close();
  }
});

test('project-flow: create-new with no org configured asks — the picked org lands in omega.json5 and createProject (#33)', async () => {
  const created = [];
  const api = {
    listProjects: async () => [],
    listOrganizations: async () => [
      { name: 'organizations/999888777', displayName: 'fixture-brand.test' },
    ],
    createProject: async (projectId, displayName, organizationId) => {
      created.push({ projectId, displayName, organizationId });
      return { projectId, displayName };
    },
  };
  const brandRoot = makeBrandRoot(PROJECT_FLOW_CONFIG);
  const context = projectFlowContext(brandRoot);
  delete context.brandConfig.gcp.organizationId; // unset → tri-state asks
  const tty = openTtyPrompt();

  try {
    const run = resolveFirebaseProject(context, api);
    await tty.answer('Set up now?', '\r');
    await tty.answer('Select Firebase project:', '\r'); // "+ Create new" is the only choice
    await tty.answer('Enter project ID', '\r');
    await tty.answer('Enter display name', '\r');
    // Org question — cursor on the only real org, ENTER picks it
    await tty.answer('Create the project inside a Google Cloud organization?', '\r');
    const projectId = await run;

    assert.equal(projectId, 'fixture-brand');
    assert.deepEqual(created, [{ projectId: 'fixture-brand', displayName: 'Fixture Brand', organizationId: '999888777' }]);
    assert.ok(readConfigSource(brandRoot).includes('organizationId: "999888777"'));
  } finally {
    tty.close();
  }
});

test('project-flow: org opt-out creates the project standalone and lands gcp.organizationId: false (#33)', async () => {
  const created = [];
  const api = {
    listProjects: async () => [],
    listOrganizations: async () => [
      { name: 'organizations/999888777', displayName: 'fixture-brand.test' },
    ],
    createProject: async (projectId, displayName, organizationId) => {
      created.push({ projectId, displayName, organizationId });
      return { projectId, displayName };
    },
  };
  const brandRoot = makeBrandRoot(PROJECT_FLOW_CONFIG);
  const context = projectFlowContext(brandRoot);
  delete context.brandConfig.gcp.organizationId;
  const tty = openTtyPrompt();

  try {
    const run = resolveFirebaseProject(context, api);
    await tty.answer('Set up now?', '\r');
    await tty.answer('Select Firebase project:', '\r');
    await tty.answer('Enter project ID', '\r');
    await tty.answer('Enter display name', '\r');
    // DOWN past the org to "No organization — create it standalone"
    await tty.answer('Create the project inside a Google Cloud organization?', `${DOWN}\r`);
    const projectId = await run;

    assert.equal(projectId, 'fixture-brand');
    // Opt-out → createProject standalone; the config-flow suite pins that the
    // landed false short-circuits every later ask (tri-state round-trip)
    assert.deepEqual(created, [{ projectId: 'fixture-brand', displayName: 'Fixture Brand', organizationId: null }]);
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes('organizationId: false'));
    assert.equal(context.brandConfig.gcp.organizationId, false);
  } finally {
    tty.close();
  }
});

// ─── Hosting: interactive verification poll ──────────────────────────────────

test('hosting: interactive run polls until verified, writing the mid-poll ACME record and proxying the CNAME', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');
  const OWNERSHIP = { type: 'TXT', rdata: `hosting-site=${PROJECT}` };
  const ACME = { type: 'TXT', rdata: 'acme-validation-token' };
  const updates = (records, domainName = `api.${DOMAIN}`) => [{ domainName, desired: { records } }];

  // missing → created-pending (1 required record) → still-pending with the
  // ACME challenge added (2 records — must be written mid-poll) → verified
  let checks = 0;
  const api = fakeFirebase({
    ...convergedResponses(),
    createCustomDomain: {},
    checkDomainStatus: () => {
      checks++;
      if (checks === 1) return { verified: false, exists: false };
      if (checks === 2) return { verified: false, exists: true, ownershipState: 'OWNERSHIP_PENDING', hostState: 'HOST_UNHOSTED', requiredDnsUpdates: updates([OWNERSHIP]) };
      if (checks === 3) return { verified: false, exists: true, ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_UNHOSTED', requiredDnsUpdates: [...updates([OWNERSHIP]), ...updates([ACME], `_acme-challenge.api.${DOMAIN}`)] };
      return { verified: true };
    },
  });
  const cf = fakeCf();
  const tty = openTtyPrompt();

  try {
    const run = handler(handlerContext(brandConfig(), api, { cloudflareApi: cf }));
    // ENTER = "check now" — keep nudging so the poll never waits an interval
    await tty.answer('check now', '\r');
    const nudge = setInterval(() => { tty.answer('check now', '\r').catch(() => {}); }, 80);
    let result;
    try {
      result = await run;
    } finally {
      clearInterval(nudge);
    }

    assert.equal(result.status, 'success');
    assert.equal(result.state.hosting.domains[0].status, 'verified');
    assert.ok(checks >= 4);

    const writes = cf.mutations();
    assert.ok(writes.some((w) => w.body?.content === ACME.rdata)); // ACME TXT written mid-poll
    assert.ok(writes.some((w) => w.body?.type === 'CNAME' && w.body?.proxied === true)); // proxied after verify
  } finally {
    tty.close();
  }
});
