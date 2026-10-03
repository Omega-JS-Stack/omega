/**
 * Sentry service tests — both operations against a method-level recording
 * fake of the Sentry client, with the config writeback REAL (temp brand
 * roots via the shared config fixture). Proves skip semantics, org
 * resolution (config wins / lone-org self-heal / multi-org warn), the
 * region repoint, per-target project creation with the right platforms,
 * the converged zero-mutation byte-identical no-op, DSN drift patching,
 * and the dry-run zero-mutation guarantee.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { SERVICE_ORDER, OPERATIONS } = require('../src/config.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');
const service = require('../src/services/monitoring/index.js');

const DOWN = '\x1B[B';

// Tests must never see real credentials from the shell environment
delete process.env.SENTRY_AUTH_TOKEN;

const ORG = { slug: 'fixture-org', links: { regionUrl: 'https://us.sentry.io' } };
const ALL_TARGETS = { web: { type: 'web' }, backend: { type: 'backend' }, desktop: { type: 'desktop' }, extension: { type: 'extension' } };
const PLATFORMS = { web: 'javascript', backend: 'node', desktop: 'electron', extension: 'javascript' };

function dsnOf(target) {
  return `https://key-${target}@o1.ingest.us.sentry.io/${target.length}00`;
}

function projectRecord(target) {
  return { id: `proj-${target}`, slug: `fixture-brand-${target}` };
}

function keysFor(target) {
  return [{ isActive: true, dsn: { public: dsnOf(target) } }];
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const WRITEBACK_CONFIG = `// Fixture Brand — hand-edited writeback target
{
  brand: {
    id: 'fixture-brand', // stays single-quoted
    name: "Fixture Brand",
  },
  monitoring: {
    providers: {
      sentry: {
        dsn: null,
      },
    },
  },
  targets: {
    web: { type: 'web' },
    backend: { type: 'backend' },
    desktop: { type: 'desktop' },
    extension: { type: 'extension' },
  },
}
`;

function brandConfig({ monitoring = { providers: { sentry: {} } }, targets = structuredClone(ALL_TARGETS) } = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
    monitoring,
    targets,
  };
}

const READ_METHODS = ['getOrganizations', 'getTeams', 'getProjects', 'getProjectKeys'];
const MUTATING_METHODS = ['createTeam', 'createProject'];

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeSentry(responses = {}) {
  const api = { calls: [], regionUrls: [] };

  api.setRegionUrl = (url) => { api.regionUrls.push(url); };

  for (const method of [...READ_METHODS, ...MUTATING_METHODS]) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeSentry: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  api.mutations = () => api.calls.filter((call) => MUTATING_METHODS.includes(call.method));
  api.callsTo = (method) => api.calls.filter((call) => call.method === method);
  return api;
}

function runService(config, { sentry, options = {}, serviceData = {}, brandRoot } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || makeBrandRoot(WRITEBACK_CONFIG),
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.monitoring,
    options,
    serviceData,
    sentryApi: sentry,
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'monitoring',
  tests: [
    // ─── Registry / skip semantics ───────────────────────────────────────────────

    {
      name: 'monitoring: registered between advertising and campaigns with the two operations',
      run: (ctx) => {
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('advertising') + 1]).toBe('monitoring');
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('monitoring') + 1]).toBe('campaigns');
        ctx.expect(OPERATIONS.monitoring.map((op) => op.name)).toEqual(['projects', 'dsn']);
      },
    },

    {
      name: 'monitoring: skips without a monitoring section, when disabled, and on another provider',
      run: async (ctx) => {
        const none = await runService(brandConfig({ monitoring: null }), { sentry: fakeSentry() });
        ctx.expect(none.status).toBe('skipped');
        ctx.expect(none.reason).toMatch(/no monitoring config/);

        const disabled = await runService(brandConfig({ monitoring: false }), { sentry: fakeSentry() });
        ctx.expect(disabled.status).toBe('skipped');
        ctx.expect(disabled.reason).toMatch(/disabled/);

        const other = await runService(brandConfig({ monitoring: { providers: { other: {} } } }), { sentry: fakeSentry() });
        ctx.expect(other.status).toBe('skipped');
        ctx.expect(other.reason).toMatch(/monitoring\.providers\.other/);

        // Empty providers block = none chosen, exactly what a null provider meant (#425)
        const unchosen = await runService(brandConfig({ monitoring: { providers: {} } }), { sentry: fakeSentry() });
        ctx.expect(unchosen.status).toBe('skipped');
        ctx.expect(unchosen.reason).toMatch(/no monitoring\.providers entry/);
      },
    },

    {
      name: 'monitoring: skips without SENTRY_AUTH_TOKEN in .env (machine-readable missingEnv)',
      run: async (ctx) => {
        const result = await runService(brandConfig()); // no injected api → the creds check applies
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/SENTRY_AUTH_TOKEN/);
        ctx.expect(result.missingEnv).toEqual(['SENTRY_AUTH_TOKEN']);
      },
    },

    // ─── Create-on-missing ───────────────────────────────────────────────────────

    {
      name: 'monitoring: empty org — team + one project per target created, org and DSNs written back',
      run: async (ctx) => {
        const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
        const api = fakeSentry({
          getOrganizations: [ORG],
          getTeams: [],
          createTeam: { slug: 'fixture-brand' },
          getProjects: [],
          createProject: (org, team, { slug }) => ({ id: `proj-${slug}`, slug }),
          getProjectKeys: (org, slug) => keysFor(slug.replace('fixture-brand-', '')),
        });

        const result = await runService(brandConfig(), { sentry: api, brandRoot });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.projects.created).toBe(4);
        ctx.expect(result.output.dsn.landed).toBe(4);
        ctx.expect(result.state.org).toBe('fixture-org');
        ctx.expect(result.state.projectMap.backend.slug).toBe('fixture-brand-backend');

        // Region repoint from the org record
        ctx.expect(api.regionUrls).toEqual(['https://us.sentry.io']);

        // One team ensure, then a create per target with the right platform
        ctx.expect(api.callsTo('createTeam').length).toBe(1);
        const createdPlatforms = Object.fromEntries(
          api.callsTo('createProject').map(({ args }) => [args[2].slug.replace('fixture-brand-', ''), args[2].platform]),
        );
        ctx.expect(createdPlatforms).toEqual(PLATFORMS);

        // omega.json5 gained the org + all four per-target DSNs, comments intact
        const written = readConfigSource(brandRoot);
        ctx.expect(written).toMatch(/org: "fixture-org"/);
        for (const target of Object.keys(ALL_TARGETS)) {
          ctx.expect(written.includes(dsnOf(target)), `expected ${target} DSN in omega.json5`).toBeTruthy();
        }
        ctx.expect(written).toMatch(/\/\/ stays single-quoted/);
      },
    },

    {
      name: 'monitoring: only enabled targets get projects',
      run: async (ctx) => {
        const api = fakeSentry({
          getOrganizations: [ORG],
          getTeams: [{ slug: 'fixture-brand' }],
          getProjects: [],
          createProject: (org, team, { slug }) => ({ id: `proj-${slug}`, slug }),
          getProjectKeys: keysFor('web'),
        });

        const result = await runService(brandConfig({ targets: { web: { type: 'web' } } }), { sentry: api });

        ctx.expect(result.output.projects.created).toBe(1);
        ctx.expect(api.callsTo('createProject').map(({ args }) => args[2].slug)).toEqual(['fixture-brand-web']);
      },
    },

    // A target answers to the NAME its brand gave it (#886): the TYPE picks the
    // Sentry platform, the NAME is the project slug and the config key.
    {
      name: 'monitoring: a web target named `site` gets its own project, and its DSN lands under targets.site',
      run: async (ctx) => {
        const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
        const api = fakeSentry({
          getOrganizations: [ORG],
          getTeams: [{ slug: 'fixture-brand' }],
          getProjects: [],
          createProject: (org, team, { slug }) => ({ id: `proj-${slug}`, slug }),
          getProjectKeys: keysFor('site'),
        });

        const result = await runService(brandConfig({ targets: { site: { type: 'web' } } }), { sentry: api, brandRoot });

        ctx.expect(result.status).toBe('success');
        const [{ args }] = api.callsTo('createProject');
        ctx.expect(args[2].slug, 'the project is named for the target').toBe('fixture-brand-site');
        ctx.expect(args[2].platform, 'and platformed by its type').toBe('javascript');
        ctx.expect(result.state.projectMap.site.slug).toBe('fixture-brand-site');

        const written = readConfigSource(brandRoot);
        ctx.expect(written, 'the DSN lands under targets.site').toMatch(/site: \{\s*\n\s*monitoring:/);
        ctx.expect(written.includes(dsnOf('site'))).toBeTruthy();
      },
    },

    // ─── Convergence ─────────────────────────────────────────────────────────────

    {
      name: 'monitoring: a fully converged brand is a zero-mutation no-op and the file stays byte-identical',
      run: async (ctx) => {
        const configured = `// Converged fixture
{
  brand: { id: 'fixture-brand' },
  monitoring: { providers: { sentry: { org: "fixture-org" } } },
  targets: {
    web: { type: 'web', monitoring: { providers: { sentry: { dsn: "${dsnOf('web')}" } } } },
  },
}
`;
        const brandRoot = makeBrandRoot(configured);
        const config = brandConfig({
          monitoring: { providers: { sentry: { org: 'fixture-org' } } },
          targets: { web: { type: 'web', monitoring: { providers: { sentry: { dsn: dsnOf('web') } } } } },
        });
        const api = fakeSentry({
          getOrganizations: [ORG],
          getProjects: [projectRecord('web')],
          getProjectKeys: keysFor('web'),
        });

        const result = await runService(config, { sentry: api, brandRoot });

        ctx.expect(result.status).toBe('success');
        ctx.expect(api.mutations()).toEqual([]);
        ctx.expect(result.output.projects.synced).toBe(1);
        ctx.expect(result.output.dsn.landed).toBe(0);
        ctx.expect(readConfigSource(brandRoot)).toBe(configured);
      },
    },

    {
      name: 'monitoring: a hand-set stale DSN is drift and gets patched',
      run: async (ctx) => {
        const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
        const config = brandConfig({
          monitoring: { providers: { sentry: { org: 'fixture-org' } } },
          targets: { web: { type: 'web', monitoring: { providers: { sentry: { dsn: 'https://stale@old.ingest.sentry.io/1' } } } } },
        });
        const api = fakeSentry({
          getOrganizations: [ORG],
          getProjects: [projectRecord('web')],
          getProjectKeys: keysFor('web'),
        });

        const result = await runService(config, { sentry: api, brandRoot });

        ctx.expect(result.output.dsn.landed).toBe(1);
        ctx.expect(api.mutations()).toEqual([]);
        ctx.expect(readConfigSource(brandRoot).includes(dsnOf('web'))).toBeTruthy();
      },
    },

    // ─── Org resolution ──────────────────────────────────────────────────────────

    {
      name: 'monitoring: multiple orgs without monitoring.providers.sentry.org warns and mutates nothing',
      run: async (ctx) => {
        const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
        const api = fakeSentry({
          getOrganizations: [{ slug: 'org-a' }, { slug: 'org-b' }],
        });

        const result = await runService(brandConfig(), { sentry: api, brandRoot });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.projects.orgUnresolved).toBe(true);
        ctx.expect(api.mutations()).toEqual([]);
        ctx.expect(readConfigSource(brandRoot)).toBe(WRITEBACK_CONFIG);
      },
    },

    {
      name: 'monitoring: an ambiguous org is ASKED for and the pick lands in omega.json5 (#635)',
      run: async (ctx) => {
        const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
        const api = fakeSentry({
          getOrganizations: [{ slug: 'org-a' }, { slug: 'org-b', links: { regionUrl: 'https://eu.sentry.io' } }],
          getTeams: [{ slug: 'fixture-brand' }],
          getProjects: [],
          createProject: (org, team, { slug }) => ({ id: `proj-${slug}`, slug }),
          getProjectKeys: keysFor('web'),
        });

        const tty = openTtyPrompt();
        try {
          const run = runService(brandConfig({ targets: { web: { type: 'web' } } }), { sentry: api, brandRoot });
          await tty.answer('Select Sentry organization:', `${DOWN}\r`); // org-b
          const result = await run;

          ctx.expect(result.status).toBe('success');
          ctx.expect(result.state.org).toBe('org-b');
          // The pick is the org every org-scoped call is then made against
          ctx.expect(api.callsTo('createProject').map(({ args }) => args[0])).toEqual(['org-b']);
          ctx.expect(api.regionUrls).toEqual(['https://eu.sentry.io']);
          // ...and it landed in config (comments intact), so nothing asks again
          const written = readConfigSource(brandRoot);
          ctx.expect(written).toMatch(/org: "org-b"/);
          ctx.expect(written).toMatch(/\/\/ stays single-quoted/);
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'monitoring: a token that sees NO org has nothing to ask about — the warn stands (#635)',
      run: async (ctx) => {
        const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
        const api = fakeSentry({ getOrganizations: [] });

        const tty = openTtyPrompt();
        try {
          const result = await runService(brandConfig(), { sentry: api, brandRoot });

          ctx.expect(result.status).toBe('warned');
          ctx.expect(result.output.projects.orgUnresolved).toBe(true);
          ctx.expect(api.mutations()).toEqual([]);
          ctx.expect(readConfigSource(brandRoot)).toBe(WRITEBACK_CONFIG);
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'monitoring: a configured org the token cannot see warns honestly',
      run: async (ctx) => {
        const config = brandConfig({ monitoring: { providers: { sentry: { org: 'someone-elses-org' } } } });
        const api = fakeSentry({ getOrganizations: [ORG] });

        const result = await runService(config, { sentry: api });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(api.mutations()).toEqual([]);
      },
    },

    // ─── Dry run ─────────────────────────────────────────────────────────────────

    {
      name: 'monitoring: dry run on an empty org plans everything and mutates nothing',
      run: async (ctx) => {
        const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
        const api = fakeSentry({
          getOrganizations: [ORG],
          getProjects: [],
        });

        const result = await runService(brandConfig(), { sentry: api, brandRoot, options: { dryRun: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.projects.planned).toEqual([
          'fixture-brand-web', 'fixture-brand-backend', 'fixture-brand-desktop', 'fixture-brand-extension',
        ]);
        ctx.expect(api.mutations()).toEqual([]);
        ctx.expect(readConfigSource(brandRoot)).toBe(WRITEBACK_CONFIG);
      },
    },
  ],
});
