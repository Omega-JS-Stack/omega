/**
 * Migrations service tests — the notifications, users, orders,
 * payments-intents and payment-provider (#428) migrations against a
 * method-level recording fake of the
 * FirestoreREST client (and the auth admin for orphan detection), with the
 * fix pipeline, conflict resolution, and REST patch construction real.
 * Proves the --migration gating (flag, name filter, shared-project and
 * service-account skips), pinned patch payloads for the legacy transforms
 * (including the #384 attribution fold on all four surfaces), orphan
 * deletion, the converged zero-mutation no-op, the warned status on write
 * failures and schema-invalid docs, --ids / --limit / pagination behavior,
 * before/after snapshots under .omega/migrations/, and the --execute write
 * gate: a run without it audits and mutates nothing.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { mock } = require('node:test');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { SERVICE_ORDER, OPERATIONS } = require('../src/config.js');
const { FieldValue } = require('../src/services/migrations/lib/migration-runner.js');
const { validateDocument } = require('../src/services/migrations/lib/schema-validator.js');
const { createSanitizeFix } = require('../src/services/migrations/lib/sanitize-strings.js');
const { createMetadataFix } = require('../src/services/migrations/lib/ensure-metadata.js');
const { createAttributionFoldFix } = require('../src/services/migrations/lib/attribution-touch.js');
const { DEFAULT_USER } = require('../src/services/migrations/lib/user-schema.js');
const {
  CREATION_TIME, USER_RECORD, tsObj, stageBrand, brandConfig,
  fakeAuth, fakeFirestore, collectionOf, runService, convergedUser,
} = require('./lib/migrations-fixtures.js');

/** A notifications doc already in the canonical shape (client keys in DEFAULT order). */
function convergedNotification(id = 'notif-1') {
  return {
    id,
    createTime: '2023-05-01T00:00:00.000000Z',
    updateTime: '2023-06-01T00:00:00.000000Z',
    data: {
      token: 'tok-1',
      owner: 'uid-1',
      tags: ['news'],
      attribution: {},
      metadata: { created: tsObj('2023-05-01T00:00:00.000Z'), updated: tsObj('2023-06-01T00:00:00.000Z') },
      context: {
        client: {
          language: 'en', mobile: false, device: null, platform: 'MacIntel', browser: null,
          vendor: null, runtime: null, userAgent: 'UA', url: 'https://fixture-brand.test/',
        },
      },
    },
  };
}

/** The pre-#384 attribution: one `utm` blob, last-tagged-wins, no first/last touch. */
function legacyAttribution() {
  return {
    affiliate: {
      code: 'AFF1234',
      timestamp: '2024-02-01T00:00:00.000Z',
      url: 'https://fixture-brand.test/?aff=AFF1234',
      page: '/',
    },
    utm: {
      tags: { utm_source: 'newsletter', utm_medium: 'email' },
      timestamp: '2024-02-02T00:00:00.000Z',
      url: 'https://fixture-brand.test/pricing?utm_source=newsletter',
      page: '/pricing',
    },
  };
}

/** The touch that blob folds into — no clickIds/referrer husks, they were never captured. */
function foldedTouch() {
  return {
    tags: { utm_source: 'newsletter', utm_medium: 'email' },
    referrer: null,
    url: 'https://fixture-brand.test/pricing?utm_source=newsletter',
    page: '/pricing',
    timestamp: '2024-02-02T00:00:00.000Z',
  };
}

// ─── connections keyed by identity id ───

const GOOGLE_RECORD = () => ({ type: 'oauth2', token: { refresh_token: 'r-1' }, identity: { id: 'google-sub-1', sub: 'google-sub-1', email: 'g@example.com' } });
const KICK_RECORD = () => ({ type: 'oauth2', token: { refresh_token: 'r-2' }, identity: { user_id: 8675309, name: 'ianwieds' } });

/** The document one patchDoc leaves: every masked path set from the body, or deleted. */
function patched(data, [, sets, mask]) {
  const after = structuredClone(data);

  for (const dotted of mask) {
    const parts = dotted.split('.');
    const leaf = parts.pop();
    const parent = parts.reduce((node, part) => (node[part] ??= {}), after);
    const value = parts.reduce((node, part) => node?.[part], sets)?.[leaf];

    if (value === undefined) {
      delete parent[leaf];
    } else {
      parent[leaf] = structuredClone(value);
    }
  }

  return after;
}

async function runUsers(doc, { execute = true } = {}) {
  const firestore = collectionOf([doc]);
  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute },
  });

  return { result, firestore };
}

// ─── Orders / payments-intents migrations ────────────────────────────────────

/** A payments-orders or payments-intents doc carrying an attribution object. */
function paymentDoc(id, attribution) {
  return {
    id,
    createTime: '2024-02-02T00:00:00.000000Z',
    updateTime: '2024-02-02T00:00:00.000000Z',
    data: { id, owner: 'uid-1', attribution },
  };
}

// ─── payment-provider migration (#428) ───────────────────────────────────────

/** A doc in any payment-touching collection, carrying whatever provider shape. */
function providerDoc(collection, id, fields) {
  return {
    id,
    createTime: '2024-02-02T00:00:00.000000Z',
    updateTime: '2024-02-02T00:00:00.000000Z',
    data: { id, ...fields },
  };
}

/** Run ONLY the payment-provider migration, with one collection stocked. */
async function runProviderMigration(docsByCollection, options = {}) {
  const firestore = fakeFirestore({
    countDocs: (collection) => (docsByCollection[collection] || []).length,
    listDocs: (collection) => ({ docs: docsByCollection[collection] || [], nextPageToken: null }),
    patchDoc: {},
  });

  const result = await runService(brandConfig(), {
    ...options,
    auth: fakeAuth({}),
    firestore,
    options: { migration: 'payment-provider', ...(options.options || {}) },
  });

  return { result, firestore };
}

// ─── state-retirement (#434): the LOCAL migration ────────────────────────────

const stateRetirement = require('../src/services/migrations/ensure/state-retirement.js');

const FIXTURE_STATE = {
  edge: { zoneId: 'zone-abc' },
  repo: { repo: { fullName: 'org/fixture', htmlUrl: 'https://github.com/org/fixture', private: false } },
  search: { propertyUrl: 'sc-domain:fixture-brand.test', permissionLevel: 'siteOwner', gaLinked: true },
  analytics: {
    streams: {
      web: { streamId: '111', measurementId: 'G-WEB', apiSecret: 'web-secret', uri: 'https://fixture-brand.test' },
      backend: { streamId: '222', measurementId: 'G-API', apiSecret: 'api-secret', uri: 'https://api.fixture-brand.test' },
    },
    firebaseLink: { propertyId: '999', linked: true },
  },
  payment: {
    stripeAccountId: 'acct_1',
    radarConfirmed: true,
    disputesConfirmed: false,
    stripeProducts: { premium: 'prod_1' },
    paypalProducts: { premium: 'PROD-1' },
  },
  cloud: {
    sdkConfig: { apiKey: 'key-1', projectId: 'fixture-project', measurementId: '' },
    authentication: { oauthRedirectsConfigured: true },
    cloudMessaging: { vapidPublicKey: 'B-public', vapidPrivateKey: 'private-half' },
    billing: { enabled: true },
  },
  campaigns: { listId: 'list-1', listName: 'Fixture Brand' },
  newsletter: { publicationId: 'pub-1' },
  monitoring: { org: 'fixture-org', projectMap: { web: { id: '1', slug: 'fixture-web' } } },
  captcha: { domainsConfirmed: ['fixture-brand.test', 'www.fixture-brand.test'] },
};

const RETIREMENT_CONFIG_SOURCE = [
  '{',
  '  brand: {',
  '    id: "fixture-brand",',
  '  },',
  '  payment: {',
  '    products: [',
  '      { id: "premium", name: "Premium" },',
  '    ],',
  '  },',
  '}',
  '',
].join('\n');

// The same catalog the source above authors — planMoves reads it to know a
// [id=…] edit path has something to address
const RETIREMENT_CONFIG = { payment: { products: [{ id: 'premium', name: 'Premium' }] } };

function stageRetirementBrand({ state = FIXTURE_STATE } = {}) {
  const root = stageBrand();
  jetpack.write(join(root, 'config', 'omega.json5'), RETIREMENT_CONFIG_SOURCE);
  if (state) {
    jetpack.write(join(root, '.omega', 'state.json'), state, { jsonIndent: 2 });
  }
  return root;
}

function runRetirement(root, options = {}) {
  return stateRetirement({ brandRoot: root, brandConfig: RETIREMENT_CONFIG, options });
}

// ─── targets-rename (#443): the other LOCAL migration ────────────────────────

const targetsRename = require('../src/services/migrations/ensure/targets-rename.js');

/**
 * A brand monorepo on disk: a root manifest with the given workspaces globs,
 * and target dirs under `apps/`, `targets/`, or both.
 */
function stageRenameBrand({ apps = null, targets = null, workspaces = ['apps/*'] } = {}) {
  const root = stageBrand();

  jetpack.write(join(root, 'package.json'), `${JSON.stringify({ name: 'fixture-brand', private: true, workspaces }, null, 2)}\n`);

  for (const [dir, names] of [['apps', apps], ['targets', targets]]) {
    for (const name of names || []) {
      jetpack.write(join(root, dir, name, 'package.json'), `${JSON.stringify({ name })}
`);
    }
  }

  return root;
}

const readManifest = (root) => jetpack.read(join(root, 'package.json'), 'json');

const runRename = (root, options = {}) => targetsRename({ brandRoot: root, options });

// ─── platform-names (#867): the third LOCAL migration ────────────────────────

