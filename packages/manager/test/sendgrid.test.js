/**
 * SendGrid service tests — all 6 operations against method-level recording
 * fakes (SendGrid + Cloudflare). Proves skip semantics, the converged
 * zero-mutation no-op, the one-pass domain-auth flow (create → DNS diff-sync
 * → validate once), sender recreation + the de-ITW'd address requirement,
 * list resolution through config/state/name/create, SSOT-driven field and
 * segment reconciliation (type recreate, stale PATCH + fallback, __temp_
 * sweep), the min-diff event webhook, and the dry-run zero-mutation
 * guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const { fieldsFor, segmentsFor } = require('../src/lib/backend-marketing.js');
const { buildQueryDsl } = require('../src/services/sendgrid/lib/segment-query.js');
const service = require('../src/services/sendgrid/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.SENDGRID_API_KEY;
delete process.env.OMEGA_WEBHOOK_KEY;
delete process.env.CLOUDFLARE_TOKEN;

const DOMAIN = 'fixture-brand.test';
const BRAND_NAME = 'Fixture Brand';
const FROM_EMAIL = `offers@${DOMAIN}`;
const WEBHOOK_KEY = 'fixture-webhook-key';
const WEBHOOK_URL = `https://api.${DOMAIN}/omega/marketing/webhook/forward?provider=sendgrid&key=${WEBHOOK_KEY}`;

const SENDGRID_FIELDS = fieldsFor('sendgrid');
const SENDGRID_SEGMENTS = segmentsFor('sendgrid');
const TYPE_MAP = { text: 'Text', number: 'Number', date: 'Date' };

const ADDRESS = { line1: '123 Fixture St', line2: 'Unit 4', city: 'Testville', region: 'CA', postalCode: '00000', country: 'USA' };

const DNS_FIXTURE = {
  mail_cname: { type: 'cname', host: `emailauth.${DOMAIN}`, data: 'u123.wl001.sendgrid.net' },
  dkim1: { type: 'cname', host: `s1._domainkey.${DOMAIN}`, data: 's1.domainkey.u123.wl001.sendgrid.net' },
  dkim2: { type: 'cname', host: `s2._domainkey.${DOMAIN}`, data: 's2.domainkey.u123.wl001.sendgrid.net' },
};

const VALIDATION_OK = { validation_results: { mail_cname: { valid: true }, dkim1: { valid: true }, dkim2: { valid: true } } };
const VALIDATION_PENDING = { validation_results: { mail_cname: { valid: false }, dkim1: { valid: true }, dkim2: { valid: true } } };

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ url = `https://${DOMAIN}`, parent = 'self', address = ADDRESS, listId = null, campaigns = {} } = {}) {
  return {
    brand: {
      id: 'fixture-brand',
      name: BRAND_NAME,
      url,
      contact: { email: `support@${DOMAIN}` },
      ...(address ? { address } : {}),
    },
    parent,
    marketing: { campaigns: { ...structuredClone(DEFAULTS.marketing.campaigns), listId, ...campaigns } },
    targets: { web: {} },
  };
}

const READ_METHODS = [
  'getAuthenticatedDomains', 'getVerifiedSenders', 'getLists', 'getListByName',
  'getList', 'getCustomFields', 'getSegments', 'getSegment', 'getEventWebhookSettings',
];
const MUTATING_METHODS = [
  'authenticateDomain', 'validateDomain', 'createVerifiedSender', 'deleteVerifiedSender',
  'createList', 'createCustomField', 'deleteCustomField',
  'createSegment', 'updateSegment', 'deleteSegment', 'updateEventWebhookSettings',
];

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeSendgrid(responses = {}) {
  const api = { calls: [] };

  for (const method of [...READ_METHODS, ...MUTATING_METHODS]) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeSendgrid: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  api.mutations = () => api.calls.filter((c) => MUTATING_METHODS.includes(c.method));
  api.callsTo = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

/** Recording fake Cloudflare client (zone lookup + raw DNS record requests). */
function fakeCf({ zone = { id: 'zone-1', name: DOMAIN }, records = [] } = {}) {
  const api = { requests: [] };

  api.getZoneByName = async (name) => {
    api.requests.push({ method: 'getZoneByName', name });
    return zone ? structuredClone(zone) : null;
  };

  api.makeRequest = async (path, options = {}) => {
    const method = options.method || 'GET';
    api.requests.push({ method, path, body: options.body ? JSON.parse(options.body) : undefined });
    if (method === 'GET') {
      return { result: structuredClone(records) };
    }
    return { result: {} };
  };

  api.writes = () => api.requests.filter((r) => r.method !== 'GET' && r.method !== 'getZoneByName');
  return api;
}

