/**
 * Analytics service tests — GA4 streams/firebase-link against a method-level
 * recording fake of the Analytics Admin API, plus the meta/tiktok pixel-token
 * checks. Proves skip/filter semantics, the converged zero-mutation no-op
 * across all four operations, per-target stream creation, diff-first rename +
 * enhanced measurement, the clean-secret lifecycle, the acknowledgement-gate
 * warn, wrong-property link moves, and the fully-drifted dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/analytics/index.js');
const { resolveGoogleProperty } = require('../src/services/analytics/lib/property-flow.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// Tests must never see real credentials from the shell environment
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.META_ACCESS_TOKEN;
delete process.env.TIKTOK_ACCESS_TOKEN;

const DOMAIN = 'fixture-brand.test';
const ACCOUNT = '999888';
const PROPERTY = '123456';
const PROJECT = 'fixture-proj';
const PROJECT_NUMBER = '123456789';

// All enhanced-measurement keys enabled — matches the manager defaults
const ENHANCED_ALL = structuredClone(DEFAULTS.analytics.providers.google.enhancedMeasurement);

const WEB_STREAM = {
  name: `properties/${PROPERTY}/dataStreams/101`,
  type: 'WEB_DATA_STREAM',
  displayName: 'Fixture Brand - Website',
  webStreamData: { defaultUri: `https://${DOMAIN}`, measurementId: 'G-WEB1' },
};
const BACKEND_STREAM = {
  name: `properties/${PROPERTY}/dataStreams/102`,
  type: 'WEB_DATA_STREAM',
  displayName: 'Fixture Brand - Backend',
  webStreamData: { defaultUri: `https://api.${DOMAIN}`, measurementId: 'G-BACK1' },
};
// The stream Firebase auto-creates when linking, already normalized
const FIREBASE_STREAM = {
  name: `properties/${PROPERTY}/dataStreams/103`,
  type: 'WEB_DATA_STREAM',
  displayName: 'Fixture Brand - Firebase',
  webStreamData: { defaultUri: `https://${PROJECT}.firebaseapp.com`, measurementId: 'G-FIREBASE1' },
};
const CLEAN_SECRET = {
  name: `properties/${PROPERTY}/dataStreams/101/measurementProtocolSecrets/s1`,
  displayName: 'Secret',
  secretValue: 'cleansecret123',
};
const OUR_LINK = { name: `properties/${PROPERTY}/firebaseLinks/fl1`, project: `projects/${PROJECT_NUMBER}` };

// State the cloud service leaves behind (messagingSenderId IS the project number)
const FIREBASE_STATE = {
  cloud: { sdkConfig: { measurementId: 'G-FIREBASE1', messagingSenderId: PROJECT_NUMBER } },
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ url = `https://${DOMAIN}`, targets = { web: {}, backend: {} }, google = true, metaId = null, tiktokId = null } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    analytics: structuredClone(DEFAULTS.analytics),
    firebase: { projectId: PROJECT },
    targets,
  };
  if (google) {
    config.analytics.providers.google.accountId = ACCOUNT;
    config.analytics.providers.google.propertyId = PROPERTY;
  }
  config.analytics.providers.meta.id = metaId;
  config.analytics.providers.tiktok.id = tiktokId;
  return config;
}

const READ_METHODS = [
  'getProperty', 'listDataStreams', 'getEnhancedMeasurementSettings',
  'listMeasurementProtocolSecrets', 'listFirebaseLinks', 'listAccounts', 'listProperties',
];
const MUTATING_METHODS = [
  'createWebDataStream', 'updateDataStream', 'updateEnhancedMeasurementSettings',
  'createMeasurementProtocolSecret', 'deleteMeasurementProtocolSecret',
  'createFirebaseLink', 'deleteFirebaseLink',
];

/**
 * Recording fake GoogleAnalyticsAPI. Static values are cloned per call,
 * functions are called with the method args (throw inside one to simulate an
 * API error). A method with no configured response throws — so the converged
 * no-op test fails LOUDLY on any unexpected mutation.
 */
