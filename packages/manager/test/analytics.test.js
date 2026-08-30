/**
 * Analytics service tests — GA4 streams/firebase-link against a method-level
 * recording fake of the Analytics Admin API, plus the meta/tiktok pixel
 * provisioning and token checks. Proves skip/filter semantics, the converged
 * zero-mutation no-op across all four operations, per-target stream creation,
 * diff-first rename + enhanced measurement, the clean-secret lifecycle, the
 * acknowledgement-gate warn, wrong-property link moves, the per-target
 * measurement-id writeback, find-by-name-before-create pixel provisioning
 * with its token gate, the near-zero-input Meta pass (gate → Enter-gated
 * token page → paste-in → ad-account discovery → create, all in one run) with
 * its `providers.meta: false` off switch, and the fully-drifted dry-run
 * guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/analytics/index.js');
const { MetaMarketingAPI } = require('../src/services/analytics/lib/meta-api.js');
const { TikTokBusinessAPI } = require('../src/services/analytics/lib/tiktok-api.js');
const { resolveGoogleProperty } = require('../src/services/analytics/lib/property-flow.js');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

/** The brand .env the analytics service writes each stream secret into (#434). */
const readEnv = (brandRoot) => jetpack.read(join(brandRoot, '.env')) || '';

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

// What the cloud service leaves in config (messagingSenderId IS the project
// number) — the google ops read both from there since #434
const FIREBASE_SDK_CONFIG = { measurementId: 'G-FIREBASE1', messagingSenderId: PROJECT_NUMBER };

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Every run gets a writeback-ready root: the stream reconcile lands each
// target's measurement id in omega.json5, and the pixel provisioning lands
// the pixel ids, so a fixture root without a real config file is not a
// runnable brand.
const FIXTURE_CONFIG = `{
  // Fixture Brand — analytics writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  cloud: { config: { projectId: 'fixture-proj' } },
  targets: { web: {}, backend: {} },
}
`;

function brandConfig({
  url = `https://${DOMAIN}`, targets = { web: {}, backend: {} }, google = true,
  metaId = null, tiktokId = null, metaAccount = null, tiktokAccount = null,
  metaDisabled = false, firebase = true,
} = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    analytics: structuredClone(DEFAULTS.analytics),
    cloud: { config: { projectId: PROJECT, ...(firebase ? FIREBASE_SDK_CONFIG : {}) } },
    targets,
  };
  if (google) {
    config.analytics.providers.google.accountId = ACCOUNT;
    config.analytics.providers.google.propertyId = PROPERTY;
  }
  config.analytics.providers.meta.id = metaId;
  config.analytics.providers.meta.accountId = metaAccount;
  config.analytics.providers.tiktok.id = tiktokId;
  config.analytics.providers.tiktok.accountId = tiktokAccount;
  // The tri-state opt-out (#33): an unconfigured Meta half ASKS in a TTY, so
  // every interactive test that isn't about Meta turns it off the same way a
  // brand would
  if (metaDisabled) {
    config.analytics.providers.meta = false;
  }
  return config;
}

/**
 * Stub the real browser launch — pressEnterToOpen's seam (module.exports
 * .openInBrowser), the moment a human would see the page.
 */
function stubBrowser(onOpen) {
  const promptModule = require('@omega.js/devkit/prompt');
  const real = promptModule.openInBrowser;
  const opened = [];

  promptModule.openInBrowser = (url) => {
    opened.push(url);
    onOpen?.(url);
    return true;
  };

  return { opened, restore: () => { promptModule.openInBrowser = real; } };
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

function runService(config, { analytics, meta, tiktok, options = {}, metaToken, tiktokToken, brandRoot } = {}) {
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
  // Each run starts from a brand .env with no stream secrets in it — the
  // handler seeds its fallback from process.env (#434)
  for (const target of ['web', 'backend', 'desktop', 'extension', 'mobile']) {
    delete process.env[`GOOGLE_ANALYTICS_SECRET_${target.toUpperCase()}`];
  }

  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || makeBrandRoot(FIXTURE_CONFIG), // every run may write config/omega.json5
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.analytics,
    options,
    analyticsApi: analytics,
    metaApi: meta,
    tiktokApi: tiktok,
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
  assert.equal(result.output?.streams, undefined); // google-streams never ran
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('analytics: a fully converged brand is a zero-mutation no-op across all 4 operations', async () => {
  const api = fakeAnalytics(convergedResponses());

  const result = await runService(brandConfig({ metaId: 'PIXEL123', tiktokId: 'TT123' }), {
    analytics: api,
    metaToken: 'meta-token',
    tiktokToken: 'tiktok-token',
  });

  assert.equal(result.status, 'success');
  assert.equal(api.mutations().length, 0);

  assert.equal(result.output.streams.resolved.web.measurementId, 'G-WEB1');
  assert.equal(result.output.streams.resolved.backend.streamId, '102');
  assert.equal(result.output.firebaseLink.linked, true);
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

  const result = await runService(brandConfig(), { analytics: api });

  const creates = api.callsTo('createWebDataStream');
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].args[1], { defaultUri: `https://${DOMAIN}`, displayName: 'Fixture Brand - Website' });
  assert.deepEqual(creates[1].args[1], { defaultUri: `https://api.${DOMAIN}`, displayName: 'Fixture Brand - Backend' });

  assert.equal(result.output.streams.resolved.web.measurementId, 'G-NEW201');
  assert.equal(result.output.streams.resolved.backend.measurementId, 'G-NEW202');
  // Correctly-named creations need no rename
  assert.equal(api.callsTo('updateDataStream').length, 0);
});

