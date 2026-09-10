/**
 * Chat service tests — both operations against a method-level recording
 * fake of the Firestore REST client. Proves skip semantics (incl. the
 * shared-agent updateAgentInfo gate), the converged zero-mutation no-op,
 * baseline-knowledge generation (placeholders, generated pricing, the
 * de-ITW'd sponsorships URL, the {website}-in-pricing fix omega-manager
 * shipped broken), the brand config/chatsy.md merge, brandmark-gated image
 * management, agent diff-sync with leaf masks, the owner-plan
 * reconciliation through the shared lib, and the dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkdtempSync, mkdirSync, writeFileSync } = fs;
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { setBrowserOpener } = require('@omega.js/devkit/flows');
const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { getBaselineKnowledge } = require('../src/services/chat/lib/baseline-knowledge.js');
const service = require('../src/services/chat/index.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// Tests must never see real credentials from the shell environment
delete process.env.CHATSY_SERVICE_ACCOUNT;

const BRAND_NAME = 'Fixture Brand';
const URL = 'https://fixture-brand.test';
const DESCRIPTION = 'A fixture brand';
const BRANDMARK = 'https://fixture-brand.test/brandmark.png';
const AGENT_ID = 'agent_fixture1';
const OWNER_UID = 'uid_owner1';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ chatsy = {}, targets = { web: {}, backend: {} }, images = { brandmark: BRANDMARK }, products, features } = {}) {
  return {
    brand: { id: 'fixture-brand', name: BRAND_NAME, url: URL, description: DESCRIPTION, images },
    features: features,
    inbound: {
      chat: {
        providers: {
          chatsy: chatsy === false
            ? false
            : { ...structuredClone(DEFAULTS.inbound.chat.providers.chatsy), agentId: AGENT_ID, ...chatsy },
        },
      },
    },
    payment: { products: products || [{ id: 'plus', name: 'Plus', type: 'subscription', prices: { monthly: 10, annually: 100 }, trial: { days: 14 } }] },
    targets,
  };
}

/** The exact agent document the chat operation converges to. */
function desiredAgentDoc(config, { brandKnowledge = '' } = {}) {
  const baseline = getBaselineKnowledge(config);
  const knowledge = brandKnowledge ? `${baseline}\n\n${brandKnowledge}` : baseline;
  const image = config.brand.images?.brandmark;

  return {
    name: `${BRAND_NAME} Support`,
    owner: OWNER_UID,
    settings: {
      welcomeMessage: `Welcome to the ${BRAND_NAME} Support chat! How can I help you?`,
      agent: { language: 'EN', ...(image ? { image } : {}) },
      autoTranslate: true,
      brand: { name: BRAND_NAME, about: DESCRIPTION, website: URL, knowledge },
    },
  };
}

function subscription(planId = 'max', planName = 'Max') {
  return {
    product: { id: planId, name: planName },
    status: 'active',
    payment: { provider: 'internal', frequency: 'annually', price: 0, resourceId: null, orderId: null },
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
    brandRoot: brandRoot || '/tmp/omega-manager-chatsy-nonexistent', // no config/chatsy.md → baseline only
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.chat,
    options,
    serviceData,
    chatsyDb: db,
  });
}

// ─── Registry / defaults pins ────────────────────────────────────────────────

test('chat: registered after forms with the chat + user operations', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('forms') + 1], 'chat');
  assert.deepEqual(OPERATIONS.chat.map((o) => o.name), ['chat', 'user']);
});

// #23 D4 — ONE chatsy home. The dotted path pinned here is the SAME string
// @omega.js/client reads (pinned on that side in packages/web's
// test/config-rekey.test.js): rename one without the other and both break.
test('chat: the agent id lands at inbound.chat.providers.chatsy.agentId — the path the client reads', () => {
  const source = fs.readFileSync(require.resolve('../src/services/chat/index.js'), 'utf8');

  assert.ok(
    source.includes("landValue(context, 'inbound.chat.providers.chatsy.agentId'"),
    'the mint writeback lands the ONE path',
  );
  assert.ok(
    source.includes("path: 'inbound.chat.providers.chatsy.agentId'"),
    'the interactive flow lands the ONE path',
  );
  assert.ok(
    source.includes("disablePath: 'inbound.chat.providers.chatsy'"),
    'Disable writes false at the section, not at a stale top-level key',
  );
  assert.ok(!/'chatsy\.agentId'/.test(source), 'no bare chatsy.* path survives');
});

test('chat: the widget settings share the provisioning home — schema-declared, one place', () => {
  const { SHARED_SCHEMA } = require('@omega.js/config');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  assert.ok(paths.includes('inbound.chat.providers.chatsy.agentId'));
  assert.ok(paths.includes('inbound.chat.providers.chatsy.settings'));
});