function fakeAnalytics(responses = {}) {
  const api = { calls: [] };

  for (const method of [...READ_METHODS, ...MUTATING_METHODS]) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeAnalytics: no response configured for ${method}(${JSON.stringify(args)})`);
      }
      const value = responses[method];
      return typeof value === 'function' ? await value(...args) : structuredClone(value);
    };
  }

  api.mutations = () => api.calls.filter((c) => MUTATING_METHODS.includes(c.method));
  api.callsTo = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

/** Everything a fully converged two-target brand reads. */
function convergedResponses() {
  return {
    getProperty: { name: `properties/${PROPERTY}`, displayName: `Fixture Brand (${DOMAIN})` },
    listDataStreams: [WEB_STREAM, BACKEND_STREAM, FIREBASE_STREAM],
    getEnhancedMeasurementSettings: ENHANCED_ALL,
    listMeasurementProtocolSecrets: [CLEAN_SECRET],
    listFirebaseLinks: [OUR_LINK],
  };
}

function runService(config, { analytics, brandState = {}, options = {}, metaToken, tiktokToken, brandRoot } = {}) {
  if (metaToken) {
    process.env.META_ACCESS_TOKEN = metaToken;
  } else {
    delete process.env.META_ACCESS_TOKEN;
  }
  if (tiktokToken) {
    process.env.TIKTOK_ACCESS_TOKEN = tiktokToken;
  } else {
    delete process.env.TIKTOK_ACCESS_TOKEN;
  }

  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || '/tmp/omega-manager-analytics-unused', // the selection flow writes config/omega.json5 when given a real root
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState,
    apps: [],
    operations: OPERATIONS.analytics,
    options,
    serviceData: brandState.analytics || {},
    analyticsApi: analytics,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('analytics: skips when no provider is configured', async () => {
  const result = await runService(brandConfig({ google: false }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no analytics providers configured/);
});

test('analytics: analytics.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.analytics.enabled = false;

  const result = await runService(config, { analytics: fakeAnalytics() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /analytics\.enabled/);
});

test('analytics: google-only config without credentials skips the service', async () => {
  const result = await runService(brandConfig());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /GOOGLE_CLIENT_ID/);
});

test('analytics: no propertyId filters the google operations; pixel checks still run', async () => {
  // No fake API injected — if the filter failed, google-streams would crash
  const result = await runService(brandConfig({ google: false, metaId: 'PIXEL123' }));

  assert.equal(result.status, 'warned'); // meta id configured but no token
  assert.equal(result.output.meta.pixelId, 'PIXEL123');
  assert.equal(result.output.meta.tokenConfigured, false);
  assert.equal(result.state?.streams, undefined); // google-streams never ran
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('analytics: a fully converged brand is a zero-mutation no-op across all 4 operations', async () => {
  const api = fakeAnalytics(convergedResponses());

  const result = await runService(brandConfig({ metaId: 'PIXEL123', tiktokId: 'TT123' }), {
    analytics: api,
    brandState: FIREBASE_STATE,
    metaToken: 'meta-token',
    tiktokToken: 'tiktok-token',
  });

  assert.equal(result.status, 'success');
  assert.equal(api.mutations().length, 0);

  assert.equal(result.state.streams.web.measurementId, 'G-WEB1');
  assert.equal(result.state.streams.web.apiSecret, 'cleansecret123');
  assert.equal(result.state.streams.backend.streamId, '102');
  assert.equal(result.state.streams.backend.uri, `https://api.${DOMAIN}`);
  assert.equal(result.state.firebaseLink.linked, true);
  assert.equal(result.output.meta.tokenConfigured, true);
  assert.equal(result.output.tiktok.tokenConfigured, true);
});

// ─── Stream reconciliation ───────────────────────────────────────────────────

test('analytics: missing streams are created with the per-target URI and display name', async () => {
  let nextId = 200;
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [], // property has no streams at all
    // No firebase state in this test → the link must match by project ID
    listFirebaseLinks: [{ name: `properties/${PROPERTY}/firebaseLinks/fl1`, project: `projects/${PROJECT}` }],
    createWebDataStream: (propertyId, { defaultUri, displayName }) => ({
      name: `properties/${PROPERTY}/dataStreams/${++nextId}`,
      type: 'WEB_DATA_STREAM',
      displayName,
      webStreamData: { defaultUri, measurementId: `G-NEW${nextId}` },
    }),
  });

  const result = await runService(brandConfig(), { analytics: api, brandState: {} });

  const creates = api.callsTo('createWebDataStream');
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].args[1], { defaultUri: `https://${DOMAIN}`, displayName: 'Fixture Brand - Website' });
  assert.deepEqual(creates[1].args[1], { defaultUri: `https://api.${DOMAIN}`, displayName: 'Fixture Brand - Backend' });

  assert.equal(result.state.streams.web.measurementId, 'G-NEW201');
  assert.equal(result.state.streams.backend.measurementId, 'G-NEW202');
  // Correctly-named creations need no rename
  assert.equal(api.callsTo('updateDataStream').length, 0);
});