// ─── Measurement id → config (#417) ──────────────────────────────────────────
// Before this, stream ids only ever reached .omega/state.json, so a brand's
// configured `analytics.providers.google.id` stayed null (the playground's
// still was, months after its property was created) and each target's
// Measurement Protocol secret had no stream id of its own to pair with.

test('analytics: each target measurement id lands in targets.<type>.analytics.providers.google.id', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const api = fakeAnalytics(convergedResponses());

  await runService(brandConfig(), { analytics: api, brandRoot });

  const written = readConfigSource(brandRoot);
  assert.match(written, /targets:[\s\S]*web:[\s\S]*analytics:[\s\S]*google:[\s\S]*id: "G-WEB1"/);
  assert.match(written, /backend:[\s\S]*analytics:[\s\S]*google:[\s\S]*id: "G-BACK1"/);
  // The per-surface override never touches the shared block
  assert.ok(!written.includes('providers: { google: { id:'), 'shared analytics block untouched');
  assert.ok(written.includes('// Fixture Brand — analytics writeback target'), 'comments survive');
});

test('analytics: a config already carrying the measurement ids is left byte-identical', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const first = fakeAnalytics(convergedResponses());
  await runService(brandConfig(), { analytics: first, brandRoot });

  const landed = readConfigSource(brandRoot);
  const config = brandConfig();
  config.targets = {
    web: { analytics: { providers: { google: { id: 'G-WEB1' } } } },
    backend: { analytics: { providers: { google: { id: 'G-BACK1' } } } },
  };

  const second = fakeAnalytics(convergedResponses());
  await runService(config, { analytics: second, brandRoot });

  assert.equal(readConfigSource(brandRoot), landed, 'converged rerun writes nothing');
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

  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  await runService(brandConfig({ targets: { web: {} } }), { analytics: api, brandRoot });

  // Original unclean + first regeneration deleted; two creates until clean
  assert.equal(api.callsTo('deleteMeasurementProtocolSecret').length, 2);
  assert.equal(api.callsTo('createMeasurementProtocolSecret').length, 2);
  // The clean secret's home is the brand .env, never omega.json5 (#434)
  assert.match(readEnv(brandRoot), /GOOGLE_ANALYTICS_SECRET_WEB="finallyclean"/);
  assert.ok(!readConfigSource(brandRoot).includes('finallyclean'));
});

test('analytics: the data-collection acknowledgement gate warns instead of failing', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listMeasurementProtocolSecrets: () => {
      throw new Error('HTTP 403: User Data Collection Acknowledgement required.');
    },
  });

  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const result = await runService(brandConfig({ targets: { web: {} } }), { analytics: api, brandRoot });

  assert.equal(result.status, 'warned');
  assert.equal(readEnv(brandRoot), ''); // no secret resolved, nothing written
  assert.equal(api.mutations().length, 0);
});

test('analytics: interactive acknowledgement — Enter-gated open, retry poll lands the secret in ONE run', async () => {
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

  const browser = stubBrowser(() => { acked = true; });
  const tty = openTtyPrompt();
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  try {
    const run = runService(brandConfig({ targets: { web: {} }, metaDisabled: true }), {
      analytics: api, brandRoot,
      });

    await tty.answer('Press Enter to open the data-collection acknowledgement page', '\r');
    await tty.answer('(enter)=check now, (s)=skip', '\r');
    const result = await run;

    assert.match(readEnv(brandRoot), /GOOGLE_ANALYTICS_SECRET_WEB="freshcleansecret"/);
    assert.equal(result.status, 'success', 'the acknowledged run finishes green — no rerun needed');
    assert.match(browser.opened[0], /analytics\.google\.com/);
  } finally {
    browser.restore();
    tty.close();
  }
});

test('analytics: firebase-link derives the project from cloud.config — its ONE home (#23)', async () => {
  const config = brandConfig({ targets: { web: {} } });
  // BOTH halves come from cloud.config now: the id, and the project NUMBER
  // the link may reference instead (#434 moved it off state)
  config.cloud = { provider: 'firebase', config: { projectId: PROJECT, ...FIREBASE_SDK_CONFIG } };

  const api = fakeAnalytics(convergedResponses());
  const result = await runService(config, { analytics: api });

  assert.equal(result.status, 'success');
  assert.ok(api.callsTo('listFirebaseLinks').length > 0, 'the link op ran instead of skipping on a missing cloud.config.projectId');
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
  });

  const deletes = api.callsTo('deleteFirebaseLink');
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].args, ['777', 'fl9']);
  const creates = api.callsTo('createFirebaseLink');
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].args, [PROPERTY, PROJECT]);
  assert.equal(result.output.firebaseLink.linked, true);
});

