/**
 * Directory service tests (#246) — the entry operation against a method-level
 * recording fake of the Firestore REST client. Proves the three gates (opt-in,
 * a parent to push into, demo-* no-op), the payload shape (identity + the
 * blocks the brand declares, repo slugs from @omega.js/config's ONE derivation),
 * the zero-mutation no-op on an unchanged config, that hub-owned fields on the
 * same document are never touched or counted as drift, and the dry-run
 * zero-mutation guarantee.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/directory/index.js');
const { OWNED_SECTIONS } = require('../src/services/directory/lib/blocks.js');

// Tests must never see real credentials from the shell environment
delete process.env.DIRECTORY_SERVICE_ACCOUNT;

const BRAND = { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' };
const COMPANY = { id: 'parent-brand', name: 'Parent Brand', url: 'https://parent-brand.test', images: {} };
const SPONSORSHIPS = {
  acceptable: ['tech', 'marketing'],
  unacceptable: ['gambling'],
  prices: { 'guest-post': 70, 'link-insertion': 50 },
};
const DOC_PATH = `brands/${BRAND.id}`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ directory = { enabled: true }, company = COMPANY, sponsorships = SPONSORSHIPS, projectId = 'fixture-brand-prod' } = {}) {
  const config = {
    brand: structuredClone(BRAND),
    cloud: { config: { projectId } },
    repo: { provider: 'github', owner: 'fixture-org' },
    targets: { web: { type: 'web' }, backend: { type: 'backend' } },
    // Never publishable — the entry carries identity + declared blocks only
    payment: { products: [{ id: 'premium' }] },
    analytics: { providers: { google: { id: 'G-FIXTURE' } } },
  };
  if (directory !== null) config.directory = structuredClone(directory);
  if (company !== null) config.company = structuredClone(company);
  if (sponsorships !== null) config.sponsorships = structuredClone(sponsorships);
  return config;
}

/** The exact entry the directory should hold for the default fixture. */
function desiredEntry() {
  return {
    brand: structuredClone(BRAND),
    github: { owner: 'fixture-org', name: 'fixture-brand-omega', slug: 'fixture-org/fixture-brand-omega' },
    sponsorships: structuredClone(SPONSORSHIPS),
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

function runService(config, { db, options = {} } = {}) {
  return service.run({
    brandId: BRAND.id,
    brandRoot: '/tmp/omega-manager-directory-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: BRAND.id, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.directory,
    options,
    serviceData: {},
    directoryDb: db,
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'directory',
  tests: [
    // ─── Registry / defaults pins ────────────────────────────────────────────────

    {
      name: 'directory: registered after server with the entry operation',
      run: (ctx) => {
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('server') + 1]).toBe('directory');
        ctx.expect(OPERATIONS.directory.map((o) => o.name)).toEqual(['entry']);
      },
    },

    {
      name: 'directory: defaults are OFF — participation is never implicit',
      run: (ctx) => {
        ctx.expect(DEFAULTS.directory).toEqual({ enabled: false });
      },
    },

    // ─── Gate 1: opt-in ──────────────────────────────────────────────────────────

    {
      name: 'directory: no directory config at all means no push',
      run: async (ctx) => {
        const result = await runService(brandConfig({ directory: null }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/directory\.enabled/);
      },
    },

    {
      name: 'directory: directory.enabled = false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ directory: { enabled: false } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/directory\.enabled/);
      },
    },

    {
      name: 'directory: an empty directory block is not opt-in',
      run: async (ctx) => {
        // Presence is not consent — only `enabled: true` participates
        const result = await runService(brandConfig({ directory: {} }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/directory\.enabled/);
      },
    },

    // ─── Gate 2: a company to push into (#677) ───────────────────────────────────

    {
      name: 'directory: a brand naming no company has no directory to push into',
      run: async (ctx) => {
        const result = await runService(brandConfig({ company: null }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/company/);
      },
    },

    {
      name: 'directory: a standalone resolution (id null) skips the same way',
      run: async (ctx) => {
        const result = await runService(brandConfig({ company: { id: null, name: 'Fixture Brand', url: BRAND.url, images: {} } }), { db: fakeDb() });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/company/);
      },
    },

    {
      name: "directory: company.id 'self' still participates (the company is in its own directory)",
      run: async (ctx) => {
        const db = fakeDb({ getDoc: desiredEntry() });
        const result = await runService(brandConfig({ company: { id: 'self', name: 'Fixture Brand', url: BRAND.url, images: {} } }), { db });
        ctx.expect(result.status).toBe('success');
        ctx.expect(db.reads()).toEqual([DOC_PATH]);
      },
    },

    // ─── Gate 3: demo no-op ──────────────────────────────────────────────────────

    {
      name: 'directory: a demo-* brand no-ops even when it opts in (emulator-only, nothing live to reach)',
      run: async (ctx) => {
        const db = fakeDb(); // any call at all throws
        const result = await runService(brandConfig({ projectId: 'demo-fixture-brand' }), { db });
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/demo-fixture-brand.*emulator-only/);
        ctx.expect(db.calls).toEqual([]);
      },
    },

    // ─── Credentials ─────────────────────────────────────────────────────────────

    {
      name: 'directory: skips without DIRECTORY_SERVICE_ACCOUNT in .env',
      run: async (ctx) => {
        const result = await runService(brandConfig()); // no injected db → the creds check applies
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/DIRECTORY_SERVICE_ACCOUNT/);
      },
    },

    // ─── Idempotence ─────────────────────────────────────────────────────────────

    {
      name: 'directory: an entry matching config is a zero-mutation no-op',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: desiredEntry() });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(db.reads()).toEqual([DOC_PATH]);
        ctx.expect(result.output.entry.synced).toBe(true);
        ctx.expect(result.output.entry.blocks).toEqual(['sponsorships']);
        // no durable state — the directory doc IS the sync target
        ctx.expect(result.state).toBe(null);
      },
    },

    {
      name: 'directory: key order differences are not drift',
      run: async (ctx) => {
        const db = fakeDb({
          getDoc: {
            sponsorships: {
              prices: { 'link-insertion': 50, 'guest-post': 70 },
              unacceptable: ['gambling'],
              acceptable: ['tech', 'marketing'],
            },
            github: { slug: 'fixture-org/fixture-brand-omega', name: 'fixture-brand-omega', owner: 'fixture-org' },
            brand: { url: BRAND.url, name: BRAND.name, id: BRAND.id },
          },
        });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
      },
    },

    {
      name: 'directory: hub-owned fields on the same document are not drift',
      run: async (ctx) => {
        // The marketplace keeps its own state on the entry (#246 boundary: the hub
        // is brand code). A converged brand must not rewrite the document because
        // of fields the framework does not own.
        const db = fakeDb({ getDoc: { ...desiredEntry(), orderCount: 12, moderation: { status: 'approved' } } });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
      },
    },

    // ─── The push ────────────────────────────────────────────────────────────────

    {
      name: 'directory: a missing entry is created with identity + the declared blocks only',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null, patchDoc: {} });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().map((c) => c.args)).toEqual([[DOC_PATH, desiredEntry(), OWNED_SECTIONS]]);
        ctx.expect(result.output.entry.created).toBe(true);
      },
    },

    {
      name: 'directory: the write masks only the framework-owned sections',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null, patchDoc: {} });

        await runService(brandConfig(), { db });

        // A merge write, never a replace: everything the hub owns survives, and a
        // section dropped from config is still removed (its path stays in the mask).
        ctx.expect(db.mutations()[0].args[2]).toEqual(['brand', 'github', 'sponsorships']);
      },
    },

    {
      name: 'directory: a changed sponsorship price is drift and is pushed',
      run: async (ctx) => {
        const stale = desiredEntry();
        stale.sponsorships.prices['guest-post'] = 30;
        const db = fakeDb({ getDoc: stale, patchDoc: {} });

        const result = await runService(brandConfig(), { db });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations().map((c) => c.args)).toEqual([[DOC_PATH, desiredEntry(), OWNED_SECTIONS]]);
        ctx.expect(result.output.entry.updated).toBe(true);
      },
    },

    {
      name: 'directory: drifted brand identity is pushed',
      run: async (ctx) => {
        const stale = desiredEntry();
        stale.brand.name = 'Old Name';
        const db = fakeDb({ getDoc: stale, patchDoc: {} });

        const result = await runService(brandConfig(), { db });

        ctx.expect(db.mutations().map((c) => c.args[1])).toEqual([desiredEntry()]);
      },
    },

    {
      name: 'directory: an undeclared block is omitted from the entry (and its removal is masked)',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: desiredEntry(), patchDoc: {} });

        const result = await runService(brandConfig({ sponsorships: null }), { db });

        ctx.expect(result.status).toBe('success');
        const [path, data, mask] = db.mutations()[0].args;
        ctx.expect(path).toBe(DOC_PATH);
        ctx.expect(Object.keys(data)).toEqual(['brand', 'github']);
        ctx.expect(mask.includes('sponsorships'), 'the mask still names the dropped block, so the directory loses it too').toBeTruthy();
        ctx.expect(result.output.entry.blocks).toEqual([]);
      },
    },

    {
      name: 'directory: an empty sponsorships block is not a declared block',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null, patchDoc: {} });

        await runService(brandConfig({ sponsorships: {} }), { db });

        ctx.expect(Object.keys(db.mutations()[0].args[1])).toEqual(['brand', 'github']);
      },
    },

    {
      name: 'directory: the repo slug comes from the shared derivation, not a local one',
      run: async (ctx) => {
        const config = brandConfig();
        // The owner is the only half configured: the name is `<brand.id>-omega`, the
        // SOURCE role's derivation (#883), never a value the entry re-invents.
        config.repo.owner = 'Renamed-Org';
        const db = fakeDb({ getDoc: null, patchDoc: {} });

        await runService(config, { db });

        ctx.expect(db.mutations()[0].args[1].github).toEqual({
          owner: 'Renamed-Org',
          name: 'fixture-brand-omega',
          slug: 'Renamed-Org/fixture-brand-omega',
        });
      },
    },

    {
      name: 'directory: an unresolvable repo is omitted rather than pushed half-formed',
      run: async (ctx) => {
        const config = brandConfig();
        delete config.repo; // no owner means no address at all
        const db = fakeDb({ getDoc: null, patchDoc: {} });

        await runService(config, { db });

        ctx.expect(Object.keys(db.mutations()[0].args[1])).toEqual(['brand', 'sponsorships']);
      },
    },

    {
      name: 'directory: a brand with no url pushes identity without one',
      run: async (ctx) => {
        const config = brandConfig();
        delete config.brand.url;
        const db = fakeDb({ getDoc: null, patchDoc: {} });

        await runService(config, { db });

        ctx.expect(db.mutations()[0].args[1].brand).toEqual({ id: BRAND.id, name: BRAND.name });
      },
    },

    // ─── Dry run ─────────────────────────────────────────────────────────────────

    {
      name: 'directory: dry run on a drifted entry performs zero mutations',
      run: async (ctx) => {
        const stale = desiredEntry();
        stale.brand.url = 'https://old-url.test';
        const db = fakeDb({ getDoc: stale });

        const result = await runService(brandConfig(), { db, options: { dryRun: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.entry.planned).toBe('update');
        ctx.expect(result.state).toBe(null);
      },
    },

    {
      name: 'directory: dry run on a missing entry plans a create',
      run: async (ctx) => {
        const db = fakeDb({ getDoc: null });

        const result = await runService(brandConfig(), { db, options: { dryRun: true } });

        ctx.expect(db.mutations()).toEqual([]);
        ctx.expect(result.output.entry.planned).toBe('create');
      },
    },
  ],
});
