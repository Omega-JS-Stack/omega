/**
 * Slapform service tests — both operations against a method-level recording
 * fake of the Firestore REST client. Proves skip semantics, the converged
 * zero-mutation no-op, form diff-sync (name + enabled), the form-not-found
 * error (omega-manager silently created an orphan doc there), owner-account
 * plan reconciliation with leaf-masked patches that preserve sibling
 * subscription fields, the config plan override, the dry-run zero-mutation
 * guarantee, and the typed-value encode/decode round-trip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { encodeFields, decodeFields } = require('../src/lib/firestore-rest.js');
const service = require('../src/services/slapform/index.js');

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
  'subscription.payment.processor',
  'subscription.payment.frequency',
  'subscription.payment.price',
  'subscription.payment.resourceId',
  'subscription.payment.orderId',
];

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ slapform = {}, targets = { web: {}, backend: {} } } = {}) {
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
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.slapform,
    options,
    serviceData,
    slapformDb: db,
  });
}

// ─── Registry / defaults pins ────────────────────────────────────────────────

test('slapform: registered after payment with the form + user operations', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('payment') + 1], 'slapform');
  assert.deepEqual(OPERATIONS.slapform.map((o) => o.name), ['form', 'user']);
});

test('slapform: defaults carry no formId and Slapform\'s top tier as the plan', () => {
  assert.equal(DEFAULTS.forms.providers.slapform.enabled, true);
  assert.equal(DEFAULTS.forms.providers.slapform.formId, null);
  assert.deepEqual(DEFAULTS.forms.providers.slapform.plan, { id: 'grandmaster', name: 'Grandmaster' });
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('slapform: slapform.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ slapform: { enabled: false } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /forms\.providers\.slapform\.enabled/);
});

test('slapform: scalar slapform: false skips the service', async () => {
  const result = await runService(brandConfig({ slapform: false }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /forms\.providers\.slapform\.enabled/);
});

test('slapform: skips without a web target (the form lives on the website)', async () => {
  const result = await runService(brandConfig({ targets: { backend: {} } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no web target/);
});

test('slapform: skips without slapform.formId', async () => {
  const result = await runService(brandConfig({ slapform: { formId: null } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /forms\.providers\.slapform\.formId/);
});

test('slapform: skips without SLAPFORM_SERVICE_ACCOUNT in .env', async () => {
  const result = await runService(brandConfig()); // no injected db → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /SLAPFORM_SERVICE_ACCOUNT/);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('slapform: fully converged brand is a zero-mutation no-op across both operations', async () => {
  const db = fakeDb(convergedResponses());

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.deepEqual(db.reads(), [`forms/${FORM_ID}`, `forms/${FORM_ID}`, `users/${OWNER_UID}`]);
  assert.equal(result.state.formId, FORM_ID);
  assert.equal(result.state.ownerUid, OWNER_UID);
  assert.equal(result.output.form.synced, true);
  assert.equal(result.output.user.synced, true);
});

test('slapform: extra Slapform-written subscription fields do not count as drift', async () => {
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

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
});

// ─── form ────────────────────────────────────────────────────────────────────

test('slapform: a drifted form name is patched with a leaf-masked merge write', async () => {
  const db = fakeDb({
    ...convergedResponses({ form: { name: 'Old Name', owner: OWNER_UID, settings: { enabled: true } } }),
    patchDoc: {},
  });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations().map((c) => c.args), [[
    `forms/${FORM_ID}`,
    { name: FORM_NAME, settings: { enabled: true } },
    ['name', 'settings.enabled'],
  ]]);
  assert.equal(result.output.form.updated, true);
});

test('slapform: a disabled form is re-enabled', async () => {
  const db = fakeDb({
    ...convergedResponses({ form: { name: FORM_NAME, owner: OWNER_UID, settings: { enabled: false } } }),
    patchDoc: {},
  });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.equal(db.mutations().length, 1);
});

test('slapform: a formId pointing at no document errors instead of creating an orphan', async () => {
  const db = fakeDb({ getDoc: null });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'error');
  assert.deepEqual(db.mutations(), []);
  // stopOnError: the user operation never runs after the form error
  assert.deepEqual(db.reads(), [`forms/${FORM_ID}`]);
});

// ─── user ────────────────────────────────────────────────────────────────────

test('slapform: a missing user document is created with the full subscription', async () => {
  const db = fakeDb({
    getDoc: (path) => (path === `forms/${FORM_ID}`
      ? { name: FORM_NAME, owner: OWNER_UID, settings: { enabled: true } }
      : null),
    patchDoc: {},
  });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations().map((c) => c.args), [[
    `users/${OWNER_UID}`,
    { subscription: subscription() },
    SUBSCRIPTION_FIELD_PATHS,
  ]]);
  assert.equal(result.output.user.updated, true);
  assert.equal(result.state.ownerUid, OWNER_UID);
});

test('slapform: a user on a lower plan is moved to the configured plan', async () => {
  const db = fakeDb({
    ...convergedResponses({ user: { subscription: subscription('mini', 'Mini') } }),
    patchDoc: {},
  });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.equal(db.mutations().length, 1);
  assert.equal(db.mutations()[0].args[1].subscription.product.id, 'grandmaster');
});

test('slapform: slapform.plan overrides the default tier', async () => {
  const db = fakeDb({
    ...convergedResponses({ user: { subscription: subscription() } }),
    patchDoc: {},
  });

  const result = await runService(
    brandConfig({ slapform: { plan: { id: 'sumo', name: 'Sumo' } } }),
    { db },
  );

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations()[0].args[1].subscription.product, { id: 'sumo', name: 'Sumo' });
  assert.equal(result.output.user.plan, 'sumo');
});

test('slapform: a form without an owner field errors the user operation', async () => {
  const db = fakeDb(convergedResponses({ form: { name: FORM_NAME, settings: { enabled: true } } }));

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'error');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.form.synced, true); // the form op itself passed
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('slapform: dry run on a fully drifted brand performs zero mutations', async () => {
  const db = fakeDb({
    getDoc: (path) => (path === `forms/${FORM_ID}`
      ? { name: 'Old Name', owner: OWNER_UID, settings: { enabled: false } }
      : null),
  });

  const result = await runService(brandConfig(), { db, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.form.planned, 'update');
  assert.equal(result.output.user.planned, 'grandmaster');
  // no durable state lands in a dry run
  assert.equal(result.state, null);
});

// ─── Firestore typed-value codec ─────────────────────────────────────────────

test('firestore-rest: typed-value encode/decode round-trips a nested document', () => {
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
  assert.deepEqual(encoded.price, { integerValue: '0' });
  assert.deepEqual(encoded.ratio, { doubleValue: 1.5 });
  assert.deepEqual(encoded.settings, { mapValue: { fields: { enabled: { booleanValue: true } } } });
  assert.deepEqual(encoded.resourceId, { nullValue: null });

  assert.deepEqual(decodeFields(encoded), doc);
});

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

test('slapform 2b: missing formId + SA + template donor mints the brand-owned form end to end', async (t) => {
  process.env[PASSWORD_PIN_VAR] = 'fixture-password-123';
  t.after(() => delete process.env[PASSWORD_PIN_VAR]);

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
    brand: { id: 'fixture-brand', config: {}, targets: ['web', 'backend'], apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.slapform,
    options: {},
    serviceData: {},
    slapformDb: store,
    slapformAuthAdmin: authAdmin,
  });

  assert.equal(result.status, 'success');

  // The product user: looked up, created with the pinned password, doc = the
  // canonical account shape with REAL generated credentials
  assert.deepEqual(authAdmin.calls.map((c) => c.method), ['getUserByEmail', 'createUser']);
  assert.equal(authAdmin.calls[1].password, 'fixture-password-123');
  const userSet = store.sets().find((c) => c.args[0] === 'users/uid_minted1');
  assert.ok(userSet, 'users/{uid} doc written');
  assert.equal(userSet.args[1].auth.uid, 'uid_minted1');
  assert.equal(userSet.args[1].auth.email, 'support@fixture-brand.test');
  assert.match(userSet.args[1].api.privateKey, /^[A-Za-z0-9]{43}$/, 'real api key generated');

  // The form: shape-templated from the donor, owned by the new user
  const formId = result.state.formId;
  assert.match(formId, /^[A-Za-z0-9]{14}$/, 'minted id matches the product convention');
  const formSet = store.sets().find((c) => c.args[0] === `forms/${formId}`);
  assert.ok(formSet, 'form doc written');
  assert.equal(formSet.args[1].owner, 'uid_minted1');
  assert.deepEqual(formSet.args[1].fields, ['email', 'message'], 'donor shape copied');
  assert.equal(formSet.args[1].id, formId, 'embedded id field re-pointed at the minted doc, not the donor');

  // Same-run convergence: the ensures patched the donor name + enabled flag
  const formPatch = store.patches().find((c) => c.args[0] === `forms/${formId}`);
  assert.ok(formPatch, 'form converged in the same run');
  assert.equal(formPatch.args[1].name, FORM_NAME);

  // Writeback: the minted id landed in omega.json5, comments intact
  const written = readSource(brandRoot);
  assert.ok(written.includes(`formId: "${formId}"`), 'minted id written back');
  assert.ok(written.includes('// formId lands here'));
});

test('slapform 2b: dry run plans the mint — zero writes, no user creation, no writeback', async () => {
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
    brand: { id: 'fixture-brand', config: {}, targets: ['web', 'backend'], apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.slapform,
    options: { dryRun: true },
    serviceData: {},
    slapformDb: store,
    slapformAuthAdmin: authAdmin,
  });

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /creation planned/);
  assert.deepEqual(store.sets(), []);
  assert.deepEqual(store.patches(), []);
  assert.deepEqual(authAdmin.calls, []);
  assert.ok(!readSource(brandRoot).includes('formId:'), 'no writeback on dry run');
});

test('slapform 2b: an existing product user is reused — no createUser, no users write', async (t) => {
  process.env[PASSWORD_PIN_VAR] = 'fixture-password-123';
  t.after(() => delete process.env[PASSWORD_PIN_VAR]);

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
    brand: { id: 'fixture-brand', config: {}, targets: ['web', 'backend'], apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.slapform,
    options: {},
    serviceData: {},
    slapformDb: store,
    slapformAuthAdmin: authAdmin,
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(authAdmin.calls.map((c) => c.method), ['getUserByEmail']);
  assert.equal(store.sets().length, 1, 'only the form doc written');
  assert.equal(store.sets()[0].args[1].owner, 'uid_existing9');
});

test('slapform 2b: a missing template doc fails loud instead of minting garbage', async () => {
  const store = fakeStore({}); // no template
  const authAdmin = fakeAuthAdmin();

  await assert.rejects(
    service.run({
      brandId: 'fixture-brand',
      brandRoot: '/tmp/omega-manager-slapform-unused',
      brandConfig: createConfig(),
      brand: { id: 'fixture-brand', config: {}, targets: ['web', 'backend'], apps: [] },
      brandState: {},
      apps: [],
      operations: OPERATIONS.slapform,
      options: {},
      serviceData: {},
      slapformDb: store,
      slapformAuthAdmin: authAdmin,
    }),
    /template doc forms\/tmplForm1 not found/,
  );
});

test('slapform 2b: no brand contact email → no mint attempt, normal missing-id skip', async () => {
  const config = brandConfig({ slapform: { formId: null, templateFormId: 'tmplForm1' } });
  // no config.brand.contact
  const store = fakeStore({ 'forms/tmplForm1': TEMPLATE_FORM });

  const result = await runService(config, { db: store });

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /forms\.providers\.slapform\.formId/);
  assert.deepEqual(store.sets(), []);
});

// ─── Interactive setup flow (config-landing) ─────────────────────────────────

const { setBrowserOpener: setOpener } = require('@omega.js/devkit/flows');
const { makeBrandRoot: makeRoot, readConfigSource: readSource } = require('./lib/config-fixture.js');
const { openTtyPrompt: openTty } = require('./lib/interactive.js');

test('setup: interactive run lands the pasted form id in omega.json5 and proceeds', async () => {
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

    assert.equal(result.state.formId, FORM_ID);
    assert.deepEqual(opened, ['https://slapform.com']);
    const written = readSource(brandRoot);
    assert.ok(written.includes(`formId: "${FORM_ID}"`));
    assert.ok(written.includes('// formId lands here'));
  } finally {
    tty.close();
    setOpener(null);
  }
});
