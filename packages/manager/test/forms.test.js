/**
 * Forms service tests — both operations against a method-level recording
 * fake of the Firestore REST client. Proves skip semantics, the converged
 * zero-mutation no-op, form diff-sync (name + enabled), the form-not-found
 * error (omega-manager silently created an orphan doc there), owner-account
 * plan reconciliation with leaf-masked patches that preserve sibling
 * subscription fields, the config plan override, the dry-run zero-mutation
 * guarantee, and the typed-value encode/decode round-trip.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { encodeFields, decodeFields } = require('../src/lib/firestore-rest.js');
const service = require('../src/services/forms/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.SLAPFORM_SERVICE_ACCOUNT;

const BRAND_NAME = 'Fixture Brand';
const FORM_ID = 'form_fixture1';
const OWNER_UID = 'uid_owner1';
const FORM_NAME = `Contact Form - ${BRAND_NAME}`;

const SUBSCRIPTION_FIELD_PATHS = [
  'subscription.product.id',
  'subscription.product.name',
  'subscription.status',
  'subscription.payment.provider',
  'subscription.payment.frequency',
  'subscription.payment.price',
  'subscription.payment.resourceId',
  'subscription.payment.orderId',
];

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ slapform = {}, targets = { web: { type: 'web' }, backend: { type: 'backend' } } } = {}) {
  return {
    brand: { id: 'fixture-brand', name: BRAND_NAME, url: 'https://fixture-brand.test' },
    forms: {
      providers: {
        slapform: slapform === false
          ? false
          : { ...structuredClone(DEFAULTS.forms.providers.slapform), formId: FORM_ID, ...slapform },
      },
    },
    targets,
  };
}

function subscription(planId = 'grandmaster', planName = 'Grandmaster') {
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
function convergedResponses({ form, user } = {}) {
  const docs = {
    [`forms/${FORM_ID}`]: form !== undefined
      ? form
      : { name: FORM_NAME, owner: OWNER_UID, settings: { enabled: true } },
    [`users/${OWNER_UID}`]: user !== undefined
      ? user
      : { subscription: subscription() },
  };

  return {
    getDoc: (path) => structuredClone(docs[path] ?? null),
  };
}

function runService(config, { db, options = {}, serviceData = {}, brandRoot } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || '/tmp/omega-manager-slapform-unused', // the setup flow writes config/omega.json5 when given a real root
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.forms,
    options,
    serviceData,
    slapformDb: db,
  });
}

// ─── 2b create-on-missing (operator SA mints the brand's own form) ───────────

/** Stateful doc-store fake: setDoc lands, getDoc reads back — the mint +
 *  same-run convergence needs real read-your-writes. */
function fakeStore(initialDocs = {}) {
  const docs = structuredClone(initialDocs);
  const calls = [];

  return {
    calls,
    docs,
    getDoc: async (docPath) => {
      calls.push({ method: 'getDoc', args: [docPath] });
      return structuredClone(docs[docPath] ?? null);
    },
    setDoc: async (docPath, data) => {
      calls.push({ method: 'setDoc', args: [docPath, structuredClone(data)] });
      docs[docPath] = structuredClone(data);
      return {};
    },
    patchDoc: async (docPath, data, fieldPaths) => {
      calls.push({ method: 'patchDoc', args: [docPath, structuredClone(data), fieldPaths] });
      return {};
    },
    sets: () => calls.filter((c) => c.method === 'setDoc'),
    patches: () => calls.filter((c) => c.method === 'patchDoc'),
  };
}

function fakeAuthAdmin({ existing = null } = {}) {
  const calls = [];
  return {
    calls,
    getUserByEmail: async (email) => {
      calls.push({ method: 'getUserByEmail', email });
      return existing;
    },
    createUser: async ({ email, password }) => {
      calls.push({ method: 'createUser', email, password });
      return { uid: 'uid_minted1', email };
    },
  };
}

const PASSWORD_PIN_VAR = 'OMEGA_ACCOUNT_PASSWORD__SUPPORT_FIXTURE_BRAND_TEST';
const TEMPLATE_FORM = {
  id: 'tmplForm1', // BEM docs mirror their doc id — the mint must re-point it
  name: 'Contact Form - Donor Brand',
  owner: 'uid_donor',
  settings: { enabled: false },
  fields: ['email', 'message'],
};