test('chat: defaults carry no agentId, Chatsy\'s top tier, and no company sponsorship URL', () => {
  assert.equal(DEFAULTS.inbound.chat.providers.chatsy.enabled, true);
  assert.equal(DEFAULTS.inbound.chat.providers.chatsy.updateAgentInfo, true);
  assert.equal(DEFAULTS.inbound.chat.providers.chatsy.agentId, null);
  assert.deepEqual(DEFAULTS.inbound.chat.providers.chatsy.plan, { id: 'max', name: 'Max' });
  assert.equal(DEFAULTS.inbound.chat.providers.chatsy.sponsorshipsUrl, null);
});

// ─── Baseline knowledge generation ───────────────────────────────────────────

test('chat: baseline knowledge fills every placeholder — including {website} inside the generated pricing', () => {
  const knowledge = getBaselineKnowledge(brandConfig());

  // omega-manager replaced {website} BEFORE inserting pricing, so agents
  // shipped with a literal "{website}/pricing" — the port replaces it last
  assert.deepEqual(knowledge.match(/\{[a-zA-Z]+\}/g), null);
  assert.ok(knowledge.includes(`Company Description: ${DESCRIPTION}`));
  assert.ok(knowledge.includes(`${URL}/pricing`));
  assert.ok(knowledge.includes('- Plus ($10/month or $100/year) (14-day free trial)'));
});

test('chat: pricing quotes the CATALOG\'s own words, formats free/unlimited, and skips archived ones', () => {
  // A product names only VALUES (#647); the catalog says what each id is
  // called, so the agent never quotes a raw config key at a customer.
  const knowledge = getBaselineKnowledge(brandConfig({
    features: {
      requests: { name: 'API Requests', usage: {} },
      seats: { name: 'Seats', usage: { pace: false } },
      support: { name: 'Priority support' },
    },
    products: [
      { id: 'free', name: 'Free', type: 'subscription' },
      { id: 'pro', name: 'Pro', type: 'subscription', prices: { monthly: 5 }, features: { requests: -1, seats: 3, support: true, sso: false } },
      { id: 'old', name: 'Old', type: 'subscription', prices: { monthly: 1 }, archived: true },
    ],
  }));

  assert.ok(knowledge.includes('- Free (free)'));
  assert.ok(
    knowledge.includes('- Pro ($5/month) - unlimited API Requests, 3 Seats, Priority support'),
    knowledge,
  );
  assert.ok(!knowledge.includes('sso'), 'a value of false is not part of the tier and is never mentioned');
  assert.ok(!knowledge.includes('- Old'));
});