// #662: the delete and the create are ONE walk's work. GA holds a
// just-deleted link for a moment and answers the create with a precondition
// failure — the run waits that out (skip allowed) instead of owing a rerun.
test('analytics: the create waits out GA\'s hold on the just-deleted link and links in the SAME walk (#662)', async () => {
  let attempts = 0;
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listFirebaseLinks: (propertyId) => (propertyId === '777'
      ? [{ name: 'properties/777/firebaseLinks/fl9', project: `projects/${PROJECT_NUMBER}` }]
      : []),
    listAccounts: [{ name: `accounts/${ACCOUNT}`, displayName: 'Fixture Account' }],
    listProperties: [{ name: 'properties/777', displayName: 'Wrong Property' }],
    deleteFirebaseLink: { deleted: true },
    createFirebaseLink: () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('HTTP 400: Precondition check failed.');
      }
      return { name: `properties/${PROPERTY}/firebaseLinks/fl2` };
    },
  });

  const tty = openTtyPrompt();
  try {
    const run = runService(brandConfig({ targets: { web: {} }, metaDisabled: true }), { analytics: api });

    await tty.answer('(enter)=check now, (s)=skip', '\r');
    const result = await run;

    assert.equal(result.status, 'success', 'the link landed in this walk — nothing owed to a rerun');
    assert.equal(result.output.firebaseLink.linked, true);
    assert.equal(api.callsTo('createFirebaseLink').length, 3, 'the create was retried on a later tick, not abandoned');
  } finally {
    tty.close();
  }
});

test('analytics: skipping the link wait warns with the reason the summary prints (#662)', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listFirebaseLinks: (propertyId) => (propertyId === '777'
      ? [{ name: 'properties/777/firebaseLinks/fl9', project: `projects/${PROJECT_NUMBER}` }]
      : []),
    listAccounts: [{ name: `accounts/${ACCOUNT}`, displayName: 'Fixture Account' }],
    listProperties: [{ name: 'properties/777', displayName: 'Wrong Property' }],
    deleteFirebaseLink: { deleted: true },
    createFirebaseLink: () => {
      throw new Error('HTTP 400: Precondition check failed.');
    },
  });

  const tty = openTtyPrompt();
  try {
    const run = runService(brandConfig({ targets: { web: {} }, metaDisabled: true }), { analytics: api });

    await tty.answer('(enter)=check now, (s)=skip', 's');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.deepEqual(result.warned, [{ operation: 'google-firebase-link', reason: 'the Firebase link is not ready yet — rerun in a minute' }]);
  } finally {
    tty.close();
  }
});

test('analytics: a property linked to a DIFFERENT firebase project warns (not ours to break)', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    listDataStreams: [WEB_STREAM, FIREBASE_STREAM],
    listFirebaseLinks: [{ name: `properties/${PROPERTY}/firebaseLinks/fl3`, project: 'projects/someone-elses-project' }],
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), {
    analytics: api,
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
  });

  const updates = api.callsTo('updateDataStream');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].args[2], {
    displayName: 'Fixture Brand - Firebase',
    webStreamData: { defaultUri: `https://${PROJECT}.firebaseapp.com` },
  });
  assert.deepEqual(updates[0].args[3], ['displayName', 'webStreamData.defaultUri']);
  assert.equal(result.output.firebaseLink.streamUpdated.updated, true);
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

test('analytics: interactive paste-in walks to the token page (Enter-gated) and saves it to the brand .env', async () => {
  const jetpack = require('fs-jetpack');
  const brandRoot = makeBrandRoot('{}');
  const browser = stubBrowser();
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig({ google: false, metaId: 'PIXEL123' }), { brandRoot });
    // The check path opens the same three-outcome gate as everything else (#608)
    await tty.answer('Set up now?', '\r');
    await tty.answer('Press Enter to open the Meta Pixel access token page', '\r');
    await tty.answer('Paste META_ACCESS_TOKEN:', 'pasted-meta-token\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.output.meta.tokenConfigured, true);
    assert.deepEqual(browser.opened, ['https://business.facebook.com/settings/system-users'], 'Enter opened the page — never auto-opened');
    assert.match(jetpack.read(`${brandRoot}/.env`), /^META_ACCESS_TOKEN="pasted-meta-token"$/m);
    assert.equal(process.env.META_ACCESS_TOKEN, 'pasted-meta-token');
  } finally {
    browser.restore();
    tty.close();
    delete process.env.META_ACCESS_TOKEN;
  }
});

