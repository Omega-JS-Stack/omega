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
const { setBrowserOpener } = require('@omega.js/devkit/flows');
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

// Every fixture root is a real brand root: the auth redirect confirm and the
// VAPID paste-back land in config/omega.json5 (#434)
function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-fb-'));
  jetpack.write(path.join(root, 'config', 'omega.json5'), `{\n  brand: { id: 'fixture-brand' },\n}\n`);
  return root;
}

// ONE cloud home (#23): the provisioning fields, the platform-level org +
// billing account, and the app config all live under `cloud`.
function brandConfig({ cloud = {}, sdkConfig } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: `https://${DOMAIN}` },
    cloud: {
      ...structuredClone(DEFAULTS.cloud),
      ...cloud,
      config: { projectId: PROJECT, ...(sdkConfig || {}), ...(cloud.config || {}) },
    },
    targets: { web: {}, backend: {} },
  };
  if (sdkConfig) {
    config.cloud.provider = 'firebase';
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

function runService(config, { firebase, cloudflare, options = {}, serviceData = {}, brandRoot, targetDirs = [] } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || tmpRoot(),
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), targetDirs },
    targetDirs,
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
    targets: [],
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

/** What sdk-config derives from RAW_SDK: authDomain becomes the BRAND host
 * (first-party redirect under storage partitioning; the build self-hosts
 * /__/auth/* — Ian's ruling 2026-07-23) + default RTDB URL. */
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
    listBrands: [{ name: `projects/${PROJECT_NUMBER}/brands/b1`, applicationTitle: 'Fixture Brand', supportEmail: `support@${DOMAIN}`, orgInternalOnly: false }],
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