test('analytics: displayName drift renames the stream without creating', async () => {
  const drifted = structuredClone(WEB_STREAM);
  drifted.displayName = 'Old Stream Name';

  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [drifted, FIREBASE_STREAM],
    updateDataStream: {},
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  assert.equal(result.status, 'success');
  assert.equal(api.callsTo('createWebDataStream').length, 0);
  const renames = api.callsTo('updateDataStream');
  assert.equal(renames.length, 1);
  assert.deepEqual(renames[0].args[2], { displayName: 'Fixture Brand - Website' });
});

test('analytics: enhanced measurement is patched only on drift (omega-manager patched every run)', async () => {
  const driftedSettings = { ...ENHANCED_ALL, scrollsEnabled: false };

  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    getEnhancedMeasurementSettings: driftedSettings,
    updateEnhancedMeasurementSettings: {},
  });

  await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  const patches = api.callsTo('updateEnhancedMeasurementSettings');
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].args[2], ENHANCED_ALL);
});

test('analytics: an unclean secret is regenerated until clean', async () => {
  const uncleanSecret = { ...CLEAN_SECRET, secretValue: 'dirty-secret_1' };
  const created = ['still_dirty', 'finallyclean'];
  let createCount = 0;

  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listMeasurementProtocolSecrets: [uncleanSecret],
    createMeasurementProtocolSecret: () => ({
      name: `properties/${PROPERTY}/dataStreams/101/measurementProtocolSecrets/new${createCount}`,
      displayName: 'Secret',
      secretValue: created[createCount++],
    }),
    deleteMeasurementProtocolSecret: { deleted: true },
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  // Original unclean + first regeneration deleted; two creates until clean
  assert.equal(api.callsTo('deleteMeasurementProtocolSecret').length, 2);
  assert.equal(api.callsTo('createMeasurementProtocolSecret').length, 2);
  assert.equal(result.state.streams.web.apiSecret, 'finallyclean');
});

test('analytics: the data-collection acknowledgement gate warns instead of failing', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listMeasurementProtocolSecrets: () => {
      throw new Error('HTTP 403: User Data Collection Acknowledgement required.');
    },
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  assert.equal(result.status, 'warned');
  assert.equal(result.state.streams.web.apiSecret, null);
  assert.equal(api.mutations().length, 0);
});

test('analytics: interactive acknowledgement — Enter-gated open, retry poll lands the secret in ONE run', async () => {
  const promptModule = require('@omega.js/devkit/prompt');

  // openInBrowser is the moment the human sees the page — the stub "acks"
  let acked = false;
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listMeasurementProtocolSecrets: () => {
      throw new Error('HTTP 403: User Data Collection Acknowledgement required.');
    },
    createMeasurementProtocolSecret: () => {
      if (!acked) {
        throw new Error('HTTP 403: User Data Collection Acknowledgement required.');
      }
      return { name: `properties/${PROPERTY}/dataStreams/101/measurementProtocolSecrets/s9`, displayName: 'Secret', secretValue: 'freshcleansecret' };
    },
  });

  const opened = [];
  const realOpen = promptModule.openInBrowser;
  promptModule.openInBrowser = (url) => {
    opened.push(url);
    acked = true;
    return true;
  };

  const tty = openTtyPrompt();
  try {
    const run = runService(brandConfig({ targets: { web: {} } }), {
      analytics: api,
      brandState: FIREBASE_STATE,
    });

    await tty.answer('Press Enter to open the data-collection acknowledgement page', '\r');
    await tty.answer('(enter)=check now, (s)=skip', '\r');
    const result = await run;

    assert.equal(result.state.streams.web.apiSecret, 'freshcleansecret');
    assert.equal(result.status, 'success', 'the acknowledged run finishes green — no rerun needed');
    assert.match(opened[0], /analytics\.google\.com/);
  } finally {
    promptModule.openInBrowser = realOpen;
    tty.close();
  }
});

