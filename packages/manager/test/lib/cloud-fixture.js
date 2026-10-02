/**
 * Cloud service fixtures shared by the cloud test files: real brand roots,
 * the brand config, a method-level recording fake of the FirebaseAPI surface,
 * a Cloudflare fake for hosting, the service runner, and the answers a fully
 * converged project gives.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS, DEFAULTS } = require('../../src/config.js');
const service = require('../../src/services/cloud/index.js');

const DOMAIN = 'fixture-brand.test';
const PROJECT = 'fixture-proj';
const PROJECT_NUMBER = '123456789';
const SA_EMAIL = `firebase-adminsdk-x1@${PROJECT}.iam.gserviceaccount.com`;
const ZONE = { id: 'zone-1', name: DOMAIN, status: 'active' };
// The role that lets the deploy account act as the runtime accounts
const ACT_AS_ROLE = 'roles/iam.serviceAccountUser';

// The handler's REQUIRED_SERVICES list, pinned (drift here should fail loudly)
const ALL_SERVICES = [
  'serviceusage.googleapis.com', 'firebase.googleapis.com', 'firestore.googleapis.com',
  'firebasestorage.googleapis.com', 'firebasehosting.googleapis.com', 'firebasedatabase.googleapis.com',
  'identitytoolkit.googleapis.com', 'cloudfunctions.googleapis.com', 'cloudbuild.googleapis.com',
  'run.googleapis.com', 'artifactregistry.googleapis.com', 'iap.googleapis.com',
  'recaptchaenterprise.googleapis.com', 'fcm.googleapis.com',
];

const DEFAULT_ROOT_CONFIG = `{\n  brand: { id: 'fixture-brand' },\n}\n`;

// Every fixture root is a real brand root: the auth redirect confirm and the
// VAPID paste-back land in config/omega.json5
function tmpRoot(source = DEFAULT_ROOT_CONFIG) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-fb-'));
  jetpack.write(path.join(root, 'config', 'omega.json5'), source);
  return root;
}

// ONE cloud home: the provisioning fields, the platform-level org + billing
// account, and the app config all live under `cloud`.
function brandConfig({ cloud = {}, sdkConfig } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: `https://${DOMAIN}` },
    cloud: {
      ...structuredClone(DEFAULTS.cloud),
      ...cloud,
      config: { projectId: PROJECT, ...(sdkConfig || {}), ...(cloud.config || {}) },
    },
    targets: { web: { type: 'web' }, backend: { type: 'backend' } },
  };
  if (sdkConfig) {
    config.cloud.provider = 'firebase';
  }
  return config;
}

const MUTATING_METHODS = new Set([
  'linkBillingAccount', 'enableService', 'enableServices', 'setIamPolicy',
  'updateProjectName', 'createWebApp', 'updateWebAppDisplayName', 'createBrand',
  'createServiceAccount', 'createServiceAccountKey', 'setServiceAccountIamPolicy', 'createHostingSite',
  'createCustomDomain', 'undeleteCustomDomain', 'createFirestoreDatabase',
  'enableFirestorePITR', 'createRealtimeDatabase', 'createDefaultStorageBucket',
  'initializeIdentityPlatform', 'updateIdentityConfig',
]);

const API_METHODS = [
  ...MUTATING_METHODS,
  'getProjectBillingInfo', 'listEnabledServices', 'getProjectNumber', 'getIamPolicy',
  'getGcpProject', 'listWebApps', 'getWebAppConfig', 'listBrands', 'listServiceAccounts',
  'listHostingSites', 'checkDomainStatus', 'getFirestoreDatabase', 'listRealtimeDatabases',
  'getIdentityConfig', 'getIdpConfig', 'getStorageBucket', 'isServiceEnabled', 'getServiceAccountIamPolicy',
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
 * /__/auth/*) + default RTDB URL. */
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
        ...['roles/firebase.admin', 'roles/firebaseauth.admin', 'roles/datastore.owner', 'roles/serviceusage.serviceUsageConsumer', 'roles/cloudscheduler.admin']
          .map((role) => ({ role, members: [`serviceAccount:${SA_EMAIL}`] })),
      ],
    }),
    getGcpProject: { displayName: 'Fixture Brand' },
    listWebApps: [{ appId: 'app-1', displayName: 'Web App' }],
    getWebAppConfig: { ...RAW_SDK },
    listBrands: [{ name: `projects/${PROJECT_NUMBER}/brands/b1`, applicationTitle: 'Fixture Brand', supportEmail: `support@${DOMAIN}`, orgInternalOnly: false }],
    listServiceAccounts: [{ email: SA_EMAIL }],
    // The deploy grant lives on each runtime account's OWN policy
    getServiceAccountIamPolicy: () => ({ bindings: [{ role: ACT_AS_ROLE, members: [`serviceAccount:${SA_EMAIL}`] }] }),
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
function stagedRoot(source) {
  const root = tmpRoot(source);
  jetpack.write(path.join(root, '.omega', 'secrets', 'service-account.json'), { client_email: SA_EMAIL });
  return root;
}

module.exports = {
  DOMAIN, PROJECT, PROJECT_NUMBER, SA_EMAIL, ACT_AS_ROLE, ALL_SERVICES, EXPECTED_SDK,
  tmpRoot, stagedRoot, brandConfig, fakeFirebase, fakeCf, runService, convergedResponses,
};
