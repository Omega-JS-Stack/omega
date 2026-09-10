/**
 * Test: the index checks leave a SHARED cloud project's indexes alone
 * ([#716](https://github.com/Omega-JS-Stack/omega/issues/716)).
 *
 * A `cloud.shared: true` project is one Firebase project carrying every tenant
 * brand's collections. `firestore-indexes-synced` pulled its deployed indexes
 * down and merged them into THIS brand's `firestore.indexes.json` — ~400 lines
 * of other brands' collections (campaigns, courses, enrollments, inboxes) landing
 * silently during a test run, ready for the next `git add -A`. On a shared
 * project the live index set is nobody's single brand to track, so the whole
 * check is skipped and the consumer's file stays authored.
 *
 * `firestore-indexes-file` is the SAME leak one step earlier: it runs BEFORE the
 * sync check (setup-tests/index.js:89 vs :91), and when the file is missing or
 * poisoned its fix live-pulled the tenant set in to create it — so gating only
 * the sync check left the first write ungated. It seeds the template instead,
 * the same answer a demo-* project already got.
 *
 * The ONE stub is `powertools.execute` — the single seam every spawn in these
 * checks goes through, and the same seam setup-offline-mode.test.js uses. Here it
 * refuses EVERY command, so any surviving live read fails the test instead of
 * reaching the network; the control case shims the read-only fetch to the real
 * command's contract (`firebase firestore:indexes > <file>`) so the ungated path
 * is proved to still run.
 *
 * Run: npx omega test backend:cli/setup-shared-project-indexes
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');
const FirestoreIndexesSyncedTest = require('../../dist/cli/commands/setup-tests/firestore-indexes-synced.js');
const FirestoreIndexesFileTest = require('../../dist/cli/commands/setup-tests/firestore-indexes-file.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// What the indexes-file fix seeds when there is no live set to pull.
const TEMPLATE_INDEXES = JSON.parse(jetpack.read(path.resolve(__dirname, '../../templates/firestore.indexes.json')));

// What the brand authored, and what the shared project actually carries — the
// live set is another tenant's collection entirely.
const LOCAL_INDEXES = {
  indexes: [
    { collectionGroup: 'users', queryScope: 'COLLECTION', fields: [{ fieldPath: 'email', order: 'ASCENDING' }] },
  ],
  fieldOverrides: [],
};

const TENANT_INDEXES = {
  indexes: [
    { collectionGroup: 'enrollments', queryScope: 'COLLECTION', fields: [{ fieldPath: 'courseId', order: 'ASCENDING' }] },
  ],
  fieldOverrides: [],
};

// Nothing may spawn: on a shared project every live read is the bug.
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

  jetpack.write(command.split('> ')[1].trim(), JSON.stringify(TENANT_INDEXES, null, 2));

  return '';
}

/**
 * A target root with committed indexes and a real (non-demo) project id, whose
 * config declares the cloud project shared or not.
 *
 * `opts.indexes` swaps what lands on disk for the indexes-file cases: `false`
 * writes no file at all, `'poisoned'` writes the 403 error text a failed live
 * pull shell-redirects into it.
 */
function seedTarget(shared, opts = {}) {
  const targetPath = jetpack.tmpDir({ prefix: 'omega-shared-indexes-' }).path();

  if (opts.indexes === 'poisoned') {
    jetpack.write(path.join(targetPath, 'firestore.indexes.json'), 'Error 403: Caller is missing permission');
  } else if (opts.indexes !== false) {
    jetpack.write(path.join(targetPath, 'firestore.indexes.json'), JSON.stringify(LOCAL_INDEXES, null, 2));
  }

  jetpack.write(path.join(targetPath, 'config', 'omega.json5'), JSON.stringify({
    brand: { name: 'Tenant Brand' },
    cloud: shared ? { shared: true, config: { projectId: 'shared-project' } } : { config: { projectId: 'own-project' } },
    targets: { backend: {} },
  }, null, 2));

  return targetPath;
}

function buildIndexesTest(TestClass, targetPath, projectId) {
  return new TestClass({
    main: { projectId: projectId, argv: {}, firebaseProjectPath: targetPath },
  });
}

function readIndexes(targetPath) {
  return JSON.parse(jetpack.read(path.join(targetPath, 'firestore.indexes.json')));
}