test('analytics: firebase-link derives the project from cloud.config when firebase.projectId is absent', async () => {
  const config = brandConfig({ targets: { web: {} } });
  config.firebase = {};
  config.cloud = { provider: 'firebase', config: { projectId: PROJECT } };

  const api = fakeAnalytics(convergedResponses());
  const result = await runService(config, { analytics: api, brandState: FIREBASE_STATE });

  assert.equal(result.status, 'success');
  assert.ok(api.callsTo('listFirebaseLinks').length > 0, 'the link op ran instead of skipping on a missing firebase.projectId');
  assert.equal(api.mutations().length, 0, 'converged link stays a no-op');
});

test('analytics: a configured propertyId that does not exist warns', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    getProperty: null,
    listDataStreams: [FIREBASE_STREAM],
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  assert.equal(result.status, 'warned');
  assert.match(result.output.streams.error, /not found/);
});

test('analytics: firebase measurementId missing from the property warns of a cross-link', async () => {
  // Property carries only the web stream — Firebase's G-FIREBASE1 lives elsewhere
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM],
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  assert.equal(result.status, 'warned');
  assert.equal(api.mutations().length, 0);
});

// ─── Firebase link ───────────────────────────────────────────────────────────

test('analytics: a link on the wrong property is moved to the configured one', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listFirebaseLinks: (propertyId) => (propertyId === '777'
      ? [{ name: 'properties/777/firebaseLinks/fl9', project: `projects/${PROJECT_NUMBER}` }]
      : []),
    listAccounts: [{ name: `accounts/${ACCOUNT}`, displayName: 'Fixture Account' }],
    listProperties: [{ name: 'properties/777', displayName: 'Wrong Property' }],
    deleteFirebaseLink: { deleted: true },
    createFirebaseLink: { name: `properties/${PROPERTY}/firebaseLinks/fl2` },
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  const deletes = api.callsTo('deleteFirebaseLink');
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].args, ['777', 'fl9']);
  const creates = api.callsTo('createFirebaseLink');
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].args, [PROPERTY, PROJECT]);
  assert.equal(result.state.firebaseLink.linked, true);
});

test('analytics: a property linked to a DIFFERENT firebase project warns (not ours to break)', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listFirebaseLinks: [{ name: `properties/${PROPERTY}/firebaseLinks/fl3`, project: 'projects/someone-elses-project' }],
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  assert.equal(result.status, 'warned');
  assert.match(result.output.firebaseLink.error, /different project/);
  assert.equal(api.callsTo('deleteFirebaseLink').length, 0);
});

test('analytics: the Firebase auto-stream ("Web App", no URI) is normalized after link check', async () => {
  const autoStream = {
    name: `properties/${PROPERTY}/dataStreams/103`,
    type: 'WEB_DATA_STREAM',
    displayName: 'Web App',
    webStreamData: { measurementId: 'G-FIREBASE1' },
  };

  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, autoStream],
    updateDataStream: {},
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
    brandState: FIREBASE_STATE,
  });

  const updates = api.callsTo('updateDataStream');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].args[2], {
    displayName: 'Fixture Brand - Firebase',
    webStreamData: { defaultUri: `https://${PROJECT}.firebaseapp.com` },
  });
  assert.deepEqual(updates[0].args[3], ['displayName', 'webStreamData.defaultUri']);
  assert.equal(result.state.firebaseLink.streamUpdated.updated, true);
});

// ─── Pixel tokens ────────────────────────────────────────────────────────────

test('analytics: pixel token present succeeds, missing token warns with the env var name', async () => {
  const result = await runService(
    brandConfig({ google: false, metaId: 'PIXEL123', tiktokId: 'TT456' }),
    { metaToken: 'meta-token' }, // tiktok token deliberately missing
  );

  assert.equal(result.status, 'warned');
  assert.equal(result.output.meta.tokenConfigured, true);
  assert.equal(result.output.tiktok.tokenConfigured, false);
});

test('analytics: interactive paste-in saves the pixel token to the brand .env', async () => {
  const jetpack = require('fs-jetpack');
  const brandRoot = makeBrandRoot('{}');
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig({ google: false, metaId: 'PIXEL123' }), { brandRoot });
    await tty.answer('META_ACCESS_TOKEN (leave empty to skip):', 'pasted-meta-token\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.output.meta.tokenConfigured, true);
    assert.match(jetpack.read(`${brandRoot}/.env`), /^META_ACCESS_TOKEN="pasted-meta-token"$/m);
    assert.equal(process.env.META_ACCESS_TOKEN, 'pasted-meta-token');
  } finally {
    tty.close();
    delete process.env.META_ACCESS_TOKEN;
  }
});