/** Everything already matches — the whole service should be reads only. */
function convergedResponses() {
  return {
    getAuthenticatedDomains: [{ id: 111, domain: DOMAIN, valid: true }],
    getVerifiedSenders: [{ id: 222, from_email: FROM_EMAIL, verified: true }],
    getList: { id: 'lst_1', name: BRAND_NAME },
    getListByName: { id: 'lst_1', name: BRAND_NAME },
    getCustomFields: SENDGRID_FIELDS.map((f, i) => ({ id: `f${i}`, name: f.name, field_type: TYPE_MAP[f.type] })),
    getSegments: SENDGRID_SEGMENTS.map((s, i) => ({ id: `seg${i}`, name: s.name })),
    getSegment: (id) => {
      const seg = SENDGRID_SEGMENTS[Number(String(id).replace('seg', ''))];
      return { id, name: seg.name, query_dsl: buildQueryDsl(seg.conditions, seg.logic) };
    },
    getEventWebhookSettings: {
      enabled: true, url: WEBHOOK_URL,
      bounce: true, dropped: true, spam_report: true, unsubscribe: true, group_unsubscribe: true,
    },
  };
}

const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');

// Writeback target — the list op edits config/omega.json5 in the brand root;
// these comments must survive every service write byte-for-byte.
const WRITEBACK_CONFIG = `// Fixture Brand — hand-edited writeback target
{
  brand: {
    id: 'fixture-brand', // stays single-quoted
    name: "Fixture Brand",
  },
  marketing: {
    campaigns: {
      enabled: true,
    },
  },
}
`;

function runService(config, { sendgrid, cloudflare = null, options = {}, serviceData = {}, webhookKey = true, brandRoot } = {}) {
  if (webhookKey) {
    process.env.OMEGA_WEBHOOK_KEY = WEBHOOK_KEY;
  } else {
    delete process.env.OMEGA_WEBHOOK_KEY;
  }

  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || makeBrandRoot(WRITEBACK_CONFIG), // the list op writes into config/omega.json5 here
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.sendgrid,
    options,
    serviceData,
    sendgridApi: sendgrid,
    cloudflareApi: cloudflare,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('sendgrid: skips without SENDGRID_API_KEY in .env', async () => {
  const result = await runService(brandConfig()); // no injected api → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /SENDGRID_API_KEY/);
});

test('sendgrid: marketing.campaigns.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ campaigns: { enabled: false } }), { sendgrid: fakeSendgrid() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /marketing\.campaigns\.enabled/);
});

test('sendgrid: a different campaigns provider skips the service', async () => {
  const result = await runService(brandConfig({ campaigns: { provider: 'other' } }), { sendgrid: fakeSendgrid() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /provider = 'other'/);
});

test('sendgrid: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { sendgrid: fakeSendgrid() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

test('sendgrid: the defaults carry no company parent URL', () => {
  // omega-manager defaulted parent to the company's brand URL — the manager
  // defaults layer must leave the choice to config
  assert.equal(DEFAULTS.parent, null);
  assert.equal(DEFAULTS.marketing.campaigns.provider, 'sendgrid');
  assert.equal(DEFAULTS.marketing.campaigns.listId, null);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('sendgrid: fully converged brand is a zero-mutation no-op across all 6 operations', async () => {
  const api = fakeSendgrid(convergedResponses());

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.state.listId, 'lst_1');
  assert.equal(result.output.customFields.created, 0);
  assert.equal(result.output.segments.created, 0);
  assert.equal(result.output.eventWebhook.url, 'converged');
});

// ─── domain-auth ─────────────────────────────────────────────────────────────

test('sendgrid: missing domain auth is created, DNS written, validated once — pending warns', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getAuthenticatedDomains: [],
    authenticateDomain: { id: 111, domain: DOMAIN, dns: DNS_FIXTURE },
    validateDomain: VALIDATION_PENDING,
  });
  const cf = fakeCf();

  const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'warned');
  assert.deepEqual(api.callsTo('authenticateDomain')[0].args, [DOMAIN, 'emailauth']);
  assert.equal(api.callsTo('validateDomain').length, 1); // ONCE — no poll loop

  const writes = cf.writes();
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[0], {
    method: 'POST',
    path: '/zones/zone-1/dns_records',
    body: { type: 'CNAME', name: `emailauth.${DOMAIN}`, content: 'u123.wl001.sendgrid.net', ttl: 1, proxied: false, comment: 'SendGrid mail_cname' },
  });
  assert.equal(result.output.domainAuth.valid, false);
});

