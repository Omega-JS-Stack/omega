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

const { ensureTarget } = require('../../dist/cli/utils/ensure-target.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/** A virgin backend target: a manifest and nothing else. */
function seedTarget() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ensure-target-')));
  jetpack.write(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }, null, 2));
  return dir;
}

/** The framework's own script declarations — the SSOT both writers read. */
const frameworkPackage = require('../../package.json');
const PROJECT_SCRIPTS = frameworkPackage.projectScripts;
const CUSTOM_OWNED = frameworkPackage.projectScriptsCustomOwned || [];

/** The target manifest, parsed. */
function manifestOf(dir) {
  return JSON.parse(jetpack.read(path.join(dir, 'package.json')));
}

/** ensureTarget with its output captured. */
function run(dir) {
  const lines = [];
  const result = ensureTarget({ projectDir: dir, log: (message) => lines.push(message) });
  return { ...result, lines };
}

module.exports = defineCases({
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
      name: 'the-standard-scripts-sync-to-their-defaults-on-every-run',
      auth: 'none',

      async run({ assert }) {
        // ONE overwrite policy with the three sibling frameworks and with the
        // manager walk (#689): a key this framework declares is framework-owned
        // and takes the default on every verb run — a consumer who wants other
        // behavior uses hook points, never an edited standard script.
        const dir = seedTarget();

        try {
          run(dir);

          for (const [key, value] of Object.entries(PROJECT_SCRIPTS)) {
            assert.equal(manifestOf(dir).scripts[key], value, `a fresh target gets the framework default for ${key}`);
          }

          // A hand-edited standard key and a consumer-added one
          const edited = manifestOf(dir);
          edited.scripts.deploy = 'echo mine';
          edited.scripts.render = 'render deploy';
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify(edited, null, 2));

          const healed = run(dir);
          const after = manifestOf(dir);
          assert.equal(after.scripts.deploy, PROJECT_SCRIPTS.deploy, 'an edited standard script is rewritten to the default');
          assert.equal(after.scripts.render, 'render deploy', 'a key the framework never declares is the consumer\'s own');
          assert.equal(healed.changed.length > 0, true, 'and the run reports the sync');
          assert.equal(jetpack.read(path.join(dir, 'package.json')).endsWith('\n'), true, 'the write keeps npm\'s trailing newline, like every sibling writer');

          // Converged: a third run writes nothing
          const before = jetpack.read(path.join(dir, 'package.json'));
          const third = run(dir);
          assert.deepEqual(third.changed, [], 'a converged manifest is not a change');
          assert.equal(jetpack.read(path.join(dir, 'package.json')), before, 'and is byte-identical');
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'the-standard-scripts-spell-the-verb-bare',
      auth: 'none',

      async run({ assert }) {
        // Bare `omega <verb>` inside a package script, web's form and the one
        // the three siblings share (#748): npm already puts node_modules/.bin
        // on the path there, so the `npx` prefix bought nothing. It stays
        // canonical for docs and the terminal, never for a script.
        for (const [key, value] of Object.entries(PROJECT_SCRIPTS)) {
          assert.equal(value.includes('npx omega'), false, `${key} must spell the verb bare`);
        }

        const dir = seedTarget();

        try {
          // A target still carrying the old spelling, plus a consumer key that
          // happens to use npx — only the framework-owned ones are rewritten
          const seeded = manifestOf(dir);
          seeded.scripts = { start: 'npx omega serve', deploy: 'npx omega deploy', lint: 'npx eslint .' };
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify(seeded, null, 2));

          run(dir);
          const healed = manifestOf(dir).scripts;

          assert.equal(healed.start, PROJECT_SCRIPTS.start, 'the old `npx omega serve` heals to the bare verb');
          assert.equal(healed.deploy, PROJECT_SCRIPTS.deploy, 'and so does every other framework-owned key');
          assert.equal(healed.lint, 'npx eslint .', 'a key the framework never declares is the consumer\'s own');

          // Converged: the second pass writes nothing
          const before = jetpack.read(path.join(dir, 'package.json'));
          assert.deepEqual(run(dir).changed, [], 'a healed manifest is not a change');
          assert.equal(jetpack.read(path.join(dir, 'package.json')), before, 'and is byte-identical');
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'a-custom-server-backend-keeps-the-verbs-its-mode-refuses',
      auth: 'none',

      async run({ assert }) {
        // Per KEY, not per target (#689): a custom-server backend (#584) names
        // its own start/deploy because those verbs refuse in that mode — the
        // rest of the standard keys are still this framework's.
        const dir = seedTarget();

        try {
          jetpack.write(path.join(dir, 'config', 'omega.json5'), JSON.stringify({
            brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
            targets: { backend: { projectType: 'custom' } },
          }));
          const seeded = manifestOf(dir);
          seeded.scripts = { start: 'node server.js' };
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify(seeded, null, 2));

          run(dir);
          const scripts = manifestOf(dir).scripts;

          assert.equal(scripts.start, 'node server.js', 'the brand names its own server command');
          for (const key of CUSTOM_OWNED) {
            if (key === 'start') continue;
            assert.equal(scripts[key], undefined, `${key} is the brand's in custom mode — never written, never scaffolded`);
          }
          for (const key of Object.keys(PROJECT_SCRIPTS)) {
            if (CUSTOM_OWNED.includes(key)) continue;
            assert.equal(scripts[key], PROJECT_SCRIPTS[key], `${key} still works in custom mode, so the framework still owns it`);
          }

          // Converged: a second run writes nothing
          const before = jetpack.read(path.join(dir, 'package.json'));
          assert.deepEqual(run(dir).changed, [], 'a converged custom target is not a change');
          assert.equal(jetpack.read(path.join(dir, 'package.json')), before, 'and is byte-identical');
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
        const source = jetpack.read(path.join(__dirname, '..', '..', 'dist', 'cli', 'commands', 'base-command.js'));

        assert.match(source, /ensureTarget\(/, 'ensureStaged() runs the scaffold before it stages');
      },
    },

    {
      name: 'a-workspace-root-is-refused-without-writing-a-file',
      auth: 'none',

      async run({ assert }) {
        // The accident: `omega deploy` at a workspace root scaffolded a whole
        // backend target into it — firebase.json, src/, rules — before failing
        // anyway ([#699](https://github.com/Omega-JS-Stack/omega/issues/699)).
        // Parity with the same case in @omega.js/desktop's suite (#706).
        const dir = seedTarget();

        try {
          const manifestPath = path.join(dir, 'package.json');
          jetpack.write(manifestPath, `${JSON.stringify({ name: 'acme', workspaces: ['targets/*'] }, null, 2)}\n`);
          const before = jetpack.read(manifestPath);

          let refusal = null;
          try {
            run(dir);
          } catch (e) {
            refusal = e;
          }

          assert.ok(refusal, 'a workspace root fails loud, not silently');
          assert.match(refusal.message, /refusing to scaffold into/, 'the refusal says what it refused');
          assert.match(refusal.message, /declares "workspaces"/, 'and why');
          assert.equal(refusal.message.includes(dir), true, 'naming the directory it was aimed at');

          assert.deepEqual(jetpack.list(dir), ['package.json'], 'nothing was scaffolded');
          assert.equal(jetpack.read(manifestPath), before, 'the manifest is byte-identical');
        } finally {
          jetpack.remove(dir);
        }
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
});