test('analytics: an empty paste-in keeps the warned guidance and writes nothing', async () => {
  const jetpack = require('fs-jetpack');
  const brandRoot = makeBrandRoot('{}');
  const browser = stubBrowser();
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig({ google: false, metaId: 'PIXEL123' }), { brandRoot });
    await tty.answer('Set up now?', '\r');
    await tty.answer('Press Enter to open the Meta Pixel access token page', '\r');
    await tty.answer('Paste META_ACCESS_TOKEN:', '\r');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.equal(result.output.meta.tokenConfigured, false);
    assert.equal(jetpack.exists(`${brandRoot}/.env`), false);
    assert.equal(process.env.META_ACCESS_TOKEN, undefined);
  } finally {
    browser.restore();
    tty.close();
  }
});

// ─── Pixel provisioning (#417) ───────────────────────────────────────────────
// Meta is LIVE; TikTok rides the SAME flow but no brand carries its token
// yet, so every real run of the TikTok half ends at the warned guidance.

const PIXEL_METHODS = ['listAdAccounts', 'listPixels', 'createPixel'];

/**
 * Recording fake pixel client — meta and tiktok share the normalized
 * { id, name } surface, so one fake serves both. An unconfigured method
 * throws, which is how the converged tests prove nothing was called.
 */