test('sendgrid: invalid domain auth with a wrong DNS record patches it and converges when validation passes', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getAuthenticatedDomains: [{ id: 111, domain: DOMAIN, valid: false, dns: DNS_FIXTURE }],
    validateDomain: VALIDATION_OK,
  });
  const cf = fakeCf({
    records: [{ id: 'rec-1', type: 'CNAME', name: `emailauth.${DOMAIN}`, content: 'stale.sendgrid.net' }],
  });

  const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.equal(api.callsTo('authenticateDomain').length, 0); // reused, not recreated

  const writes = cf.writes();
  assert.equal(writes.length, 3);
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].path, '/zones/zone-1/dns_records/rec-1');
  assert.equal(writes[1].method, 'POST');
  assert.equal(result.output.domainAuth.valid, true);
});

test('sendgrid: no Cloudflare token → manual records + validation still attempted', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getAuthenticatedDomains: [],
    authenticateDomain: { id: 111, domain: DOMAIN, dns: DNS_FIXTURE },
    validateDomain: VALIDATION_PENDING,
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'warned');
  assert.equal(api.callsTo('validateDomain').length, 1);
  assert.equal(result.output.domainAuth.manualRecords.length, 3);
  assert.equal(result.output.domainAuth.manualRecords[0].name, `emailauth.${DOMAIN}`);
});

// ─── sender-identity ─────────────────────────────────────────────────────────

test('sendgrid: an unverified sender is recreated with the brand address', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getVerifiedSenders: [{ id: 9, from_email: FROM_EMAIL, verified: false }],
    deleteVerifiedSender: null,
    createVerifiedSender: { id: 10, from_email: FROM_EMAIL, verified: true },
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('deleteVerifiedSender')[0].args, [9]);
  assert.deepEqual(api.callsTo('createVerifiedSender')[0].args[0], {
    nickname: BRAND_NAME,
    fromEmail: FROM_EMAIL,
    fromName: BRAND_NAME,
    replyToEmail: `support@${DOMAIN}`,
    replyToName: BRAND_NAME,
    address: { street: ADDRESS.line1, street2: ADDRESS.line2, city: ADDRESS.city, state: ADDRESS.region, zip: ADDRESS.postalCode, country: ADDRESS.country },
  });
});

test('sendgrid: a stale unverified sender squatting the nickname is deleted before create', async () => {
  // contact.email changed → the derivation moved; the old sender holds the
  // account-unique nickname and would 400 the create
  const api = fakeSendgrid({
    ...convergedResponses(),
    getVerifiedSenders: [{ id: 9376, nickname: BRAND_NAME, from_email: 'offers@old-domain.test', verified: false }],
    deleteVerifiedSender: null,
    createVerifiedSender: { id: 10, from_email: FROM_EMAIL, verified: true },
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('deleteVerifiedSender')[0].args, [9376]);
  assert.equal(api.callsTo('createVerifiedSender')[0].args[0].fromEmail, FROM_EMAIL);
});

test('sendgrid: a VERIFIED sender on the nickname with another address warns instead of deleting', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getVerifiedSenders: [{ id: 9376, nickname: BRAND_NAME, from_email: 'offers@old-domain.test', verified: true }],
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.senderIdentity.staleNickname, 'offers@old-domain.test');
  assert.equal(api.callsTo('deleteVerifiedSender').length, 0);
  assert.equal(api.callsTo('createVerifiedSender').length, 0);
});

test('sendgrid: missing sender without brand.address warns with CAN-SPAM guidance', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getVerifiedSenders: [],
  });

  const result = await runService(brandConfig({ address: null }), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.senderIdentity.missingAddress, true);
  assert.equal(api.callsTo('createVerifiedSender').length, 0);
});

// ─── list ────────────────────────────────────────────────────────────────────

test('sendgrid: a configured listId is verified and kept', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getList: { id: 'lst_cfg', name: 'Renamed In SendGrid' },
  });

  const result = await runService(brandConfig({ listId: 'lst_cfg' }), { sendgrid: api });

  assert.deepEqual(api.callsTo('getList')[0].args, ['lst_cfg']);
  assert.equal(api.callsTo('createList').length, 0);
  assert.equal(result.state.listId, 'lst_cfg');
});

