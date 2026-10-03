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
const defineCases = require('@omega.js/devkit/test/define-cases');
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

function brandConfig({ chatsy = {}, targets = { web: { type: 'web' }, backend: { type: 'backend' } }, images = { brandmark: BRANDMARK }, products, features } = {}) {
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

// ─── Interactive setup flow (config-landing) ─────────────────────────────────

const DOWN_KEY = '\x1B[B';

const WRITEBACK_CONFIG = `{
  // Fixture Brand — chatsy writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  inbound: { chat: { providers: { chatsy: { enabled: true } } } }, // agentId lands here
}
`;

module.exports = defineCases({
  type: 'group',
  description: 'chat',
  tests: [
    // ─── Registry / defaults pins ────────────────────────────────────────────────

    {
      name: 'chat: registered after forms with the chat + user operations',
      run: (ctx) => {
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('forms') + 1]).toBe('chat');
        ctx.expect(OPERATIONS.chat.map((o) => o.name)).toEqual(['chat', 'user']);
      },
    },

    // #23 D4 — ONE chatsy home. The dotted path pinned here is the SAME string
    // @omega.js/client reads (pinned on that side in packages/web's
    // test/config-rekey.test.js): rename one without the other and both break.
    {
      name: 'chat: the agent id lands at inbound.chat.providers.chatsy.agentId — the path the client reads',
      run: (ctx) => {
        const source = fs.readFileSync(require.resolve('../src/services/chat/index.js'), 'utf8');

        ctx.expect(source.includes("landValue(context, 'inbound.chat.providers.chatsy.agentId'"), 'the mint writeback lands the ONE path').toBeTruthy();
        ctx.expect(source.includes("path: 'inbound.chat.providers.chatsy.agentId'"), 'the interactive flow lands the ONE path').toBeTruthy();
        ctx.expect(source.includes("disablePath: 'inbound.chat.providers.chatsy'"), 'Disable writes false at the section, not at a stale top-level key').toBeTruthy();
        ctx.expect(!/'chatsy\.agentId'/.test(source), 'no bare chatsy.* path survives').toBeTruthy();
      },
    },

    {
      name: 'chat: the widget settings share the provisioning home — schema-declared, one place',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('@omega.js/config');
        const paths = SHARED_SCHEMA.map((entry) => entry.path);

        ctx.expect(paths.includes('inbound.chat.providers.chatsy.agentId')).toBeTruthy();
        ctx.expect(paths.includes('inbound.chat.providers.chatsy.settings')).toBeTruthy();
      },
    },

    {
      name: 'chat: defaults carry no agentId, Chatsy\'s top tier, and no company sponsorship URL',
      run: (ctx) => {
        ctx.expect(DEFAULTS.inbound.chat.providers.chatsy.enabled).toBe(true);
        ctx.expect(DEFAULTS.inbound.chat.providers.chatsy.updateAgentInfo).toBe(true);
        ctx.expect(DEFAULTS.inbound.chat.providers.chatsy.agentId).toBe(null);
        ctx.expect(DEFAULTS.inbound.chat.providers.chatsy.plan).toEqual({ id: 'max', name: 'Max' });
        ctx.expect(DEFAULTS.inbound.chat.providers.chatsy.sponsorshipsUrl).toBe(null);
      },
    },

    // ─── Baseline knowledge generation ───────────────────────────────────────────

    {
      name: 'chat: baseline knowledge fills every placeholder — including {website} inside the generated pricing',
      run: (ctx) => {
        const knowledge = getBaselineKnowledge(brandConfig());

        // omega-manager replaced {website} BEFORE inserting pricing, so agents
        // shipped with a literal "{website}/pricing" — the port replaces it last
        ctx.expect(knowledge.match(/\{[a-zA-Z]+\}/g)).toEqual(null);
        ctx.expect(knowledge.includes(`Company Description: ${DESCRIPTION}`)).toBeTruthy();
        ctx.expect(knowledge.includes(`${URL}/pricing`)).toBeTruthy();
        ctx.expect(knowledge.includes('- Plus ($10/month or $100/year) (14-day free trial)')).toBeTruthy();
      },
    },

    {
      name: 'chat: pricing quotes the CATALOG\'s own words, formats free/unlimited, and skips archived ones',
      run: (ctx) => {
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

        ctx.expect(knowledge.includes('- Free (free)')).toBeTruthy();
        ctx.expect(knowledge.includes('- Pro ($5/month) - unlimited API Requests, 3 Seats, Priority support'), knowledge).toBeTruthy();
        ctx.expect(!knowledge.includes('sso'), 'a value of false is not part of the tier and is never mentioned').toBeTruthy();
        ctx.expect(!knowledge.includes('- Old')).toBeTruthy();
      },
    },

    {
      name: 'chat: the sponsorships URL is config — default {website}/contact, not the company page',
      run: (ctx) => {
        const defaulted = getBaselineKnowledge(brandConfig());
        ctx.expect(defaulted.includes(`Direct users to submit requests at ${URL}/contact`)).toBeTruthy();
        ctx.expect(!defaulted.includes('itwcreativeworks.com')).toBeTruthy();

        const overridden = getBaselineKnowledge(brandConfig({ chatsy: { sponsorshipsUrl: 'https://parent.test/sponsorship' } }));
        ctx.expect(overridden.includes('Direct users to submit requests at https://parent.test/sponsorship')).toBeTruthy();
      },
    },

    // ─── Setup / skip semantics ──────────────────────────────────────────────────

    {
      name: 'chat: chatsy.enabled = false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ chatsy: { enabled: false } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/inbound\.chat\.providers\.chatsy\.enabled/);
      },
    },

    {
      name: 'chat: scalar chatsy: false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ chatsy: false }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/inbound\.chat\.providers\.chatsy\.enabled/);
      },
    },

    {
      name: 'chat: a shared agent managed by another brand skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ chatsy: { updateAgentInfo: false } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/updateAgentInfo/);
      },
    },

    {
      name: 'chat: skips without a web target (the widget lives on the website)',
      run: async (ctx) => {
        const result = await runService(brandConfig({ targets: { backend: { type: 'backend' } } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/no web target/);
      },
    },

    // The gate is by TYPE (#886): a brand may name its web target anything
    {
      name: 'chat: a web target named `site` runs the service, key spelling is not the gate',
      run: async (ctx) => {
        const config = brandConfig({ targets: { site: { type: 'web' }, api: { type: 'backend' } } });
        const result = await runService(config, { db: fakeDb(convergedResponses(config)) });

        ctx.expect(result.status).not.toBe('skipped');
      },
    },

    {
      name: 'chat: skips without chatsy.agentId',
      run: async (ctx) => {
        const result = await runService(brandConfig({ chatsy: { agentId: null } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/inbound\.chat\.providers\.chatsy\.agentId/);
      },
    },

    {
      name: 'chat: skips without CHATSY_SERVICE_ACCOUNT in .env',
      run: async (ctx) => {
        const result = await runService(brandConfig()); // no injected db → the creds check applies
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/CHATSY_SERVICE_ACCOUNT/);
      },
    },

    // ─── Converged no-op ─────────────────────────────────────────────────────────

    {
      name: 'chat: fully converged brand is a zero-mutation no-op across both operations',
      run: async (ctx) => {
        const config = brandConfig();
        const db = fakeDb(convergedResponses(config));

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(db.reads()).toEqual([`agents/${AGENT_ID}`, `agents/${AGENT_ID}`, `users/${OWNER_UID}`]);
        ctx.expect(result.state.agentId).toBe(AGENT_ID);
        ctx.expect(result.state.accountId).toBe(OWNER_UID);
        ctx.expect(result.output.chat.synced).toBe(true);
        ctx.expect(result.output.user.synced).toBe(true);
      },
    },

    {
      name: 'chat: Chatsy-owned agent fields (owner, id, metadata) do not count as drift',
      run: async (ctx) => {
        const config = brandConfig();
        const agent = { ...desiredAgentDoc(config), id: AGENT_ID, metadata: { created: '2024-01-01' } };
        const db = fakeDb(convergedResponses(config, { agent }));

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
      },
    },

    // ─── chat ────────────────────────────────────────────────────────────────────

    {
      name: 'chat: a drifted agent is patched with exactly the managed leaf fields',
      run: async (ctx) => {
        const config = brandConfig();
        const agent = { ...desiredAgentDoc(config), name: 'Old Name' };
        const db = fakeDb({ ...convergedResponses(config, { agent }), patchDoc: {} });

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        const [path, data, fieldPaths] = db.mutations()[0].args;
        ctx.expect(path).toBe(`agents/${AGENT_ID}`);
        ctx.expect(data.name).toBe(`${BRAND_NAME} Support`);
        ctx.expect(data.settings.agent.image).toBe(BRANDMARK);
        ctx.expect(fieldPaths).toEqual([
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
        ctx.expect(result.output.chat.updated).toBe(true);
      },
    },

    {
      name: 'chat: without a brandmark the agent image is not managed at all',
      run: async (ctx) => {
        const config = brandConfig({ images: {} });
        // Agent carries an existing image the brand can't express — not drift
        const agent = desiredAgentDoc(config);
        agent.settings.agent.image = 'https://chatsy.ai/some-existing-avatar.png';
        const db = fakeDb(convergedResponses(config, { agent }));

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
      },
    },

    {
      name: 'chat: config/chatsy.md is appended to the baseline with {website} replaced',
      run: async (ctx) => {
        const brandRoot = mkdtempSync(join(tmpdir(), 'omega-chatsy-'));
        mkdirSync(join(brandRoot, 'config'), { recursive: true });
        writeFileSync(join(brandRoot, 'config', 'chatsy.md'), 'Extra facts live at {website}/docs\n');

        const config = brandConfig();
        const expected = desiredAgentDoc(config, { brandKnowledge: `Extra facts live at ${URL}/docs` });
        const agent = desiredAgentDoc(config); // baseline-only knowledge → drift
        const db = fakeDb({ ...convergedResponses(config, { agent }), patchDoc: {} });

        const result = await runService(config, { db, brandRoot });

        ctx.expect(result.status).toBe('success');
        const [, data] = db.mutations()[0].args;
        ctx.expect(data.settings.brand.knowledge).toBe(expected.settings.brand.knowledge);
        ctx.expect(data.settings.brand.knowledge.endsWith(`Extra facts live at ${URL}/docs`)).toBeTruthy();
      },
    },

    {
      name: 'chat: an agentId pointing at no document errors instead of creating an orphan',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('error');
        ctx.expect(db.mutations()).toEqual([]);
        // stopOnError: the user operation never runs after the chat error
        ctx.expect(db.reads()).toEqual([`agents/${AGENT_ID}`]);
      },
    },

    // ─── user ────────────────────────────────────────────────────────────────────

    {
      name: 'chat: a user on a lower plan is moved to the configured plan',
      run: async (ctx) => {
        const config = brandConfig();
        const db = fakeDb({
          ...convergedResponses(config, { user: { subscription: subscription('pro', 'Pro') } }),
          patchDoc: {},
        });

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().map((c) => c.args)).toEqual([[
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
        ctx.expect(result.output.user.updated).toBe(true);
        ctx.expect(result.state.accountId).toBe(OWNER_UID);
      },
    },

    {
      name: 'chat: chatsy.plan overrides the default tier',
      run: async (ctx) => {
        const config = brandConfig({ chatsy: { plan: { id: 'pro', name: 'Pro' } } });
        const db = fakeDb({
          ...convergedResponses(config, { user: { subscription: subscription() } }),
          patchDoc: {},
        });

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()[0].args[1].subscription.product).toEqual({ id: 'pro', name: 'Pro' });
        ctx.expect(result.output.user.plan).toBe('pro');
      },
    },

    {
      name: 'chat: an agent without an owner field errors the user operation',
      run: async (ctx) => {
        const config = brandConfig();
        const agent = desiredAgentDoc(config);
        delete agent.owner;
        const db = fakeDb(convergedResponses(config, { agent }));

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('error');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.chat.synced).toBe(true); // the chat op itself passed
      },
    },

    // ─── Dry run ─────────────────────────────────────────────────────────────────

    {
      name: 'chat: dry run on a fully drifted brand performs zero mutations',
      run: async (ctx) => {
        const config = brandConfig();
        const db = fakeDb({
          getDoc: (path) => (path === `agents/${AGENT_ID}`
            ? { name: 'Old Name', owner: OWNER_UID, settings: {} }
            : null),
        });

        const result = await runService(config, { db, options: { dryRun: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.chat.planned).toBe('update');
        ctx.expect(result.output.user.planned).toBe('max');
        // no durable state lands in a dry run
        ctx.expect(result.state).toBe(null);
      },
    },

    {
      name: 'setup: interactive run lands the pasted agent id in omega.json5 and proceeds',
      run: async (ctx) => {
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

          ctx.expect(result.state.agentId).toBe(AGENT_ID); // the landed id drove the run
          ctx.expect(opened).toEqual(['https://chatsy.ai']);
          const written = readConfigSource(brandRoot);
          ctx.expect(written.includes(`agentId: "${AGENT_ID}"`)).toBeTruthy();
          ctx.expect(written.includes('// agentId lands here')).toBeTruthy(); // comment survived
        } finally {
          tty.close();
          setBrowserOpener(null);
        }
      },
    },

    {
      name: 'setup: interactive Disable writes chatsy: false and skips the service',
      run: async (ctx) => {
        const config = brandConfig({ chatsy: { agentId: null } });
        const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
        const tty = openTtyPrompt();

        try {
          const run = runService(config, { db: fakeDb({}), brandRoot });
          await tty.answer('Set up now?', `${DOWN_KEY}${DOWN_KEY}\r`); // Disable (stop prompting)
          const result = await run;

          ctx.expect(result.status).toBe('skipped');
          ctx.expect(readConfigSource(brandRoot).includes('inbound: { chat: { providers: { chatsy: false } } }, // agentId lands here')).toBeTruthy();
        } finally {
          tty.close();
        }
      },
    },

    // ─── 2b create-on-missing (operator SA mints the brand's own agent) ──────────

    {
      name: 'chat 2b: missing agentId + SA + template donor mints the brand-owned agent',
      run: async (ctx) => {
        process.env.OMEGA_ACCOUNT_PASSWORD__SUPPORT_FIXTURE_BRAND_TEST = 'fixture-password-123';
        ctx.after(() => delete process.env.OMEGA_ACCOUNT_PASSWORD__SUPPORT_FIXTURE_BRAND_TEST);

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

        ctx.expect(result.status).toBe('success');
        const agentId = result.state.agentId;
        ctx.expect(agentId, 'minted id matches the product convention').toMatch(/^[A-Za-z0-9]{14}$/);
        ctx.expect(docs[`agents/${agentId}`].owner, 'minted agent owned by the new user').toBe('uid_minted2');
        ctx.expect(docs['users/uid_minted2'], 'product user doc written').toBeTruthy();
        ctx.expect(docs['users/uid_minted2'].api.privateKey, 'real api key generated').toMatch(/^[A-Za-z0-9]{43}$/);
        ctx.expect(readConfigSource(brandRoot).includes(`agentId: "${agentId}"`), 'minted id written back').toBeTruthy();
      },
    },
  ],
});