function fakePixelApi(responses = {}) {
  const api = { calls: [] };

  for (const method of PIXEL_METHODS) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakePixelApi: no response configured for ${method}(${JSON.stringify(args)})`);
      }
      const value = responses[method];
      return typeof value === 'function' ? await value(...args) : structuredClone(value);
    };
  }

  api.callsTo = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

test('analytics: a configured pixel id is converged proof — the platform API is never called', async () => {
  const meta = fakePixelApi(); // any call throws

  const result = await runService(
    brandConfig({ google: false, metaId: 'PIXEL123', metaAccount: '1234567890' }),
    { meta, metaToken: 'meta-token' },
  );

  assert.equal(result.status, 'success');
  assert.equal(meta.calls.length, 0);
  assert.equal(result.output.meta.pixelId, 'PIXEL123');
});

test('analytics: the brand pixel is matched BY NAME before any create, and the id lands in omega.json5', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const meta = fakePixelApi({
    listPixels: [{ id: 'PX-SOMEONE-ELSE', name: 'Another Brand' }, { id: 'PX-EXISTING', name: 'Fixture Brand' }],
  });

  const result = await runService(
    brandConfig({ google: false, metaAccount: '1234567890' }),
    { meta, metaToken: 'meta-token', brandRoot },
  );

  assert.deepEqual(meta.callsTo('listPixels')[0].args, ['1234567890']);
  assert.equal(meta.callsTo('createPixel').length, 0, 'a matching pixel is never re-created');
  assert.ok(readConfigSource(brandRoot).includes('id: "PX-EXISTING"'));
  assert.equal(result.status, 'success');
  assert.equal(result.output.meta.pixelId, 'PX-EXISTING', 'the token check sees the id landed this pass');
  assert.equal(result.output.meta.tokenConfigured, true);
});

test('analytics: a missing Meta Pixel is created on the ad account and written back', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const meta = fakePixelApi({
    listPixels: [],
    createPixel: (accountId, name) => ({ id: 'PX-NEW', name }),
  });

  const result = await runService(
    brandConfig({ google: false, metaAccount: '1234567890' }),
    { meta, metaToken: 'meta-token', brandRoot },
  );

  assert.deepEqual(meta.callsTo('createPixel')[0].args, ['1234567890', 'Fixture Brand']);
  assert.ok(readConfigSource(brandRoot).includes('id: "PX-NEW"'));
  assert.equal(result.output.meta.pixelId, 'PX-NEW');
  assert.equal(result.status, 'success');
});

test('analytics: no META_ACCESS_TOKEN — the create is skipped with guidance, never attempted', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const before = readConfigSource(brandRoot);
  const meta = fakePixelApi(); // any call throws

  const result = await runService(
    brandConfig({ google: false, metaAccount: '1234567890' }),
    { meta, brandRoot }, // token deliberately missing — the state every brand is in today
  );

  assert.equal(result.status, 'warned');
  assert.equal(meta.calls.length, 0, 'no token, no call');
  assert.equal(result.output.meta.pixelId, null);
  assert.equal(result.output.meta.tokenConfigured, false);
  assert.equal(readConfigSource(brandRoot), before, 'nothing lands in config');
});

test('analytics: dry-run plans the pixel create and writes nothing', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const before = readConfigSource(brandRoot);
  const meta = fakePixelApi({ listPixels: [] }); // createPixel would throw

  const result = await runService(
    brandConfig({ google: false, metaAccount: '1234567890' }),
    { meta, metaToken: 'meta-token', brandRoot, options: { dryRun: true } },
  );

  assert.equal(meta.callsTo('createPixel').length, 0);
  assert.deepEqual(result.output.meta, { planned: 'create', name: 'Fixture Brand' });
  assert.equal(readConfigSource(brandRoot), before);
});

test('analytics: the TikTok half rides the same flow — advertiser id + token creates and lands the code', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const tiktok = fakePixelApi({
    listPixels: [],
    createPixel: (advertiserId, name) => ({ id: 'TT-NEW', name }),
  });

  const result = await runService(
    brandConfig({ google: false, tiktokAccount: '7000000000000000001' }),
    { tiktok, tiktokToken: 'tiktok-token', brandRoot },
  );

  assert.deepEqual(tiktok.callsTo('createPixel')[0].args, ['7000000000000000001', 'Fixture Brand']);
  assert.ok(readConfigSource(brandRoot).includes('id: "TT-NEW"'));
  assert.equal(result.output.tiktok.pixelId, 'TT-NEW');
});

test('analytics: without TIKTOK_ACCESS_TOKEN the TikTok half stays inert — warned, zero calls', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const before = readConfigSource(brandRoot);
  const tiktok = fakePixelApi(); // any call throws — the scaffold must not reach the API

  const result = await runService(
    brandConfig({ google: false, tiktokAccount: '7000000000000000001' }),
    { tiktok, brandRoot },
  );

  assert.equal(result.status, 'warned');
  assert.equal(tiktok.calls.length, 0);
  assert.equal(result.output.tiktok.tokenConfigured, false);
  assert.equal(readConfigSource(brandRoot), before);
});

test('analytics: an accountId with no id is enough to run the service (the provisioning gate)', async () => {
  const skipped = await runService(brandConfig({ google: false }));
  assert.equal(skipped.status, 'skipped');

  const meta = fakePixelApi({ listPixels: [], createPixel: { id: 'PX-NEW', name: 'Fixture Brand' } });
  const result = await runService(brandConfig({ google: false, metaAccount: '1234567890' }), {
    meta,
    metaToken: 'meta-token',
  });

  assert.notEqual(result.status, 'skipped', 'a configurable-but-uncreated pixel is work');
});

// ─── Near-zero-input Meta pass (#417, Ian 2026-08-21) ────────────────────────
// The GA4 half's standard applied to the pixel: the run acquires what it
// needs instead of demanding it in config first — the token via the
// Enter-gated walk to the page that mints it, the ad account from the token
// itself. `providers.meta: false` is the off switch for all of it.

const AD_ACCOUNT = { id: '1234567890', name: 'Fixture Brand Ads' };
const SYSTEM_USERS_URL = 'https://business.facebook.com/settings/system-users';
const DOWN = '\x1B[B'; // arrow-down escape for select() answers

test('analytics: ONE interactive pass — gate, token paste-in, account discovery, pixel create', async () => {
  const jetpack = require('fs-jetpack');
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const meta = fakePixelApi({
    listAdAccounts: [AD_ACCOUNT],
    listPixels: [],
    createPixel: (accountId, name) => ({ id: 'PX-NEW', name }),
  });
  const browser = stubBrowser();
  const tty = openTtyPrompt();

  try {
    // Nothing configured and no token — the state every brand starts in
    const run = runService(brandConfig({ google: false }), { meta, brandRoot });
    await tty.answer('Set up now?', '\r');
    await tty.answer('Press Enter to open the Meta Pixel access token page', '\r');
    await tty.answer('Paste META_ACCESS_TOKEN:', 'pasted-meta-token\r');
    const result = await run;

    assert.deepEqual(browser.opened, [SYSTEM_USERS_URL]);
    assert.equal(meta.callsTo('listAdAccounts').length, 1, 'the token pasted this pass is what discovery runs on');
    assert.deepEqual(meta.callsTo('createPixel')[0].args, [AD_ACCOUNT.id, 'Fixture Brand']);

    const written = readConfigSource(brandRoot);
    assert.ok(written.includes(`accountId: "${AD_ACCOUNT.id}"`), 'the discovered ad account lands in config');
    assert.ok(written.includes('id: "PX-NEW"'));
    assert.ok(written.includes('// Fixture Brand — analytics writeback target'), 'comments survive');
    assert.match(jetpack.read(`${brandRoot}/.env`), /^META_ACCESS_TOKEN="pasted-meta-token"$/m);
    assert.equal(result.status, 'success');
    assert.equal(result.output.meta.pixelId, 'PX-NEW', 'the token check reports the pixel this pass made');
    assert.equal(result.output.meta.tokenConfigured, true);
  } finally {
    browser.restore();
    tty.close();
    delete process.env.META_ACCESS_TOKEN;
  }
});

test('analytics: the setup gate\'s Disable writes providers.meta: false instead of asking again', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const meta = fakePixelApi(); // any call throws
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig({ google: false }), { meta, brandRoot });
    await tty.answer('Set up now?', `${DOWN}${DOWN}\r`); // Disable (stop prompting)
    const result = await run;

    assert.equal(meta.calls.length, 0);
    assert.match(readConfigSource(brandRoot), /meta: false/);
    assert.equal(result.status, 'success', 'opting out is not a warning');
  } finally {
    tty.close();
  }
});

test('analytics: providers.meta = false disables the provider — no calls, no prompts, no warn', { timeout: 10000 }, async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const before = readConfigSource(brandRoot);
  const meta = fakePixelApi(); // any call throws
  const tty = openTtyPrompt(); // interactive: an ignored opt-out would prompt (and time this test out)
  const log = captureLog();

  let result;
  try {
    result = await runService(
      brandConfig({ google: false, metaDisabled: true, tiktokId: 'TT456' }),
      { meta, tiktokToken: 'tiktok-token', brandRoot },
    );
  } finally {
    log.restore();
    tty.close();
  }

  assert.equal(meta.calls.length, 0);
  assert.equal(result.output.meta, undefined, 'a disabled provider reports nothing');
  assert.equal(result.status, 'success');
  assert.equal(readConfigSource(brandRoot), before);
  assert.ok(
    log.lines.some((line) => line.includes('Meta Pixel disabled (analytics.providers.meta: false)')),
    'the opt-out is reported as disabled, not as unconfigured',
  );
});

test('analytics: a token seeing exactly one ad account auto-selects it — and the rerun is a byte-identical no-op', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const meta = fakePixelApi({
    listAdAccounts: [AD_ACCOUNT],
    listPixels: [],
    createPixel: (accountId, name) => ({ id: 'PX-NEW', name }),
  });

  // No TTY: the token alone is enough — nothing to ask when there's one answer
  const first = await runService(brandConfig({ google: false }), { meta, metaToken: 'meta-token', brandRoot });
  const landed = readConfigSource(brandRoot);

  assert.equal(first.status, 'success');
  assert.ok(landed.includes(`accountId: "${AD_ACCOUNT.id}"`));
  assert.ok(landed.includes('id: "PX-NEW"'));

  // The rerun reads the landed config back — converged means zero calls
  const rerun = fakePixelApi(); // any call throws
  const second = await runService(
    brandConfig({ google: false, metaId: 'PX-NEW', metaAccount: AD_ACCOUNT.id }),
    { meta: rerun, metaToken: 'meta-token', brandRoot },
  );

  assert.equal(rerun.calls.length, 0);
  assert.equal(readConfigSource(brandRoot), landed, 'converged rerun writes nothing');
  assert.equal(second.status, 'success');
});

test('analytics: several visible ad accounts without a TTY list the candidates and create nothing', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const before = readConfigSource(brandRoot);
  const meta = fakePixelApi({
    listAdAccounts: [AD_ACCOUNT, { id: '9999999999', name: 'Second Account' }],
  }); // listPixels/createPixel would throw

  const log = captureLog();
  let result;
  try {
    result = await runService(brandConfig({ google: false }), { meta, metaToken: 'meta-token', brandRoot });
  } finally {
    log.restore();
  }

  assert.equal(result.status, 'warned');
  assert.equal(meta.callsTo('listPixels').length, 0, 'no account, no create');
  assert.ok(log.lines.some((line) => line.includes('2 ad accounts visible')));
  assert.ok(log.lines.some((line) => line.includes('Second Account')));
  assert.equal(readConfigSource(brandRoot), before);
});

test('analytics: several visible ad accounts in a TTY are a pick — the choice lands in config', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const meta = fakePixelApi({
    listAdAccounts: [{ id: '9999999999', name: 'Second Account' }, AD_ACCOUNT],
    listPixels: [{ id: 'PX-EXISTING', name: 'Fixture Brand' }],
  });
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig({ google: false }), { meta, metaToken: 'meta-token', brandRoot });
    await tty.answer('Set up now?', '\r'); // the token is already in hand — the gate still asks permission
    // The brand match ("Fixture Brand Ads") sorts to the cursor
    await tty.answer('Select the ad account for Meta Pixel:', '\r');
    const result = await run;

    assert.deepEqual(meta.callsTo('listPixels')[0].args, [AD_ACCOUNT.id]);
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes(`accountId: "${AD_ACCOUNT.id}"`));
    assert.ok(written.includes('id: "PX-EXISTING"'));
    assert.equal(result.status, 'success');
  } finally {
    tty.close();
  }
});

test('analytics: a token that sees no ad accounts warns with the fix, and creates nothing', async () => {
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const before = readConfigSource(brandRoot);
  const meta = fakePixelApi({ listAdAccounts: [] });

  const log = captureLog();
  let result;
  try {
    result = await runService(brandConfig({ google: false }), { meta, metaToken: 'meta-token', brandRoot });
  } finally {
    log.restore();
  }

  assert.equal(result.status, 'warned');
  assert.equal(meta.callsTo('listPixels').length, 0);
  assert.ok(log.lines.some((line) => line.includes('No ad accounts are visible to META_ACCESS_TOKEN')));
  assert.ok(log.lines.some((line) => line.includes('Add assets')));
  assert.equal(readConfigSource(brandRoot), before);
});

test('analytics: without a token and without a TTY, an unconfigured Meta half is silent (the service skips)', async () => {
  const result = await runService(brandConfig({ google: false }), { meta: fakePixelApi() });

  assert.equal(result.status, 'skipped', 'nothing configured, nothing to ask with — no nagging in CI');
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

test('setup: interactive run lands account + property in omega.json5 and the google ops run in the same pass', async () => {
  const api = fakeAnalytics({
    ...convergedResponses(),
    listAccounts: [{ name: `accounts/${ACCOUNT}`, displayName: 'Fixture Account' }],
    listProperties: [{ name: `properties/${PROPERTY}`, displayName: 'Fixture Brand' }],
  });
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig({ google: false, metaDisabled: true }), { analytics: api, brandRoot });
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
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
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

// ─── Company-default GA account (cp257) ──────────────────────────────────────
// A company-managed brand inherits `analytics.providers.google.accountId`
// through the merge chain (company layer under the brand file). The flow says
// so with a dim note instead of prompting; an explicit brand value wins in
// the merge and gets no note; the picker stays the fallback.

/** Capture console.log lines around a flow run (prompt I/O bypasses console). */
function captureLog() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.log = original; } };
}

const COMPANY_NOTE = 'defaulting to company account';

test('property-flow: company-inherited account resolves with the company-default note, no prompt', async () => {
  const api = { listAccounts: async () => { throw new Error('must not list accounts — the company default resolves it'); } };
  const context = {
    brandId: 'fixture-brand',
    brandRoot: '/tmp/omega-manager-analytics-unused', // nothing lands — both values exist
    options: {}, // non-interactive on purpose: the company default needs no prompt
    brandConfig: {
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: `https://${DOMAIN}` },
      // The merged view a company-managed brand sees: the company accountId
      // arrived through the merge chain
      analytics: { providers: { google: { accountId: ACCOUNT, propertyId: PROPERTY } } },
    },
    companyConfig: { analytics: { providers: { google: { accountId: ACCOUNT } } } },
  };

  const log = captureLog();
  let propertyId;
  try {
    propertyId = await resolveGoogleProperty(context, api);
  } finally {
    log.restore();
  }

  assert.equal(propertyId, PROPERTY);
  assert.ok(log.lines.some((line) => line.includes(`Google Analytics account ${ACCOUNT}`) && line.includes(COMPANY_NOTE)));
});