const platformNames = require('../src/services/migrations/ensure/platform-names.js');

const runPlatformNames = (root, options = {}) => platformNames({ brandRoot: root, options });

/** A brand whose config (and optionally a target's own) still says `win`/`snap`. */
function stagePlatformBrand({ brand = null, target = null, icons = [] } = {}) {
  const root = stageBrand();

  if (brand) jetpack.write(join(root, 'config', 'omega.json5'), brand);
  if (target) jetpack.write(join(root, 'targets', 'desktop', 'config', 'omega.json5'), target);
  for (const dir of icons) jetpack.write(join(root, dir, 'config', 'icons', 'macos', 'icon.png'), 'png-bytes');

  return root;
}

const readJson5 = (file) => require('json5').parse(jetpack.read(file));

module.exports = defineCases({
  type: 'group',
  description: 'migrations',
  tests: [
    // ─── Registry / sentinel / lib units ─────────────────────────────────────────

    {
      name: 'migrations: registered after account, before bookmark, with every collection handler',
      run: (ctx) => {
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('account') + 1]).toBe('migrations');
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('migrations') + 1]).toBe('bookmark');
        ctx.expect(OPERATIONS.migrations.map((o) => o.name)).toEqual(['targets-rename', 'platform-names', 'notifications', 'users', 'orders', 'payments-intents', 'payment-provider', 'state-retirement']);
        // the three LOCAL migrations: the brand's own files, not Firestore
        ctx.expect(OPERATIONS.migrations.filter((o) => o.local).map((o) => o.name)).toEqual(['targets-rename', 'platform-names', 'state-retirement']);
      },
    },

    {
      name: 'migrations: FieldValue.delete() is a stable identity sentinel',
      run: (ctx) => {
        ctx.expect(FieldValue.delete()).toBe(FieldValue.delete());
      },
    },

    {
      name: 'schema-validator: type, required, nullable, and array item checks with dotted paths',
      run: (ctx) => {
        const schema = {
          token: { type: 'string', required: true },
          owner: { type: 'string', required: true, nullable: true },
          tags: { type: 'array', required: true, itemType: 'string' },
          metadata: {
            type: 'object',
            required: true,
            properties: { created: { type: 'object', required: true } },
          },
        };

        ctx.expect(validateDocument({ token: 't', owner: null, tags: ['a'], metadata: { created: {} } }, schema)).toEqual({ valid: true, errors: [] });

        const result = validateDocument({ token: null, tags: ['a', 7], metadata: {} }, schema);
        ctx.expect(result.valid).toBe(false);
        ctx.expect(result.errors.map((e) => [e.field, e.message])).toEqual([
          ['token', 'Expected string, got null (field is not nullable)'],
          ['owner', 'Missing required field'],
          ['tags[1]', 'Array item expected string, got number'],
          ['metadata.created', 'Missing required field'],
        ]);
      },
    },

    {
      name: 'sanitize fix: trims nested strings and array items, no-ops on clean docs',
      run: (ctx) => {
        const fix = createSanitizeFix();

        ctx.expect(fix({ name: 'clean', nested: { ok: 'yes' }, tags: ['a'] })).toBe(null);

        const updates = fix({ name: '  padded  ', nested: { ok: 'yes', bad: 'x ' }, tags: [' t1', 't2'] });
        const logs = updates.__logs__;
        delete updates.__logs__;
        ctx.expect(updates).toEqual({ name: 'padded', 'nested.bad': 'x', tags: ['t1', 't2'] });
        ctx.expect(logs.length).toBe(3);
      },
    },

    {
      name: 'metadata fix: moves legacy fields, falls back to server times, no-ops when converged',
      run: (ctx) => {
        const fix = createMetadataFix({ legacyCreatedFields: ['created'], legacyUpdatedFields: ['updated'] });
        const doc = { id: 'd1', createTime: '2023-01-15T12:00:00.500000Z', updateTime: '2023-02-01T00:00:00.000000Z' };

        // Legacy fields move into metadata.* and are deleted
        const created = tsObj('2022-01-01T00:00:00.000Z');
        const updated = tsObj('2022-06-01T00:00:00.000Z');
        ctx.expect(fix({ created, updated }, doc)).toEqual({
          'metadata.created': created,
          created: FieldValue.delete(),
          'metadata.updated': updated,
          updated: FieldValue.delete(),
        });

        // No legacy, no metadata → server timestamps (ISO strings, rounded UNIX)
        ctx.expect(fix({}, doc)).toEqual({
          'metadata.created': { timestamp: '2023-01-15T12:00:00.500Z', timestampUNIX: 1673784001 },
          'metadata.updated': { timestamp: '2023-02-01T00:00:00.000Z', timestampUNIX: 1675209600 },
        });

        // Already converged → no-op
        ctx.expect(fix({ metadata: { created, updated } }, doc)).toBe(null);
      },
    },

    {
      name: 'attribution fold: the legacy utm blob becomes both touches, with no husks, and utm is dropped',
      run: (ctx) => {
        const fix = createAttributionFoldFix();

        ctx.expect(fix({ attribution: legacyAttribution() })).toEqual({
          'attribution.first': foldedTouch(),
          'attribution.last': foldedTouch(),
          'attribution.utm': FieldValue.delete(),
        });

        // An untagged blob folds to a touch with no `tags` key at all — never `{}`
        const untagged = fix({ attribution: { utm: { tags: {}, timestamp: null, url: null, page: null } } });
        ctx.expect(untagged['attribution.first']).toEqual({
          referrer: null, url: null, page: null, timestamp: null,
        });

        // The two touches are separate objects, not one shared reference
        const updates = fix({ attribution: legacyAttribution() });
        ctx.expect(updates['attribution.first']).not.toBe(updates['attribution.last']);
      },
    },

    {
      name: 'attribution fold: rebuilt, absent, and half-migrated docs are never re-folded',
      run: (ctx) => {
        const fix = createAttributionFoldFix();

        // Post-#384 doc → strict no-op
        ctx.expect(fix({ attribution: { affiliate: {}, first: foldedTouch(), last: foldedTouch() } })).toBe(null);

        // No attribution at all, or no legacy blob → no-op (nothing is synthesized)
        ctx.expect(fix({})).toBe(null);
        ctx.expect(fix({ attribution: {} })).toBe(null);
        ctx.expect(fix({ attribution: { affiliate: { code: 'AFF1234' } } })).toBe(null);

        // A doc carrying BOTH shapes keeps its touches — only the leftover blob goes
        ctx.expect(fix({ attribution: { first: foldedTouch(), last: foldedTouch(), utm: { tags: { utm_source: 'stale' } } } })).toEqual({
          'attribution.utm': FieldValue.delete(),
        });
      },
    },

    // ─── Setup / skip semantics ──────────────────────────────────────────────────

    {
      name: 'migrations: no --migration flag skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig(), { options: {} });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/--migration flag not set/);
      },
    },

    {
      name: 'migrations: no backend target skips the service',
      run: async (ctx) => {
        const config = brandConfig();
        delete config.targets.backend;
        const result = await runService(config);
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/no backend target/);
      },
    },

    {
      name: 'migrations: shared Firebase project skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ cloud: { shared: true } }));
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/shared Firebase project/);
      },
    },

    {
      name: 'migrations: unknown --migration name skips with the available list',
      run: async (ctx) => {
        const result = await runService(brandConfig(), { options: { migration: 'nope' } });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/migration "nope" not found/);
      },
    },

    {
      name: 'migrations: missing service account skips with firebase-service guidance',
      run: async (ctx) => {
        const result = await runService(brandConfig());
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/\.omega\/secrets\/service-account\.json.*cloud service/);
      },
    },

    {
      name: 'migrations: --migration=<name> runs only that migration',
      run: async (ctx) => {
        const firestore = collectionOf([]);
        const auth = fakeAuth({});

        const result = await runService(brandConfig(), {
          auth, firestore, options: { migration: 'notifications' },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('countDocs').map((c) => c.args)).toEqual([['notifications']]);
        ctx.expect(auth.calls).toEqual([]);
      },
    },

    // ─── Notifications migration ─────────────────────────────────────────────────

    {
      name: 'notifications: legacy doc converges in one pinned REST patch',
      run: async (ctx) => {
        const created = tsObj('2023-05-01T00:00:00.000Z');
        const updated = tsObj('2023-06-01T00:00:00.000Z');
        const doc = {
          id: 'notif-1',
          createTime: '2023-05-01T00:00:00.000000Z',
          updateTime: '2023-06-01T00:00:00.000000Z',
          data: {
            token: 'tok-1',
            uid: 'uid-1',
            tags: ['news'],
            created,
            updated,
            url: 'https://fixture-brand.test/page',
          },
        };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'notifications/notif-1',
          {
            owner: 'uid-1',
            metadata: { created, updated },
            context: {
              client: {
                language: null, mobile: null, device: null, platform: null, browser: null,
                vendor: null, runtime: null, userAgent: null, url: 'https://fixture-brand.test/page',
              },
            },
            attribution: {},
          },
          ['uid', 'owner', 'metadata.created', 'created', 'metadata.updated', 'updated', 'context', 'url', 'attribution'],
        ]]);
        ctx.expect(result.output.notifications).toEqual({
          totalDocs: 1,
          validDocs: 1,
          invalidDocs: 0,
          docsFixed: 1,
          docsDeleted: undefined,
          errors: undefined,
          errorDocIds: undefined,
          invalidDocIds: undefined,
        });
      },
    },

    {
      name: 'notifications: converged doc is a zero-mutation no-op',
      run: async (ctx) => {
        const firestore = collectionOf([convergedNotification()]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(result.output.notifications.docsFixed).toBe(0);
        ctx.expect(result.output.notifications.validDocs).toBe(1);
      },
    },

    {
      name: 'notifications: schema-invalid doc downgrades the service to warned',
      run: async (ctx) => {
        const doc = convergedNotification('notif-bad');
        delete doc.data.token;
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', execute: true },
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.notifications.invalidDocs).toBe(1);
        ctx.expect(result.output.notifications.invalidDocIds).toEqual(['notif-bad']);
      },
    },

    {
      name: 'notifications: a failed write is counted and downgrades to warned',
      run: async (ctx) => {
        const doc = convergedNotification('notif-1');
        doc.data.uid = 'uid-legacy';
        delete doc.data.owner;
        const firestore = collectionOf([doc], {
          patchDoc: () => { throw new Error('firestore unavailable'); },
        });

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', execute: true },
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.notifications.errors).toBe(1);
        ctx.expect(result.output.notifications.errorDocIds).toEqual([
          { id: 'notif-1', errors: ['Write failed: firestore unavailable'] },
        ]);
      },
    },

    {
      name: 'migrations: the default pass audits — counted and snapshotted, never written; --execute is the write gate',
      run: async (ctx) => {
        const root = stageBrand();
        const legacyDoc = () => {
          const doc = convergedNotification('notif-1');
          doc.data.uid = 'uid-legacy';
          delete doc.data.owner;
          return doc;
        };

        // No flag: the same work is planned and recorded, and nothing is written
        const audit = collectionOf([legacyDoc()]);
        const result = await runService(brandConfig(), {
          root, auth: fakeAuth({}), firestore: audit, options: { migration: 'notifications' },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(audit.mutations()).toEqual([]);
        ctx.expect(result.output.notifications.docsFixed).toBe(1);

        const snapshots = jetpack.find(join(root, '.omega', 'migrations', 'notifications'), { matching: '*.json' });
        const docSnapshot = snapshots.find((p) => p.endsWith('notif-1.json'));
        const summary = snapshots.find((p) => p.endsWith('_summary.json'));
        ctx.expect(docSnapshot && summary).toBeTruthy();
        const { before, after, fixed } = jetpack.read(docSnapshot, 'json');
        ctx.expect(before.uid).toBe('uid-legacy');
        ctx.expect(after.owner).toBe('uid-legacy');
        ctx.expect(fixed).toBe(true);
        ctx.expect(jetpack.read(summary, 'json').execute).toBe(false);

        // --execute: the only pass that reaches Firestore
        const executed = collectionOf([legacyDoc()]);
        await runService(brandConfig(), {
          auth: fakeAuth({}), firestore: executed, options: { migration: 'notifications', execute: true },
        });

        ctx.expect(executed.of('patchDoc').map((c) => c.args[0])).toEqual(['notifications/notif-1']);

        // The manage-wide --dry-run vetoes --execute: both flags together never write
        const vetoed = collectionOf([legacyDoc()]);
        await runService(brandConfig(), {
          auth: fakeAuth({}), firestore: vetoed, options: { migration: 'notifications', execute: true, dryRun: true },
        });

        ctx.expect(vetoed.mutations()).toEqual([]);
      },
    },

    {
      name: 'notifications: the legacy utm blob folds into first/last in a pinned patch',
      run: async (ctx) => {
        const doc = convergedNotification('notif-1');
        doc.data.attribution = legacyAttribution();
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'notifications/notif-1',
          { attribution: { first: foldedTouch(), last: foldedTouch() } },
          ['attribution.first', 'attribution.last', 'attribution.utm'],
        ]]);
        ctx.expect(result.output.notifications.validDocs).toBe(1);
      },
    },

    {
      name: 'notifications: fold and backfill never synthesize husks — a blob folds, a bare doc gets {}',
      run: async (ctx) => {
        // A doc with the blob keeps its folded touches; a doc with no attribution at
        // all gets the empty object, never a synthesized touch.
        const folded = convergedNotification('notif-blob');
        folded.data.attribution = { utm: legacyAttribution().utm };
        const bare = convergedNotification('notif-bare');
        delete bare.data.attribution;
        const firestore = collectionOf([folded, bare]);

        await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', execute: true },
        });

        const patches = new Map(firestore.of('patchDoc').map((c) => [c.args[0], c.args[1]]));
        ctx.expect(patches.get('notifications/notif-blob').attribution.first).toEqual(foldedTouch());
        ctx.expect('clickIds' in patches.get('notifications/notif-blob').attribution.first).toBe(false);
        ctx.expect(patches.get('notifications/notif-bare').attribution).toEqual({});
      },
    },

    // ─── Users migration ─────────────────────────────────────────────────────────

    {
      name: 'users: orphaned doc (no auth record) is deleted with a snapshot',
      run: async (ctx) => {
        const root = stageBrand();
        const doc = { id: 'uid-ghost', createTime: '2024-01-01T00:00:00Z', updateTime: '2024-01-01T00:00:00Z', data: { auth: { uid: 'uid-ghost' } } };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          root, auth: fakeAuth({ getUser: null }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('deleteDoc').map((c) => c.args)).toEqual([['users/uid-ghost']]);
        ctx.expect(firestore.of('patchDoc')).toEqual([]);
        ctx.expect(result.output.users.docsDeleted).toBe(1);

        const snapshot = jetpack.find(join(root, '.omega', 'migrations', 'users'), { matching: 'uid-ghost.json' })[0];
        ctx.expect(jetpack.read(snapshot, 'json')).toEqual({
          before: { auth: { uid: 'uid-ghost' } },
          after: null,
          deleted: true,
        });
      },
    },

    {
      name: 'users: converged doc is a zero-mutation no-op that validates',
      run: async (ctx) => {
        const firestore = collectionOf([convergedUser()]);
        const auth = fakeAuth({ getUser: USER_RECORD });

        const result = await runService(brandConfig(), {
          auth, firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(auth.of('getUser').map((c) => c.args)).toEqual([['uid-1']]);
        ctx.expect(result.output.users).toEqual({
          totalDocs: 1,
          validDocs: 1,
          invalidDocs: 0,
          docsFixed: 0,
          docsDeleted: undefined,
          errors: undefined,
          errorDocIds: undefined,
          invalidDocIds: undefined,
        });
      },
    },

    {
      name: 'users: legacy plan field is deleted in a pinned patch (subscription wins)',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.plan = { id: 'legacy' };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([['users/uid-1', {}, ['plan']]]);
      },
    },

    {
      name: 'users: flat subscription.id/name become subscription.product in a pinned patch',
      run: async (ctx) => {
        const doc = convergedUser();
        delete doc.data.subscription.product;
        doc.data.subscription.id = 'premium';
        doc.data.subscription.name = 'Premium';
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          { subscription: { product: { id: 'premium', name: 'Premium' } } },
          ['subscription.product', 'subscription.id', 'subscription.name'],
        ]]);
        ctx.expect(result.output.users.validDocs).toBe(1);
      },
    },

    {
      name: 'users: sparse doc gets the full @omega.js/account backfill with auth-reconciled metadata and consent',
      run: async (ctx) => {
        const doc = { id: 'uid-1', createTime: '2023-01-15T12:00:00.000000Z', updateTime: '2023-02-01T00:00:00.000000Z', data: {} };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.users.docsFixed).toBe(1);
        ctx.expect(result.output.users.validDocs).toBe(1);

        const [docPath, sets, fieldPaths] = firestore.of('patchDoc')[0].args;
        ctx.expect(docPath).toBe('users/uid-1');

        // Dotted descendants were absorbed into their top-level ancestors
        ctx.expect([...fieldPaths].sort()).toEqual([
          'activity', 'affiliate', 'api', 'attribution', 'auth', 'connections',
          'consent', 'flags', 'metadata.created', 'metadata.updated', 'owns', 'personal',
          'roles', 'subscription', 'trackingConsent', 'usage',
        ]);

        // Firebase Auth is canonical for identity and creation time
        ctx.expect(sets.auth).toEqual({ uid: 'uid-1', email: USER_RECORD.email, temporary: false });
        ctx.expect(sets.metadata.created).toEqual(tsObj(CREATION_TIME));
        ctx.expect(sets.metadata.updated).toEqual(tsObj('2023-02-01T00:00:00.000Z'));

        // Consent backfilled as an implicit signup grant at the reconciled creation time
        ctx.expect(sets.consent.legal.status).toBe('granted');
        ctx.expect(sets.consent.legal.grantedAt.timestampUNIX).toBe(tsObj(CREATION_TIME).timestampUNIX);
        ctx.expect(sets.consent.legal.grantedAt.text).toMatch(/Fixture Brand's Terms of Service/);
        ctx.expect(sets.consent.marketing.status).toBe('granted');

        // Dynamic values generated per-doc
        ctx.expect(sets.affiliate.code).toMatch(/^[0-9a-zA-Z]{7}$/);
        ctx.expect(sets.api.clientId).toMatch(/^[0-9a-f-]{36}$/);
        ctx.expect(sets.api.privateKey).toMatch(/^[0-9a-f]{64}$/);

        ctx.expect(sets.subscription).toEqual(DEFAULT_USER.subscription);
        ctx.expect(sets.usage).toEqual({});
      },
    },

    {
      name: '#788: users: oauth2 moves to connections, each record stamped with its kind',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.oauth2 = {
          google: { token: { refresh_token: 'r-1' }, identity: { id: 'google-sub-1', email: 'g@example.com' } },
          discord: { token: { refresh_token: 'r-2' }, identity: { id: 'discord-1' } },
        };
        delete doc.data.connections;
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          {
            connections: {
              google: { 'google-sub-1': { token: { refresh_token: 'r-1' }, identity: { id: 'google-sub-1', email: 'g@example.com' }, type: 'oauth2' } },
              discord: { 'discord-1': { token: { refresh_token: 'r-2' }, identity: { id: 'discord-1' }, type: 'oauth2' } },
            },
          },
          ['connections', 'oauth2'],
        ]]);
        ctx.expect(result.output.users.validDocs).toBe(1);
      },
    },

    {
      name: '#793: users: a moved record gets the identity.id the connections route matches on',
      run: async (ctx) => {
        // The lane matches a connection on `connections.<provider>.identity.id`
        // ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)), and a legacy
        // record has whatever its provider answered: Google's `sub`, Kick's numeric
        // `user_id`. The move fills the id beside them and deletes nothing.
        const doc = convergedUser();
        doc.data.oauth2 = {
          google: { token: { refresh_token: 'r-1' }, identity: { sub: 'google-sub-1', email: 'g@example.com' } },
          kick: { token: { refresh_token: 'r-2' }, identity: { user_id: 8675309, name: 'ianwieds' } },
          twitch: { token: { refresh_token: 'r-3' }, identity: { id: 'twitch-1', login: 'ianwieds' } },
        };
        delete doc.data.connections;
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          {
            connections: {
              google: { 'google-sub-1': { token: { refresh_token: 'r-1' }, identity: { sub: 'google-sub-1', email: 'g@example.com', id: 'google-sub-1' }, type: 'oauth2' } },
              kick: { 8675309: { token: { refresh_token: 'r-2' }, identity: { user_id: 8675309, name: 'ianwieds', id: '8675309' }, type: 'oauth2' } },
              twitch: { 'twitch-1': { token: { refresh_token: 'r-3' }, identity: { id: 'twitch-1', login: 'ianwieds' }, type: 'oauth2' } },
            },
          },
          ['connections', 'oauth2'],
        ]]);
      },
    },

    {
      name: '#788: users: a document already moved is a zero-mutation no-op',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.connections = { google: { 'google-sub-1': { token: { refresh_token: 'r-1' }, identity: { id: 'google-sub-1' }, type: 'oauth2' } } };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
      },
    },

    {
      name: '#793: users: a document already at connections still gains the identity.id it lacks',
      run: async (ctx) => {
        // The rename shipped before the id did, so a document moved by the #788 code
        // sits at `connections` with no `oauth2` left to trigger a move — and the
        // route matches on `connections.<provider>.identity.id`. The backfill runs
        // over the existing map too, and nothing is deleted.
        const doc = convergedUser();
        doc.data.connections = {
          google: { token: { refresh_token: 'r-1' }, identity: { sub: 'google-sub-1', email: 'g@example.com' }, type: 'oauth2' },
          kick: { token: { refresh_token: 'r-2' }, identity: { user_id: 8675309 }, type: 'oauth2' },
          twitch: { token: { refresh_token: 'r-3' }, identity: { id: 'twitch-1' }, type: 'oauth2' },
        };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args), 'only `connections` is written: there is no oauth2 key to delete').toEqual([[
          'users/uid-1',
          {
            connections: {
              google: { 'google-sub-1': { token: { refresh_token: 'r-1' }, identity: { sub: 'google-sub-1', email: 'g@example.com', id: 'google-sub-1' }, type: 'oauth2' } },
              kick: { 8675309: { token: { refresh_token: 'r-2' }, identity: { user_id: 8675309, id: '8675309' }, type: 'oauth2' } },
              twitch: { 'twitch-1': { token: { refresh_token: 'r-3' }, identity: { id: 'twitch-1' }, type: 'oauth2' } },
            },
          },
          ['connections'],
        ]]);
      },
    },

    {
      name: '#793: users: a document whose connections need nothing is a zero-mutation no-op',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.connections = {
          google: { 'google-sub-1': { token: { refresh_token: 'r-1' }, identity: { id: 'google-sub-1', sub: 'google-sub-1' }, type: 'oauth2' } },
        };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations(), 'a complete record is never rewritten').toEqual([]);
      },
    },

    {
      name: '#788: users: both keys present keeps connections and deletes oauth2 only',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.connections = { google: { 'google-sub-1': { token: { refresh_token: 'current' }, identity: { id: 'google-sub-1' }, type: 'oauth2' } } };
        doc.data.oauth2 = {
          google: { token: { refresh_token: 'stale' }, identity: { id: 'google-sub-1' } },
          discord: { token: { refresh_token: 'r-2' }, identity: { id: 'discord-1' } },
        };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          {
            connections: {
              google: { 'google-sub-1': { token: { refresh_token: 'current' }, identity: { id: 'google-sub-1' }, type: 'oauth2' } },
              discord: { 'discord-1': { token: { refresh_token: 'r-2' }, identity: { id: 'discord-1' }, type: 'oauth2' } },
            },
          },
          ['connections', 'oauth2'],
        ]]);
      },
    },

    {
      name: '#1061: users: an old one-level connection record moves under its identity id',
      run: async (ctx) => {
        // Kick's record predates `identity.id`: the earlier backfill fills it in, and
        // the move keys the record by it in the same run
        const doc = convergedUser();
        doc.data.connections = { google: GOOGLE_RECORD(), kick: KICK_RECORD() };

        const { result, firestore } = await runUsers(doc);

        ctx.expect(result.status).toBe('success');

        const patches = firestore.of('patchDoc').map((c) => c.args);

        ctx.expect(patches.length, 'one write for the document').toBe(1);
        ctx.expect(patches[0][0]).toBe('users/uid-1');
        ctx.expect(patched(doc.data, patches[0]).connections, 'each record sits one level down, under its identity id, its shape unchanged').toEqual({
          google: { 'google-sub-1': GOOGLE_RECORD() },
          kick: { 8675309: { ...KICK_RECORD(), identity: { user_id: 8675309, name: 'ianwieds', id: '8675309' } } },
        });
      },
    },

    {
      name: '#1061: users: a second run of the connections move changes nothing',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.connections = { google: GOOGLE_RECORD(), kick: KICK_RECORD() };

        const first = await runUsers(doc);
        const moved = { ...doc, data: patched(doc.data, first.firestore.of('patchDoc')[0].args) };

        ctx.expect(Object.keys(moved.data.connections.google), 'the first run keyed the records').toEqual(['google-sub-1']);

        const { result, firestore } = await runUsers(moved);

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations(), 'a document in the keyed shape is never rewritten').toEqual([]);
      },
    },

    {
      name: '#1061: users: a record already keyed by its identity id is left alone',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.connections = {
          google: { 'google-sub-1': GOOGLE_RECORD(), 'google-sub-2': { ...GOOGLE_RECORD(), identity: { id: 'google-sub-2' } } },
          discord: { type: 'oauth2', token: { refresh_token: 'r-3' }, identity: { id: 'discord-1', username: 'ian' } },
        };

        const { result, firestore } = await runUsers(doc);

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').length, 'the old record beside them is written').toBe(1);

        const after = patched(doc.data, firestore.of('patchDoc')[0].args).connections;

        ctx.expect(after.google, 'the keyed accounts are untouched').toEqual(doc.data.connections.google);
        ctx.expect(after.discord, 'while the old record beside them moves').toEqual({ 'discord-1': doc.data.connections.discord });
      },
    },

    {
      name: '#1061: users: an old record with no identity id is dropped, and the log names the user and the provider',
      run: async (ctx) => {
        const printed = mock.method(console, 'log', () => {});
        ctx.after(() => mock.reset());
        const doc = convergedUser();
        doc.data.connections = { google: GOOGLE_RECORD(), discord: { type: 'oauth2', token: { refresh_token: 'r-3' } } };

        const { result, firestore } = await runUsers(doc);

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').length, 'one write for the document').toBe(1);
        ctx.expect(patched(doc.data, firestore.of('patchDoc')[0].args).connections, 'the record no route could address is gone, never keyed and never left one level up').toEqual({
          google: { 'google-sub-1': GOOGLE_RECORD() },
        });

        const lines = () => printed.mock.calls.map((call) => call.arguments.join(' ').replace(/\x1b\[[0-9;]*m/g, ''));
        const dropLines = () => lines().filter((line) => line.includes('uid-1') && line.includes('discord'));

        ctx.expect(dropLines().length, `one log line names the user and the provider: ${lines().join(' | ')}`).toBe(1);
        ctx.expect(dropLines()[0].includes('Dropped connections.discord'), `with --execute it says the record was dropped: ${dropLines()[0]}`).toBeTruthy();

        // The audit computes the same drop and says it only would
        printed.mock.resetCalls();
        const audit = convergedUser();
        audit.data.connections = { discord: { type: 'oauth2', token: { refresh_token: 'r-3' } } };

        const audited = await runUsers(audit, { execute: false });

        ctx.expect(audited.firestore.mutations(), 'the audit writes nothing').toEqual([]);
        ctx.expect(dropLines().length, `the audit names the user and the provider too: ${lines().join(' | ')}`).toBe(1);
        ctx.expect(dropLines()[0].includes('Would drop connections.discord'), `in the audit's own words: ${dropLines()[0]}`).toBeTruthy();
      },
    },

    {
      name: '#1061: users: a ghost entry with no token beside a keyed account keeps the account',
      run: async (ctx) => {
        const doc = convergedUser();
        const ghost = { refreshing: { instance: 'gone-instance', timestampUNIX: 1 } };
        doc.data.connections = { google: { 'google-sub-1': GOOGLE_RECORD(), 'google-sub-2': ghost } };

        const { result, firestore } = await runUsers(doc);

        ctx.expect(result.status).toBe('success');

        const patches = firestore.of('patchDoc');
        const after = patches.length ? patched(doc.data, patches[0].args).connections : doc.data.connections;

        ctx.expect(after.google['google-sub-1'], 'the valid account is kept where it is').toEqual(GOOGLE_RECORD());
      },
    },

    {
      name: '#1061: users: an account connected beside the old fields before the migration ends as a sibling',
      run: async (ctx) => {
        // A user still in the old shape can connect again before the migration runs:
        // the new account lands keyed, beside the old record's own top-level fields
        const doc = convergedUser();
        const fresh = { type: 'oauth2', token: { refresh_token: 'fresh-2' }, identity: { id: 'google-sub-2' } };
        doc.data.connections = { google: { ...GOOGLE_RECORD(), 'google-sub-2': fresh } };

        const { result, firestore } = await runUsers(doc);

        ctx.expect(result.status).toBe('success');
        ctx.expect(patched(doc.data, firestore.of('patchDoc')[0].args).connections, 'the old record moves under its id, and the fresh account stays its sibling').toEqual({
          google: { 'google-sub-1': GOOGLE_RECORD(), 'google-sub-2': fresh },
        });
      },
    },

    {
      name: '#1061: users: the same identity reconnected before the migration keeps only the fresh record',
      run: async (ctx) => {
        const printed = mock.method(console, 'log', () => {});
        ctx.after(() => mock.reset());
        const doc = convergedUser();
        const fresh = { type: 'oauth2', token: { refresh_token: 'fresh-1' }, identity: { id: 'google-sub-1' } };
        doc.data.connections = { google: { ...GOOGLE_RECORD(), 'google-sub-1': fresh } };

        const { result, firestore } = await runUsers(doc);

        ctx.expect(result.status).toBe('success');
        ctx.expect(patched(doc.data, firestore.of('patchDoc')[0].args).connections, 'the reconnect wins, and none of the stale fields survive').toEqual({
          google: { 'google-sub-1': fresh },
        });

        const lines = printed.mock.calls.map((call) => call.arguments.join(' ').replace(/\x1b\[[0-9;]*m/g, ''));

        ctx.expect(lines.some((line) => line.includes('Dropped connections.google') && line.includes('uid-1')), `the stale record's drop is logged: ${lines.join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: 'users: usage period → monthly migration and zero-total cleanup in one pinned patch',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.usage = {
          requests: { total: 5, period: 3, monthly: 1 },
          old: { total: 0, monthly: 0, daily: 0 },
        };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          { usage: { requests: { total: 5, monthly: 4, daily: 0 } } },
          ['usage.requests', 'usage.old'],
        ]]);
      },
    },

    {
      name: 'users: affiliate.referrer resolves to the referrer\'s code via DB lookup',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.affiliate.referrer = 'uid-referrer';
        const firestore = collectionOf([doc], {
          getDoc: { affiliate: { code: 'REF4567' } },
        });

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('getDoc').map((c) => c.args)).toEqual([['users/uid-referrer']]);
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          { attribution: { affiliate: { code: 'REF4567' } } },
          ['attribution.affiliate.code', 'affiliate.referrer'],
        ]]);
      },
    },

    {
      name: 'users: the legacy utm blob folds into first/last in a pinned patch',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.attribution = legacyAttribution();
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          { attribution: { first: foldedTouch(), last: foldedTouch() } },
          ['attribution.first', 'attribution.last', 'attribution.utm'],
        ]]);
        ctx.expect(result.output.users.validDocs).toBe(1);
      },
    },

    {
      name: 'users: the defaults backfill never re-injects the legacy utm blob or empty touch husks',
      run: async (ctx) => {
        const doc = { id: 'uid-1', createTime: '2023-01-15T12:00:00.000000Z', updateTime: '2023-02-01T00:00:00.000000Z', data: {} };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        const [, sets] = firestore.of('patchDoc')[0].args;
        ctx.expect(sets.attribution.utm).toBe(undefined);
        ctx.expect(sets.attribution.first).toEqual({ referrer: null, url: null, page: null, timestamp: null });
        ctx.expect(sets.attribution.last).toEqual({ referrer: null, url: null, page: null, timestamp: null });
        ctx.expect(result.output.users.validDocs).toBe(1);
      },
    },

    {
      name: 'users: a blob with no affiliate is absorbed into one attribution set, blob and all',
      run: async (ctx) => {
        // The defaults backfill also patches `attribution` here, so the runner folds the
        // three dotted paths into that one ancestor — the utm DELETE leaves the mask and
        // the wholesale set is what has to drop the blob.
        const doc = convergedUser();
        doc.data.attribution = { utm: legacyAttribution().utm };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          {
            attribution: {
              affiliate: { code: null, timestamp: null, url: null, page: null },
              first: foldedTouch(),
              last: foldedTouch(),
            },
          },
          ['attribution'],
        ]]);
        ctx.expect(result.output.users.validDocs).toBe(1);
      },
    },

    {
      name: 'users: a doc already carrying the touch shape keeps it (no re-fold, no mutation)',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.attribution = { affiliate: legacyAttribution().affiliate, first: foldedTouch(), last: foldedTouch() };
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(result.output.users.validDocs).toBe(1);
      },
    },

    {
      name: 'users: the default pass plans the backfill and the orphan delete without mutating',
      run: async (ctx) => {
        const sparse = { id: 'uid-1', createTime: '2023-01-15T12:00:00Z', updateTime: '2023-02-01T00:00:00Z', data: {} };
        const ghost = { id: 'uid-ghost', createTime: '2024-01-01T00:00:00Z', updateTime: '2024-01-01T00:00:00Z', data: {} };
        const firestore = collectionOf([sparse, ghost]);
        const auth = fakeAuth({ getUser: (uid) => (uid === 'uid-1' ? structuredClone(USER_RECORD) : null) });

        const result = await runService(brandConfig(), {
          auth, firestore, options: { migration: 'users' },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(result.output.users.docsFixed).toBe(1);
        ctx.expect(result.output.users.docsDeleted).toBe(1);
      },
    },

    {
      name: 'orders: the legacy utm blob folds into first/last on payments-orders',
      run: async (ctx) => {
        const firestore = collectionOf([paymentDoc('order-1', legacyAttribution())]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'orders', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('countDocs').map((c) => c.args)).toEqual([['payments-orders']]);
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'payments-orders/order-1',
          { attribution: { first: foldedTouch(), last: foldedTouch() } },
          ['attribution.first', 'attribution.last', 'attribution.utm'],
        ]]);
        ctx.expect(result.output['payments-orders'].docsFixed).toBe(1);
      },
    },

    {
      name: 'orders: a rebuilt order and one with no attribution are zero-mutation no-ops',
      run: async (ctx) => {
        const rebuilt = paymentDoc('order-new', { affiliate: {}, first: foldedTouch(), last: foldedTouch() });
        const bare = { id: 'order-bare', createTime: '2024-02-02T00:00:00.000000Z', updateTime: '2024-02-02T00:00:00.000000Z', data: { id: 'order-bare' } };
        const firestore = collectionOf([rebuilt, bare]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'orders', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(result.output['payments-orders'].totalDocs).toBe(2);
        ctx.expect(result.output['payments-orders'].docsFixed).toBe(0);
      },
    },

    {
      name: 'orders: the default pass is the audit — the fold is counted and snapshotted, nothing is written',
      run: async (ctx) => {
        const root = stageBrand();
        const firestore = collectionOf([paymentDoc('order-1', legacyAttribution()), paymentDoc('order-new', { first: foldedTouch(), last: foldedTouch() })]);

        const result = await runService(brandConfig(), {
          root, auth: fakeAuth({}), firestore, options: { migration: 'orders' },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(result.output['payments-orders'].totalDocs).toBe(2);
        ctx.expect(result.output['payments-orders'].docsFixed).toBe(1);

        const summaryPath = jetpack.find(join(root, '.omega', 'migrations', 'payments-orders'), { matching: '_summary.json' })[0];
        const summary = jetpack.read(summaryPath, 'json');
        ctx.expect(summary.execute).toBe(false);
        ctx.expect(summary.stats.docsFixed).toBe(1);
      },
    },

    {
      name: 'payments-intents: the legacy utm blob folds into first/last and affiliate is untouched',
      run: async (ctx) => {
        const firestore = collectionOf([paymentDoc('intent-1', legacyAttribution())]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'payments-intents', execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('countDocs').map((c) => c.args)).toEqual([['payments-intents']]);

        const [docPath, sets, fieldPaths] = firestore.of('patchDoc')[0].args;
        ctx.expect(docPath).toBe('payments-intents/intent-1');
        ctx.expect(fieldPaths).toEqual(['attribution.first', 'attribution.last', 'attribution.utm']);
        ctx.expect(sets.attribution.affiliate).toBe(undefined);
        ctx.expect(sets.attribution.first).toEqual(foldedTouch());
        ctx.expect(result.output['payments-intents'].docsFixed).toBe(1);
      },
    },

    {
      name: 'payments-intents: trackingConsent is never synthesized by the fold',
      run: async (ctx) => {
        const firestore = collectionOf([paymentDoc('intent-1', legacyAttribution())]);

        await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'payments-intents', execute: true },
        });

        const [, sets, fieldPaths] = firestore.of('patchDoc')[0].args;
        ctx.expect(sets.trackingConsent).toBe(undefined);
        ctx.expect(fieldPaths.includes('trackingConsent')).toBe(false);
      },
    },

    {
      name: 'payment-provider: the stored word moves on every collection, at that collection’s own path',
      run: async (ctx) => {
        const { result, firestore } = await runProviderMigration({
          users: [providerDoc('users', 'uid-1', { subscription: { payment: { processor: 'stripe', resourceId: 'sub_1' } } })],
          'payments-orders': [providerDoc('payments-orders', 'order-1', { processor: 'paypal' })],
          'payments-intents': [providerDoc('payments-intents', 'intent-1', { processor: 'chargebee' })],
          'payments-webhooks': [providerDoc('payments-webhooks', 'evt-1', { processor: 'stripe' })],
          'payments-disputes': [providerDoc('payments-disputes', 'alert-1', { provider: 'chargeblast', alert: { processor: 'stripe' } })],
        }, { options: { execute: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([
          ['users/uid-1', { subscription: { payment: { provider: 'stripe' } } }, ['subscription.payment.provider', 'subscription.payment.processor']],
          ['payments-orders/order-1', { provider: 'paypal' }, ['provider', 'processor']],
          ['payments-intents/intent-1', { provider: 'chargebee' }, ['provider', 'processor']],
          ['payments-webhooks/evt-1', { provider: 'stripe' }, ['provider', 'processor']],
          ['payments-disputes/alert-1', { alert: { provider: 'stripe' } }, ['alert.provider', 'alert.processor']],
        ]);

        // The dispute doc's own top-level `provider` (the ALERT source, chargeblast)
        // is a different field and is never in the mask
        ctx.expect(firestore.of('patchDoc')[4].args[1].provider).toBe(undefined);

        for (const collection of ['users', 'payments-orders', 'payments-intents', 'payments-webhooks', 'payments-disputes']) {
          ctx.expect(result.output[`payment-provider:${collection}`].docsFixed, `${collection} fixed one doc`).toBe(1);
        }
      },
    },

    {
      name: 'payment-provider: a null value still moves — the retired key never survives',
      run: async (ctx) => {
        const { firestore } = await runProviderMigration({
          users: [providerDoc('users', 'uid-free', { subscription: { payment: { processor: null } } })],
        }, { options: { execute: true } });

        ctx.expect(firestore.of('patchDoc')[0].args).toEqual([
          'users/uid-free',
          { subscription: { payment: { provider: null } } },
          ['subscription.payment.provider', 'subscription.payment.processor'],
        ]);
      },
    },

    {
      name: 'payment-provider: a doc carrying BOTH keeps `provider` and drops only the leftover',
      run: async (ctx) => {
        const { firestore } = await runProviderMigration({
          'payments-orders': [providerDoc('payments-orders', 'order-both', { provider: 'stripe', processor: 'paypal' })],
        }, { options: { execute: true } });

        ctx.expect(firestore.of('patchDoc')[0].args).toEqual(['payments-orders/order-both', {}, ['processor']]);
      },
    },

    {
      name: 'payment-provider: a converged brand is a zero-mutation no-op on every collection',
      run: async (ctx) => {
        const { result, firestore } = await runProviderMigration({
          users: [providerDoc('users', 'uid-1', { subscription: { payment: { provider: 'stripe' } } })],
          'payments-orders': [providerDoc('payments-orders', 'order-1', { provider: 'paypal' })],
          'payments-intents': [providerDoc('payments-intents', 'intent-1', { provider: 'chargebee' })],
          'payments-webhooks': [providerDoc('payments-webhooks', 'evt-1', { provider: 'stripe' })],
          'payments-disputes': [providerDoc('payments-disputes', 'alert-1', { provider: 'chargeblast', alert: { provider: 'stripe' } })],
        }, { options: { execute: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(result.output['payment-provider:users'].totalDocs).toBe(1);
        ctx.expect(result.output['payment-provider:users'].docsFixed).toBe(0);
      },
    },

    {
      name: 'payment-provider: a doc with no payment field at all is untouched',
      run: async (ctx) => {
        const { result, firestore } = await runProviderMigration({
          users: [providerDoc('users', 'uid-bare', { subscription: {} })],
        }, { options: { execute: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(result.output['payment-provider:users'].docsFixed).toBe(0);
      },
    },

    {
      name: 'payment-provider: the default pass is the audit — counted and snapshotted, nothing written',
      run: async (ctx) => {
        const root = stageBrand();
        const { result, firestore } = await runProviderMigration({
          'payments-orders': [
            providerDoc('payments-orders', 'order-1', { processor: 'stripe' }),
            providerDoc('payments-orders', 'order-new', { provider: 'stripe' }),
          ],
        }, { root });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.mutations(), 'the audit writes nothing').toEqual([]);
        ctx.expect(result.output['payment-provider:payments-orders'].totalDocs).toBe(2);
        ctx.expect(result.output['payment-provider:payments-orders'].docsFixed, 'and still counts what it WOULD change').toBe(1);

        const summaryPath = jetpack.find(join(root, '.omega', 'migrations', 'payments-orders'), { matching: '_summary.json' })[0];
        const summary = jetpack.read(summaryPath, 'json');
        ctx.expect(summary.execute).toBe(false);
        ctx.expect(summary.stats.docsFixed).toBe(1);
      },
    },

    // ─── Runner mechanics: --migration (all), --ids, --limit, pagination ─────────

    {
      name: 'migrations: bare --migration runs every registered migration in order',
      run: async (ctx) => {
        const converged = {
          notifications: convergedNotification(),
          users: convergedUser(),
          'payments-orders': paymentDoc('order-new', { first: foldedTouch(), last: foldedTouch() }),
          'payments-intents': paymentDoc('intent-new', { first: foldedTouch(), last: foldedTouch() }),
          'payments-webhooks': providerDoc('payments-webhooks', 'evt-new', { provider: 'stripe' }),
          'payments-disputes': providerDoc('payments-disputes', 'alert-new', { alert: { provider: 'stripe' } }),
        };
        const firestore = fakeFirestore({
          countDocs: 1,
          listDocs: (collection) => ({ docs: [converged[collection]], nextPageToken: null }),
        });

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: true, execute: true },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('countDocs').map((c) => c.args)).toEqual([
          ['notifications'], ['users'], ['payments-orders'], ['payments-intents'],
          // then payment-provider's own sweep of all five payment-touching collections
          ['users'], ['payments-orders'], ['payments-intents'], ['payments-webhooks'], ['payments-disputes'],
        ]);
        ctx.expect(firestore.mutations()).toEqual([]);
        ctx.expect(Object.keys(result.output)).toEqual([
          // The folder shape comes first: nothing to rename under the fixture root,
          // and no retired platform key in its config either
          'targetsRename', 'platformNames',
          'notifications', 'users', 'payments-orders', 'payments-intents',
          'payment-provider:users', 'payment-provider:payments-orders', 'payment-provider:payments-intents',
          'payment-provider:payments-webhooks', 'payment-provider:payments-disputes',
          // The one local migration: no .omega/state.json under the fixture root
          'stateRetirement',
        ]);
      },
    },

    {
      name: 'migrations: --ids fetches exactly those docs and warns on missing ones',
      run: async (ctx) => {
        const firestore = fakeFirestore({
          getDocWithMeta: (path) => (path === 'notifications/notif-1' ? convergedNotification() : null),
        });

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', ids: 'notif-1,missing' },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('getDocWithMeta').map((c) => c.args)).toEqual([['notifications/notif-1'], ['notifications/missing']]);
        ctx.expect(firestore.of('countDocs')).toEqual([]);
        ctx.expect(firestore.of('listDocs')).toEqual([]);
        ctx.expect(result.output.notifications.totalDocs).toBe(1);
      },
    },

    {
      name: 'migrations: --limit caps processed docs and the page size',
      run: async (ctx) => {
        const docs = [convergedNotification('n1'), convergedNotification('n2'), convergedNotification('n3')];
        const firestore = collectionOf(docs);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', limit: 2 },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('listDocs').map((c) => c.args)).toEqual([['notifications', { pageSize: 2, pageToken: null }]]);
        ctx.expect(result.output.notifications.totalDocs).toBe(2);
      },
    },

    {
      name: 'migrations: --limit arrives from the CLI as a STRING, and "0" is no limit (#920)',
      run: async (ctx) => {
        const docs = [convergedNotification('n1'), convergedNotification('n2'), convergedNotification('n3')];

        // The parse hands a value flag through as text, so the cap has to be read as
        // a number: `'0' || 0` is truthy, which capped the batch at zero documents.
        const capped = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore: collectionOf(docs), options: { migration: 'notifications', limit: '2' },
        });
        ctx.expect(capped.output.notifications.totalDocs).toBe(2);

        const firestore = collectionOf(docs);
        const unlimited = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications', limit: '0' },
        });
        ctx.expect(unlimited.output.notifications.totalDocs, '--limit 0 processes everything').toBe(3);
        ctx.expect(firestore.of('listDocs').map((c) => c.args)).toEqual([['notifications', { pageSize: 500, pageToken: null }]]);
      },
    },

    {
      name: 'migrations: pagination follows nextPageToken across pages',
      run: async (ctx) => {
        const firestore = fakeFirestore({
          countDocs: 2,
          listDocs: (collection, { pageToken }) => (pageToken
            ? { docs: [convergedNotification('n2')], nextPageToken: null }
            : { docs: [convergedNotification('n1')], nextPageToken: 'page-2' }),
        });

        const result = await runService(brandConfig(), {
          auth: fakeAuth({}), firestore, options: { migration: 'notifications' },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(firestore.of('listDocs').map((c) => c.args)).toEqual([
          ['notifications', { pageSize: 500, pageToken: null }],
          ['notifications', { pageSize: 500, pageToken: 'page-2' }],
        ]);
        ctx.expect(result.output.notifications.totalDocs).toBe(2);
      },
    },

    {
      name: 'state-retirement: every state key is either moved to a named home or explicitly dropped',
      run: (ctx) => {
        const moves = stateRetirement.planMoves(FIXTURE_STATE, RETIREMENT_CONFIG);
        const by = (from) => moves.find((move) => move.from === from);

        // Public ids + confirmations → config, in the #425 provider shape
        ctx.expect(by('edge.zoneId')).toEqual({ from: 'edge.zoneId', config: 'edge.providers.cloudflare.zone', value: 'zone-abc' });
        ctx.expect(by('search.gaLinked').config).toBe('search.providers.searchConsole.gaLinked');
        ctx.expect(by('analytics.streams.backend.measurementId').config).toBe('targets.backend.analytics.providers.google.id');
        ctx.expect(by('payment.radarConfirmed').config).toBe('payment.providers.stripe.radarConfirmed');
        ctx.expect(by('payment.stripeProducts.premium').config).toBe('payment.products[id=premium].stripe.productId');
        ctx.expect(by('payment.paypalProducts.premium').config).toBe('payment.products[id=premium].paypal.productId');
        ctx.expect(by('cloud.sdkConfig.apiKey').config).toBe('cloud.config.apiKey');
        ctx.expect(by('cloud.authentication.oauthRedirectsConfigured').config).toBe('cloud.oauthRedirectsConfigured');
        ctx.expect(by('cloud.cloudMessaging.vapidPublicKey').config).toBe('cloud.messaging.vapidKey');
        ctx.expect(by('campaigns.listId').config).toBe('marketing.campaigns.providers.sendgrid.listId');
        ctx.expect(by('newsletter.publicationId').config).toBe('marketing.newsletter.providers.beehiiv.publicationId');
        ctx.expect(by('monitoring.org').config).toBe('monitoring.providers.sentry.org');
        ctx.expect(by('captcha.domainsConfirmed').value).toEqual(['fixture-brand.test', 'www.fixture-brand.test']);

        // Secrets → the brand .env, per target, NEVER config (the loader hard-fails
        // secret-shaped keys)
        ctx.expect(by('analytics.streams.web.apiSecret').env).toBe('GOOGLE_ANALYTICS_SECRET_WEB');
        ctx.expect(by('analytics.streams.backend.apiSecret').env).toBe('GOOGLE_ANALYTICS_SECRET_BACKEND');
        ctx.expect(by('cloud.cloudMessaging.vapidPrivateKey').env).toBe('VAPID_PRIVATE_KEY');
        ctx.expect(moves.every((move) => !move.config || !/secret$|privateKey$/i.test(move.config.split('.').pop()))).toBeTruthy();

        // A false confirmation is the ABSENCE of a fact, and an empty string would
        // erase a real config value
        ctx.expect(by('payment.disputesConfirmed')).toBe(undefined);
        ctx.expect(by('cloud.sdkConfig.measurementId')).toBe(undefined);

        // Re-derived on the next run: nothing claims a home for them
        for (const derived of [
          'repo.repo.fullName', 'search.propertyUrl', 'analytics.streams.web.streamId',
          'analytics.firebaseLink.linked', 'payment.stripeAccountId', 'cloud.billing.enabled',
          'campaigns.listName', 'monitoring.projectMap.web.slug',
        ]) {
          ctx.expect(by(derived), `${derived} should not be moved`).toBe(undefined);
        }
      },
    },

    {
      name: 'state-retirement: a legacy `website` stream key lands on the web target (#505)',
      run: (ctx) => {
        // omega-manager-era state files key the web stream by its DIR name — passed
        // through it composes `targets.website`, a target the brand never declares
        const moves = stateRetirement.planMoves({
          analytics: { streams: { website: { measurementId: 'G-LEGACY', apiSecret: 'legacy-secret' } } },
        }, RETIREMENT_CONFIG);

        const by = (from) => moves.find((move) => move.from === from);
        ctx.expect(by('analytics.streams.website.measurementId').config).toBe('targets.web.analytics.providers.google.id');
        ctx.expect(by('analytics.streams.website.apiSecret').env).toBe('GOOGLE_ANALYTICS_SECRET_WEB');
        ctx.expect(moves.every((move) => !(move.config || '').startsWith('targets.website')), 'no move composes targets.website').toBeTruthy();
      },
    },

    {
      name: 'state-retirement: a brand that DECLARES `website` keeps its own name (#886)',
      run: (ctx) => {
        // `website: { type: 'web' }` is a legal target name now, so the legacy
        // remap must not rewrite a key the brand is actually using
        const moves = stateRetirement.planMoves({
          analytics: { streams: { website: { measurementId: 'G-OWN', apiSecret: 'own-secret' } } },
        }, { targets: { website: { type: 'web' } } });

        const by = (from) => moves.find((move) => move.from === from);
        ctx.expect(by('analytics.streams.website.measurementId').config).toBe('targets.website.analytics.providers.google.id');
        // The .env key is the env schema's, spelled per TYPE (#678): only
        // GOOGLE_ANALYTICS_SECRET_WEB is declared for a web stream
        ctx.expect(by('analytics.streams.website.apiSecret').env).toBe('GOOGLE_ANALYTICS_SECRET_WEB');
      },
    },

    {
      name: 'state-retirement: an audit run reports the plan and writes nothing',
      run: async (ctx) => {
        const root = stageRetirementBrand();
        const configBefore = jetpack.read(join(root, 'config', 'omega.json5'));

        const result = await runRetirement(root);

        ctx.expect(result.output.stateRetirement.audit).toBe(true);
        ctx.expect(result.output.stateRetirement.config.includes('edge.providers.cloudflare.zone')).toBeTruthy();
        ctx.expect(result.output.stateRetirement.env).toEqual(['GOOGLE_ANALYTICS_SECRET_WEB', 'GOOGLE_ANALYTICS_SECRET_BACKEND', 'VAPID_PRIVATE_KEY']);
        ctx.expect(result.output.stateRetirement.dropped.includes('payment.stripeAccountId')).toBeTruthy();

        ctx.expect(jetpack.read(join(root, 'config', 'omega.json5'))).toBe(configBefore);
        ctx.expect(jetpack.exists(join(root, '.env'))).toBe(false);
        ctx.expect(jetpack.exists(join(root, '.omega', 'state.json'))).toBeTruthy();
      },
    },

    {
      name: 'state-retirement: --execute lands both homes, deletes the file, and re-runs clean',
      run: async (ctx) => {
        const root = stageRetirementBrand();
        delete process.env.GOOGLE_ANALYTICS_SECRET_WEB;
        delete process.env.GOOGLE_ANALYTICS_SECRET_BACKEND;
        delete process.env.VAPID_PRIVATE_KEY;

        const result = await runRetirement(root, { execute: true });

        const config = jetpack.read(join(root, 'config', 'omega.json5'));
        ctx.expect(config).toMatch(/zone: "zone-abc"/);
        ctx.expect(config).toMatch(/gaLinked: true/);
        ctx.expect(config).toMatch(/radarConfirmed: true/);
        ctx.expect(config).toMatch(/oauthRedirectsConfigured: true/);
        ctx.expect(config).toMatch(/vapidKey: "B-public"/);
        ctx.expect(config).toMatch(/org: "fixture-org"/);
        // Secrets are NOT in config
        ctx.expect(!config.includes('web-secret')).toBeTruthy();
        ctx.expect(!config.includes('private-half')).toBeTruthy();

        const env = jetpack.read(join(root, '.env'));
        ctx.expect(env).toMatch(/GOOGLE_ANALYTICS_SECRET_WEB="web-secret"/);
        ctx.expect(env).toMatch(/GOOGLE_ANALYTICS_SECRET_BACKEND="api-secret"/);
        ctx.expect(env).toMatch(/VAPID_PRIVATE_KEY="private-half"/);

        ctx.expect(jetpack.exists(join(root, '.omega', 'state.json'))).toBe(false);
        ctx.expect(result.output.stateRetirement.audit).toBe(undefined);

        // Idempotent: the second run has nothing to do
        const again = await runRetirement(root, { execute: true });
        ctx.expect(again.output.stateRetirement).toEqual({ retired: true });
      },
    },

    {
      name: 'state-retirement: the devkit deploy record survives — the file is trimmed, not deleted',
      run: async (ctx) => {
        const deploy = { web: { at: '2026-07-17T00:00:00.000Z', method: 'direct' } };
        const root = stageRetirementBrand({ state: { ...FIXTURE_STATE, deploy } });

        const result = await runRetirement(root, { execute: true });

        ctx.expect(jetpack.read(join(root, '.omega', 'state.json'), 'json')).toEqual({ deploy });
        ctx.expect(result.output.stateRetirement.kept).toEqual(['deploy']);
        // and it is never reported as a dropped fact
        ctx.expect(result.output.stateRetirement.dropped.every((path) => !path.startsWith('deploy'))).toBeTruthy();

        // A trimmed file is already retired — the re-run leaves it alone
        const again = await runRetirement(root, { execute: true });
        ctx.expect(again.output.stateRetirement).toEqual({ retired: true, kept: ['deploy'] });
        ctx.expect(jetpack.read(join(root, '.omega', 'state.json'), 'json')).toEqual({ deploy });
      },
    },

    {
      name: 'state-retirement: a record section it does not recognize survives untouched (#479)',
      run: async (ctx) => {
        const deploy = { web: { at: '2026-07-17T00:00:00.000Z', method: 'direct' } };
        const install = { lastCheck: '2026-08-22T00:00:00.000Z', packages: ['web'] };
        const root = stageRetirementBrand({ state: { ...FIXTURE_STATE, deploy, install } });

        const result = await runRetirement(root, { execute: true });

        // The retired CONTENT moves out; state.json lives on as the record file, and
        // this migration owns only the sections it retires
        ctx.expect(jetpack.read(join(root, '.omega', 'state.json'), 'json')).toEqual({ deploy, install });
        ctx.expect(result.output.stateRetirement.kept.sort()).toEqual(['deploy', 'install']);
        ctx.expect(result.output.stateRetirement.dropped.every((path) => !path.startsWith('install')), 'an unrecognized section is never a dropped fact').toBeTruthy();

        const again = await runRetirement(root, { execute: true });
        ctx.expect(again.output.stateRetirement).toEqual({ retired: true, kept: ['deploy', 'install'] });
      },
    },

    {
      name: 'targets-rename: the default run audits — the plan is reported, nothing moves',
      run: async (ctx) => {
        const root = stageRenameBrand({ apps: ['website', 'backend'] });
        const before = jetpack.read(join(root, 'package.json'));

        const result = await runRename(root);

        ctx.expect(result.output.targetsRename.audit).toBe(true);
        ctx.expect(result.output.targetsRename.folder).toBe(true);
        ctx.expect(result.output.targetsRename.workspaces).toBe(true);
        ctx.expect(result.output.targetsRename.targets.sort()).toEqual(['backend', 'website']);

        ctx.expect(jetpack.exists(join(root, 'apps', 'website')), 'the folder is untouched').toBe('dir');
        ctx.expect(jetpack.exists(join(root, 'targets')), 'nothing is created').toBe(false);
        ctx.expect(jetpack.read(join(root, 'package.json')), 'the manifest is byte-identical').toBe(before);
      },
    },

    {
      name: 'targets-rename: --execute renames apps/ → targets/ once, contents and other globs intact',
      run: async (ctx) => {
        const root = stageRenameBrand({ apps: ['website', 'backend'], workspaces: ['apps/*', 'tools/*'] });

        const result = await runRename(root, { execute: true });

        ctx.expect(result.output.targetsRename.migrated).toBe(true);
        ctx.expect(jetpack.exists(join(root, 'apps')), 'apps/ is gone').toBe(false);
        ctx.expect(jetpack.list(join(root, 'targets')).sort()).toEqual(['backend', 'website']);
        ctx.expect(jetpack.read(join(root, 'targets', 'website', 'package.json'), 'json').name, 'target contents travel with the folder').toBe('website');
        ctx.expect(readManifest(root).workspaces, 'the glob flips, every other entry survives').toEqual(['targets/*', 'tools/*']);
      },
    },

    {
      name: 'targets-rename: idempotent — a migrated brand re-runs as a clean no-op',
      run: async (ctx) => {
        const root = stageRenameBrand({ apps: ['website'] });

        await runRename(root, { execute: true });
        const after = jetpack.read(join(root, 'package.json'));

        const again = await runRename(root, { execute: true });

        ctx.expect(again.output.targetsRename).toEqual({ migrated: false });
        ctx.expect(jetpack.read(join(root, 'package.json')), 'the manifest is untouched').toBe(after);
        ctx.expect(jetpack.list(join(root, 'targets'))).toEqual(['website']);
      },
    },

    {
      name: 'targets-rename: a brand born on targets/ is never touched',
      run: async (ctx) => {
        const root = stageRenameBrand({ targets: ['website'], workspaces: ['targets/*'] });

        const result = await runRename(root, { execute: true });

        ctx.expect(result.output.targetsRename).toEqual({ migrated: false });
        ctx.expect(readManifest(root).workspaces).toEqual(['targets/*']);
      },
    },

    {
      name: 'targets-rename: a hand-renamed folder still heals the workspaces glob',
      run: async (ctx) => {
        const root = stageRenameBrand({ targets: ['website'], workspaces: ['apps/*'] });

        const audit = await runRename(root);
        ctx.expect(audit.output.targetsRename).toEqual({ audit: true, folder: false, workspaces: true, targets: [] });
        ctx.expect(readManifest(root).workspaces, 'the audit writes nothing').toEqual(['apps/*']);

        const result = await runRename(root, { execute: true });

        ctx.expect(result.output.targetsRename.migrated).toBe(true);
        ctx.expect(readManifest(root).workspaces).toEqual(['targets/*']);
      },
    },

    {
      name: 'targets-rename: BOTH folders fails loudly instead of guessing',
      run: async (ctx) => {
        const root = stageRenameBrand({ apps: ['website'], targets: ['website'] });

        await ctx.expect((() => runRename(root, { execute: true }))()).rejects.toThrow(/carries BOTH apps\/ and targets\//);

        ctx.expect(jetpack.exists(join(root, 'apps', 'website')), 'nothing is moved').toBe('dir');
        ctx.expect(readManifest(root).workspaces, 'nothing is rewritten').toEqual(['apps/*']);
      },
    },

    {
      name: 'platform-names: a converged brand is a clean no-op',
      run: async (ctx) => {
        const root = stagePlatformBrand({
          brand: '{\n  brand: { id: "b" },\n  targets: {\n    desktop: { type: "desktop", platforms: { windows: { arch: ["x64"] }, linux: { formats: { snap: {} } } } },\n  },\n}\n',
        });

        const result = await runPlatformNames(root, { execute: true });

        ctx.expect(result.output.platformNames).toEqual({ migrated: false });
      },
    },

    {
      name: 'platform-names: the default run audits, naming every key, writing nothing',
      run: async (ctx) => {
        const brand = '{\n  brand: { id: "b" },\n  targets: {\n    desktop: {\n      type: "desktop",\n      platforms: {\n        win: { arch: ["x64"], oneClick: false },\n        linux: { snap: { enabled: true, channels: ["edge"] } },\n      },\n    },\n  },\n}\n';
        const root = stagePlatformBrand({ brand, icons: ['.'] });
        const before = jetpack.read(join(root, 'config', 'omega.json5'));

        const result = await runPlatformNames(root);

        ctx.expect(result.output.platformNames.audit).toBe(true);
        ctx.expect(result.output.platformNames.keys).toEqual(['targets.desktop.platforms.win', 'targets.desktop.platforms.linux.snap']);
        ctx.expect(result.output.platformNames.icons).toEqual([root]);
        ctx.expect(jetpack.read(join(root, 'config', 'omega.json5')), 'the file is byte-identical').toBe(before);
        ctx.expect(jetpack.exists(join(root, 'config', 'icons', 'macos')), 'the icon dir is untouched').toBe('dir');
      },
    },

    {
      name: 'platform-names: --execute rewrites the keys, keeps the settings, and renames the icon dir',
      run: async (ctx) => {
        const brand = '{\n  brand: { id: "b" },\n  targets: {\n    desktop: {\n      type: "desktop",\n      platforms: {\n        win: { arch: ["x64"], oneClick: false },\n        linux: { arch: ["x64"], snap: { enabled: true, channels: ["edge"], grade: "devel" } },\n      },\n    },\n  },\n}\n';
        const root = stagePlatformBrand({ brand, icons: ['.', join('targets', 'desktop')] });

        const result = await runPlatformNames(root, { execute: true });

        ctx.expect(result.output.platformNames.migrated).toBe(true);

        const config = readJson5(join(root, 'config', 'omega.json5'));
        const platforms = config.targets.desktop.platforms;
        ctx.expect(platforms.win, 'the retired key is gone: there is no dual read').toBe(undefined);
        ctx.expect(platforms.windows, 'every setting travels').toEqual({ arch: ['x64'], oneClick: false });
        ctx.expect(platforms.linux.snap).toBe(undefined);
        ctx.expect(platforms.linux.formats.snap, 'the snap settings move INSIDE the format, and the `enabled` flag is dropped').toEqual({ channels: ['edge'], grade: 'devel' });
        ctx.expect(platforms.linux.arch, 'the platform keeps its own install knobs').toEqual(['x64']);

        for (const dir of [root, join(root, 'targets', 'desktop')]) {
          ctx.expect(jetpack.exists(join(dir, 'config', 'icons', 'macos'))).toBe(false);
          ctx.expect(jetpack.read(join(dir, 'config', 'icons', 'mac', 'icon.png'))).toBe('png-bytes');
        }

        // Idempotent: the rerun finds nothing left to move
        const again = await runPlatformNames(root, { execute: true });
        ctx.expect(again.output.platformNames).toEqual({ migrated: false });
      },
    },

    {
      name: 'platform-names: a disabled snap becomes the `false` that drops the format',
      run: async (ctx) => {
        const root = stagePlatformBrand({
          target: '{\n  platforms: {\n    linux: { snap: { enabled: false, channels: ["stable"] } },\n  },\n}\n',
        });

        const result = await runPlatformNames(root, { execute: true });

        ctx.expect(result.output.platformNames.keys).toEqual(['platforms.linux.snap']);
        const config = readJson5(join(root, 'targets', 'desktop', 'config', 'omega.json5'));
        ctx.expect(config.platforms.linux.formats.snap, 'presence is the switch, so `false` is the whole statement').toBe(false);
      },
    },

    {
      name: 'platform-names: the keys are swept in EVERY file a brand owns, target files included',
      run: async (ctx) => {
        const root = stagePlatformBrand({
          brand: '{\n  brand: { id: "b" },\n  targets: {\n    app: { type: "desktop", platforms: { win: { arch: ["x64"] } } },\n  },\n}\n',
          target: '{\n  platforms: {\n    win: { oneClick: true },\n  },\n}\n',
        });

        const result = await runPlatformNames(root, { execute: true });

        ctx.expect(result.output.platformNames.keys, 'the brand file names the key under its target, the target file at the top level').toEqual(['targets.app.platforms.win', 'platforms.win']);
        ctx.expect(readJson5(join(root, 'config', 'omega.json5')).targets.app.platforms.windows).toEqual({ arch: ['x64'] });
        ctx.expect(readJson5(join(root, 'targets', 'desktop', 'config', 'omega.json5')).platforms.windows).toEqual({ oneClick: true });
      },
    },
  ],
});
