/**
 * Test: `ensureTarget()` — the local, idempotent scaffold every verb runs
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * `omega setup` is retired: the "write it if missing" half it owned (the
 * config artifacts, the engines pin, the defaults tree) moved into one
 * function that `ensureStaged()` calls, so nobody has to remember a command
 * per target. It must heal a fresh target on the first run and go completely
 * quiet on the second.
 *
 * Run: npx omega test backend:cli/ensure-target
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const { ensureTarget } = require('../../src/cli/utils/ensure-target.js');

/** A virgin backend target: a manifest and nothing else. */
function seedTarget() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ensure-target-')));
  jetpack.write(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }, null, 2));
  return dir;
}

/** ensureTarget with its output captured. */
function run(dir) {
  const lines = [];
  const result = ensureTarget({ projectDir: dir, log: (message) => lines.push(message) });
  return { ...result, lines };
}

module.exports = {
  description: 'ensureTarget(): the verbs scaffold the target — once, then quietly',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-fresh-target-gets-the-scaffold',
      auth: 'none',

      async run({ assert }) {
        const dir = seedTarget();

        try {
          const first = run(dir);

          assert.equal(jetpack.exists(path.join(dir, '.firebaserc')), 'file', '.firebaserc is derived from the resolved config');
          assert.equal(jetpack.exists(path.join(dir, 'firebase.json')), 'file', 'firebase.json is scaffolded from the template');
          assert.equal(jetpack.exists(path.join(dir, 'src', 'index.js')), 'file', 'the authored Cloud Functions entry is seeded');
          assert.equal(jetpack.exists(path.join(dir, 'firestore.rules')), 'file', "the brand's rules SOURCE half is seeded");
          assert.equal(jetpack.exists(path.join(dir, 'database.rules.json')), 'file', 'the emulator dies ENOENT without it');
          assert.equal(jetpack.exists(path.join(dir, 'config', 'omega.json5')), 'file', 'a standalone target carries the full config template');

          const manifest = JSON.parse(jetpack.read(path.join(dir, 'package.json')));
          assert.equal(typeof manifest.engines.node, 'string', 'engines.node is stamped from the framework pin');

          assert.equal(first.written.length > 0, true, 'the first run reports what it wrote');
          assert.equal(first.lines.length > 0, true, 'the first run says so');
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'a-second-run-is-a-silent-no-op',
      auth: 'none',

      async run({ assert }) {
        const dir = seedTarget();

        try {
          run(dir);
          const before = jetpack.inspectTree(dir, { checksum: 'sha1' });

          const second = run(dir);
          const after = jetpack.inspectTree(dir, { checksum: 'sha1' });

          assert.deepEqual(second.written, [], 'nothing is written twice');
          assert.deepEqual(second.merged, [], 'a byte-identical default is not a merge');
          assert.deepEqual(second.changed, [], 'nothing is migrated twice');
          assert.deepEqual(second.lines, [], 'idempotent means quiet');
          assert.equal(after.checksum, before.checksum, 'the tree is byte-identical after a second run');
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'consumer-authored-files-are-never-clobbered',
      auth: 'none',

      async run({ assert }) {
        const dir = seedTarget();

        try {
          jetpack.write(path.join(dir, 'src', 'index.js'), '// mine\n');
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', engines: { node: '20' } }, null, 2));

          run(dir);

          assert.equal(jetpack.read(path.join(dir, 'src', 'index.js')), '// mine\n', 'an authored entry survives');
          assert.equal(JSON.parse(jetpack.read(path.join(dir, 'package.json'))).engines.node, '20', 'an authored engines.node survives');
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'staging-runs-it-first-so-every-verb-does',
      auth: 'none',

      async run({ assert }) {
        // ensureStaged() is the one call every runtime surface makes before it
        // touches dist/ — emulator, serve, test, build, deploy. Reading it here
        // proves the wiring without booting a verb.
        const source = jetpack.read(path.join(__dirname, '..', '..', 'src', 'cli', 'commands', 'base-command.js'));

        assert.match(source, /ensureTarget\(/, 'ensureStaged() runs the scaffold before it stages');
      },
    },

    {
      name: 'the-frameworks-own-tree-is-not-a-consumer-target',
      auth: 'none',

      async run({ assert }) {
        // Running the framework's own suite from packages/backend puts the
        // framework at the cwd. Scaffolding there would scatter the consumer
        // defaults through the package. Sibling of the same guard in
        // @omega.js/desktop's ensure-target.
        const dir = seedTarget();

        try {
          const frameworkName = require('../../package.json').name;
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify({ name: frameworkName, version: '0.0.0' }, null, 2));

          const result = run(dir);

          assert.deepEqual(result.written, [], 'nothing is written into the framework tree');
          assert.deepEqual(result.changed, [], 'the manifest is left alone');
          assert.deepEqual(result.lines, [], 'and it says nothing — a normal state, not a broken one');
          assert.equal(jetpack.exists(path.join(dir, 'firebase.json')), false, 'no consumer artifact appears');
        } finally {
          jetpack.remove(dir);
        }
      },
    },
  ],
};