test('cloud: skips without cloud.config.projectId', async () => {
  const config = brandConfig();
  config.cloud.config.projectId = null;

  const result = await runService(config, { firebase: fakeFirebase() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /cloud\.config\.projectId/);
});

test('cloud: derives projectId from cloud.config — the ONE home (#23)', async () => {
  const config = brandConfig();
  config.cloud.config.projectId = null;
  config.cloud = { provider: 'firebase', config: { projectId: PROJECT } };

  const result = await runService(config, { firebase: fakeFirebase() });
  assert.notEqual(result.status, 'skipped', 'cloud.config.projectId names the project — no skip');
});

test('cloud: cloud.enabled = false skips the service', async () => {
  const config = brandConfig({ cloud: { enabled: false } });
  const result = await runService(config, { firebase: fakeFirebase() });
  assert.equal(result.status, 'skipped');
});

test('cloud: demo-* project skips (emulator-only — no real cloud to reconcile)', async () => {
  const config = brandConfig({ cloud: { config: { projectId: 'demo-omega' } } });
  const result = await runService(config, { firebase: fakeFirebase() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /demo-\*/);
});

test('cloud: skips without GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET', async () => {
  const result = await runService(brandConfig());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /GOOGLE_CLIENT_ID/);
});

test('cloud: shared project only runs service-account + sdk-config', async () => {
  const config = brandConfig({
    cloud: { shared: true },
    sdkConfig: { ...EXPECTED_SDK },
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

test('cloud: brand.url with a path/port derives a hostname-only domain — authDomain never carries them (cp268)', async () => {
  const config = brandConfig({
    cloud: { shared: true },
    sdkConfig: { ...EXPECTED_SDK },
  });
  config.brand.url = `https://${DOMAIN}:8443/app`; // schema allows any http(s) URL
  const api = fakeFirebase(convergedResponses());

  const result = await runService(config, {
    firebase: api,
    brandRoot: stagedRoot(),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.state.sdkConfig.authDomain, DOMAIN); // hostname only — no :8443, no /app
});

// ─── The flagship: converged project = zero-mutation no-op ───────────────────

test('cloud: fully converged project is a zero-mutation no-op across all 13 operations', async () => {
  const config = brandConfig({ sdkConfig: { ...EXPECTED_SDK } });
  const api = fakeFirebase(convergedResponses());
  const cf = fakeCf({
    records: [{ id: 'c1', type: 'CNAME', name: `api.${DOMAIN}`, content: `${PROJECT}.web.app`, proxied: true }],
  });

  config.cloud.oauthRedirectsConfigured = true;
  config.cloud.messaging = { vapidKey: 'B'.repeat(87) };
  process.env.VAPID_PRIVATE_KEY = 'p'.repeat(43);

  const result = await runService(config, {
    firebase: api,
    cloudflare: cf,
    brandRoot: stagedRoot(),
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.deepEqual(cf.mutations(), []);

  // Values the later operations in this run carry forward
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

test('billing: Spark plan with no cloud.billingAccount warns instead of linking', async () => {
  const handler = require('../src/services/cloud/ensure/billing.js');
  const api = fakeFirebase({ getProjectBillingInfo: { billingEnabled: false } });

  const result = await handler(handlerContext(brandConfig(), api));

  assert.equal(result.status, 'warned');
  assert.equal(api.mutations().length, 0);
  // #32: the skip announces itself to the run-summary aggregate
  assert.ok(result.output.billing.needsInteractive.includes('billing account'));
});

test('billing: an unreadable billing API says "could not check", never announces Spark (#56)', async () => {
  const handler = require('../src/services/cloud/ensure/billing.js');
  // getProjectBillingInfo() swallows every read failure into null (the live
  // run's auth attempt timed out), so the step knows nothing about the plan.
  const api = fakeFirebase({ getProjectBillingInfo: null });
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));

  let result;
  try {
    result = await handler(handlerContext(brandConfig(), api));
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.status, 'warned');
  assert.equal(api.mutations().length, 0);
  assert.match(result.output.billing.error, /could not check/i);
  const printed = lines.join('\n');
  assert.match(printed, /Could not check the billing plan/);
  assert.ok(!printed.includes('Spark plan (free tier)'), 'never states a plan it did not read');
});

test('billing: cloud.billingAccount: false = the user chose Spark — clean success, no nagging, no link', async () => {
  const handler = require('../src/services/cloud/ensure/billing.js');
  const api = fakeFirebase({ getProjectBillingInfo: { billingEnabled: false } });
  const config = brandConfig({ cloud: { billingAccount: false } });

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
    assert.equal(config.cloud.billingAccount, 'billingAccounts/FIXTURE-222');
    assert.ok(readConfigSource(brandRoot).includes('billingAccount: "billingAccounts/FIXTURE-222"'));
  } finally {
    tty.close();
  }
});

test('billing: interactive opt-out lands cloud.billingAccount: false and stays on Spark', async () => {
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
    assert.equal(config.cloud.billingAccount, false);
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
  const config = brandConfig({ cloud: { billingAccount: 'billingAccounts/MY-OWN' } });

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
  const backendPath = path.join(brandRoot, 'targets', 'backend');

  const result = await handler(handlerContext(brandConfig(), api, {
    brandRoot,
    targetDirs: [{ name: 'backend', dir: 'targets/backend', path: backendPath, target: 'backend' }],
  }));

  assert.equal(result.state.serviceAccount.email, SA_EMAIL);
  assert.equal(api.callsTo('createServiceAccountKey').length, 1);
  assert.equal(api.callsTo('createServiceAccount').length, 0); // account existed
  assert.equal(jetpack.read(path.join(brandRoot, '.omega', 'secrets', 'service-account.json'), 'json').client_email, SA_EMAIL);
  // No per-target copy: dist/ staging pulls from .omega/secrets at build time
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

test('authentication: an unchanged google-oauth.json is NOT rewritten on the next run (#623)', async () => {
  const handler = require('../src/services/cloud/ensure/authentication.js');
  const api = fakeFirebase(convergedResponses());
  // Redirect URIs already confirmed, so the run reaches the secret write
  // without the interactive flow
  const context = handlerContext(brandConfig({ cloud: { oauthRedirectsConfigured: true } }), api);
  const secretsPath = path.join(context.brandRoot, '.omega', 'secrets', 'google-oauth.json');

  await handler(context);
  assert.equal(jetpack.read(secretsPath, 'json').clientSecret, 'fixture-secret');

  // Backdate so a rewrite is unmistakable (same-ms writes hide behind mtime)
  const backdated = new Date(Date.now() - 60_000);
  fs.utimesSync(secretsPath, backdated, backdated);

  await handler(context);

  assert.ok(fs.statSync(secretsPath).mtimeMs < Date.now() - 30_000,
    'a converged secret is read-compared, never re-written (the #590 idiom)');
});

test('authentication: a DRIFTED google-oauth.json is rewritten (#623)', async () => {
  const handler = require('../src/services/cloud/ensure/authentication.js');
  const api = fakeFirebase(convergedResponses());
  const context = handlerContext(brandConfig({ cloud: { oauthRedirectsConfigured: true } }), api);
  const secretsPath = path.join(context.brandRoot, '.omega', 'secrets', 'google-oauth.json');

  jetpack.write(secretsPath, { clientId: `${PROJECT_NUMBER}-abc.apps.googleusercontent.com`, clientSecret: 'rotated-away' });

  await handler(context);

  assert.equal(jetpack.read(secretsPath, 'json').clientSecret, 'fixture-secret',
    'the console is the source of truth — a stale secret is replaced');
});

test('authentication: interactive redirect-URI confirm records completion in config (#434)', async () => {
  const handler = require('../src/services/cloud/ensure/authentication.js');
  const prompt = require('@omega.js/devkit/prompt');
  const api = fakeFirebase(convergedResponses());
  const tty = openTtyPrompt();

  // Stub the real browser launch behind the press-Enter-to-open step
  const opened = [];
  const realOpen = prompt.openInBrowser;
  prompt.openInBrowser = (url) => { opened.push(url); return true; };

  try {
    const context = handlerContext(brandConfig(), api);
    const run = handler(context);
    await tty.answer('Press Enter to open the OAuth client settings', '\r');
    await tty.answer('Origins + redirect URIs configured in the OAuth client?', 'y\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.output.authentication.oauthRedirectsConfigured, true);
    assert.match(readConfigSource(context.brandRoot), /oauthRedirectsConfigured: true/);
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

test('cloud-messaging: interactive paste-back validates lengths and splits the pair across its two homes (#434)', async () => {
  const handler = require('../src/services/cloud/ensure/cloud-messaging.js');
  const prompt = require('@omega.js/devkit/prompt');
  const api = fakeFirebase({ isServiceEnabled: () => true });
  const tty = openTtyPrompt();

  const realOpen = prompt.openInBrowser;
  prompt.openInBrowser = () => true;

  try {
    const context = handlerContext(brandConfig(), api);
    const run = handler(context);
    await tty.answer('Press Enter to open the Cloud Messaging settings', '\r');
    await tty.answer('VAPID public key:', 'too-short\r');
    // \x15 (ctrl-U) clears the rejected line before retyping
    await tty.answer('must be exactly 87 characters', `\x15${'B'.repeat(87)}\r`);
    await tty.answer('VAPID private key:', `${'p'.repeat(43)}\r`);
    const result = await run;

    // Public half → omega.json5 (it ships to every browser); private half →
    // the gitignored brand .env
    assert.match(readConfigSource(context.brandRoot), new RegExp(`vapidKey: "${'B'.repeat(87)}"`));
    assert.match(jetpack.read(path.join(context.brandRoot, '.env')), new RegExp(`VAPID_PRIVATE_KEY="${'p'.repeat(43)}"`));
    assert.ok(!readConfigSource(context.brandRoot).includes('p'.repeat(43)));
    assert.notEqual(result.status, 'warned');
    assert.equal(api.mutations().length, 0);
  } finally {
    prompt.openInBrowser = realOpen;
    tty.close();
  }
});

// ─── SDK config drift check ──────────────────────────────────────────────────

test('sdk-config: the missing omega.json5 cloud.config keys are written back, comments intact', async () => {
  const handler = require('../src/services/cloud/ensure/sdk-config.js');
  const api = fakeFirebase(convergedResponses());
  const brandRoot = makeBrandRoot(FIREBASE_WRITEBACK_CONFIG);

  // The fixture's cloud.config carries only projectId (its ONE home, #23) —
  // every other SDK key is missing and must land.
  const result = await handler(handlerContext(brandConfig(), api, { brandRoot }));

  assert.equal(result.status, undefined); // drift healed — success, not warned
  assert.deepEqual(result.state.sdkConfig, EXPECTED_SDK);
  assert.deepEqual(
    result.output.sdkConfig.updated.slice().sort(),
    Object.keys(EXPECTED_SDK).filter((k) => EXPECTED_SDK[k] && k !== 'projectId').sort(),
  );
  assert.equal(api.callsTo('createWebApp').length, 0);

  const written = readConfigSource(brandRoot);
  assert.ok(written.includes(`apiKey: "${EXPECTED_SDK.apiKey}"`));
  assert.ok(written.includes(`authDomain: "${DOMAIN}"`)); // brand host — the build self-hosts /__/auth/* (cp268)
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

// #588: the op used to ensure an api.{sub}.{domain} per `brand.subdomains`
// entry, a key nothing else declared or read. Ian's 2026-09-01 call: the web
// INSTANCE is the subdomain and every instance shares ONE backend, so the
// default site ensures api.<domain> and nothing per instance.
test('hosting: a multi-instance brand still ensures api.<domain> alone (#588)', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');
  const api = fakeFirebase(convergedResponses());
  const config = brandConfig();
  config.targets.web = [{ id: 'main' }, { id: 'admin' }, { id: 'cdn' }];

  const result = await handler(handlerContext(config, api));

  assert.equal(result.status, 'success');
  assert.deepEqual(result.state.hosting.domains, [{ domain: `api.${DOMAIN}`, status: 'verified' }]);

  // The retired key is inert: its reader is gone, not merely unused
  const stale = brandConfig();
  stale.brand.subdomains = ['admin', 'cdn'];
  const staleResult = await handler(handlerContext(stale, fakeFirebase(convergedResponses())));
  assert.deepEqual(staleResult.state.hosting.domains, [{ domain: `api.${DOMAIN}`, status: 'verified' }]);
});

test('hosting: cloud.apiSubdomain = false skips without touching anything', async () => {
  const handler = require('../src/services/cloud/ensure/hosting.js');
  const api = fakeFirebase({});
  const config = brandConfig({ cloud: { apiSubdomain: false } });

  const result = await handler(handlerContext(config, api));

  assert.deepEqual(result, {});
  assert.equal(api.calls.length, 0);
});

// ─── Dry run: drifted everywhere, zero mutations ─────────────────────────────

test('cloud: dry-run on a fully drifted project performs zero mutations', async () => {
  const config = brandConfig({ cloud: { billingAccount: 'billingAccounts/MY-OWN' } });
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
    brandConfig: brandConfig({ cloud: { supportEmail: 'team@groups.example.com' } }),
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

// ─── OAuth consent: an Internal audience is a manage-time STOPPER (#667) ─────

const INTERNAL_BRAND = { name: `projects/${PROJECT_NUMBER}/brands/b1`, applicationTitle: 'Fixture Brand', supportEmail: 'owner@example.com', orgInternalOnly: true };
const AUDIENCE_URL = `https://console.cloud.google.com/auth/audience?project=${PROJECT}`;

// Writeback target for the Disable outcome (the tri-state opt-out lands here)
const AUDIENCE_CONFIG = `// Fixture Brand — consent audience opt-out target
{
  brand: { id: 'fixture-brand' },
  cloud: { config: { projectId: "fixture-proj" } }, // consentAudience lands beside it
}
`;

test('oauth-consent: an External audience is a ✓ — nothing asks, nothing polls (#667)', async () => {
  const api = fakeFirebase({ listBrands: [{ ...INTERNAL_BRAND, orgInternalOnly: false }] });
  const tty = openTtyPrompt(); // interactive: a gate or a poll here would hang

  try {
    const result = await ensureOAuthConsent(handlerContext(brandConfig(), api));

    assert.equal(result.state.oauthConsent.audience, 'External');
    assert.equal(result.status, undefined, 'already External — a clean run');
    assert.equal(api.callsTo('listBrands').length, 1, 'one read, no poll');
    assert.deepEqual(api.mutations(), []);
  } finally {
    tty.close();
  }
});

test('oauth-consent: Internal + interactive STOPS — ENTER opens the console page and polls until it flips (#667)', async () => {
  // Google gives no API write for the audience: the human flips it in the
  // console and the ensure watches the brand read for it
  let reads = 0;
  const api = fakeFirebase({
    listBrands: () => (++reads === 1 ? [INTERNAL_BRAND] : [{ ...INTERNAL_BRAND, orgInternalOnly: false }]),
  });
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const run = ensureOAuthConsent(handlerContext(brandConfig(), api));
    await tty.answer('Set up now?', '\r'); // Yes
    await tty.answer('Press Enter to open the consent audience page', '\r');
    const result = await run;

    assert.deepEqual(opened, [AUDIENCE_URL]);
    assert.equal(result.state.oauthConsent.audience, 'External');
    assert.equal(result.status, undefined, 'the flip landed — nothing to warn about');
    assert.equal(reads, 2, 'the initial read plus the poll re-read');
    assert.deepEqual(api.mutations(), [], 'no write exists to attempt');
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('oauth-consent: (s) at the audience poll = later — Internal, warned with the reason (#667)', async () => {
  const api = fakeFirebase({ listBrands: [INTERNAL_BRAND] }); // never flips
  setBrowserOpener(async () => true);
  const tty = openTtyPrompt();

  try {
    const run = ensureOAuthConsent(handlerContext(brandConfig(), api));
    await tty.answer('Set up now?', '\r'); // Yes
    await tty.answer('Press Enter to open the consent audience page', '\r');
    await tty.answer('(enter)=check now, (s)=skip', 's');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.match(result.reason, /consent audience is Internal/);
    assert.equal(result.state.oauthConsent.audience, 'Internal');
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('oauth-consent: Disable lands cloud.consentAudience: false and the next run never asks (#667)', async () => {
  const api = fakeFirebase({ listBrands: [INTERNAL_BRAND] });
  const brandRoot = makeBrandRoot(AUDIENCE_CONFIG);
  const config = brandConfig();
  const tty = openTtyPrompt();

  try {
    const run = ensureOAuthConsent(handlerContext(config, api, { brandRoot }));
    await tty.answer('Set up now?', `${DOWN}${DOWN}\r`); // Disable (stop prompting)
    const result = await run;

    assert.equal(result.status, undefined, 'a deliberate opt-out is not a warning');
    assert.equal(result.state.oauthConsent.audience, 'Internal');
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes('consentAudience: false'), 'the opt-out lands in omega.json5');
    assert.ok(!written.includes('enabled: false'), 'the whole cloud service never dies with the audience step');
    assert.ok(written.includes('// consentAudience lands beside it'), 'the comment-preserving writeback');

    // The next run reads the recorded `false`: no gate, no poll — either
    // would hang on this still-open TTY
    const second = await ensureOAuthConsent(handlerContext(config, api, { brandRoot }));
    assert.equal(second.status, undefined, 'a recorded opt-out is silent forever');
    assert.equal(second.state.oauthConsent.audience, 'Internal');
  } finally {
    tty.close();
  }
});

test('oauth-consent: a non-interactive run warns with the console URL and never asks (#667)', async () => {
  const api = fakeFirebase({ listBrands: [INTERNAL_BRAND] });
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));

  let result;
  try {
    result = await ensureOAuthConsent(handlerContext(brandConfig(), api));
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.status, 'warned');
  assert.match(result.reason, /consent audience is Internal/);
  assert.equal(result.state.oauthConsent.audience, 'Internal');
  assert.ok(lines.join('\n').includes(AUDIENCE_URL), 'the console URL is printed');
  assert.equal(api.callsTo('listBrands').length, 1, 'no poll without a TTY');
});

test('oauth-consent: a dry run plans the stopper without asking or writing', async () => {
  const api = fakeFirebase({ listBrands: [INTERNAL_BRAND] });

  const result = await ensureOAuthConsent(handlerContext(brandConfig(), api, { options: { dryRun: true } }));

  assert.deepEqual(api.mutations(), []);
  assert.equal(result.status, undefined, 'a dry run plans, it never warns');
  assert.equal(result.state.oauthConsent.audience, 'Internal');
});

test('oauth-consent: a CREATED screen is born Internal — the audience goes through the same stopper (#667)', async () => {
  // Google creates API-made brands Internal, always: the create path reads
  // the returned brand and stops on it like any other
  const api = fakeFirebase({
    listBrands: [],
    getAuthenticatedEmail: 'owner@example.com',
    createBrand: (projectId, title, email) => ({ name: 'projects/123/brands/b9', applicationTitle: title, supportEmail: email, orgInternalOnly: true }),
  });

  const result = await ensureOAuthConsent(handlerContext(brandConfig(), api));

  assert.equal(result.status, 'warned');
  assert.match(result.reason, /consent audience is Internal/);
  assert.equal(result.state.oauthConsent.audience, 'Internal');
});

test("oauth-consent: an 'already exists' create re-reads the screen and reports it", async () => {
  // The list lagged (or a concurrent run won): the screen still gets its
  // audience read and reported, instead of a run that says nothing
  let listed = 0;
  const api = fakeFirebase({
    listBrands: () => (listed++ === 0 ? [] : [{ ...INTERNAL_BRAND, orgInternalOnly: false }]),
    getAuthenticatedEmail: 'owner@example.com',
    createBrand: () => { throw new Error('Requested entity already exists'); },
  });

  const result = await ensureOAuthConsent(handlerContext(brandConfig(), api));

  assert.equal(result.state.oauthConsent.audience, 'External');
  assert.equal(result.state.oauthConsent.supportEmail, INTERNAL_BRAND.supportEmail);
});

test('oauth-consent: an org-less project names the cause, never the generic could-not-create line (#667)', async () => {
  // Brand creation is org-only: an org-less project answers 400 "Project
  // must belong to an organization"
  const api = fakeFirebase({
    listBrands: [],
    getAuthenticatedEmail: 'owner@example.com',
    createBrand: () => { throw new Error('Google API Error: Project must belong to an organization.'); },
  });
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));

  let result;
  try {
    result = await ensureOAuthConsent(handlerContext(brandConfig(), api));
  } finally {
    console.log = originalLog;
  }

  const printed = lines.join('\n');
  assert.equal(result.status, 'warned');
  assert.match(result.reason, /belongs to no organization/);
  assert.match(printed, /belongs to no organization/);
  assert.ok(!printed.includes('Could not create OAuth consent screen'), 'a known cause never gets the generic line');
});

// ─── OAuth consent: the branding page is a NAMED manual step (#696) ─────────

const BRANDING_URL = `https://console.cloud.google.com/auth/branding?project=${PROJECT}`;

test('oauth-consent: the walk NAMES the console branding page — Google gives no API for it (#696)', async () => {
  // The logo, the home/privacy/terms links and the authorized domains live on
  // a page with no API, so the run cannot reconcile them: it names the page
  // and says what is safe to change right now (#693's ruling).
  const capture = () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    return { lines, restore: () => { console.log = originalLog; } };
  };

  const existing = fakeFirebase({ listBrands: [{ ...INTERNAL_BRAND, orgInternalOnly: false }] });
  const read = capture();
  let result;
  try {
    result = await ensureOAuthConsent(handlerContext(brandConfig(), existing));
  } finally {
    read.restore();
  }

  const printed = read.lines.join('\n');
  assert.equal(result.status, undefined, 'naming a manual step never warns or fails the run');
  assert.ok(printed.includes(BRANDING_URL), `the branding page URL is named, got:\n${printed}`);
  assert.match(printed, /safe anytime/, 'the one-line checklist says links + authorized domains are safe anytime');
  assert.match(printed, /verification review/i, 'and that a logo upload starts the verification review');
  assert.deepEqual(existing.mutations(), [], 'naming a page mutates nothing');

  // The freshly CREATED screen gets the same naming — a new project is
  // exactly where the branding page has never been touched
  const created = fakeFirebase({
    listBrands: [],
    getAuthenticatedEmail: 'owner@example.com',
    createBrand: (projectId, title, email) => ({ name: 'projects/123/brands/b9', applicationTitle: title, supportEmail: email }),
  });
  const write = capture();
  try {
    await ensureOAuthConsent(handlerContext(brandConfig(), created));
  } finally {
    write.restore();
  }

  assert.ok(write.lines.join('\n').includes(BRANDING_URL), 'the created screen names the branding page too');
});

// ─── Interactive project selection/creation (config-landing flow) ────────────

const { resolveFirebaseProject } = require('../src/services/cloud/lib/project-flow.js');

const PROJECT_FLOW_CONFIG = `{
  // Fixture Brand — firebase writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  cloud: { organizationId: "123456789" }, // projectId lands under cloud.config
}
`;

function projectFlowContext(brandRoot) {
  return {
    brandId: 'fixture-brand',
    brandRoot,
    options: {},
    brandConfig: {
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
      cloud: { organizationId: '123456789' },
    },
  };
}

test('project-flow: selecting an existing project lands cloud.config.projectId in omega.json5', async () => {
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
    assert.equal(context.brandConfig.cloud.config.projectId, 'fixture-brand');
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes('projectId: "fixture-brand"'));
    assert.ok(written.includes('// projectId lands under cloud.config'));
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
  delete context.brandConfig.cloud.organizationId; // unset → tri-state asks
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

test('project-flow: org opt-out creates the project standalone and lands cloud.organizationId: false (#33)', async () => {
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
  delete context.brandConfig.cloud.organizationId;
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
    assert.equal(context.brandConfig.cloud.organizationId, false);
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