test('property-flow: explicit brand accountId beats the company default — no company note', async () => {
  const api = { listAccounts: async () => { throw new Error('must not list accounts'); } };
  const context = {
    brandId: 'fixture-brand',
    brandRoot: '/tmp/omega-manager-analytics-unused',
    options: {},
    brandConfig: {
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: `https://${DOMAIN}` },
      // Brand file set its own account — the merge already made it win
      analytics: { providers: { google: { accountId: '424242', propertyId: PROPERTY } } },
    },
    companyConfig: { analytics: { providers: { google: { accountId: ACCOUNT } } } },
  };

  const log = captureLog();
  let propertyId;
  try {
    propertyId = await resolveGoogleProperty(context, api);
  } finally {
    log.restore();
  }

  assert.equal(propertyId, PROPERTY);
  assert.ok(!log.lines.some((line) => line.includes(COMPANY_NOTE)));
});

test('property-flow: company layer without an accountId → interactive picker fallback', async () => {
  const api = {
    listAccounts: async () => [{ name: `accounts/${ACCOUNT}`, displayName: 'Fixture Account' }],
    listProperties: async () => [{ name: `properties/${PROPERTY}`, displayName: 'Fixture Brand' }],
  };
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);
  const context = {
    brandId: 'fixture-brand',
    brandRoot,
    options: {},
    brandConfig: {
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: `https://${DOMAIN}` },
      analytics: { providers: { google: {} } },
    },
    companyConfig: { brand: { name: 'Fixture Co' } }, // company exists, no GA default
  };
  const tty = openTtyPrompt();

  try {
    const run = resolveGoogleProperty(context, api);
    await tty.answer('Set up now?', '\r');
    await tty.answer('Select Google Analytics account:', '\r');
    await tty.answer('Select GA4 property:', '\r'); // account flow's Yes gates the pair
    const propertyId = await run;

    assert.equal(propertyId, PROPERTY);
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes(`accountId: "${ACCOUNT}"`));
    assert.ok(written.includes(`propertyId: "${PROPERTY}"`));
  } finally {
    tty.close();
  }
});

