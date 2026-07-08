/**
 * Replyify service tests — both operations against a method-level recording
 * fake of the Firestore REST client. Proves skip semantics (incl. the
 * backend-target gate and the shared-agent updateAgentInfo gate), the
 * converged zero-mutation no-op, baseline generation (the de-ITW'd
 * discount section gated on config, the company sponsorship block gone),
 * the filter-query composition (auto-generated and file-provided), the
 * config/replyify.md parser across all four formats, agent diff-sync with
 * leaf masks, the owner-plan reconciliation through the shared lib, and
 * the dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { getBaselineKnowledge, getBaselineFilter } = require('../src/services/replyify/lib/baseline.js');
const { parseKnowledgeFile } = require('../src/services/replyify/lib/knowledge-file.js');
const service = require('../src/services/replyify/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.REPLYIFY_SERVICE_ACCOUNT;

const BRAND_NAME = 'Fixture Brand';
const DOMAIN = 'fixture-brand.test';
const URL = `https://${DOMAIN}`;
const DESCRIPTION = 'A fixture brand';
const AGENT_ID = 'agent_fixture1';
const OWNER_UID = 'uid_owner1';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ replyify = {}, targets = { web: {}, backend: {} } } = {}) {
  return {
    brand: { id: 'fixture-brand', name: BRAND_NAME, url: URL, description: DESCRIPTION },
    replyify: replyify === false
      ? false
      : { ...structuredClone(DEFAULTS.replyify), agentId: AGENT_ID, ...replyify },
    targets,
  };
}

/** The exact agent document the agent operation converges to. */
function desiredAgentDoc(config, { filterQuery, brandKnowledge = '' } = {}) {
  const baseline = getBaselineKnowledge(config, DOMAIN);
  const knowledge = brandKnowledge ? `${baseline}\n\n${brandKnowledge}` : baseline;
  const brandFilter = filterQuery || `(\n  to:(\n    @${DOMAIN}\n  )\n)`;

  return {
    name: `${BRAND_NAME} - Customer Service`,
    owner: OWNER_UID,
    settings: {
      filter: { query: `${brandFilter}\nAND\n${getBaselineFilter(config, DOMAIN)}` },
      brand: { name: BRAND_NAME, about: DESCRIPTION, website: URL, knowledge },
    },
  };
}

function subscription(planId = 'max', planName = 'Max') {
  return {
    product: { id: planId, name: planName },
    status: 'active',
    payment: { processor: 'internal', frequency: 'annually', price: 0, resourceId: null, orderId: null },
  };
}

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeDb(responses = {}) {
  const db = { calls: [] };

  for (const method of ['getDoc', 'patchDoc']) {
    db[method] = async (...args) => {
      db.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeDb: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  db.mutations = () => db.calls.filter((c) => c.method === 'patchDoc');
  db.reads = () => db.calls.filter((c) => c.method === 'getDoc').map((c) => c.args[0]);
  return db;
}

/** Everything already matches — the whole service should be reads only. */
function convergedResponses(config, { agent, user } = {}) {
  const docs = {
    [`agents/${AGENT_ID}`]: agent !== undefined ? agent : desiredAgentDoc(config),
    [`users/${OWNER_UID}`]: user !== undefined ? user : { subscription: subscription() },
  };

  return {
    getDoc: (path) => structuredClone(docs[path] ?? null),
  };
}

function runService(config, { db, options = {}, serviceData = {}, brandRoot } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || '/tmp/omega-manager-replyify-nonexistent', // no config/replyify.md → baseline only
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.replyify,
    options,
    serviceData,
    replyifyDb: db,
  });
}

// ─── Registry / defaults pins ────────────────────────────────────────────────

test('replyify: registered after chatsy with the agent + user operations', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('chatsy') + 1], 'replyify');
  assert.deepEqual(OPERATIONS.replyify.map((o) => o.name), ['agent', 'user']);
});

test('replyify: defaults carry no agentId, Replyify\'s top tier, and no discount', () => {
  assert.equal(DEFAULTS.replyify.enabled, true);
  assert.equal(DEFAULTS.replyify.updateAgentInfo, true);
  assert.equal(DEFAULTS.replyify.agentId, null);
  assert.deepEqual(DEFAULTS.replyify.plan, { id: 'max', name: 'Max' });
  assert.equal(DEFAULTS.replyify.discount, null);
});

// ─── Baseline generation ─────────────────────────────────────────────────────

