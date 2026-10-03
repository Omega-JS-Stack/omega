/**
 * Server service tests — the brands operation against a method-level
 * recording fake of the Firestore REST client. Proves skip semantics, the
 * converged zero-mutation no-op (key-order-insensitive), the whitelist
 * (only brand/github/sponsorships cross, absent sections omitted), the
 * full-replace write on drift including stale-key removal (omega-manager's
 * merge:false semantic — but it overwrote blindly on every run; the port
 * reads first), and the dry-run zero-mutation guarantee.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/server/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.SERVER_SERVICE_ACCOUNT;

const BRAND = { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' };
const REPO = { provider: 'github', owner: 'fixture-org' };
const SPONSORSHIPS = {
  acceptable: ['tech', 'marketing'],
  unacceptable: ['spam'],
  prices: { 'guest-post': 70, 'link-insertion': 50 },
};
const DOC_PATH = `brands/${BRAND.id}`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ server = {}, sponsorships = SPONSORSHIPS } = {}) {
  const config = {
    brand: structuredClone(BRAND),
    repo: structuredClone(REPO),
    server: server === false ? false : { ...structuredClone(DEFAULTS.server), ...server },
    targets: { web: { type: 'web' }, backend: { type: 'backend' } },
    // Non-whitelisted sections — must never reach the registry
    payment: { products: [{ id: 'premium' }] },
    analytics: { providers: { google: { id: 'G-FIXTURE' } } },
  };
  if (sponsorships !== null) {
    config.sponsorships = structuredClone(sponsorships);
  }
  return config;
}

/** The exact document the registry should hold for the default fixture. */
function desiredDoc() {
  return { brand: structuredClone(BRAND), repo: structuredClone(REPO), sponsorships: structuredClone(SPONSORSHIPS) };
}

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeDb(responses = {}) {
  const db = { calls: [] };

  for (const method of ['getDoc', 'setDoc']) {
    db[method] = async (...args) => {
      db.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeDb: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  db.mutations = () => db.calls.filter((c) => c.method === 'setDoc');
  db.reads = () => db.calls.filter((c) => c.method === 'getDoc').map((c) => c.args[0]);
  return db;
}

function runService(config, { db, options = {} } = {}) {
  return service.run({
    brandId: BRAND.id,
    brandRoot: '/tmp/omega-manager-server-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: BRAND.id, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.server,
    options,
    serviceData: {},
    serverDb: db,
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'server',
  tests: [
    // ─── Registry / defaults pins ────────────────────────────────────────────────

    {
      name: 'server: registered after email with the brands operation',
      run: (ctx) => {
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('email') + 1]).toBe('server');
        ctx.expect(OPERATIONS.server.map((o) => o.name)).toEqual(['brands']);
      },
    },

    {
      name: 'server: defaults are enabled-only (project comes from the service account)',
      run: (ctx) => {
        ctx.expect(DEFAULTS.server).toEqual({ enabled: true });
      },
    },

    // ─── Setup / skip semantics ──────────────────────────────────────────────────

    {
      name: 'server: server.enabled = false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ server: { enabled: false } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/server\.enabled/);
      },
    },

    {
      name: 'server: scalar server: false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ server: false }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/server\.enabled/);
      },
    },

    {
      name: 'server: skips without SERVER_SERVICE_ACCOUNT in .env',
      run: async (ctx) => {
        const result = await runService(brandConfig()); // no injected db → the creds check applies
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/SERVER_SERVICE_ACCOUNT/);
      },
    },

    // ─── Converged no-op ─────────────────────────────────────────────────────────

    {
      name: 'server: a registry entry matching config is a zero-mutation no-op',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: desiredDoc() });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(db.reads()).toEqual([DOC_PATH]);
        ctx.expect(result.output.brands.synced).toBe(true);
        // no durable state — the registry doc IS the sync target
        ctx.expect(result.state).toBe(null);
      },
    },

    {
      name: 'server: key order differences are not drift',
      run: async (ctx) => {
        // Same content as desiredDoc(), every level reordered
        const db = fakeDb({
          getDoc: {
            sponsorships: {
              prices: { 'link-insertion': 50, 'guest-post': 70 },
              unacceptable: ['spam'],
              acceptable: ['tech', 'marketing'],
            },
            repo: { owner: 'fixture-org', provider: 'github' },
            brand: { url: BRAND.url, name: BRAND.name, id: BRAND.id },
          },
        });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
      },
    },

    // ─── brands ──────────────────────────────────────────────────────────────────

    {
      name: 'server: a missing registry entry is created with ONLY the whitelisted sections',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null, setDoc: {} });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        // Exact full-document write: payment/analytics/targets/server never cross
        ctx.expect(db.mutations().map((c) => c.args)).toEqual([[DOC_PATH, desiredDoc()]]);
        ctx.expect(result.output.brands.created).toBe(true);
      },
    },

    {
      name: 'server: an absent sponsorships section is omitted from the document',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null, setDoc: {} });

        const result = await runService(brandConfig({ sponsorships: null }), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()[0].args[1]).toEqual({ brand: BRAND, repo: REPO });
      },
    },

    {
      name: 'server: drifted brand data is replace-written with the full document',
      run: async (ctx) => {
        const stale = desiredDoc();
        stale.brand.name = 'Old Name';
        const db = fakeDb({ getDoc: stale, setDoc: {} });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().map((c) => c.args)).toEqual([[DOC_PATH, desiredDoc()]]);
        ctx.expect(result.output.brands.updated).toBe(true);
      },
    },

    {
      name: 'server: a stale key in the registry entry is drift (replace removes it)',
      run: async (ctx) => {
        // Every desired field matches — only an extra leftover key differs. A
        // merge-style compare would call this converged; the full-replace
        // semantic must rewrite the document so the stale key disappears.
        const db = fakeDb({ getDoc: { ...desiredDoc(), legacy: true }, setDoc: {} });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().map((c) => c.args)).toEqual([[DOC_PATH, desiredDoc()]]);
      },
    },

    {
      name: 'server: a changed sponsorship price is drift',
      run: async (ctx) => {
        const stale = desiredDoc();
        stale.sponsorships.prices['guest-post'] = 30;
        const db = fakeDb({ getDoc: stale, setDoc: {} });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().length).toBe(1);
      },
    },

    // ─── Dry run ─────────────────────────────────────────────────────────────────

    {
      name: 'server: dry run on a drifted entry performs zero mutations',
      run: async (ctx) => {
        const stale = desiredDoc();
        stale.brand.url = 'https://old-url.test';
        const db = fakeDb({ getDoc: stale });

        const result = await runService(brandConfig(), { db, options: { dryRun: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.brands.planned).toBe('update');
        ctx.expect(result.state).toBe(null);
      },
    },

    {
      name: 'server: dry run on a missing entry plans a create',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null });

        const result = await runService(brandConfig(), { db, options: { dryRun: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.brands.planned).toBe('create');
      },
    },
  ],
});
