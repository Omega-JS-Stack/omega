/**
 * Test: campaign seeding READS unconditionally, WRITES only on opt-in
 * ([#202](https://github.com/Omega-JS-Stack/omega/issues/202)).
 *
 * `omega setup` on a real project with a working service-account.json used to
 * auto-run fix(), writing 5 seed docs into LIVE Firestore with no consent. The
 * check still inspects live docs every run, but a missing/drifted seed now
 * returns 'warn' (non-blocking, never reaches fix) unless `--seed-campaigns`
 * opts the run into writing.
 *
 * Run: npx omega test backend:cli/marketing-campaigns-seeded
 */
const MarketingCampaignsSeededTest = require('../../dist/cli/commands/setup-tests/marketing-campaigns-seeded.js');
const { buildSeedCampaigns } = require('../../dist/cli/commands/setup-tests/helpers/seed-campaigns.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const SEEDS = buildSeedCampaigns();

// A Firestore stand-in over a plain {path: data} store. Every .set() lands in
// `writes`, so "never wrote to live Firestore" is an assertion.
function fakeAdmin(store, writes) {
  return {
    firestore: () => ({
      doc: (path) => ({
        get: async () => ({ exists: Object.prototype.hasOwnProperty.call(store, path), data: () => store[path] }),
        set: async (data, options) => {
          writes.push({ path: path, data: data, options: options });
          store[path] = Object.assign({}, store[path], data);
        },
      }),
    }),
  };
}

// The live docs a fully-seeded project carries.
function seededStore() {
  const store = {};

  for (const seed of SEEDS) {
    store[`marketing-campaigns/${seed.id}`] = JSON.parse(JSON.stringify(seed.doc));
  }

  return store;
}

// A fully-seeded project where one enforced field was changed by hand.
function driftedStore() {
  const store = seededStore();
  store[`marketing-campaigns/${SEEDS[0].id}`].settings.template = 'not-the-enforced-value';

  return store;
}

function buildTest({ projectId, argv, store }) {
  const writes = [];
  const test = new MarketingCampaignsSeededTest({
    main: {
      projectId: projectId,
      argv: argv,
      firebaseProjectPath: '/nonexistent/project',
    },
  });

  test.writes = writes;
  test.adminCalls = 0;
  test._getAdmin = () => {
    test.adminCalls++;
    return store ? fakeAdmin(store, writes) : null;
  };

  return test;
}

// Mirrors the runner in src/cli/index.js: only a hard `false` reaches fix().
// 'warn' is reported and moves on; `true` passes.
async function runLikeSetup(test) {
  const result = await test.run();

  if (result === false) {
    await test.fix();
  }

  return result;
}

module.exports = defineCases({
  description: 'Marketing campaigns seeder — reads every run, writes only on opt-in',
  type: 'group',

  tests: [
    {
      name: 'no-flag-drift-warns-and-never-writes',
      async run({ expect }) {
        const stores = { 'missing docs': {}, 'drifted enforced field': driftedStore() };

        for (const [label, store] of Object.entries(stores)) {
          const test = buildTest({ projectId: 'real-project', argv: {}, store: store });
          const result = await runLikeSetup(test);

          expect(result, `${label}: without --seed-campaigns drift must warn, never fail into fix()`).toBe('warn');
          expect(test.writes.length, `${label}: without --seed-campaigns nothing may be written`).toBe(0);
        }
      },
    },

    {
      name: 'no-flag-fully-seeded-passes-clean',
      async run({ expect }) {
        // The common case on a live project: reads run, everything matches,
        // the check passes with no standing warning.
        const test = buildTest({ projectId: 'real-project', argv: {}, store: seededStore() });
        const result = await runLikeSetup(test);

        expect(result, 'correct seeds pass without the flag').toBe(true);
        expect(test.adminCalls, 'the read-only check runs without the flag').toBe(1);
        expect(test.writes.length, 'a clean pass writes nothing').toBe(0);
      },
    },

    {
      name: 'no-flag-no-connection-skips',
      async run({ expect }) {
        const test = buildTest({ projectId: 'real-project', argv: {}, store: null });
        const result = await runLikeSetup(test);

        expect(result, 'no connection still skips gracefully without the flag').toBe(true);
        expect(test.writes.length, 'no connection writes nothing').toBe(0);
      },
    },

    {
      name: 'no-flag-fix-never-writes',
      async run({ expect }) {
        // Belt for any future caller that reaches fix() directly.
        const test = buildTest({ projectId: 'real-project', argv: {}, store: {} });
        await test.fix();

        expect(test.writes.length, 'fix() without --seed-campaigns must never write').toBe(0);
      },
    },

    {
      name: 'flag-drift-fails-into-fix-and-seeds',
      async run({ expect }) {
        // Both the kebab and camelCase keys the parse mints opt in.
        for (const argv of [{ 'seed-campaigns': true }, { seedCampaigns: true }]) {
          const test = buildTest({ projectId: 'real-project', argv: argv, store: {} });
          const result = await test.run();

          expect(result, `${JSON.stringify(argv)}: with the flag, drift fails so the runner fixes`).toBe(false);

          await test.fix();
          expect(test.writes.length, `${JSON.stringify(argv)}: fix() creates every missing seed`).toBe(SEEDS.length);
        }
      },
    },

    {
      name: 'flag-preserves-the-no-connection-skip',
      async run({ expect }) {
        const test = buildTest({ projectId: 'real-project', argv: { 'seed-campaigns': true }, store: null });
        const result = await runLikeSetup(test);

        expect(result, 'no connection still skips gracefully with the flag').toBe(true);
        expect(test.writes.length, 'no connection writes nothing').toBe(0);
      },
    },

    {
      name: 'demo-project-passes-before-every-other-guard',
      async run({ expect }) {
        for (const argv of [{}, { 'seed-campaigns': true }]) {
          const test = buildTest({ projectId: 'demo-omega', argv: argv, store: {} });
          const result = await runLikeSetup(test);

          expect(result, `${JSON.stringify(argv)}: demo-* projects pass, emulator seeds on boot`).toBe(true);
          expect(test.adminCalls, `${JSON.stringify(argv)}: demo-* projects never construct admin`).toBe(0);
          expect(test.writes.length, `${JSON.stringify(argv)}: demo-* projects never write`).toBe(0);
        }
      },
    },

    {
      name: 'warning-names-the-opt-in-flag',
      async run({ expect }) {
        const test = buildTest({ projectId: 'real-project', argv: {}, store: {} });
        const warning = test.getWarning();

        expect(Array.isArray(warning), 'getWarning() returns the runner\'s detail lines').toBe(true);
        expect(warning.join(' '), 'the warning must name the exact flag that opts in').toMatch(/--seed-campaigns/);
      },
    },
  ],
});