test('replyify: the baseline carries no company values and no discount section by default', () => {
  const knowledge = getBaselineKnowledge(brandConfig(), DOMAIN);

  // omega-manager's baseline shipped the company sponsorship business block
  // (guest-post rules, itwcreativeworks.com/sponsorship, WELCOME10) and a
  // hardcoded GIFT15 discount for every brand — all gone from the package
  assert.ok(!knowledge.includes('itwcreativeworks'));
  assert.ok(!knowledge.includes('GIFT15'));
  assert.ok(!knowledge.includes('WELCOME10'));
  assert.ok(!knowledge.includes('<sponsorships'));
  assert.ok(!knowledge.includes('<discount'));
  assert.deepEqual(knowledge.match(/\{[^}]+\}/g), null); // every placeholder filled
  assert.ok(knowledge.includes(`${URL}/account#billing`));
});

test('replyify: replyify.discount renders the discount section with the configured code', () => {
  const knowledge = getBaselineKnowledge(
    brandConfig({ replyify: { discount: { code: 'SAVE20', label: '20% off' } } }),
    DOMAIN,
  );

  assert.ok(knowledge.includes('<discount followup="0">'));
  assert.ok(knowledge.includes('Discount code: SAVE20 (20% off).'));
  assert.ok(knowledge.includes(`${URL}/pricing?utm_source=replyify`));
  // The section sits inside billing_payments, between subscription and refund
  assert.ok(knowledge.indexOf('</subscription>') < knowledge.indexOf('<discount'));
  assert.ok(knowledge.indexOf('</discount>') < knowledge.indexOf('<refund'));
});

test('replyify: the baseline filter excludes the brand\'s transactional addresses', () => {
  assert.equal(getBaselineFilter(brandConfig(), DOMAIN), `-to:(\n  alerts@${DOMAIN}\n  OR account@${DOMAIN}\n)`);
});

// ─── config/replyify.md parser ───────────────────────────────────────────────

