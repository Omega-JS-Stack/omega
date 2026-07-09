/**
 * Beehiiv service tests — all 4 operations against a method-level recording
 * fake. Proves skip semantics, the converged zero-mutation no-op,
 * publication resolution (config/state verify, auto-match by name, the
 * manual-creation warn — publications have no create API), SSOT-driven
 * custom-field reconciliation diffed by display, the verify-only segments
 * operation (Beehiiv has no segment-create API — it can never mutate), the
 * min-diff webhook patch, and the dry-run zero-mutation guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const { fieldsFor, segmentsFor } = require('../src/lib/bem-marketing.js');
const service = require('../src/services/beehiiv/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.BEEHIIV_API_KEY;
delete process.env.BACKEND_MANAGER_WEBHOOK_KEY;

const DOMAIN = 'fixture-brand.test';
const BRAND_NAME = 'Fixture Brand';
const PUB_ID = 'pub_fixture123';
const WEBHOOK_KEY = 'fixture-webhook-key';
const WEBHOOK_URL = `https://api.${DOMAIN}/backend-manager/marketing/webhook/forward?provider=beehiiv&key=${WEBHOOK_KEY}`;
const WEBHOOK_DESCRIPTION = 'BEM consent pipeline (managed by OMEGA — do not edit manually)';
const EVENT_TYPES = ['subscription.unsubscribed', 'subscription.deleted', 'subscription.paused'];

const BEEHIIV_FIELDS = fieldsFor('beehiiv');
const BEEHIIV_SEGMENTS = segmentsFor('beehiiv');
const KIND_MAP = { text: 'string', number: 'integer', date: 'datetime' };

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ url = `https://${DOMAIN}`, parent = 'self', publicationId = null, newsletter = {} } = {}) {
  return {
    brand: { id: 'fixture-brand', name: BRAND_NAME, url, description: 'A fixture brand' },
    parent,
    marketing: { newsletter: { ...structuredClone(DEFAULTS.marketing.newsletter), publicationId, ...newsletter } },
    targets: { web: {} },
  };
}

const READ_METHODS = ['getPublication', 'listPublications', 'getCustomFields', 'getSegments', 'listWebhooks'];
const MUTATING_METHODS = ['createCustomField', 'deleteCustomField', 'createWebhook', 'updateWebhook'];

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeBeehiiv(responses = {}) {
  const api = { calls: [] };

  for (const method of [...READ_METHODS, ...MUTATING_METHODS]) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeBeehiiv: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  api.mutations = () => api.calls.filter((c) => MUTATING_METHODS.includes(c.method));
  api.callsTo = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

/** Everything already matches — the whole service should be reads only. */
function convergedResponses() {
  return {
    getPublication: { id: PUB_ID, name: BRAND_NAME },
    getCustomFields: BEEHIIV_FIELDS.map((f, i) => ({ id: `bf${i}`, name: f.name, display: f.display, kind: KIND_MAP[f.type] })),
    getSegments: BEEHIIV_SEGMENTS.map((s, i) => ({ id: `bs${i}`, name: s.name })),
    listWebhooks: [{ id: 'wh_1', url: WEBHOOK_URL, event_types: [...EVENT_TYPES], description: WEBHOOK_DESCRIPTION, enabled: true }],
  };
}

const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');

// Writeback target — the publication op edits config/omega.json5 in the
// brand root; these comments must survive every service write.
const WRITEBACK_CONFIG = `// Fixture Brand — hand-edited writeback target
{
  brand: { id: 'fixture-brand', name: "Fixture Brand" },
  marketing: {
    newsletter: {
      enabled: true, // the resolved id lands next to this
    },
  },
}
`;

function runService(config, { beehiiv, options = {}, serviceData = {}, webhookKey = true, brandRoot } = {}) {
  if (webhookKey) {
    process.env.BACKEND_MANAGER_WEBHOOK_KEY = WEBHOOK_KEY;
  } else {
    delete process.env.BACKEND_MANAGER_WEBHOOK_KEY;
  }

  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || makeBrandRoot(WRITEBACK_CONFIG), // the publication op writes into config/omega.json5 here
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.beehiiv,
    options,
    serviceData,
    beehiivApi: beehiiv,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('beehiiv: skips without BEEHIIV_API_KEY in .env', async () => {
  const result = await runService(brandConfig()); // no injected api → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /BEEHIIV_API_KEY/);
});

test('beehiiv: marketing.newsletter.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ newsletter: { enabled: false } }), { beehiiv: fakeBeehiiv() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /marketing\.newsletter\.enabled/);
});