// ─── Pixel API clients (#417) ────────────────────────────────────────────────
// The clients are the ONLY place the platform request shapes live. Meta's is
// proven against the live Marketing API; TikTok's is the SCAFFOLD half —
// pinning it here is what makes the flip a token, not a rewrite.

/** Record every fetch and answer with a canned response. */
function stubFetch(response) {
  const original = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: response.ok !== false,
      status: response.status || 200,
      text: async () => JSON.stringify(response.body),
    };
  };

  return { calls, restore: () => { global.fetch = original; } };
}

test('meta-api: pixels are listed and created on the ad account edge with the system-user token', async () => {
  const list = stubFetch({ body: { data: [{ id: 'PX1', name: 'Fixture Brand' }] } });
  let created;
  try {
    const api = new MetaMarketingAPI({ accessToken: 'sys-user-token' });
    assert.deepEqual(await api.listPixels('1234567890'), [{ id: 'PX1', name: 'Fixture Brand' }]);

    assert.match(list.calls[0].url, /^https:\/\/graph\.facebook\.com\/v21\.0\/act_1234567890\/adspixels\?fields=id,name/);
    assert.equal(list.calls[0].options.headers.Authorization, 'Bearer sys-user-token');

    created = stubFetch({ body: { id: 'PX-NEW' } });
    assert.deepEqual(await api.createPixel('act_1234567890', 'Fixture Brand'), { id: 'PX-NEW', name: 'Fixture Brand' });
    assert.equal(created.calls[0].url, 'https://graph.facebook.com/v21.0/act_1234567890/adspixels', 'an act_-prefixed id is not double-prefixed');
    assert.equal(created.calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(created.calls[0].options.body), { name: 'Fixture Brand' });
  } finally {
    created?.restore(); // restores the list stub…
    list.restore();     // …which restores the real fetch
  }
});