test('replyify: parseKnowledgeFile handles all four file formats', () => {
  assert.deepEqual(
    parseKnowledgeFile('---filter---\n(to:(@x.test))\n---knowledge---\nExtra facts'),
    { filterQuery: '(to:(@x.test))', knowledge: 'Extra facts' },
  );
  assert.deepEqual(
    parseKnowledgeFile('---filter---\n(to:(@x.test))'),
    { filterQuery: '(to:(@x.test))', knowledge: '' },
  );
  assert.deepEqual(
    parseKnowledgeFile('---knowledge---\nExtra facts'),
    { filterQuery: null, knowledge: 'Extra facts' },
  );
  assert.deepEqual(
    parseKnowledgeFile('Just knowledge, no delimiters'),
    { filterQuery: null, knowledge: 'Just knowledge, no delimiters' },
  );
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('replyify: replyify.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ replyify: { enabled: false } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /replyify\.enabled/);
});

test('replyify: scalar replyify: false skips the service', async () => {
  const result = await runService(brandConfig({ replyify: false }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /replyify\.enabled/);
});

test('replyify: a shared agent managed by another brand skips the service', async () => {
  const result = await runService(brandConfig({ replyify: { updateAgentInfo: false } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /updateAgentInfo/);
});

test('replyify: skips without a backend target (the agent answers the backend\'s support email)', async () => {
  const result = await runService(brandConfig({ targets: { web: {} } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no backend target/);
});

test('replyify: skips without replyify.agentId', async () => {
  const result = await runService(brandConfig({ replyify: { agentId: null } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /replyify\.agentId/);
});

test('replyify: skips without REPLYIFY_SERVICE_ACCOUNT in .env', async () => {
  const result = await runService(brandConfig()); // no injected db → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /REPLYIFY_SERVICE_ACCOUNT/);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('replyify: fully converged brand is a zero-mutation no-op across both operations', async () => {
  const config = brandConfig();
  const db = fakeDb(convergedResponses(config));

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.deepEqual(db.reads(), [`agents/${AGENT_ID}`, `agents/${AGENT_ID}`, `users/${OWNER_UID}`]);
  assert.equal(result.state.agentId, AGENT_ID);
  assert.equal(result.state.ownerUid, OWNER_UID);
  assert.equal(result.output.agent.synced, true);
  assert.equal(result.output.user.synced, true);
});

test('replyify: Replyify-owned agent fields (owner, id, other settings) do not count as drift', async () => {
  const config = brandConfig();
  const agent = { ...desiredAgentDoc(config), id: AGENT_ID, metadata: { created: '2024-01-01' } };
  agent.settings.signature = 'Keep me';
  const db = fakeDb(convergedResponses(config, { agent }));

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
});

// ─── agent ───────────────────────────────────────────────────────────────────

test('replyify: a drifted agent is patched with exactly the managed leaf fields', async () => {
  const config = brandConfig();
  const agent = { ...desiredAgentDoc(config), name: 'Old Name' };
  const db = fakeDb({ ...convergedResponses(config, { agent }), patchDoc: {} });

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  const [path, data, fieldPaths] = db.mutations()[0].args;
  assert.equal(path, `agents/${AGENT_ID}`);
  assert.equal(data.name, `${BRAND_NAME} - Customer Service`);
  // The auto-generated brand filter ANDed with the baseline exclusions
  assert.equal(
    data.settings.filter.query,
    `(\n  to:(\n    @${DOMAIN}\n  )\n)\nAND\n-to:(\n  alerts@${DOMAIN}\n  OR account@${DOMAIN}\n)`,
  );
  assert.deepEqual(fieldPaths, [
    'name',
    'settings.filter.query',
    'settings.brand.name',
    'settings.brand.about',
    'settings.brand.website',
    'settings.brand.knowledge',
  ]);
  assert.equal(result.output.agent.updated, true);
});

test('replyify: config/replyify.md provides the filter and appends knowledge', async () => {
  const brandRoot = mkdtempSync(join(tmpdir(), 'omega-replyify-'));
  mkdirSync(join(brandRoot, 'config'), { recursive: true });
  writeFileSync(
    join(brandRoot, 'config', 'replyify.md'),
    '---filter---\n(to:(support@fixture-brand.test))\n---knowledge---\nWe ship worldwide.\n',
  );

  const config = brandConfig();
  const expected = desiredAgentDoc(config, {
    filterQuery: '(to:(support@fixture-brand.test))',
    brandKnowledge: 'We ship worldwide.',
  });
  const agent = desiredAgentDoc(config); // baseline-only doc → drift
  const db = fakeDb({ ...convergedResponses(config, { agent }), patchDoc: {} });

  const result = await runService(config, { db, brandRoot });

  assert.equal(result.status, 'success');
  const [, data] = db.mutations()[0].args;
  assert.equal(data.settings.filter.query, expected.settings.filter.query);
  assert.equal(data.settings.brand.knowledge, expected.settings.brand.knowledge);
  assert.ok(data.settings.brand.knowledge.endsWith('We ship worldwide.'));
});

test('replyify: an agentId pointing at no document errors instead of creating an orphan', async () => {
  const db = fakeDb({ getDoc: null });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'error');
  assert.deepEqual(db.mutations(), []);
  // stopOnError: the user operation never runs after the agent error
  assert.deepEqual(db.reads(), [`agents/${AGENT_ID}`]);
});

// ─── user ────────────────────────────────────────────────────────────────────

test('replyify: a user on a lower plan is moved to the configured plan', async () => {
  const config = brandConfig();
  const db = fakeDb({
    ...convergedResponses(config, { user: { subscription: subscription('plus', 'Plus') } }),
    patchDoc: {},
  });

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations().map((c) => c.args), [[
    `users/${OWNER_UID}`,
    { subscription: subscription() },
    [
      'subscription.product.id',
      'subscription.product.name',
      'subscription.status',
      'subscription.payment.processor',
      'subscription.payment.frequency',
      'subscription.payment.price',
      'subscription.payment.resourceId',
      'subscription.payment.orderId',
    ],
  ]]);
  assert.equal(result.output.user.updated, true);
  assert.equal(result.state.ownerUid, OWNER_UID);
});

test('replyify: replyify.plan overrides the default tier', async () => {
  const config = brandConfig({ replyify: { plan: { id: 'pro', name: 'Pro' } } });
  const db = fakeDb({
    ...convergedResponses(config, { user: { subscription: subscription() } }),
    patchDoc: {},
  });

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations()[0].args[1].subscription.product, { id: 'pro', name: 'Pro' });
  assert.equal(result.output.user.plan, 'pro');
});

test('replyify: an agent without an owner field errors the user operation', async () => {
  const config = brandConfig();
  const agent = desiredAgentDoc(config);
  delete agent.owner;
  const db = fakeDb(convergedResponses(config, { agent }));

  const result = await runService(config, { db });

  assert.equal(result.status, 'error');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.agent.synced, true); // the agent op itself passed
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('replyify: dry run on a fully drifted brand performs zero mutations', async () => {
  const config = brandConfig();
  const db = fakeDb({
    getDoc: (path) => (path === `agents/${AGENT_ID}`
      ? { name: 'Old Name', owner: OWNER_UID, settings: {} }
      : null),
  });

  const result = await runService(config, { db, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.agent.planned, 'update');
  assert.equal(result.output.user.planned, 'max');
  // no durable state lands in a dry run
  assert.equal(result.state, null);
});