test('sendgrid: a stale known id falls back to name lookup', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getList: () => null,
    getListByName: { id: 'lst_2', name: BRAND_NAME },
  });

  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_gone' }, brandRoot });

  assert.equal(result.state.listId, 'lst_2');
  assert.equal(api.callsTo('createList').length, 0);

  const written = readConfigSource(brandRoot);
  assert.ok(written.includes('listId: "lst_2",'));
  assert.ok(written.includes("id: 'fixture-brand', // stays single-quoted"));
});

test('sendgrid: no list anywhere → created and stored in state', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getListByName: () => undefined,
    createList: { id: 'lst_new', name: BRAND_NAME },
  });

  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const result = await runService(brandConfig(), { sendgrid: api, brandRoot });

  assert.deepEqual(api.callsTo('createList')[0].args, [BRAND_NAME]);
  assert.equal(result.state.listId, 'lst_new');
  assert.equal(api.callsTo('getList').length, 0); // nothing known to verify

  const written = readConfigSource(brandRoot);
  assert.ok(written.includes('listId: "lst_new",'));
  assert.ok(written.includes('// Fixture Brand — hand-edited writeback target'));
});

test('sendgrid: config-known id writes nothing; a state-known id is promoted into omega.json5', async () => {
  // Config already carries the id — the file stays byte-identical
  const configuredRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const before = readConfigSource(configuredRoot);
  await runService(brandConfig({ listId: 'lst_1' }), { sendgrid: fakeSendgrid(convergedResponses()), brandRoot: configuredRoot });
  assert.equal(readConfigSource(configuredRoot), before);

  // The same id known only from state — promoted into the file
  const stateRoot = makeBrandRoot(WRITEBACK_CONFIG);
  await runService(brandConfig(), { sendgrid: fakeSendgrid(convergedResponses()), serviceData: { listId: 'lst_1' }, brandRoot: stateRoot });
  assert.ok(readConfigSource(stateRoot).includes('listId: "lst_1",'));
});

// ─── custom-fields ───────────────────────────────────────────────────────────

