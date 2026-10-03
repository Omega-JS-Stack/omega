/**
 * Email service tests — both operations against a method-level recording
 * fake of the Firestore REST client. Proves skip semantics (incl. the
 * backend-target gate and the shared-agent updateAgentInfo gate), the
 * converged zero-mutation no-op, baseline generation (the de-ITW'd
 * discount section gated on config, the company sponsorship block gone),
 * the filter-query composition (auto-generated and file-provided), the
 * config/replyify.md parser across all four formats, agent diff-sync with
 * leaf masks, the owner-plan reconciliation through the shared lib, and
 * the dry-run guarantee.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { getBaselineKnowledge, getBaselineFilter } = require('../src/services/email/lib/baseline.js');
const { parseKnowledgeFile } = require('../src/services/email/lib/knowledge-file.js');
const service = require('../src/services/email/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.REPLYIFY_SERVICE_ACCOUNT;

const BRAND_NAME = 'Fixture Brand';
const DOMAIN = 'fixture-brand.test';
const URL = `https://${DOMAIN}`;
const DESCRIPTION = 'A fixture brand';
const AGENT_ID = 'agent_fixture1';
const OWNER_UID = 'uid_owner1';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ replyify = {}, targets = { web: { type: 'web' }, backend: { type: 'backend' } } } = {}) {
  return {
    brand: { id: 'fixture-brand', name: BRAND_NAME, url: URL, description: DESCRIPTION },
    inbound: {
      email: {
        providers: {
          replyify: replyify === false
            ? false
            : { ...structuredClone(DEFAULTS.inbound.email.providers.replyify), agentId: AGENT_ID, ...replyify },
        },
      },
    },
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
    brandRoot: brandRoot || '/tmp/omega-manager-replyify-nonexistent', // no config/replyify.md → baseline only
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.email,
    options,
    serviceData,
    replyifyDb: db,
  });
}

// ─── Interactive setup flow (config-landing) ─────────────────────────────────

const { setBrowserOpener: setOpener } = require('@omega.js/devkit/flows');
const { makeBrandRoot: makeRoot, readConfigSource: readSource } = require('./lib/config-fixture.js');
const { openTtyPrompt: openTty } = require('./lib/interactive.js');

module.exports = defineCases({
  type: 'group',
  description: 'email',
  tests: [
    // ─── Registry / defaults pins ────────────────────────────────────────────────

    {
      name: 'email: registered after chat with the agent + user operations',
      run: (ctx) => {
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('chat') + 1]).toBe('email');
        ctx.expect(OPERATIONS.email.map((o) => o.name)).toEqual(['agent', 'user']);
      },
    },

    {
      name: 'email: defaults carry no agentId, Replyify\'s top tier, and no discount',
      run: (ctx) => {
        ctx.expect(DEFAULTS.inbound.email.providers.replyify.enabled).toBe(true);
        ctx.expect(DEFAULTS.inbound.email.providers.replyify.updateAgentInfo).toBe(true);
        ctx.expect(DEFAULTS.inbound.email.providers.replyify.agentId).toBe(null);
        ctx.expect(DEFAULTS.inbound.email.providers.replyify.plan).toEqual({ id: 'max', name: 'Max' });
        ctx.expect(DEFAULTS.inbound.email.providers.replyify.discount).toBe(null);
      },
    },

    // ─── Baseline generation ─────────────────────────────────────────────────────

    {
      name: 'email: the baseline carries no company values and no discount section by default',
      run: (ctx) => {
        const knowledge = getBaselineKnowledge(brandConfig(), DOMAIN);

        // omega-manager's baseline shipped the company sponsorship business block
        // (guest-post rules, itwcreativeworks.com/sponsorship, WELCOME10) and a
        // hardcoded GIFT15 discount for every brand — all gone from the package
        ctx.expect(!knowledge.includes('itwcreativeworks')).toBeTruthy();
        ctx.expect(!knowledge.includes('GIFT15')).toBeTruthy();
        ctx.expect(!knowledge.includes('WELCOME10')).toBeTruthy();
        ctx.expect(!knowledge.includes('<sponsorships')).toBeTruthy();
        ctx.expect(!knowledge.includes('<discount')).toBeTruthy();
        ctx.expect(knowledge.match(/\{[^}]+\}/g)).toEqual(null); // every placeholder filled
        ctx.expect(knowledge.includes(`${URL}/account#billing`)).toBeTruthy();
      },
    },

    {
      name: 'email: replyify.discount renders the discount section with the configured code',
      run: (ctx) => {
        const knowledge = getBaselineKnowledge(
          brandConfig({ replyify: { discount: { code: 'SAVE20', label: '20% off' } } }),
          DOMAIN,
        );

        ctx.expect(knowledge.includes('<discount followup="0">')).toBeTruthy();
        ctx.expect(knowledge.includes('Discount code: SAVE20 (20% off).')).toBeTruthy();
        ctx.expect(knowledge.includes(`${URL}/pricing?utm_source=replyify`)).toBeTruthy();
        // The section sits inside billing_payments, between subscription and refund
        ctx.expect(knowledge.indexOf('</subscription>') < knowledge.indexOf('<discount')).toBeTruthy();
        ctx.expect(knowledge.indexOf('</discount>') < knowledge.indexOf('<refund')).toBeTruthy();
      },
    },

    {
      name: 'email: the baseline filter excludes the brand\'s transactional addresses',
      run: (ctx) => {
        ctx.expect(getBaselineFilter(brandConfig(), DOMAIN)).toBe(`-to:(\n  alerts@${DOMAIN}\n  OR account@${DOMAIN}\n)`);
      },
    },

    // ─── config/replyify.md parser ───────────────────────────────────────────────

    {
      name: 'email: parseKnowledgeFile handles all four file formats',
      run: (ctx) => {
        ctx.expect(parseKnowledgeFile('---filter---\n(to:(@x.test))\n---knowledge---\nExtra facts')).toEqual({ filterQuery: '(to:(@x.test))', knowledge: 'Extra facts' });
        ctx.expect(parseKnowledgeFile('---filter---\n(to:(@x.test))')).toEqual({ filterQuery: '(to:(@x.test))', knowledge: '' });
        ctx.expect(parseKnowledgeFile('---knowledge---\nExtra facts')).toEqual({ filterQuery: null, knowledge: 'Extra facts' });
        ctx.expect(parseKnowledgeFile('Just knowledge, no delimiters')).toEqual({ filterQuery: null, knowledge: 'Just knowledge, no delimiters' });
      },
    },

    // ─── Setup / skip semantics ──────────────────────────────────────────────────

    {
      name: 'email: replyify.enabled = false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ replyify: { enabled: false } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/inbound\.email\.providers\.replyify\.enabled/);
      },
    },

    {
      name: 'email: scalar replyify: false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ replyify: false }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/inbound\.email\.providers\.replyify\.enabled/);
      },
    },

    {
      name: 'email: a shared agent managed by another brand skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ replyify: { updateAgentInfo: false } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/updateAgentInfo/);
      },
    },

    {
      name: 'email: skips without a backend target (the agent answers the backend\'s support email)',
      run: async (ctx) => {
        const result = await runService(brandConfig({ targets: { web: { type: 'web' } } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/no backend target/);
      },
    },

    // The gate is by TYPE (#886): a brand may name its backend target anything
    {
      name: 'email: a backend target named `api` runs the service, key spelling is not the gate',
      run: async (ctx) => {
        const config = brandConfig({ targets: { site: { type: 'web' }, api: { type: 'backend' } } });
        const result = await runService(config, { db: fakeDb(convergedResponses(config)) });

        ctx.expect(result.status).not.toBe('skipped');
      },
    },

    {
      name: 'email: skips without replyify.agentId',
      run: async (ctx) => {
        const result = await runService(brandConfig({ replyify: { agentId: null } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/inbound\.email\.providers\.replyify\.agentId/);
      },
    },

    {
      name: 'email: skips without REPLYIFY_SERVICE_ACCOUNT in .env',
      run: async (ctx) => {
        const result = await runService(brandConfig()); // no injected db → the creds check applies
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/REPLYIFY_SERVICE_ACCOUNT/);
      },
    },

    // ─── Converged no-op ─────────────────────────────────────────────────────────

    {
      name: 'email: fully converged brand is a zero-mutation no-op across both operations',
      run: async (ctx) => {
        const config = brandConfig();
        const db = fakeDb(convergedResponses(config));

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(db.reads()).toEqual([`agents/${AGENT_ID}`, `agents/${AGENT_ID}`, `users/${OWNER_UID}`]);
        ctx.expect(result.state.agentId).toBe(AGENT_ID);
        ctx.expect(result.state.ownerUid).toBe(OWNER_UID);
        ctx.expect(result.output.agent.synced).toBe(true);
        ctx.expect(result.output.user.synced).toBe(true);
      },
    },

    {
      name: 'email: Replyify-owned agent fields (owner, id, other settings) do not count as drift',
      run: async (ctx) => {
        const config = brandConfig();
        const agent = { ...desiredAgentDoc(config), id: AGENT_ID, metadata: { created: '2024-01-01' } };
        agent.settings.signature = 'Keep me';
        const db = fakeDb(convergedResponses(config, { agent }));

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
      },
    },

    // ─── agent ───────────────────────────────────────────────────────────────────

    {
      name: 'email: a drifted agent is patched with exactly the managed leaf fields',
      run: async (ctx) => {
        const config = brandConfig();
        const agent = { ...desiredAgentDoc(config), name: 'Old Name' };
        const db = fakeDb({ ...convergedResponses(config, { agent }), patchDoc: {} });

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('success');
        const [path, data, fieldPaths] = db.mutations()[0].args;
        ctx.expect(path).toBe(`agents/${AGENT_ID}`);
        ctx.expect(data.name).toBe(`${BRAND_NAME} - Customer Service`);
        // The auto-generated brand filter ANDed with the baseline exclusions
        ctx.expect(data.settings.filter.query).toBe(`(\n  to:(\n    @${DOMAIN}\n  )\n)\nAND\n-to:(\n  alerts@${DOMAIN}\n  OR account@${DOMAIN}\n)`);
        ctx.expect(fieldPaths).toEqual([
          'name',
          'settings.filter.query',
          'settings.brand.name',
          'settings.brand.about',
          'settings.brand.website',
          'settings.brand.knowledge',
        ]);
        ctx.expect(result.output.agent.updated).toBe(true);
      },
    },

    {
      name: 'email: config/replyify.md provides the filter and appends knowledge',
      run: async (ctx) => {
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

        ctx.expect(result.status).toBe('success');
        const [, data] = db.mutations()[0].args;
        ctx.expect(data.settings.filter.query).toBe(expected.settings.filter.query);
        ctx.expect(data.settings.brand.knowledge).toBe(expected.settings.brand.knowledge);
        ctx.expect(data.settings.brand.knowledge.endsWith('We ship worldwide.')).toBeTruthy();
      },
    },

    {
      name: 'email: an agentId pointing at no document errors instead of creating an orphan',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('error');
        ctx.expect(db.mutations()).toEqual([]);
        // stopOnError: the user operation never runs after the agent error
        ctx.expect(db.reads()).toEqual([`agents/${AGENT_ID}`]);
      },
    },

    // ─── user ────────────────────────────────────────────────────────────────────

    {
      name: 'email: a user on a lower plan is moved to the configured plan',
      run: async (ctx) => {
        const config = brandConfig();
        const db = fakeDb({
          ...convergedResponses(config, { user: { subscription: subscription('plus', 'Plus') } }),
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
        ctx.expect(result.state.ownerUid).toBe(OWNER_UID);
      },
    },

    {
      name: 'email: replyify.plan overrides the default tier',
      run: async (ctx) => {
        const config = brandConfig({ replyify: { plan: { id: 'pro', name: 'Pro' } } });
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
      name: 'email: an agent without an owner field errors the user operation',
      run: async (ctx) => {
        const config = brandConfig();
        const agent = desiredAgentDoc(config);
        delete agent.owner;
        const db = fakeDb(convergedResponses(config, { agent }));

        const result = await runService(config, { db });

        ctx.expect(result.status).toBe('error');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.agent.synced).toBe(true); // the agent op itself passed
      },
    },

    // ─── Dry run ─────────────────────────────────────────────────────────────────

    {
      name: 'email: dry run on a fully drifted brand performs zero mutations',
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
        ctx.expect(result.output.agent.planned).toBe('update');
        ctx.expect(result.output.user.planned).toBe('max');
        // no durable state lands in a dry run
        ctx.expect(result.state).toBe(null);
      },
    },

    {
      name: 'setup: interactive run lands the pasted agent id in omega.json5 and proceeds',
      run: async (ctx) => {
        const config = brandConfig({ replyify: { agentId: null } });
        const db = fakeDb(convergedResponses(config));
        const brandRoot = makeRoot(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  inbound: { email: { providers: { replyify: { enabled: true } } } }, // agentId lands here
}
`);
        const opened = [];
        setOpener(async (url) => { opened.push(url); return true; });
        const tty = openTty();

        try {
          const run = runService(config, { db, brandRoot });
          await tty.answer('Set up now?', '\r'); // Yes
          await tty.answer('Replyify agent ID:', `${AGENT_ID}\r`);
          const result = await run;

          ctx.expect(result.state.agentId).toBe(AGENT_ID);
          ctx.expect(opened).toEqual(['https://replyify.app']);
          const written = readSource(brandRoot);
          ctx.expect(written.includes(`agentId: "${AGENT_ID}"`)).toBeTruthy();
          ctx.expect(written.includes('// agentId lands here')).toBeTruthy();
        } finally {
          tty.close();
          setOpener(null);
        }
      },
    },

    // ─── 2b create-on-missing (operator SA mints the brand's own agent) ──────────

    {
      name: 'email 2b: missing agentId + SA + template donor mints the brand-owned agent',
      run: async (ctx) => {
        process.env.OMEGA_ACCOUNT_PASSWORD__SUPPORT_FIXTURE_BRAND_TEST = 'fixture-password-123';
        ctx.after(() => delete process.env.OMEGA_ACCOUNT_PASSWORD__SUPPORT_FIXTURE_BRAND_TEST);

        const docs = { 'agents/tmplAgent1': { name: 'Donor Agent', owner: 'uid_donor', filter: { query: 'to:(donor)' } } };
        const store = {
          getDoc: async (p) => structuredClone(docs[p] ?? null),
          setDoc: async (p, d) => { docs[p] = structuredClone(d); return {}; },
          patchDoc: async () => ({}),
        };
        const authAdmin = {
          getUserByEmail: async () => null,
          createUser: async ({ email }) => ({ uid: 'uid_minted3', email }),
        };
        const config = brandConfig({ replyify: { agentId: null, templateAgentId: 'tmplAgent1' } });
        config.brand.contact = { email: 'support@fixture-brand.test' };
        const brandRoot = makeRoot(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  inbound: { email: { providers: { replyify: { enabled: true, templateAgentId: "tmplAgent1" } } } },
}
`);

        const result = await service.run({
          brandId: 'fixture-brand',
          brandRoot,
          brandConfig: config,
          brand: { id: 'fixture-brand', config: {}, enabledTargets: ['web', 'backend'], targets: [] },
          targets: [],
          operations: OPERATIONS.email,
          options: {},
          serviceData: {},
          replyifyDb: store,
          replyifyAuthAdmin: authAdmin,
        });

        ctx.expect(result.status).toBe('success');
        const agentId = result.state.agentId;
        ctx.expect(agentId, 'minted id matches the product convention').toMatch(/^[A-Za-z0-9]{14}$/);
        ctx.expect(docs[`agents/${agentId}`].owner, 'minted agent owned by the new user').toBe('uid_minted3');
        ctx.expect(docs['users/uid_minted3'], 'product user doc written').toBeTruthy();
        ctx.expect(readSource(brandRoot).includes(`agentId: "${agentId}"`), 'minted id written back').toBeTruthy();
      },
    },
  ],
});