test('analytics: an empty paste-in keeps the warned guidance and writes nothing', async () => {
  const jetpack = require('fs-jetpack');
  const brandRoot = makeBrandRoot('{}');
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig({ google: false, metaId: 'PIXEL123' }), { brandRoot });
    await tty.answer('META_ACCESS_TOKEN (leave empty to skip):', '\r');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.equal(result.output.meta.tokenConfigured, false);
    assert.equal(jetpack.exists(`${brandRoot}/.env`), false);
    assert.equal(process.env.META_ACCESS_TOKEN, undefined);
  } finally {
    tty.close();
  }
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('analytics: dry-run on a fully drifted brand performs zero mutations', async () => {
  const api = fakeAnalytics({
    getProperty: { name: `properties/${PROPERTY}` },
    listDataStreams: [], // no streams → both would be created
    listFirebaseLinks: (propertyId) => (propertyId === '777'
      ? [{ name: 'properties/777/firebaseLinks/fl9', project: `projects/${PROJECT_NUMBER}` }]
      : []),
    listAccounts: [{ name: `accounts/${ACCOUNT}` }],
    listProperties: [{ name: 'properties/777', displayName: 'Wrong Property' }],
  });

  const result = await runService(brandConfig(), {
    analytics: api,
    brandState: FIREBASE_STATE,
    options: { dryRun: true },
  });

  assert.equal(api.mutations().length, 0);
  assert.equal(result.output.streams.planned.length, 2);
  assert.deepEqual(result.output.firebaseLink.planned, [
    'unlink from property 777',
    `link to property ${PROPERTY}`,
  ]);
});

// ─── Interactive account + property flow (config-landing) ────────────────────

const FLOW_WRITEBACK_CONFIG = `{
  // Fixture Brand — analytics writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  firebase: { projectId: 'fixture-proj' },
  targets: { web: {}, backend: {} },
}
`;

test('setup: interactive run lands account + property in omega.json5 and the google ops run in the same pass', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    listAccounts: [{ name: `accounts/${ACCOUNT}`, displayName: 'Fixture Account' }],
    listProperties: [{ name: `properties/${PROPERTY}`, displayName: 'Fixture Brand' }],
  });
  const brandRoot = makeBrandRoot(FLOW_WRITEBACK_CONFIG);
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig({ google: false }), { analytics: api, brandRoot, brandState: FIREBASE_STATE });
    await tty.answer('Set up now?', '\r'); // one gate covers the account + property pair
    await tty.answer('Select Google Analytics account:', '\r');
    await tty.answer('Select GA4 property:', '\r'); // no second "Set up now?" gate
    const result = await run;

    assert.equal(result.status, 'success');
    assert.ok(api.callsTo('listDataStreams').length >= 1); // google ops ran with the landed property
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes(`accountId: "${ACCOUNT}"`));
    assert.ok(written.includes(`propertyId: "${PROPERTY}"`));
    assert.ok(written.includes('// Fixture Brand — analytics writeback target'));
  } finally {
    tty.close();
  }
});

test('property-flow: create-new property calls the Admin API with config time zone + currency', async () => {
  const created = [];
  const api = {
    listProperties: async () => [],
    createProperty: async (accountId, body) => {
      created.push({ accountId, body });
      return { name: 'properties/424242' };
    },
  };
  const brandRoot = makeBrandRoot(FLOW_WRITEBACK_CONFIG);
  const context = {
    brandId: 'fixture-brand',
    brandRoot,
    options: {},
    brandConfig: {
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: `https://${DOMAIN}` },
      analytics: { providers: { google: { accountId: ACCOUNT, propertyId: null, timeZone: 'America/Los_Angeles', currency: 'USD' } } },
    },
  };
  const tty = openTtyPrompt();

  try {
    const run = resolveGoogleProperty(context, api);
    // account is pre-configured → the property step carries the gate
    await tty.answer('Set up now?', '\r');
    await tty.answer('Select GA4 property:', '\r'); // "+ Create new property" is the only choice
    const propertyId = await run;

    assert.equal(propertyId, '424242');
    assert.deepEqual(created, [{
      accountId: ACCOUNT,
      body: { displayName: `Fixture Brand (${DOMAIN})`, timeZone: 'America/Los_Angeles', currencyCode: 'USD' },
    }]);
    assert.ok(readConfigSource(brandRoot).includes('propertyId: "424242"'));
  } finally {
    tty.close();
  }
});