function createConfig() {
  const config = brandConfig({ slapform: { formId: null, templateFormId: 'tmplForm1' } });
  config.brand.contact = { email: 'support@fixture-brand.test' };
  return config;
}

// ─── Interactive setup flow (config-landing) ─────────────────────────────────

const { setBrowserOpener: setOpener } = require('@omega.js/devkit/flows');
const { makeBrandRoot: makeRoot, readConfigSource: readSource } = require('./lib/config-fixture.js');
const { openTtyPrompt: openTty } = require('./lib/interactive.js');

module.exports = defineCases({
  type: 'group',
  description: 'forms',
  tests: [
    // ─── Registry / defaults pins ────────────────────────────────────────────────

    {
      name: 'forms: registered after payment with the form + user operations',
      run: (ctx) => {
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('payment') + 1]).toBe('forms');
        ctx.expect(OPERATIONS.forms.map((o) => o.name)).toEqual(['form', 'user']);
      },
    },

    {
      name: 'forms: defaults carry no formId and Slapform\'s top tier as the plan',
      run: (ctx) => {
        ctx.expect(DEFAULTS.forms.providers.slapform.enabled).toBe(true);
        ctx.expect(DEFAULTS.forms.providers.slapform.formId).toBe(null);
        ctx.expect(DEFAULTS.forms.providers.slapform.plan).toEqual({ id: 'grandmaster', name: 'Grandmaster' });
      },
    },

    // ─── Setup / skip semantics ──────────────────────────────────────────────────

    {
      name: 'forms: slapform.enabled = false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ slapform: { enabled: false } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/forms\.providers\.slapform\.enabled/);
      },
    },

    {
      name: 'forms: scalar slapform: false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ slapform: false }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/forms\.providers\.slapform\.enabled/);
      },
    },

    {
      name: 'forms: skips without a web target (the form lives on the website)',
      run: async (ctx) => {
        const result = await runService(brandConfig({ targets: { backend: { type: 'backend' } } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/no web target/);
      },
    },

    // The gate is by TYPE (#886): a brand may name its web target anything
    {
      name: 'forms: a web target named `site` runs the service, key spelling is not the gate',
      run: async (ctx) => {
        const result = await runService(brandConfig({ targets: { site: { type: 'web' }, api: { type: 'backend' } } }), { db: fakeDb(convergedResponses()) });

        ctx.expect(result.status).not.toBe('skipped');
      },
    },

    {
      name: 'forms: skips without slapform.formId',
      run: async (ctx) => {
        const result = await runService(brandConfig({ slapform: { formId: null } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/forms\.providers\.slapform\.formId/);
      },
    },

    {
      name: 'forms: skips without SLAPFORM_SERVICE_ACCOUNT in .env',
      run: async (ctx) => {
        const result = await runService(brandConfig()); // no injected db → the creds check applies
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/SLAPFORM_SERVICE_ACCOUNT/);
      },
    },

    // ─── Converged no-op ─────────────────────────────────────────────────────────

    {
      name: 'forms: fully converged brand is a zero-mutation no-op across both operations',
      run: async (ctx) => {
        const db = fakeDb(convergedResponses());

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(db.reads()).toEqual([`forms/${FORM_ID}`, `forms/${FORM_ID}`, `users/${OWNER_UID}`]);
        ctx.expect(result.state.formId).toBe(FORM_ID);
        ctx.expect(result.state.ownerUid).toBe(OWNER_UID);
        ctx.expect(result.output.form.synced).toBe(true);
        ctx.expect(result.output.user.synced).toBe(true);
      },
    },

    {
      name: 'forms: extra Slapform-written subscription fields do not count as drift',
      run: async (ctx) => {
        const db = fakeDb(convergedResponses({
          user: {
            subscription: {
              ...subscription(),
              trial: { active: false, days: 14 },
              cancelled: false,
            },
            email: 'owner@fixture-brand.test',
          },
        }));

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
      },
    },

    // ─── form ────────────────────────────────────────────────────────────────────

    {
      name: 'forms: a drifted form name is patched with a leaf-masked merge write',
      run: async (ctx) => {
        const db = fakeDb({
          ...convergedResponses({ form: { name: 'Old Name', owner: OWNER_UID, settings: { enabled: true } } }),
          patchDoc: {},
        });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().map((c) => c.args)).toEqual([[
          `forms/${FORM_ID}`,
          { name: FORM_NAME, settings: { enabled: true } },
          ['name', 'settings.enabled'],
        ]]);
        ctx.expect(result.output.form.updated).toBe(true);
      },
    },

    {
      name: 'forms: a disabled form is re-enabled',
      run: async (ctx) => {
        const db = fakeDb({
          ...convergedResponses({ form: { name: FORM_NAME, owner: OWNER_UID, settings: { enabled: false } } }),
          patchDoc: {},
        });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().length).toBe(1);
      },
    },

    {
      name: 'forms: a formId pointing at no document errors instead of creating an orphan',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('error');
        ctx.expect(db.mutations()).toEqual([]);
        // stopOnError: the user operation never runs after the form error
        ctx.expect(db.reads()).toEqual([`forms/${FORM_ID}`]);
      },
    },

    // ─── user ────────────────────────────────────────────────────────────────────

    {
      name: 'forms: a missing user document is created with the full subscription',
      run: async (ctx) => {
        const db = fakeDb({
          getDoc: (path) => (path === `forms/${FORM_ID}`
            ? { name: FORM_NAME, owner: OWNER_UID, settings: { enabled: true } }
            : null),
          patchDoc: {},
        });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().map((c) => c.args)).toEqual([[
          `users/${OWNER_UID}`,
          { subscription: subscription() },
          SUBSCRIPTION_FIELD_PATHS,
        ]]);
        ctx.expect(result.output.user.updated).toBe(true);
        ctx.expect(result.state.ownerUid).toBe(OWNER_UID);
      },
    },

    {
      name: 'forms: a user on a lower plan is moved to the configured plan',
      run: async (ctx) => {
        const db = fakeDb({
          ...convergedResponses({ user: { subscription: subscription('mini', 'Mini') } }),
          patchDoc: {},
        });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().length).toBe(1);
        ctx.expect(db.mutations()[0].args[1].subscription.product.id).toBe('grandmaster');
      },
    },

    {
      name: 'forms: slapform.plan overrides the default tier',
      run: async (ctx) => {
        const db = fakeDb({
          ...convergedResponses({ user: { subscription: subscription() } }),
          patchDoc: {},
        });

        const result = await runService(
          brandConfig({ slapform: { plan: { id: 'sumo', name: 'Sumo' } } }),
          { db },
        );

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()[0].args[1].subscription.product).toEqual({ id: 'sumo', name: 'Sumo' });
        ctx.expect(result.output.user.plan).toBe('sumo');
      },
    },

    {
      name: 'forms: a form without an owner field errors the user operation',
      run: async (ctx) => {
        const db = fakeDb(convergedResponses({ form: { name: FORM_NAME, settings: { enabled: true } } }));

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('error');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.form.synced).toBe(true); // the form op itself passed
      },
    },

    // ─── Dry run ─────────────────────────────────────────────────────────────────

    {
      name: 'forms: dry run on a fully drifted brand performs zero mutations',
      run: async (ctx) => {
        const db = fakeDb({
          getDoc: (path) => (path === `forms/${FORM_ID}`
            ? { name: 'Old Name', owner: OWNER_UID, settings: { enabled: false } }
            : null),
        });

        const result = await runService(brandConfig(), { db, options: { dryRun: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.form.planned).toBe('update');
        ctx.expect(result.output.user.planned).toBe('grandmaster');
        // no durable state lands in a dry run
        ctx.expect(result.state).toBe(null);
      },
    },

    // ─── Firestore typed-value codec ─────────────────────────────────────────────

    {
      name: 'firestore-rest: typed-value encode/decode round-trips a nested document',
      run: (ctx) => {
        const doc = {
          name: 'Contact Form',
          settings: { enabled: true },
          price: 0,
          ratio: 1.5,
          tags: ['a', 'b'],
          resourceId: null,
        };

        const encoded = encodeFields(doc);

        // REST int64s are string-encoded; nested maps/arrays use typed wrappers
        ctx.expect(encoded.price).toEqual({ integerValue: '0' });
        ctx.expect(encoded.ratio).toEqual({ doubleValue: 1.5 });
        ctx.expect(encoded.settings).toEqual({ mapValue: { fields: { enabled: { booleanValue: true } } } });
        ctx.expect(encoded.resourceId).toEqual({ nullValue: null });

        ctx.expect(decodeFields(encoded)).toEqual(doc);
      },
    },

    {
      name: 'forms 2b: missing formId + SA + template donor mints the brand-owned form end to end',
      run: async (ctx) => {
        process.env[PASSWORD_PIN_VAR] = 'fixture-password-123';
        ctx.after(() => delete process.env[PASSWORD_PIN_VAR]);

        const store = fakeStore({ 'forms/tmplForm1': TEMPLATE_FORM });
        const authAdmin = fakeAuthAdmin();
        const brandRoot = makeRoot(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  forms: { providers: { slapform: { enabled: true, templateFormId: "tmplForm1" } } }, // formId lands here
}
`);

        const result = await service.run({
          brandId: 'fixture-brand',
          brandRoot,
          brandConfig: createConfig(),
          brand: { id: 'fixture-brand', config: {}, enabledTargets: ['web', 'backend'], targets: [] },
          targets: [],
          operations: OPERATIONS.forms,
          options: {},
          serviceData: {},
          slapformDb: store,
          slapformAuthAdmin: authAdmin,
        });

        ctx.expect(result.status).toBe('success');

        // The product user: looked up, created with the pinned password, doc = the
        // canonical account shape with REAL generated credentials
        ctx.expect(authAdmin.calls.map((c) => c.method)).toEqual(['getUserByEmail', 'createUser']);
        ctx.expect(authAdmin.calls[1].password).toBe('fixture-password-123');
        const userSet = store.sets().find((c) => c.args[0] === 'users/uid_minted1');
        ctx.expect(userSet, 'users/{uid} doc written').toBeTruthy();
        ctx.expect(userSet.args[1].auth.uid).toBe('uid_minted1');
        ctx.expect(userSet.args[1].auth.email).toBe('support@fixture-brand.test');
        ctx.expect(userSet.args[1].api.privateKey, 'real api key generated').toMatch(/^[A-Za-z0-9]{43}$/);

        // The form: shape-templated from the donor, owned by the new user
        const formId = result.state.formId;
        ctx.expect(formId, 'minted id matches the product convention').toMatch(/^[A-Za-z0-9]{14}$/);
        const formSet = store.sets().find((c) => c.args[0] === `forms/${formId}`);
        ctx.expect(formSet, 'form doc written').toBeTruthy();
        ctx.expect(formSet.args[1].owner).toBe('uid_minted1');
        ctx.expect(formSet.args[1].fields, 'donor shape copied').toEqual(['email', 'message']);
        ctx.expect(formSet.args[1].id, 'embedded id field re-pointed at the minted doc, not the donor').toBe(formId);

        // Same-run convergence: the ensures patched the donor name + enabled flag
        const formPatch = store.patches().find((c) => c.args[0] === `forms/${formId}`);
        ctx.expect(formPatch, 'form converged in the same run').toBeTruthy();
        ctx.expect(formPatch.args[1].name).toBe(FORM_NAME);

        // Writeback: the minted id landed in omega.json5, comments intact
        const written = readSource(brandRoot);
        ctx.expect(written.includes(`formId: "${formId}"`), 'minted id written back').toBeTruthy();
        ctx.expect(written.includes('// formId lands here')).toBeTruthy();
      },
    },

    {
      name: 'forms 2b: dry run plans the mint — zero writes, no user creation, no writeback',
      run: async (ctx) => {
        const store = fakeStore({ 'forms/tmplForm1': TEMPLATE_FORM });
        const authAdmin = fakeAuthAdmin();
        const brandRoot = makeRoot(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  forms: { providers: { slapform: { enabled: true, templateFormId: "tmplForm1" } } },
}
`);

        const result = await service.run({
          brandId: 'fixture-brand',
          brandRoot,
          brandConfig: createConfig(),
          brand: { id: 'fixture-brand', config: {}, enabledTargets: ['web', 'backend'], targets: [] },
          targets: [],
          operations: OPERATIONS.forms,
          options: { dryRun: true },
          serviceData: {},
          slapformDb: store,
          slapformAuthAdmin: authAdmin,
        });

        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/creation planned/);
        ctx.expect(store.sets()).toEqual([]);
        ctx.expect(store.patches()).toEqual([]);
        ctx.expect(authAdmin.calls).toEqual([]);
        ctx.expect(!readSource(brandRoot).includes('formId:'), 'no writeback on dry run').toBeTruthy();
      },
    },

    {
      name: 'forms 2b: an existing product user is reused — no createUser, no users write',
      run: async (ctx) => {
        process.env[PASSWORD_PIN_VAR] = 'fixture-password-123';
        ctx.after(() => delete process.env[PASSWORD_PIN_VAR]);

        const store = fakeStore({ 'forms/tmplForm1': TEMPLATE_FORM });
        const authAdmin = fakeAuthAdmin({ existing: { uid: 'uid_existing9', email: 'support@fixture-brand.test' } });
        const brandRoot = makeRoot(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  forms: { providers: { slapform: { enabled: true } } },
}
`);

        const result = await service.run({
          brandId: 'fixture-brand',
          brandRoot,
          brandConfig: createConfig(),
          brand: { id: 'fixture-brand', config: {}, enabledTargets: ['web', 'backend'], targets: [] },
          targets: [],
          operations: OPERATIONS.forms,
          options: {},
          serviceData: {},
          slapformDb: store,
          slapformAuthAdmin: authAdmin,
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(authAdmin.calls.map((c) => c.method)).toEqual(['getUserByEmail']);
        ctx.expect(store.sets().length, 'only the form doc written').toBe(1);
        ctx.expect(store.sets()[0].args[1].owner).toBe('uid_existing9');
      },
    },

    {
      name: 'forms 2b: a missing template doc fails loud instead of minting garbage',
      run: async (ctx) => {
        const store = fakeStore({}); // no template
        const authAdmin = fakeAuthAdmin();

        await ctx.expect(service.run({
            brandId: 'fixture-brand',
            brandRoot: '/tmp/omega-manager-slapform-unused',
            brandConfig: createConfig(),
            brand: { id: 'fixture-brand', config: {}, enabledTargets: ['web', 'backend'], targets: [] },
            targets: [],
            operations: OPERATIONS.forms,
            options: {},
            serviceData: {},
            slapformDb: store,
            slapformAuthAdmin: authAdmin,
          })).rejects.toThrow(/template doc forms\/tmplForm1 not found/);
      },
    },

    {
      name: 'forms 2b: no brand contact email → no mint attempt, normal missing-id skip',
      run: async (ctx) => {
        const config = brandConfig({ slapform: { formId: null, templateFormId: 'tmplForm1' } });
        // no config.brand.contact
        const store = fakeStore({ 'forms/tmplForm1': TEMPLATE_FORM });

        const result = await runService(config, { db: store });

        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/forms\.providers\.slapform\.formId/);
        ctx.expect(store.sets()).toEqual([]);
      },
    },

    {
      name: 'setup: interactive run lands the pasted form id in omega.json5 and proceeds',
      run: async (ctx) => {
        const config = brandConfig({ slapform: { formId: null } });
        const db = fakeDb(convergedResponses());
        const brandRoot = makeRoot(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  forms: { providers: { slapform: { enabled: true } } }, // formId lands here
}
`);
        const opened = [];
        setOpener(async (url) => { opened.push(url); return true; });
        const tty = openTty();

        try {
          const run = runService(config, { db, brandRoot });
          await tty.answer('Set up now?', '\r'); // Yes
          await tty.answer('Slapform form ID:', `${FORM_ID}\r`);
          const result = await run;

          ctx.expect(result.state.formId).toBe(FORM_ID);
          ctx.expect(opened).toEqual(['https://slapform.com']);
          const written = readSource(brandRoot);
          ctx.expect(written.includes(`formId: "${FORM_ID}"`)).toBeTruthy();
          ctx.expect(written.includes('// formId lands here')).toBeTruthy();
        } finally {
          tty.close();
          setOpener(null);
        }
      },
    },
  ],
});
