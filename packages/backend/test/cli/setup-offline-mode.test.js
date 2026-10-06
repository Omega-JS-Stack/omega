/**
 * Test: `npx omega setup --offline` never mutates the brand's live cloud
 * project ([#284](https://github.com/Omega-JS-Stack/omega/issues/284)).
 *
 * Two setup checks reach outside the working tree with no opt-out:
 * `firestore-indexes-synced.fix()` runs `firebase deploy --only
 * firestore:indexes`, and `storage-lifecycle-policy.run()` runs `gsutil
 * lifecycle set`. Scaffolding a fresh app therefore rewrote production
 * infrastructure as a side effect. `--offline` downgrades both to REPORTED
 * failures ('warn' — surfaced in the summary, never halting): the read-only
 * drift report still runs, the mutation does not.
 *
 * The ONE stub here is `powertools.execute` — the single seam every one of
 * these spawns goes through. The real calls deploy Firestore indexes and
 * rewrite GCS bucket lifecycle on a LIVE project; neither surface has an
 * emulator, and running them is the exact bug under test. Restored in a
 * `finally`, and the read-only leg is shimmed to the real command's contract
 * (`firebase firestore:indexes > <file>` writes the live JSON to <file>) so
 * the check's own comparison logic runs for real.
 *
 * Run: npx omega test backend:cli/setup-offline-mode
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');
const { BOOLEAN_FLAGS } = require('../../dist/cli/flags.js');
const FirestoreIndexesSyncedTest = require('../../dist/cli/commands/setup-tests/firestore-indexes-synced.js');
const StorageLifecyclePolicyTest = require('../../dist/cli/commands/setup-tests/storage-lifecycle-policy.js');
const MarketingCampaignsSeededTest = require('../../dist/cli/commands/setup-tests/marketing-campaigns-seeded.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// What the target has committed vs what the live project actually carries — one
// differing index is all the drift the check needs to fail.
const LOCAL_INDEXES = {
  indexes: [
    { collectionGroup: 'users', queryScope: 'COLLECTION', fields: [{ fieldPath: 'email', order: 'ASCENDING' }] },
  ],
  fieldOverrides: [],
};

const LIVE_INDEXES = {
  indexes: [
    { collectionGroup: 'posts', queryScope: 'COLLECTION', fields: [{ fieldPath: 'published', order: 'DESCENDING' }] },
  ],
  fieldOverrides: [],
};

// Every command these checks spawn goes through powertools.execute. `onCommand`
// shims the read-only leg; anything it does not answer throws, so an unexpected
// spawn fails the test instead of reaching the network.
async function withSpawnTrap(fn, onCommand) {
  const original = powertools.execute;
  const spawned = [];

  powertools.execute = async (command, options) => {
    spawned.push(command);

    if (onCommand) {
      return await onCommand(command, options);
    }

    throw new Error(`spawn trap: nothing may spawn here (got "${command}")`);
  };

  try {
    return await fn(spawned);
  } finally {
    powertools.execute = original;
  }
}

// The `firebase firestore:indexes > <file>` read: the real command writes the
// live index JSON to the redirect target, which the check then require()s.
function liveIndexRead(command) {
  if (!command.startsWith('firebase firestore:indexes')) {
    throw new Error(`spawn trap: only the read-only index fetch may spawn (got "${command}")`);
  }

  jetpack.write(command.split('> ')[1].trim(), JSON.stringify(LIVE_INDEXES, null, 2));

  return '';
}

// An target root seeded with committed indexes that do NOT match live.
function seedTarget() {
  const targetPath = jetpack.tmpDir({ prefix: 'omega-setup-offline-' }).path();

  jetpack.write(path.join(targetPath, 'firestore.indexes.json'), JSON.stringify(LOCAL_INDEXES, null, 2));

  return targetPath;
}

function buildIndexesTest(targetPath, argv) {
  return new FirestoreIndexesSyncedTest({
    main: { projectId: 'real-project', argv: argv, firebaseProjectPath: targetPath },
  });
}

function buildStorageTest(argv) {
  return new StorageLifecyclePolicyTest({
    main: { projectId: 'real-project', argv: argv, firebaseProjectPath: '/nonexistent/project' },
  });
}

module.exports = defineCases({
  description: 'setup --offline — live-mutating checks downgrade to reported failures',
  type: 'group',
  timeout: 20000,

  tests: [
    {
      name: 'offline-is-a-declared-boolean',
      auth: 'none',

      async run({ expect }) {
        // Undeclared, the next positional would land as --offline's value.
        expect(BOOLEAN_FLAGS.includes('offline'), 'offline must be in the declared boolean list').toBe(true);
      },
    },

    {
      name: 'indexes-drift-fails-into-the-live-deploy-without-the-flag',
      auth: 'none',

      async run({ expect }) {
        // The bug, pinned: a plain scaffold run reaches `firebase deploy`.
        const targetPath = seedTarget();
        const test = buildIndexesTest(targetPath, {});

        await withSpawnTrap(async (spawned) => {
          expect(await test.run(), 'drift must fail so the runner calls fix()').toBe(false);

          await test.fix().catch(() => {});

          expect(spawned.some((c) => c.startsWith('firebase deploy')), 'without --offline the fix deploys indexes to the live project').toBe(true);
        }, (command) => {
          if (command.startsWith('firebase deploy')) {
            return '';
          }

          return liveIndexRead(command);
        });

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'indexes-drift-downgrades-to-a-warning-under-offline',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget();
        const test = buildIndexesTest(targetPath, { offline: true });

        await withSpawnTrap(async (spawned) => {
          // The read-only drift report still runs — the check reports what is
          // out of sync — but the verdict is a non-blocking warning, so the
          // runner never reaches the mutating fix.
          expect(await test.run(), '--offline downgrades drift to a reported warning').toBe('warn');
          expect(spawned.some((c) => c.startsWith('firebase deploy')), 'no live deploy may spawn under --offline').toBe(false);
        }, liveIndexRead);

        expect(test.getWarning().join(' '), 'the warning must name the flag that suppressed the deploy').toMatch(/--offline/);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'indexes-fix-spawns-nothing-under-offline',
      auth: 'none',

      async run({ expect }) {
        // Belt for any direct caller: run() already warns instead of failing,
        // so the runner cannot reach this fix.
        const targetPath = seedTarget();
        const test = buildIndexesTest(targetPath, { offline: true });

        await withSpawnTrap(async (spawned) => {
          await test.fix();

          expect(spawned, 'fix() must spawn nothing under --offline').toEqual([]);
        });

        expect(JSON.parse(jetpack.read(path.join(targetPath, 'firestore.indexes.json'))), 'the committed index file stays untouched under --offline').toEqual(LOCAL_INDEXES);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'storage-lifecycle-runs-gsutil-without-the-flag',
      auth: 'none',

      async run({ expect }) {
        // The bug's second half: this check IS the mutation.
        const test = buildStorageTest({});

        await withSpawnTrap(async (spawned) => {
          await test.run();

          expect(spawned.length > 0, 'without --offline the check spawns gsutil').toBe(true);
          expect(spawned.every((c) => c.startsWith('gsutil ')), 'every spawned command is gsutil').toBe(true);
        }, () => {
          throw new Error('bucket unreachable');
        });
      },
    },

    {
      name: 'storage-lifecycle-spawns-nothing-under-offline',
      auth: 'none',

      async run({ expect }) {
        const test = buildStorageTest({ offline: true });

        await withSpawnTrap(async (spawned) => {
          expect(await test.run(), '--offline downgrades the policy write to a reported warning').toBe('warn');
          expect(spawned, 'no gsutil process may spawn under --offline').toEqual([]);
        });

        expect(test.getWarning().join(' '), 'the warning must name the flag that suppressed the write').toMatch(/--offline/);
      },
    },

    {
      name: 'storage-lifecycle-passes-demo-projects-even-under-offline',
      auth: 'none',

      async run({ expect }) {
        // A demo-* project has no live buckets: the demo gate wins over the
        // offline warning, so a demo scaffold does not warn about a policy
        // that can never apply.
        const test = new StorageLifecyclePolicyTest({
          main: { projectId: 'demo-sandbox', argv: { offline: true }, firebaseProjectPath: '/nonexistent/project' },
        });

        await withSpawnTrap(async (spawned) => {
          expect(await test.run(), 'demo projects pass, never warn').toBe(true);
          expect(spawned, 'no process may spawn for a demo project').toEqual([]);
        });
      },
    },

    {
      name: 'seed-campaigns-opt-in-loses-to-offline',
      auth: 'none',

      async run({ expect }) {
        // --offline promises NO live mutations for the whole run; the seeding
        // fix() writes real Firestore docs, so the opt-in is ignored and the
        // drift verdict stays a non-blocking warning.
        const test = new MarketingCampaignsSeededTest({
          main: { projectId: 'real-project', argv: { offline: true, seedCampaigns: true, 'seed-campaigns': true }, firebaseProjectPath: '/nonexistent/project' },
        });

        expect(test._seedingRequested(), '--offline must override --seed-campaigns').toBe(false);
        expect(test._driftVerdict(), 'drift stays a warning, so the runner never calls the seeding fix()').toBe('warn');
        expect(test.getWarning().join(' '), 'the warning names the flag that suppressed the write, not the opt-in the user already passed').toMatch(/--offline/);
      },
    },
  ],
});