test('beehiiv: a different newsletter platform skips the service', async () => {
  const result = await runService(brandConfig({ newsletter: { platform: 'other' } }), { beehiiv: fakeBeehiiv() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /platform = 'other'/);
});

test('beehiiv: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { beehiiv: fakeBeehiiv() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

test('beehiiv: the newsletter defaults carry no company values', () => {
  assert.equal(DEFAULTS.marketing.newsletter.platform, 'beehiiv');
  assert.equal(DEFAULTS.marketing.newsletter.publicationId, null);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('beehiiv: fully converged brand is a zero-mutation no-op across all 4 operations', async () => {
  const api = fakeBeehiiv(convergedResponses());

  const result = await runService(brandConfig({ publicationId: PUB_ID }), { beehiiv: api });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.state.publicationId, PUB_ID);
  assert.equal(result.output.customFields.created, 0);
  assert.deepEqual(result.output.segments.missing, []);
  assert.equal(result.output.webhook.url, 'converged');
});

// ─── publication ─────────────────────────────────────────────────────────────

test('beehiiv: an inaccessible configured publication warns and gates the downstream operations', async () => {
  const api = fakeBeehiiv({
    ...convergedResponses(),
    getPublication: () => null,
  });

  const result = await runService(brandConfig({ publicationId: 'pub_gone' }), { beehiiv: api });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.publication.accessible, false);
  // No publication in state → fields/segments/webhook have nothing to work on
  assert.equal(api.callsTo('getCustomFields').length, 0);
  assert.equal(api.callsTo('getSegments').length, 0);
  assert.equal(api.callsTo('listWebhooks').length, 0);
});

test('beehiiv: no configured id auto-matches a publication by brand name into state', async () => {
  const api = fakeBeehiiv({
    ...convergedResponses(),
    listPublications: [{ id: 'pub_other', name: 'Unrelated' }, { id: PUB_ID, name: 'Fixture Brand News' }],
  });

  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const result = await runService(brandConfig(), { beehiiv: api, brandRoot });

  assert.equal(result.status, 'success');
  assert.equal(result.state.publicationId, PUB_ID);
  assert.equal(api.callsTo('getPublication').length, 0); // nothing known to verify
  assert.deepEqual(api.mutations(), []);

  const written = readConfigSource(brandRoot);
  assert.ok(written.includes(`publicationId: "${PUB_ID}",`));
  assert.ok(written.includes('enabled: true, // the resolved id lands next to this'));
});

test('beehiiv: a state-known id is promoted into omega.json5 on verify', async () => {
  const api = fakeBeehiiv(convergedResponses());
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);

  const result = await runService(brandConfig(), { beehiiv: api, serviceData: { publicationId: PUB_ID }, brandRoot });

  assert.equal(result.state.publicationId, PUB_ID);
  assert.ok(readConfigSource(brandRoot).includes(`publicationId: "${PUB_ID}",`));
});

test('beehiiv: no matching publication warns with the values to copy into the dashboard', async () => {
  const api = fakeBeehiiv({
    ...convergedResponses(),
    listPublications: [{ id: 'pub_other', name: 'Unrelated' }],
  });

  const result = await runService(brandConfig(), { beehiiv: api });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.publication.missing, true);
  assert.equal(result.output.publication.suggestedName, BRAND_NAME);
});

// ─── custom-fields ───────────────────────────────────────────────────────────

test('beehiiv: missing and kind-mismatched fields are created/recreated, diffed by display', async () => {
  const converged = convergedResponses().getCustomFields;
  const initial = converged.slice(1); // first field missing
  initial[0] = { ...initial[0], kind: initial[0].kind === 'string' ? 'integer' : 'string' }; // second mismatched

  let reads = 0;
  const api = fakeBeehiiv({
    ...convergedResponses(),
    getCustomFields: () => (reads += 1) === 1 ? structuredClone(initial) : structuredClone(converged),
    deleteCustomField: null,
    createCustomField: { id: 'bf_new' },
  });

  const result = await runService(brandConfig({ publicationId: PUB_ID }), { beehiiv: api });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('deleteCustomField')[0].args, [PUB_ID, initial[0].id]);
  assert.equal(api.callsTo('createCustomField').length, 2);
  // Exact creation payload: (publicationId, name, display, kind)
  const missingField = BEEHIIV_FIELDS[0];
  assert.deepEqual(api.callsTo('createCustomField')[0].args, [PUB_ID, missingField.name, missingField.display, KIND_MAP[missingField.type]]);
  assert.equal(result.output.customFields.created, 1);
  assert.equal(result.output.customFields.recreated, 1);
});

// ─── segments (verify-only — no create API) ──────────────────────────────────

