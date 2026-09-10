/**
 * SendGrid service tests — all 8 operations against method-level recording
 * fakes (SendGrid + Cloudflare). Proves skip semantics, the converged
 * zero-mutation no-op, the one-pass domain-auth flow (create → DNS diff-sync
 * → validate once), the link-branding flow (create → write both link CNAMEs →
 * validate → flip the emailurl CNAME proxied), sender recreation + the de-ITW'd address requirement,
 * list resolution through config/state/name/create, unsubscribe groups
 * matched by name with their ids written to config, SSOT-driven field and
 * segment reconciliation (type recreate, stale PATCH + fallback, __temp_
 * sweep), the min-diff event webhook, and the dry-run zero-mutation
 * guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const { fieldsFor, segmentsFor, BEM_GROUP_KEYS } = require('../src/lib/backend-marketing.js');
const { buildQueryDsl } = require('../src/services/campaigns/lib/segment-query.js');
const service = require('../src/services/campaigns/index.js');
const { GROUP_DEFINITIONS } = require('../src/services/campaigns/ensure/unsubscribe-groups.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const DOWN = '\x1B[B';

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
const GROUP_KEYS = Object.keys(GROUP_DEFINITIONS);

// The account's ASM groups as SendGrid answers them — id 100 + index, so an
// assertion names a real id instead of a magic number.
const GROUP_IDS = Object.fromEntries(GROUP_KEYS.map((key, i) => [key, 100 + i]));
const accountGroups = (keys = GROUP_KEYS) => keys.map((key) => ({ id: GROUP_IDS[key], name: GROUP_DEFINITIONS[key].name, description: GROUP_DEFINITIONS[key].description }));
const TYPE_MAP = { text: 'Text', number: 'Number', date: 'Date' };

const ADDRESS = { line1: '123 Fixture St', line2: 'Unit 4', city: 'Testville', region: 'CA', postalCode: '00000', country: 'USA' };

// The human every transactional send signs off as (#694) — a configured brand
// always has one, so it rides the default fixture
const PERSON = { name: 'Fixture Founder' };

const DNS_FIXTURE = {
  mail_cname: { type: 'cname', host: `emailauth.${DOMAIN}`, data: 'u123.wl001.sendgrid.net' },
  dkim1: { type: 'cname', host: `s1._domainkey.${DOMAIN}`, data: 's1.domainkey.u123.wl001.sendgrid.net' },
  dkim2: { type: 'cname', host: `s2._domainkey.${DOMAIN}`, data: 's2.domainkey.u123.wl001.sendgrid.net' },
};

// Link branding (#693): the `emailurl.<domain>` host, and SendGrid's validate
// answer for it — a top-level `valid`, the same field the list read reports.
const LINK_SUBDOMAIN = 'emailurl';
const LINK_HOST = `${LINK_SUBDOMAIN}.${DOMAIN}`;
const LINK_OWNER_HOST = `123.${DOMAIN}`;
const LINK_DNS_FIXTURE = {
  domain_cname: { host: LINK_HOST, data: 'sendgrid.net', type: 'cname' },
  owner_cname: { host: LINK_OWNER_HOST, data: 'sendgrid.net', type: 'cname' },
};
const LINK_VALIDATION_OK = { id: 333, valid: true };
const LINK_VALIDATION_PENDING = { id: 333, valid: false, validation_results: { domain_cname: { valid: false } } };

// The unproxied emailurl CNAME the edge service already wrote this run — the
// record the flip patches.
const EMAILURL_RECORD = { id: 'rec-url', type: 'CNAME', name: LINK_HOST, content: 'sendgrid.net', proxied: false, comment: 'SendGrid URL tracking' };

const VALIDATION_OK = { validation_results: { mail_cname: { valid: true }, dkim1: { valid: true }, dkim2: { valid: true } } };
const VALIDATION_PENDING = { validation_results: { mail_cname: { valid: false }, dkim1: { valid: true }, dkim2: { valid: true } } };

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ url = `https://${DOMAIN}`, parent = 'self', address = ADDRESS, person = PERSON, listId = null, groups = null, campaigns = {} } = {}) {
  return {
    brand: {
      id: 'fixture-brand',
      name: BRAND_NAME,
      url,
      contact: { email: `support@${DOMAIN}`, ...(person ? { person } : {}) },
      ...(address ? { address } : {}),
    },
    parent,
    marketing: {
      campaigns: {
        ...structuredClone(DEFAULTS.marketing.campaigns),
        providers: { sendgrid: { listId, ...(groups ? { groups } : {}) } },
        ...campaigns,
      },
    },
    targets: { web: {} },
  };
}

const READ_METHODS = [
  'getAuthenticatedDomains', 'getBrandedLinks', 'getVerifiedSenders', 'getLists', 'getListByName',
  'getList', 'getUnsubscribeGroups', 'getCustomFields', 'getSegments', 'getSegment',
  'getEventWebhookSettings',
];
const MUTATING_METHODS = [
  'authenticateDomain', 'validateDomain', 'createBrandedLink', 'validateBrandedLink',
  'createVerifiedSender', 'deleteVerifiedSender',
  'createList', 'createUnsubscribeGroup', 'createCustomField', 'deleteCustomField',
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

/**
 * Recording fake Cloudflare client (zone lookup + raw DNS record requests).
 *
 * The zone is STATEFUL: a created record is visible to the next read, which is
 * what the link-branding flow depends on — it writes the branded-link CNAMEs
 * and then has to find one of them again to flip it proxied (#693).
 */