module.exports = defineCases({
  description: 'the firestore index checks skip a shared cloud project',
  type: 'group',
  timeout: 20000,

  tests: [
    {
      name: 'a-shared-project-is-never-read',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget(true);
        const test = buildIndexesTest(FirestoreIndexesSyncedTest, targetPath, 'shared-project');

        await withSpawnTrap(async (spawned) => {
          assert.equal(await test.run(), true, 'a shared project has no drift of this brand\'s to report');
          assert.deepEqual(spawned, [], 'no live index read may spawn for a shared project');
        });

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-shared-project-leaves-the-authored-file-untouched',
      auth: 'none',

      async run({ assert }) {
        // Belt for a direct caller: run() passes, so the runner never reaches
        // fix() — and if something does, the merge-and-write stays off.
        const targetPath = seedTarget(true);
        const test = buildIndexesTest(FirestoreIndexesSyncedTest, targetPath, 'shared-project');

        await withSpawnTrap(async (spawned) => {
          await test.fix();

          assert.deepEqual(spawned, [], 'fix() must spawn nothing for a shared project');
        });

        assert.deepEqual(readIndexes(targetPath), LOCAL_INDEXES, 'the consumer\'s index file stays exactly as authored');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-brands-own-project-still-syncs',
      auth: 'none',

      async run({ assert }) {
        // The gate is the shared flag, not a blanket skip: a project this brand
        // owns still gets its drift read and reported.
        const targetPath = seedTarget(false);
        const test = buildIndexesTest(FirestoreIndexesSyncedTest, targetPath, 'own-project');

        await withSpawnTrap(async (spawned) => {
          assert.equal(await test.run(), false, 'drift on the brand\'s own project must still fail');
          assert.equal(
            spawned.some((c) => c.startsWith('firebase firestore:indexes')),
            true,
            'the brand\'s own project is still read',
          );
        }, liveIndexRead);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-shared-project-seeds-the-template-instead-of-pulling',
      auth: 'none',

      async run({ assert }) {
        // The earlier check: with no file to read, the fix used to create one
        // from the live pull — the tenant set, written in whole.
        const targetPath = seedTarget(true, { indexes: false });
        const test = buildIndexesTest(FirestoreIndexesFileTest, targetPath, 'shared-project');

        assert.equal(await test.run(), false, 'a missing indexes file still needs writing');

        await withSpawnTrap(async (spawned) => {
          await test.fix();

          assert.deepEqual(spawned, [], 'no live index pull may spawn for a shared project');
        }, liveIndexRead);

        assert.deepEqual(readIndexes(targetPath), TEMPLATE_INDEXES, 'the template\'s empty shape is seeded, not the tenant set');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-shared-project-rewrites-a-poisoned-file-from-the-template',
      auth: 'none',

      async run({ assert }) {
        // The other way in: a file poisoned by an earlier failed pull is
        // treated as missing, and that rewrite pulled the tenant set too.
        const targetPath = seedTarget(true, { indexes: 'poisoned' });
        const test = buildIndexesTest(FirestoreIndexesFileTest, targetPath, 'shared-project');

        assert.equal(await test.run(), false, 'a poisoned file is treated as missing');

        await withSpawnTrap(async (spawned) => {
          await test.fix();

          assert.deepEqual(spawned, [], 'no live index pull may spawn for a shared project');
        }, liveIndexRead);

        assert.deepEqual(readIndexes(targetPath), TEMPLATE_INDEXES, 'the poisoned file is replaced by the template, not the tenant set');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-demo-project-still-seeds-the-template',
      auth: 'none',

      async run({ assert }) {
        // Control: widening the gate must not change what a demo-* project
        // already did — same seed, same silence.
        const targetPath = seedTarget(false, { indexes: false });
        const test = buildIndexesTest(FirestoreIndexesFileTest, targetPath, 'demo-tenant-brand');

        await withSpawnTrap(async (spawned) => {
          await test.fix();

          assert.deepEqual(spawned, [], 'a demo project has no live project to pull from');
        }, liveIndexRead);

        assert.deepEqual(readIndexes(targetPath), TEMPLATE_INDEXES, 'the template\'s empty shape is seeded');

        jetpack.remove(targetPath);
      },
    },
  ],
});