test('sendgrid: missing and type-mismatched fields are created/recreated from the SSOT', async () => {
  const converged = convergedResponses().getCustomFields;
  const initial = converged.slice(1); // first field missing
  initial[0] = { ...initial[0], field_type: 'Text' === initial[0].field_type ? 'Number' : 'Text' }; // second mismatched

  let reads = 0;
  const api = fakeSendgrid({
    ...convergedResponses(),
    getCustomFields: () => (reads += 1) === 1 ? structuredClone(initial) : structuredClone(converged),
    deleteCustomField: null,
    createCustomField: { id: 'f_new' },
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('deleteCustomField')[0].args, [initial[0].id]);
  assert.equal(api.callsTo('createCustomField').length, 2); // the missing one + the recreated one
  assert.equal(result.output.customFields.created, 1);
  assert.equal(result.output.customFields.recreated, 1);
});

// ─── segments ────────────────────────────────────────────────────────────────

test('sendgrid: stale segments PATCH in place, missing ones are created, __temp_ orphans are swept', async () => {
  const list = convergedResponses().getSegments;
  const initial = [{ id: 'tmp1', name: '__temp_leak' }, ...list.slice(1)]; // segment 0 missing
  const staleId = 'seg1';
  const expectedDsl = (i) => buildQueryDsl(SENDGRID_SEGMENTS[i].conditions, SENDGRID_SEGMENTS[i].logic);

  let reads = 0;
  const api = fakeSendgrid({
    ...convergedResponses(),
    getSegments: () => (reads += 1) === 1 ? structuredClone(initial) : structuredClone(list),
    getSegment: (id) => id === staleId
      ? { id, name: SENDGRID_SEGMENTS[1].name, query_dsl: 'SELECT stale' }
      : convergedResponses().getSegment(id),
    updateSegment: {},
    deleteSegment: null,
    createSegment: { id: 'seg_new' },
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('deleteSegment')[0].args, ['tmp1']);
  assert.deepEqual(api.callsTo('updateSegment')[0].args, [staleId, SENDGRID_SEGMENTS[1].name, expectedDsl(1)]);
  assert.deepEqual(api.callsTo('createSegment')[0].args, [SENDGRID_SEGMENTS[0].name, expectedDsl(0)]);
});

test('sendgrid: a rejected segment PATCH falls back to delete + recreate', async () => {
  const list = convergedResponses().getSegments;
  const staleId = 'seg2';

  let reads = 0;
  const api = fakeSendgrid({
    ...convergedResponses(),
    getSegments: () => { reads += 1; return structuredClone(list); },
    getSegment: (id) => id === staleId
      ? { id, name: SENDGRID_SEGMENTS[2].name, query_dsl: 'SELECT stale' }
      : convergedResponses().getSegment(id),
    updateSegment: () => { throw new Error('PATCH not supported for this segment'); },
    deleteSegment: null,
    createSegment: { id: 'seg_recreated' },
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('deleteSegment')[0].args, [staleId]);
  assert.equal(api.callsTo('createSegment')[0].args[0], SENDGRID_SEGMENTS[2].name);
});

// ─── event-webhook ───────────────────────────────────────────────────────────

test('sendgrid: missing OMEGA_WEBHOOK_KEY warns', async () => {
  const api = fakeSendgrid(convergedResponses());

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' }, webhookKey: false });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.eventWebhook.missingWebhookKey, true);
  assert.equal(api.callsTo('getEventWebhookSettings').length, 0);
});

test('sendgrid: no parent configured → nothing to point the webhook at', async () => {
  const api = fakeSendgrid(convergedResponses());

  const result = await runService(brandConfig({ parent: null }), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.equal(api.callsTo('getEventWebhookSettings').length, 0);
  assert.equal(result.output.eventWebhook, undefined);
});

test('sendgrid: webhook drift is patched with the minimum diff against the parent forwarder', async () => {
  const parentUrl = `https://api.parent-brand.test/omega/marketing/webhook/forward?provider=sendgrid&key=${WEBHOOK_KEY}`;
  const api = fakeSendgrid({
    ...convergedResponses(),
    getEventWebhookSettings: {
      enabled: true, url: 'https://old.example.com/hook',
      bounce: true, dropped: false, spam_report: true, unsubscribe: true, group_unsubscribe: true,
    },
    updateEventWebhookSettings: {},
  });

  const result = await runService(brandConfig({ parent: 'https://parent-brand.test' }), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('updateEventWebhookSettings')[0].args[0], { url: parentUrl, dropped: true });
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('sendgrid: dry-run on a fully drifted brand performs zero mutations', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getAuthenticatedDomains: [],
    getVerifiedSenders: [],
    getListByName: () => undefined,
    getCustomFields: [],
    getSegments: [{ id: 'tmp1', name: '__temp_leak' }],
    getEventWebhookSettings: { enabled: false, url: '', bounce: false, dropped: false, spam_report: false, unsubscribe: false, group_unsubscribe: false },
  });
  const cf = fakeCf();

  const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, options: { dryRun: true } });

  assert.deepEqual(api.mutations(), []);
  assert.deepEqual(cf.writes(), []);
  assert.deepEqual(result.output.domainAuth.planned, ['authenticate-domain', 'dns-records', 'validate']);
  assert.equal(result.output.senderIdentity.planned, 'create-sender');
  assert.equal(result.output.list.planned, 'create');
  assert.equal(result.output.customFields.planned.create.length, SENDGRID_FIELDS.length);
  assert.equal(result.output.segments.planned.create.length, SENDGRID_SEGMENTS.length);
  assert.equal(result.output.segments.planned.sweepOrphans, 1);
  assert.ok(result.output.eventWebhook.planned.includes('url'));
});

// ─── domain-auth: interactive validation poll ────────────────────────────────

const { openTtyPrompt } = require('./lib/interactive.js');

test('sendgrid: interactive run polls validation until DNS propagates', async () => {
  let validations = 0;
  const api = fakeSendgrid({
    ...convergedResponses(),
    getAuthenticatedDomains: [],
    authenticateDomain: { id: 111, domain: DOMAIN, dns: DNS_FIXTURE },
    validateDomain: () => {
      validations++;
      return structuredClone(validations === 1 ? VALIDATION_PENDING : VALIDATION_OK);
    },
  });
  const cf = fakeCf();
  const tty = openTtyPrompt();

  try {
    const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, serviceData: { listId: 'lst_1' } });

    assert.equal(result.status, 'success');
    assert.equal(result.output.domainAuth.valid, true);
    assert.equal(validations, 2); // initial attempt + the poll's first re-check
  } finally {
    tty.close();
  }
});