test('beehiiv: missing segments warn with instructions and NEVER mutate', async () => {
  const list = convergedResponses().getSegments;
  const api = fakeBeehiiv({
    ...convergedResponses(),
    getSegments: list.slice(2), // first two missing
  });

  const result = await runService(brandConfig({ publicationId: PUB_ID }), { beehiiv: api });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.segments.missing, [BEEHIIV_SEGMENTS[0].name, BEEHIIV_SEGMENTS[1].name]);
  // The Beehiiv API has no segment writes — nothing to call even when drifted
  assert.deepEqual(api.mutations(), []);
});

// ─── webhook ─────────────────────────────────────────────────────────────────

test('beehiiv: webhook drift is patched with the minimum diff (matched by managed description)', async () => {
  const api = fakeBeehiiv({
    ...convergedResponses(),
    listWebhooks: [{ id: 'wh_1', url: 'https://api.old-parent.test/hook', event_types: ['subscription.unsubscribed'], description: WEBHOOK_DESCRIPTION, enabled: true }],
    updateWebhook: {},
  });

  const result = await runService(brandConfig({ publicationId: PUB_ID }), { beehiiv: api });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('updateWebhook')[0].args, [PUB_ID, 'wh_1', { url: WEBHOOK_URL, event_types: EVENT_TYPES }]);
});

test('beehiiv: no webhook yet → created with the exact consent-pipeline payload', async () => {
  const api = fakeBeehiiv({
    ...convergedResponses(),
    listWebhooks: [],
    createWebhook: { data: { id: 'wh_new' } },
  });

  const result = await runService(brandConfig({ publicationId: PUB_ID, parent: 'https://parent-brand.test' }), { beehiiv: api });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('createWebhook')[0].args, [PUB_ID, {
    url: `https://api.parent-brand.test/backend-manager/marketing/webhook/forward?provider=beehiiv&key=${WEBHOOK_KEY}`,
    event_types: EVENT_TYPES,
    description: WEBHOOK_DESCRIPTION,
  }]);
  assert.equal(result.output.webhook.created, true);
});

test('beehiiv: missing BACKEND_MANAGER_WEBHOOK_KEY warns', async () => {
  const api = fakeBeehiiv(convergedResponses());

  const result = await runService(brandConfig({ publicationId: PUB_ID }), { beehiiv: api, webhookKey: false });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.webhook.missingWebhookKey, true);
  assert.equal(api.callsTo('listWebhooks').length, 0);
});

test('beehiiv: no parent configured → nothing to point the webhook at', async () => {
  const api = fakeBeehiiv(convergedResponses());

  const result = await runService(brandConfig({ publicationId: PUB_ID, parent: null }), { beehiiv: api });

  assert.equal(result.status, 'success');
  assert.equal(api.callsTo('listWebhooks').length, 0);
  assert.equal(result.output.webhook, undefined);
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('beehiiv: dry-run on a fully drifted brand performs zero mutations', async () => {
  const api = fakeBeehiiv({
    ...convergedResponses(),
    getCustomFields: [],
    getSegments: [],
    listWebhooks: [],
  });

  const result = await runService(brandConfig({ publicationId: PUB_ID }), { beehiiv: api, options: { dryRun: true } });

  assert.deepEqual(api.mutations(), []);
  assert.equal(result.output.customFields.planned.create.length, BEEHIIV_FIELDS.length);
  assert.equal(result.output.segments.missing.length, BEEHIIV_SEGMENTS.length); // verify-only op: dry-run ≡ normal run
  assert.deepEqual(result.output.webhook.planned, ['create']);
});

// ─── Interactive create-publication flow (browser open + poll) ────────────────

const { setBrowserOpener } = require('@omegajs/devkit/flows');
const { openTtyPrompt } = require('./lib/interactive.js');

test('publication: interactive run opens the create page and polls until the new publication auto-matches', async () => {
  const api = fakeBeehiiv(convergedResponses());
  // First list: nothing matches; after the user "creates" it in the browser,
  // the poll's re-list finds it
  let listCalls = 0;
  api.listPublications = async () => {
    api.calls.push({ method: 'listPublications', args: [] });
    listCalls++;
    return listCalls === 1
      ? [{ id: 'pub_other', name: 'Unrelated' }]
      : [{ id: 'pub_other', name: 'Unrelated' }, { id: PUB_ID, name: 'Fixture Brand News' }];
  };
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig(), { beehiiv: api, brandRoot });
    await tty.answer('Open browser now?', '\r'); // yes (default)
    const result = await run;

    assert.equal(result.state.publicationId, PUB_ID);
    assert.deepEqual(opened, ['https://app.beehiiv.com/settings/workspace/overview?create_publication=true']);
    assert.equal(listCalls, 2); // initial match attempt + one poll check
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes(`publicationId: "${PUB_ID}",`));
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});