test('chat: the sponsorships URL is config — default {website}/contact, not the company page', () => {
  const defaulted = getBaselineKnowledge(brandConfig());
  assert.ok(defaulted.includes(`Direct users to submit requests at ${URL}/contact`));
  assert.ok(!defaulted.includes('itwcreativeworks.com'));

  const overridden = getBaselineKnowledge(brandConfig({ chatsy: { sponsorshipsUrl: 'https://parent.test/sponsorship' } }));
  assert.ok(overridden.includes('Direct users to submit requests at https://parent.test/sponsorship'));
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('chat: chatsy.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ chatsy: { enabled: false } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /inbound\.chat\.providers\.chatsy\.enabled/);
});

test('chat: scalar chatsy: false skips the service', async () => {
  const result = await runService(brandConfig({ chatsy: false }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /inbound\.chat\.providers\.chatsy\.enabled/);
});

test('chat: a shared agent managed by another brand skips the service', async () => {
  const result = await runService(brandConfig({ chatsy: { updateAgentInfo: false } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /updateAgentInfo/);
});

test('chat: skips without a web target (the widget lives on the website)', async () => {
  const result = await runService(brandConfig({ targets: { backend: {} } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no web target/);
});

test('chat: skips without chatsy.agentId', async () => {
  const result = await runService(brandConfig({ chatsy: { agentId: null } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /inbound\.chat\.providers\.chatsy\.agentId/);
});

test('chat: skips without CHATSY_SERVICE_ACCOUNT in .env', async () => {
  const result = await runService(brandConfig()); // no injected db → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /CHATSY_SERVICE_ACCOUNT/);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('chat: fully converged brand is a zero-mutation no-op across both operations', async () => {
  const config = brandConfig();
  const db = fakeDb(convergedResponses(config));

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.deepEqual(db.reads(), [`agents/${AGENT_ID}`, `agents/${AGENT_ID}`, `users/${OWNER_UID}`]);
  assert.equal(result.state.agentId, AGENT_ID);
  assert.equal(result.state.accountId, OWNER_UID);
  assert.equal(result.output.chat.synced, true);
  assert.equal(result.output.user.synced, true);
});

test('chat: Chatsy-owned agent fields (owner, id, metadata) do not count as drift', async () => {
  const config = brandConfig();
  const agent = { ...desiredAgentDoc(config), id: AGENT_ID, metadata: { created: '2024-01-01' } };
  const db = fakeDb(convergedResponses(config, { agent }));

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
});

// ─── chat ────────────────────────────────────────────────────────────────────

test('chat: a drifted agent is patched with exactly the managed leaf fields', async () => {
  const config = brandConfig();
  const agent = { ...desiredAgentDoc(config), name: 'Old Name' };
  const db = fakeDb({ ...convergedResponses(config, { agent }), patchDoc: {} });

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  const [path, data, fieldPaths] = db.mutations()[0].args;
  assert.equal(path, `agents/${AGENT_ID}`);
  assert.equal(data.name, `${BRAND_NAME} Support`);
  assert.equal(data.settings.agent.image, BRANDMARK);
  assert.deepEqual(fieldPaths, [
    'name',
    'settings.welcomeMessage',
    'settings.agent.language',
    'settings.agent.image',
    'settings.autoTranslate',
    'settings.brand.name',
    'settings.brand.about',
    'settings.brand.website',
    'settings.brand.knowledge',
  ]);
  assert.equal(result.output.chat.updated, true);
});

test('chat: without a brandmark the agent image is not managed at all', async () => {
  const config = brandConfig({ images: {} });
  // Agent carries an existing image the brand can't express — not drift
  const agent = desiredAgentDoc(config);
  agent.settings.agent.image = 'https://chatsy.ai/some-existing-avatar.png';
  const db = fakeDb(convergedResponses(config, { agent }));

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
});

test('chat: config/chatsy.md is appended to the baseline with {website} replaced', async () => {
  const brandRoot = mkdtempSync(join(tmpdir(), 'omega-chatsy-'));
  mkdirSync(join(brandRoot, 'config'), { recursive: true });
  writeFileSync(join(brandRoot, 'config', 'chatsy.md'), 'Extra facts live at {website}/docs\n');

  const config = brandConfig();
  const expected = desiredAgentDoc(config, { brandKnowledge: `Extra facts live at ${URL}/docs` });
  const agent = desiredAgentDoc(config); // baseline-only knowledge → drift
  const db = fakeDb({ ...convergedResponses(config, { agent }), patchDoc: {} });

  const result = await runService(config, { db, brandRoot });

  assert.equal(result.status, 'success');
  const [, data] = db.mutations()[0].args;
  assert.equal(data.settings.brand.knowledge, expected.settings.brand.knowledge);
  assert.ok(data.settings.brand.knowledge.endsWith(`Extra facts live at ${URL}/docs`));
});

test('chat: an agentId pointing at no document errors instead of creating an orphan', async () => {
  const db = fakeDb({ getDoc: null });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'error');
  assert.deepEqual(db.mutations(), []);
  // stopOnError: the user operation never runs after the chat error
  assert.deepEqual(db.reads(), [`agents/${AGENT_ID}`]);
});

// ─── user ────────────────────────────────────────────────────────────────────

test('chat: a user on a lower plan is moved to the configured plan', async () => {
  const config = brandConfig();
  const db = fakeDb({
    ...convergedResponses(config, { user: { subscription: subscription('pro', 'Pro') } }),
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
      'subscription.payment.provider',
      'subscription.payment.frequency',
      'subscription.payment.price',
      'subscription.payment.resourceId',
      'subscription.payment.orderId',
    ],
  ]]);
  assert.equal(result.output.user.updated, true);
  assert.equal(result.state.accountId, OWNER_UID);
});

test('chat: chatsy.plan overrides the default tier', async () => {
  const config = brandConfig({ chatsy: { plan: { id: 'pro', name: 'Pro' } } });
  const db = fakeDb({
    ...convergedResponses(config, { user: { subscription: subscription() } }),
    patchDoc: {},
  });

  const result = await runService(config, { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations()[0].args[1].subscription.product, { id: 'pro', name: 'Pro' });
  assert.equal(result.output.user.plan, 'pro');
});

test('chat: an agent without an owner field errors the user operation', async () => {
  const config = brandConfig();
  const agent = desiredAgentDoc(config);
  delete agent.owner;
  const db = fakeDb(convergedResponses(config, { agent }));

  const result = await runService(config, { db });

  assert.equal(result.status, 'error');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.chat.synced, true); // the chat op itself passed
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('chat: dry run on a fully drifted brand performs zero mutations', async () => {
  const config = brandConfig();
  const db = fakeDb({
    getDoc: (path) => (path === `agents/${AGENT_ID}`
      ? { name: 'Old Name', owner: OWNER_UID, settings: {} }
      : null),
  });

  const result = await runService(config, { db, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.chat.planned, 'update');
  assert.equal(result.output.user.planned, 'max');
  // no durable state lands in a dry run
  assert.equal(result.state, null);
});

// ─── Interactive setup flow (config-landing) ─────────────────────────────────

const DOWN_KEY = '\x1B[B';

const WRITEBACK_CONFIG = `{
  // Fixture Brand — chatsy writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  inbound: { chat: { providers: { chatsy: { enabled: true } } } }, // agentId lands here
}
`;

test('setup: interactive run lands the pasted agent id in omega.json5 and proceeds', async () => {
  const config = brandConfig({ chatsy: { agentId: null } });
  const db = fakeDb(convergedResponses(config));
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const run = runService(config, { db, brandRoot });
    await tty.answer('Set up now?', '\r'); // Yes
    await tty.answer('Chatsy agent ID:', `${AGENT_ID}\r`);
    const result = await run;

    assert.equal(result.state.agentId, AGENT_ID); // the landed id drove the run
    assert.deepEqual(opened, ['https://chatsy.ai']);
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes(`agentId: "${AGENT_ID}"`));
    assert.ok(written.includes('// agentId lands here')); // comment survived
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('setup: interactive Disable writes chatsy: false and skips the service', async () => {
  const config = brandConfig({ chatsy: { agentId: null } });
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const tty = openTtyPrompt();

  try {
    const run = runService(config, { db: fakeDb({}), brandRoot });
    await tty.answer('Set up now?', `${DOWN_KEY}${DOWN_KEY}\r`); // Disable (stop prompting)
    const result = await run;

    assert.equal(result.status, 'skipped');
    assert.ok(readConfigSource(brandRoot).includes('inbound: { chat: { providers: { chatsy: false } } }, // agentId lands here'));
  } finally {
    tty.close();
  }
});

// ─── 2b create-on-missing (operator SA mints the brand's own agent) ──────────

test('chat 2b: missing agentId + SA + template donor mints the brand-owned agent', async (t) => {
  process.env.OMEGA_ACCOUNT_PASSWORD__SUPPORT_FIXTURE_BRAND_TEST = 'fixture-password-123';
  t.after(() => delete process.env.OMEGA_ACCOUNT_PASSWORD__SUPPORT_FIXTURE_BRAND_TEST);

  const docs = { 'agents/tmplAgent1': { name: 'Donor Agent', owner: 'uid_donor', settings: { welcomeMessage: 'hi' } } };
  const store = {
    getDoc: async (p) => structuredClone(docs[p] ?? null),
    setDoc: async (p, d) => { docs[p] = structuredClone(d); return {}; },
    patchDoc: async () => ({}),
  };
  const authAdmin = {
    getUserByEmail: async () => null,
    createUser: async ({ email }) => ({ uid: 'uid_minted2', email }),
  };
  const config = brandConfig({ chatsy: { agentId: null, templateAgentId: 'tmplAgent1' } });
  config.brand.contact = { email: 'support@fixture-brand.test' };
  const brandRoot = makeBrandRoot(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  inbound: { chat: { providers: { chatsy: { enabled: true, templateAgentId: "tmplAgent1" } } } },
}
`);

  const result = await service.run({
    brandId: 'fixture-brand',
    brandRoot,
    brandConfig: config,
    brand: { id: 'fixture-brand', config: {}, enabledTargets: ['web', 'backend'], targets: [] },
    targets: [],
    operations: OPERATIONS.chat,
    options: {},
    serviceData: {},
    chatsyDb: store,
    chatsyAuthAdmin: authAdmin,
  });

  assert.equal(result.status, 'success');
  const agentId = result.state.agentId;
  assert.match(agentId, /^[A-Za-z0-9]{14}$/, 'minted id matches the product convention');
  assert.equal(docs[`agents/${agentId}`].owner, 'uid_minted2', 'minted agent owned by the new user');
  assert.ok(docs['users/uid_minted2'], 'product user doc written');
  assert.match(docs['users/uid_minted2'].api.privateKey, /^[A-Za-z0-9]{43}$/, 'real api key generated');
  assert.ok(readConfigSource(brandRoot).includes(`agentId: "${agentId}"`), 'minted id written back');
});