function fakeCf({ zone = { id: 'zone-1', name: DOMAIN }, records = [] } = {}) {
  const api = { requests: [] };
  const zoneRecords = structuredClone(records);
  let nextId = 1;

  api.getZoneByName = async (name) => {
    api.requests.push({ method: 'getZoneByName', name });
    return zone ? structuredClone(zone) : null;
  };

  api.makeRequest = async (path, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    api.requests.push({ method, path, body });

    if (method === 'GET') {
      return { result: structuredClone(zoneRecords) };
    }

    if (method === 'POST') {
      zoneRecords.push({ id: `new-${nextId++}`, ...body });
    } else if (method === 'PATCH') {
      const id = path.split('/').pop();
      const existing = zoneRecords.find((r) => r.id === id);
      if (existing) Object.assign(existing, body);
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
    getBrandedLinks: [{ id: 333, domain: DOMAIN, subdomain: LINK_SUBDOMAIN, valid: true }],
    getVerifiedSenders: [{ id: 222, from_email: FROM_EMAIL, verified: true }],
    getList: { id: 'lst_1', name: BRAND_NAME },
    getListByName: { id: 'lst_1', name: BRAND_NAME },
    getUnsubscribeGroups: accountGroups(),
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

// The same file once the ids already landed — a converged rerun must leave it
// byte-identical.
const GROUPS_WRITEBACK_CONFIG = `// Fixture Brand — hand-edited writeback target
{
  brand: {
    id: 'fixture-brand', // stays single-quoted
    name: "Fixture Brand",
  },
  marketing: {
    campaigns: {
      enabled: true,
      providers: {
        sendgrid: {
          groups: {
${GROUP_KEYS.map((key) => `            ${key}: ${GROUP_IDS[key]},`).join('\n')}
          },
        },
      },
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
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.campaigns,
    options,
    serviceData,
    sendgridApi: sendgrid,
    cloudflareApi: cloudflare,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('campaigns: skips without SENDGRID_API_KEY in .env', async () => {
  const result = await runService(brandConfig()); // no injected api → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /SENDGRID_API_KEY/);
});

test('campaigns: marketing.campaigns.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ campaigns: { enabled: false } }), { sendgrid: fakeSendgrid() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /marketing\.campaigns\.enabled/);
});

test('campaigns: a different campaigns provider skips the service', async () => {
  const result = await runService(brandConfig({ campaigns: { providers: { other: {} } } }), { sendgrid: fakeSendgrid() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /marketing\.campaigns\.providers\.other/);
});

test('campaigns: an empty providers block means none chosen — the service skips (#425)', async () => {
  const result = await runService(brandConfig({ campaigns: { providers: {} } }), { sendgrid: fakeSendgrid() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no marketing\.campaigns\.providers entry/);
});

test('campaigns: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { sendgrid: fakeSendgrid() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

test('campaigns: the defaults carry no company parent URL', () => {
  // omega-manager defaulted parent to the company's brand URL — the manager
  // defaults layer must leave the choice to config
  assert.equal(DEFAULTS.parent, null);
  assert.equal(DEFAULTS.marketing.campaigns.providers.sendgrid.listId, null);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('campaigns: fully converged brand is a zero-mutation no-op across all 6 operations', async () => {
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

test('campaigns: missing domain auth is created, DNS written, validated once — pending warns', async () => {
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

test('campaigns: invalid domain auth with a wrong DNS record patches it and converges when validation passes', async () => {
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

test('campaigns: no Cloudflare token → manual records + validation still attempted', async () => {
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

// ─── link-branding (#693) ────────────────────────────────────────────────────

// Run 1 on a fresh brand: the edge service wrote NO SendGrid records (its live
// domain-auth read found nothing yet), so this operation owns both link CNAMEs
// — and they must land BEFORE SendGrid is asked to validate them.
test('campaigns: a fresh brand gets both link CNAMEs written, then validated, then proxied', async () => {
  const cf = fakeCf(); // empty zone — nothing wrote the emailurl record yet
  let writesAtValidation = null;

  const api = fakeSendgrid({
    ...convergedResponses(),
    getBrandedLinks: [],
    createBrandedLink: { id: 333, domain: DOMAIN, subdomain: LINK_SUBDOMAIN, valid: false, dns: LINK_DNS_FIXTURE },
    validateBrandedLink: () => {
      writesAtValidation = cf.writes().length;
      return structuredClone(LINK_VALIDATION_OK);
    },
  });

  const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.callsTo('createBrandedLink')[0].args, [DOMAIN, LINK_SUBDOMAIN]);
  assert.equal(writesAtValidation, 2, 'both CNAMEs land BEFORE SendGrid is asked to validate');

  const writes = cf.writes();
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[0], {
    method: 'POST',
    path: '/zones/zone-1/dns_records',
    body: { type: 'CNAME', name: LINK_HOST, content: 'sendgrid.net', ttl: 1, proxied: false, comment: 'SendGrid domain_cname' },
  });
  assert.deepEqual(writes[1].body, { type: 'CNAME', name: LINK_OWNER_HOST, content: 'sendgrid.net', ttl: 1, proxied: false, comment: 'SendGrid owner_cname' });
  assert.equal(writes[2].method, 'PATCH', 'and only then does the record ride the proxy');
  assert.equal(writes[2].body.name, LINK_HOST);
  assert.equal(writes[2].body.proxied, true);
  assert.deepEqual(result.output.linkBranding, { id: 333, valid: true, proxied: true });
});

test('campaigns: missing link branding is created and validated once — pending warns', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getBrandedLinks: [],
    createBrandedLink: { id: 333, domain: DOMAIN, subdomain: LINK_SUBDOMAIN, valid: false, dns: LINK_DNS_FIXTURE },
    validateBrandedLink: LINK_VALIDATION_PENDING,
  });
  // The emailurl CNAME the edge service already wrote this run, grey
  const cf = fakeCf({ records: [EMAILURL_RECORD] });

  const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'warned');
  assert.deepEqual(api.callsTo('createBrandedLink')[0].args, [DOMAIN, LINK_SUBDOMAIN]);
  assert.equal(api.callsTo('validateBrandedLink').length, 1); // ONCE — no poll loop
  assert.equal(result.output.linkBranding.valid, false);

  const writes = cf.writes();
  assert.equal(writes.length, 1, 'the matching emailurl record is left alone; only the owner CNAME is missing');
  assert.equal(writes[0].body.name, LINK_OWNER_HOST);
  assert.ok(!writes.some((w) => w.method === 'PATCH'), 'nothing is proxied until SendGrid validates');
});

test('campaigns: link branding that already validated is a read-only converge that still flips a grey record', async () => {
  const api = fakeSendgrid(convergedResponses());
  const cf = fakeCf({ records: [EMAILURL_RECORD] });

  const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.equal(api.callsTo('createBrandedLink').length, 0);
  assert.equal(api.callsTo('validateBrandedLink').length, 0);
  assert.deepEqual(result.output.linkBranding, { id: 333, valid: true });

  // A validated branding whose record is still grey costs no extra walk
  assert.deepEqual(cf.writes(), [{
    method: 'PATCH',
    path: '/zones/zone-1/dns_records/rec-url',
    body: { type: 'CNAME', name: LINK_HOST, content: 'sendgrid.net', ttl: 1, proxied: true, comment: 'SendGrid URL tracking' },
  }]);
});

test('campaigns: an interactive run waits for validation, then flips the emailurl CNAME proxied', async () => {
  let validations = 0;
  const api = fakeSendgrid({
    ...convergedResponses(),
    getBrandedLinks: [{ id: 333, domain: DOMAIN, subdomain: LINK_SUBDOMAIN, valid: false, dns: LINK_DNS_FIXTURE }],
    validateBrandedLink: () => {
      validations++;
      return structuredClone(validations === 1 ? LINK_VALIDATION_PENDING : LINK_VALIDATION_OK);
    },
  });
  const cf = fakeCf({ records: [EMAILURL_RECORD] });
  const tty = openTtyPrompt();

  try {
    const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, serviceData: { listId: 'lst_1' } });

    assert.equal(result.status, 'success');
    assert.equal(api.callsTo('createBrandedLink').length, 0); // reused, not recreated
    assert.equal(validations, 2); // initial attempt + the poll's first re-check
    assert.deepEqual(result.output.linkBranding, { id: 333, valid: true, proxied: true });

    const writes = cf.writes();
    assert.equal(writes[0].body.name, LINK_OWNER_HOST); // the missing half of the record set
    assert.deepEqual(writes[1], {
      method: 'PATCH',
      path: '/zones/zone-1/dns_records/rec-url',
      body: { type: 'CNAME', name: LINK_HOST, content: 'sendgrid.net', ttl: 1, proxied: true, comment: 'SendGrid URL tracking' },
    });
  } finally {
    tty.close();
  }
});

test('campaigns: no Cloudflare token → the validated branding warns with the manual flip', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getBrandedLinks: [{ id: 333, domain: DOMAIN, subdomain: LINK_SUBDOMAIN, valid: false, dns: LINK_DNS_FIXTURE }],
    validateBrandedLink: LINK_VALIDATION_OK,
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.linkBranding, { id: 333, valid: true, proxied: false });
});

// A subdomain brand's apex records belong to the PARENT brand's walk — the
// same line the edge service draws — so a branding created here would wait on
// CNAMEs this brand never writes.
test('campaigns: a subdomain project leaves link branding to the parent brand', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getAuthenticatedDomains: [],
    authenticateDomain: { id: 112, domain: `app.${DOMAIN}`, dns: DNS_FIXTURE },
    validateDomain: VALIDATION_OK,
  });
  const cf = fakeCf();

  // parent: null keeps the run to the operations under test — the webhook op
  // has nothing to point at, exactly as its own test pins.
  const result = await runService(brandConfig({ url: `https://app.${DOMAIN}`, parent: null }), { sendgrid: api, cloudflare: cf, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.equal(api.callsTo('getBrandedLinks').length, 0, 'the operation steps aside before it reads');
  assert.equal(result.output.linkBranding, undefined);
});

// ─── sender-identity ─────────────────────────────────────────────────────────

test('campaigns: an unverified sender is recreated with the brand address', async () => {
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

test('campaigns: a stale unverified sender squatting the nickname is deleted before create', async () => {
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

test('campaigns: a VERIFIED sender on the nickname with another address warns instead of deleting', async () => {
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

test('campaigns: missing sender without brand.address warns with CAN-SPAM guidance', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getVerifiedSenders: [],
  });

  const result = await runService(brandConfig({ address: null }), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.senderIdentity.missingAddress, true);
  assert.equal(api.callsTo('createVerifiedSender').length, 0);
});

test('campaigns: a missing brand.address is ASKED for behind ONE gate and lands as one object (#635)', async () => {
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const api = fakeSendgrid({
    ...convergedResponses(),
    getVerifiedSenders: [],
    createVerifiedSender: { id: 10, from_email: FROM_EMAIL, verified: true },
  });

  const tty = openTtyPrompt();
  try {
    const run = runService(brandConfig({ address: null }), { sendgrid: api, serviceData: { listId: 'lst_1' }, brandRoot });
    await tty.answer('Set up now?', '\r');                       // ONE gate for all five fields
    await tty.answer('Street address', '500 Fixture Ave\r');
    await tty.answer('City', 'Testville\r');
    await tty.answer('State / region', 'CA\r');
    await tty.answer('Postal code', '90210\r');
    await tty.answer('Country', 'USA\r');
    const result = await run;

    assert.equal(result.status, 'success');
    // The pass continued on the address just entered
    assert.deepEqual(api.callsTo('createVerifiedSender')[0].args[0].address, {
      street: '500 Fixture Ave', street2: '', city: 'Testville', state: 'CA', zip: '90210', country: 'USA',
    });
    // ...and it landed as ONE brand.address object, comments intact
    const written = readConfigSource(brandRoot);
    assert.match(written, /500 Fixture Ave/);
    assert.match(written, /Testville/);
    assert.match(written, /\/\/ stays single-quoted/);
  } finally {
    tty.close();
  }
});

test('campaigns: skipping the address gate keeps the CAN-SPAM warn and writes nothing (#635)', async () => {
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const api = fakeSendgrid({ ...convergedResponses(), getVerifiedSenders: [] });

  const tty = openTtyPrompt();
  try {
    const run = runService(brandConfig({ address: null }), { sendgrid: api, serviceData: { listId: 'lst_1' }, brandRoot });
    await tty.answer('Set up now?', `${DOWN}\r`);                 // Skip for now
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.equal(result.output.senderIdentity.missingAddress, true);
    assert.equal(api.callsTo('createVerifiedSender').length, 0);
    assert.doesNotMatch(readConfigSource(brandRoot), /address/);
  } finally {
    tty.close();
  }
});

// ─── list ────────────────────────────────────────────────────────────────────

test('campaigns: a configured listId is verified and kept', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getList: { id: 'lst_cfg', name: 'Renamed In SendGrid' },
  });

  const result = await runService(brandConfig({ listId: 'lst_cfg' }), { sendgrid: api });

  assert.deepEqual(api.callsTo('getList')[0].args, ['lst_cfg']);
  assert.equal(api.callsTo('createList').length, 0);
  assert.equal(result.state.listId, 'lst_cfg');
});

test('campaigns: a stale known id falls back to name lookup', async () => {
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

test('campaigns: no list anywhere → created and stored in state', async () => {
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

test('campaigns: config-known id writes nothing; a state-known id is promoted into omega.json5', async () => {
  // Config already carries the id — the file stays byte-identical (the group
  // ids are in the file too, or the unsubscribe-groups op would land them)
  const configuredRoot = makeBrandRoot(GROUPS_WRITEBACK_CONFIG);
  const before = readConfigSource(configuredRoot);
  await runService(brandConfig({ listId: 'lst_1', groups: GROUP_IDS }), { sendgrid: fakeSendgrid(convergedResponses()), brandRoot: configuredRoot });
  assert.equal(readConfigSource(configuredRoot), before);

  // The same id known only from state — promoted into the file
  const stateRoot = makeBrandRoot(WRITEBACK_CONFIG);
  await runService(brandConfig(), { sendgrid: fakeSendgrid(convergedResponses()), serviceData: { listId: 'lst_1' }, brandRoot: stateRoot });
  assert.ok(readConfigSource(stateRoot).includes('listId: "lst_1",'));
});

// ─── unsubscribe-groups ──────────────────────────────────────────────────────

test('campaigns: the group table covers every key @omega.js/backend sends through', () => {
  // The keys are @omega.js/backend's SSOT; the names/descriptions are this
  // service's. A key with no row would send through a group nothing provisions.
  assert.deepEqual(GROUP_KEYS, BEM_GROUP_KEYS);
  for (const key of BEM_GROUP_KEYS) {
    assert.ok(GROUP_DEFINITIONS[key].name, `${key} has a group name`);
    assert.ok(GROUP_DEFINITIONS[key].description, `${key} has a recipient-facing description`);
  }
  // Brand-neutral names: sibling brands on ONE account must match the same groups
  const names = BEM_GROUP_KEYS.map((key) => GROUP_DEFINITIONS[key].name);
  assert.equal(new Set(names).size, names.length, 'group names are unique');
  assert.ok(!names.some((name) => name.includes(BRAND_NAME)), 'no brand name in a group name');
});

test('campaigns: an account with no groups gets all seven created, ids written to omega.json5', async () => {
  const created = [];
  const api = fakeSendgrid({
    ...convergedResponses(),
    getUnsubscribeGroups: [],
    createUnsubscribeGroup: (name, description) => {
      created.push({ name, description });
      const key = GROUP_KEYS.find((k) => GROUP_DEFINITIONS[k].name === name);
      return { id: GROUP_IDS[key], name, description };
    },
  });

  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' }, brandRoot });

  assert.equal(result.status, 'success');
  assert.deepEqual(created, GROUP_KEYS.map((key) => ({ name: GROUP_DEFINITIONS[key].name, description: GROUP_DEFINITIONS[key].description })));
  assert.equal(result.output.unsubscribeGroups.created, GROUP_KEYS.length);

  const written = readConfigSource(brandRoot);
  for (const key of GROUP_KEYS) {
    assert.ok(written.includes(`${key}: ${GROUP_IDS[key]},`), `${key} id landed in omega.json5`);
  }
  assert.ok(written.includes('// Fixture Brand — hand-edited writeback target'));
});

test('campaigns: groups already on the account are matched by NAME, never recreated', async () => {
  // The sibling-brand case: another brand on this SendGrid account made them,
  // so this brand adopts the SAME ids instead of creating duplicates
  const api = fakeSendgrid(convergedResponses());

  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' }, brandRoot });

  assert.equal(api.callsTo('createUnsubscribeGroup').length, 0);
  assert.equal(result.output.unsubscribeGroups.created, 0);

  const written = readConfigSource(brandRoot);
  for (const key of GROUP_KEYS) {
    assert.ok(written.includes(`${key}: ${GROUP_IDS[key]},`), `${key} id landed in omega.json5`);
  }
});

test('campaigns: only the groups missing from the account are created', async () => {
  const present = GROUP_KEYS.filter((key) => key !== 'security' && key !== 'internal');
  const api = fakeSendgrid({
    ...convergedResponses(),
    getUnsubscribeGroups: accountGroups(present),
    createUnsubscribeGroup: (name, description) => {
      const key = GROUP_KEYS.find((k) => GROUP_DEFINITIONS[k].name === name);
      return { id: GROUP_IDS[key], name, description };
    },
  });

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' }, brandRoot: makeBrandRoot(WRITEBACK_CONFIG) });

  assert.deepEqual(
    api.callsTo('createUnsubscribeGroup').map((c) => c.args[0]),
    [GROUP_DEFINITIONS.security.name, GROUP_DEFINITIONS.internal.name],
  );
  assert.equal(result.output.unsubscribeGroups.created, 2);
});

test('campaigns: a brand whose config already carries the ids writes nothing', async () => {
  const configuredRoot = makeBrandRoot(GROUPS_WRITEBACK_CONFIG);
  const before = readConfigSource(configuredRoot);

  const result = await runService(
    brandConfig({ listId: 'lst_1', groups: GROUP_IDS }),
    { sendgrid: fakeSendgrid(convergedResponses()), brandRoot: configuredRoot },
  );

  assert.equal(result.output.unsubscribeGroups.written, 0);
  assert.equal(readConfigSource(configuredRoot), before);
});

// ─── custom-fields ───────────────────────────────────────────────────────────

test('campaigns: the catalog skips the two name fields SendGrid stores itself (#695)', async () => {
  // SendGrid keeps first/last name in its RESERVED contact columns, which the
  // backend's addContact writes natively — so the custom-field lane skips them
  // on BOTH sides (one `fieldsForProvider()` derivation): never provisioned
  // here, never written by the contact sync, so the old "no SendGrid ID
  // (skipped)" warn cannot come back and no duplicate field is ever created.
  const names = SENDGRID_FIELDS.map((field) => field.name);
  assert.ok(!names.includes('user_personal_name_first'), `the catalog skips the first-name field, got ${names.join(', ')}`);
  assert.ok(!names.includes('user_personal_name_last'), `the catalog skips the last-name field, got ${names.join(', ')}`);

  // And an account carrying that view converges with nothing created — the two
  // names are not missing fields, they are fields SendGrid owns
  const api = fakeSendgrid(convergedResponses());

  const result = await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.equal(result.output.customFields.total, SENDGRID_FIELDS.length);
  assert.deepEqual(api.callsTo('createCustomField'), []);
});

test('campaigns: missing and type-mismatched fields are created/recreated from the SSOT', async () => {
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

test('campaigns: stale segments PATCH in place, missing ones are created, __temp_ orphans are swept', async () => {
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

test('campaigns: a rejected segment PATCH falls back to delete + recreate', async () => {
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

test('campaigns: a missing OMEGA_WEBHOOK_KEY is MINTED in place — the webhook is managed, never skipped (#635)', async () => {
  const api = fakeSendgrid({ ...convergedResponses(), updateEventWebhookSettings: {} });

  await runService(brandConfig(), { sendgrid: api, serviceData: { listId: 'lst_1' }, webhookKey: false });

  // OMEGA mints its own key, so the run never steps aside for it
  const minted = process.env.OMEGA_WEBHOOK_KEY;
  assert.match(minted, /^[A-Za-z0-9_-]{43}$/);
  // ...and the freshly minted key is what the forwarder URL is built from
  assert.equal(api.callsTo('getEventWebhookSettings').length, 1);
  assert.deepEqual(api.callsTo('updateEventWebhookSettings').map((c) => c.args), [
    [{ url: `https://api.${DOMAIN}/omega/marketing/webhook/forward?provider=sendgrid&key=${minted}` }],
  ]);
});

test('campaigns: no parent configured → nothing to point the webhook at', async () => {
  const api = fakeSendgrid(convergedResponses());

  const result = await runService(brandConfig({ parent: null }), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'success');
  assert.equal(api.callsTo('getEventWebhookSettings').length, 0);
  assert.equal(result.output.eventWebhook, undefined);
});

test('campaigns: webhook drift is patched with the minimum diff against the parent forwarder', async () => {
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

// ─── contact-person (#694) ───────────────────────────────────────────────────

test('campaigns: no brand.contact.person.name FAILS the walk, naming the key (#694)', async () => {
  // Live bug: the first real signup returned 200 while sendWelcomeEmail,
  // sendDiscountNudgeEmail and sendCheckupEmail ALL threw "Missing
  // brand.contact.person.name" — and the walk that provisioned SendGrid for
  // them stayed green. The walk is the launch gate, so it fails here instead.
  const api = fakeSendgrid(convergedResponses());

  const result = await runService(brandConfig({ person: null }), { sendgrid: api, serviceData: { listId: 'lst_1' } });

  assert.equal(result.status, 'error');
  assert.match(result.error, /brand\.contact\.person\.name/);
  assert.deepEqual(result.failed.map((entry) => entry.operation), ['contact-person']);

  // A name configured → the same walk is clean
  const configured = await runService(brandConfig(), { sendgrid: fakeSendgrid(convergedResponses()), serviceData: { listId: 'lst_1' } });
  assert.equal(configured.status, 'success');
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('campaigns: dry-run on a fully drifted brand performs zero mutations', async () => {
  const api = fakeSendgrid({
    ...convergedResponses(),
    getAuthenticatedDomains: [],
    getBrandedLinks: [],
    getVerifiedSenders: [],
    getListByName: () => undefined,
    getUnsubscribeGroups: [],
    getCustomFields: [],
    getSegments: [{ id: 'tmp1', name: '__temp_leak' }],
    getEventWebhookSettings: { enabled: false, url: '', bounce: false, dropped: false, spam_report: false, unsubscribe: false, group_unsubscribe: false },
  });
  const cf = fakeCf();

  const result = await runService(brandConfig(), { sendgrid: api, cloudflare: cf, options: { dryRun: true } });

  assert.deepEqual(api.mutations(), []);
  assert.deepEqual(cf.writes(), []);
  assert.deepEqual(result.output.domainAuth.planned, ['authenticate-domain', 'dns-records', 'validate']);
  assert.deepEqual(result.output.linkBranding.planned, ['brand-links', 'dns-records', 'validate', 'proxy-record']);
  assert.equal(result.output.senderIdentity.planned, 'create-sender');
  assert.equal(result.output.list.planned, 'create');
  assert.deepEqual(result.output.unsubscribeGroups.planned.create, GROUP_KEYS.map((key) => GROUP_DEFINITIONS[key].name));
  assert.equal(result.output.customFields.planned.create.length, SENDGRID_FIELDS.length);
  assert.equal(result.output.segments.planned.create.length, SENDGRID_SEGMENTS.length);
  assert.equal(result.output.segments.planned.sweepOrphans, 1);
  assert.ok(result.output.eventWebhook.planned.includes('url'));
});

// ─── domain-auth: interactive validation poll ────────────────────────────────

test('campaigns: interactive run polls validation until DNS propagates', async () => {
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