test('meta-api: ad accounts come back with the BARE id config carries, not the act_ ref', async () => {
  const stub = stubFetch({
    body: { data: [{ id: 'act_1234567890', account_id: '1234567890', name: 'Fixture Brand Ads' }] },
  });
  try {
    const api = new MetaMarketingAPI({ accessToken: 'sys-user-token' });
    assert.deepEqual(await api.listAdAccounts(), [{ id: '1234567890', name: 'Fixture Brand Ads' }]);
    assert.equal(stub.calls[0].url, 'https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_id&limit=100');
    assert.equal(stub.calls[0].options.headers.Authorization, 'Bearer sys-user-token');
  } finally {
    stub.restore();
  }
});

test('meta-api: a client built BEFORE the paste-in still authenticates (the env is read per request)', async () => {
  const api = new MetaMarketingAPI(); // built while META_ACCESS_TOKEN is unset
  const stub = stubFetch({ body: { data: [] } });
  process.env.META_ACCESS_TOKEN = 'pasted-this-run';
  try {
    await api.listAdAccounts();
    assert.equal(stub.calls[0].options.headers.Authorization, 'Bearer pasted-this-run');
  } finally {
    stub.restore();
    delete process.env.META_ACCESS_TOKEN;
  }
});

test('meta-api: a Graph error surfaces its own message', async () => {
  const stub = stubFetch({ ok: false, status: 400, body: { error: { message: '(#200) Requires ads_management permission' } } });
  try {
    await assert.rejects(
      new MetaMarketingAPI({ accessToken: 't' }).listPixels('1'),
      /Meta API error \(400\): \(#200\) Requires ads_management permission/,
    );
  } finally {
    stub.restore();
  }
});

test('tiktok-api: the v1.3 pixel endpoints speak advertiser_id + the Access-Token header', async () => {
  const list = stubFetch({ body: { code: 0, data: { pixels: [{ pixel_code: 'TT1', pixel_name: 'Fixture Brand' }] } } });
  let created;
  try {
    const api = new TikTokBusinessAPI({ accessToken: 'tt-token' });
    assert.deepEqual(await api.listPixels('7000000000000000001'), [{ id: 'TT1', name: 'Fixture Brand' }]);
    assert.equal(list.calls[0].url, 'https://business-api.tiktok.com/open_api/v1.3/pixel/list/?advertiser_id=7000000000000000001');
    assert.equal(list.calls[0].options.headers['Access-Token'], 'tt-token');

    created = stubFetch({ body: { code: 0, data: { pixel_code: 'TT-NEW', pixel_name: 'Fixture Brand' } } });
    assert.deepEqual(await api.createPixel('7000000000000000001', 'Fixture Brand'), { id: 'TT-NEW', name: 'Fixture Brand' });
    assert.equal(created.calls[0].url, 'https://business-api.tiktok.com/open_api/v1.3/pixel/create/');
    assert.deepEqual(JSON.parse(created.calls[0].options.body), {
      advertiser_id: '7000000000000000001',
      pixel_name: 'Fixture Brand',
      pixel_mode: 'STANDARD_MODE',
    });
  } finally {
    created?.restore(); // restores the list stub…
    list.restore();     // …which restores the real fetch
  }
});

test('tiktok-api: a 200 carrying a non-zero code is an error, not a success', async () => {
  const stub = stubFetch({ body: { code: 40002, message: 'Advertiser not authorized' } });
  try {
    await assert.rejects(
      new TikTokBusinessAPI({ accessToken: 't' }).listPixels('1'),
      /TikTok API error \(40002\): Advertiser not authorized/,
    );
  } finally {
    stub.restore();
  }
});
