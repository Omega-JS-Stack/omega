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
const BuildCommand = require('../../dist/cli/commands/build.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/** A virgin backend target: a manifest and nothing else. */
function seedTarget() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ensure-target-')));
  jetpack.write(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }, null, 2));
  return dir;
}

/** The scripts both writers derive: the verb table's, the manifest's declarations over them. */
const frameworkPackage = require('../../package.json');
const { verbScripts, projectScripts } = require('../../dist/vendor/devkit/verb-scripts.js');
const { CUSTOM_OWNED_SCRIPTS: CUSTOM_OWNED } = require('../../dist/cli/utils/project-type.js');
const PROJECT_SCRIPTS = projectScripts(frameworkPackage);

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

      async run({ expect }) {
        const dir = seedTarget();

        try {
          const first = run(dir);

          expect(jetpack.exists(path.join(dir, '.firebaserc')), '.firebaserc is derived from the resolved config').toBe('file');
          expect(jetpack.exists(path.join(dir, 'firebase.json')), 'firebase.json is scaffolded from the template').toBe('file');
          expect(jetpack.exists(path.join(dir, 'src', 'index.js')), 'the authored Cloud Functions entry is seeded').toBe('file');
          expect(jetpack.exists(path.join(dir, 'firestore.rules')), "the brand's rules SOURCE half is seeded").toBe('file');
          expect(jetpack.exists(path.join(dir, 'database.rules.json')), 'the emulator dies ENOENT without it').toBe('file');
          expect(jetpack.exists(path.join(dir, 'config', 'omega.json5')), 'a standalone target carries the full config template').toBe('file');

          const manifest = JSON.parse(jetpack.read(path.join(dir, 'package.json')));
          expect(typeof manifest.engines.node, 'engines.node is stamped from the framework pin').toBe('string');

          expect(first.written.length > 0, 'the first run reports what it wrote').toBe(true);
          expect(first.lines.length > 0, 'the first run says so').toBe(true);
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'the-license-is-stated-once-and-never-overwritten',
      auth: 'none',

      async run({ expect }) {
        // #884: UNLICENSED is npm's word for closed-source commercial code, and
        // every framework's ensure-target seeds it the same way, so a target
        // manifest never ships the "no license field" npm warning. A brand that
        // authored its own keeps it: licensing is the brand's call.
        const fresh = seedTarget();
        const authored = seedTarget();

        try {
          run(fresh);
          expect(manifestOf(fresh).license, 'a manifest stating no license gets the default').toBe('UNLICENSED');

          jetpack.write(path.join(authored, 'package.json'), JSON.stringify({ name: 'fixture-backend', license: 'MIT' }, null, 2));
          run(authored);
          expect(manifestOf(authored).license, 'an authored license survives every verb run').toBe('MIT');
        } finally {
          jetpack.remove(fresh);
          jetpack.remove(authored);
        }
      },
    },

    {
      name: 'a-second-run-is-a-silent-no-op',
      auth: 'none',

      async run({ expect }) {
        const dir = seedTarget();

        try {
          run(dir);
          const before = jetpack.inspectTree(dir, { checksum: 'sha1' });

          const second = run(dir);
          const after = jetpack.inspectTree(dir, { checksum: 'sha1' });

          expect(second.written, 'nothing is written twice').toEqual([]);
          expect(second.merged, 'a byte-identical default is not a merge').toEqual([]);
          expect(second.changed, 'nothing is migrated twice').toEqual([]);
          expect(second.lines, 'idempotent means quiet').toEqual([]);
          expect(after.checksum, 'the tree is byte-identical after a second run').toBe(before.checksum);
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'consumer-authored-files-are-never-clobbered',
      auth: 'none',

      async run({ expect }) {
        const dir = seedTarget();

        try {
          jetpack.write(path.join(dir, 'src', 'index.js'), '// mine\n');
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', engines: { node: '20' } }, null, 2));

          run(dir);

          expect(jetpack.read(path.join(dir, 'src', 'index.js')), 'an authored entry survives').toBe('// mine\n');
          expect(JSON.parse(jetpack.read(path.join(dir, 'package.json'))).engines.node, 'an authored engines.node survives').toBe('20');
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'the-standard-scripts-sync-to-their-defaults-on-every-run',
      auth: 'none',

      async run({ expect }) {
        // ONE overwrite policy with the three sibling frameworks and with the
        // manager walk (#689): a key this framework declares is framework-owned
        // and takes the default on every verb run — a consumer who wants other
        // behavior uses hook points, never an edited standard script.
        const dir = seedTarget();

        try {
          run(dir);

          for (const [key, value] of Object.entries(PROJECT_SCRIPTS)) {
            expect(manifestOf(dir).scripts[key], `a fresh target gets the framework default for ${key}`).toBe(value);
          }

          // A hand-edited standard key and a consumer-added one
          const edited = manifestOf(dir);
          edited.scripts.deploy = 'echo mine';
          edited.scripts.render = 'render deploy';
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify(edited, null, 2));

          const healed = run(dir);
          const after = manifestOf(dir);
          expect(after.scripts.deploy, 'an edited standard script is rewritten to the default').toBe(PROJECT_SCRIPTS.deploy);
          expect(after.scripts.render, 'a key the framework never declares is the consumer\'s own').toBe('render deploy');
          expect(healed.changed.length > 0, 'and the run reports the sync').toBe(true);
          expect(jetpack.read(path.join(dir, 'package.json')).endsWith('\n'), 'the write keeps npm\'s trailing newline, like every sibling writer').toBe(true);

          // Converged: a third run writes nothing
          const before = jetpack.read(path.join(dir, 'package.json'));
          const third = run(dir);
          expect(third.changed, 'a converged manifest is not a change').toEqual([]);
          expect(jetpack.read(path.join(dir, 'package.json')), 'and is byte-identical').toBe(before);
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'the-verb-scripts-derive-from-the-verb-table',
      auth: 'none',

      async run({ expect }) {
        const dir = seedTarget();

        try {
          run(dir);
          const scripts = manifestOf(dir).scripts;
          const derived = verbScripts(frameworkPackage.name);

          const declaredScripts = frameworkPackage.projectScripts || {};
          for (const [verb, command] of Object.entries(derived)) {
            const declared = declaredScripts[verb];
            expect(scripts[verb], `${verb} lands as ${declared ? 'its declared command' : 'its bare verb'}`).toBe(declared || command);
          }
          expect(scripts.start, 'the dev row derives npm\'s start, like on every framework').toBe('omega dev');
          expect(scripts.test, 'test is the verb like on every framework').toBe('omega test');
          for (const retired of ['emulator', 'test:static', 'test:emulator']) {
            expect(scripts[retired], `no \`${retired}\` script: dev and test are the entries`).toBe(undefined);
          }

          // No verb script is typed by hand: the manifest declares only what the table cannot derive
          const typed = Object.keys(declaredScripts).filter((key) => key in derived);
          expect(typed).toEqual([]);
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'the-standard-scripts-spell-the-verb-bare',
      auth: 'none',

      async run({ expect }) {
        // Bare `omega <verb>` inside a package script, web's form and the one
        // the three siblings share (#748): npm already puts node_modules/.bin
        // on the path there, so the `npx` prefix bought nothing. It stays
        // canonical for docs and the terminal, never for a script.
        for (const [key, value] of Object.entries(PROJECT_SCRIPTS)) {
          expect(value.includes('npx omega'), `${key} must spell the verb bare`).toBe(false);
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

          expect(healed.start, 'the old `npx omega serve` heals to the bare verb').toBe(PROJECT_SCRIPTS.start);
          expect(healed.deploy, 'and so does every other framework-owned key').toBe(PROJECT_SCRIPTS.deploy);
          expect(healed.lint, 'a key the framework never declares is the consumer\'s own').toBe('npx eslint .');

          // Converged: the second pass writes nothing
          const before = jetpack.read(path.join(dir, 'package.json'));
          expect(run(dir).changed, 'a healed manifest is not a change').toEqual([]);
          expect(jetpack.read(path.join(dir, 'package.json')), 'and is byte-identical').toBe(before);
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'a-custom-server-backend-keeps-the-verbs-its-mode-refuses',
      auth: 'none',

      async run({ expect }) {
        // Per KEY, not per target (#689): a custom-server backend (#584) names
        // its own start/deploy because those verbs refuse in that mode — the
        // rest of the standard keys are still this framework's.
        const dir = seedTarget();

        try {
          jetpack.write(path.join(dir, 'config', 'omega.json5'), JSON.stringify({
            brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
            targets: { backend: { type: 'backend', projectType: 'custom' } },
          }));
          const seeded = manifestOf(dir);
          seeded.scripts = { start: 'node server.js' };
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify(seeded, null, 2));

          run(dir);
          const scripts = manifestOf(dir).scripts;

          expect(scripts.start, 'the brand names its own server command').toBe('node server.js');
          for (const key of CUSTOM_OWNED) {
            if (key === 'start') continue;
            expect(scripts[key], `${key} is the brand's in custom mode — never written, never scaffolded`).toBe(undefined);
          }
          for (const key of Object.keys(PROJECT_SCRIPTS)) {
            if (CUSTOM_OWNED.includes(key)) continue;
            expect(scripts[key], `${key} still works in custom mode, so the framework still owns it`).toBe(PROJECT_SCRIPTS[key]);
          }

          // Converged: a second run writes nothing
          const before = jetpack.read(path.join(dir, 'package.json'));
          expect(run(dir).changed, 'a converged custom target is not a change').toEqual([]);
          expect(jetpack.read(path.join(dir, 'package.json')), 'and is byte-identical').toBe(before);
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'staging-runs-it-first-so-every-verb-does',
      auth: 'none',

      async run({ expect }) {
        // ensureStaged() is the one call every runtime surface makes before it
        // touches dist/ — emulator, serve, test, build, deploy. Reading it here
        // proves the wiring without booting a verb.
        const source = jetpack.read(path.join(__dirname, '..', '..', 'dist', 'cli', 'commands', 'base-command.js'));

        expect(source, 'ensureStaged() runs the scaffold before it stages').toMatch(/ensureTarget\(/);
      },
    },

    {
      name: 'a-verb-prints-the-scaffolds-warnings-and-build-runs-it-first',
      auth: 'none',

      async run({ expect }) {
        // A brand target whose AGENTS.md carries notes is kept with a
        // move-it warning. The verb has to print that warning, not drop it,
        // and a bare `omega build` has to reach the scaffold at all.
        const brand = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ensure-target-brand-')));
        const targetDir = path.join(brand, 'targets', 'backend');

        try {
          jetpack.write(path.join(brand, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
          jetpack.write(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'acme-backend', version: '0.0.0' }, null, 2));
          jetpack.write(path.join(targetDir, 'AGENTS.md'),
            '# ========== Default Values ==========\nframework guidance\n\n# ========== Custom Values ==========\nOur deploy needs the VPN up.\n');

          const command = new BuildCommand({ firebaseProjectPath: targetDir, argv: {}, options: {} });
          const warnings = [];
          command.log = () => {};
          command.logWarning = (message) => warnings.push(message);
          command.runEnsureTarget();

          expect(warnings.some((message) => message.includes('Kept AGENTS.md')), 'the scaffold warning reaches the verb output').toBeTruthy();
          expect(jetpack.read(path.join(targetDir, 'AGENTS.md')), 'the notes stay').toMatch(/VPN/);

          // Build runs the scaffold before it stages: stop it at that seam.
          const order = [];
          command.attachVerbLog = () => {};
          command.runEnsureTarget = () => { order.push('ensureTarget'); throw new Error('stop'); };
          await command.execute().catch((error) => order.push(error.message));
          expect(order, 'build reaches ensureTarget first').toEqual(['ensureTarget', 'stop']);
        } finally {
          jetpack.remove(brand);
        }
      },
    },

    {
      name: 'a-workspace-root-is-refused-without-writing-a-file',
      auth: 'none',

      async run({ expect }) {
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

          expect(refusal, 'a workspace root fails loud, not silently').toBeTruthy();
          expect(refusal.message, 'the refusal says what it refused').toMatch(/refusing to scaffold into/);
          expect(refusal.message, 'and why').toMatch(/declares "workspaces"/);
          expect(refusal.message.includes(dir), 'naming the directory it was aimed at').toBe(true);

          expect(jetpack.list(dir), 'nothing was scaffolded').toEqual(['package.json']);
          expect(jetpack.read(manifestPath), 'the manifest is byte-identical').toBe(before);
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'the-frameworks-own-tree-is-not-a-consumer-target',
      auth: 'none',

      async run({ expect }) {
        // Running the framework's own suite from packages/backend puts the
        // framework at the cwd. Scaffolding there would scatter the consumer
        // defaults through the package. Sibling of the same guard in
        // @omega.js/desktop's ensure-target.
        const dir = seedTarget();

        try {
          const frameworkName = require('../../package.json').name;
          jetpack.write(path.join(dir, 'package.json'), JSON.stringify({ name: frameworkName, version: '0.0.0' }, null, 2));

          const result = run(dir);

          expect(result.written, 'nothing is written into the framework tree').toEqual([]);
          expect(result.changed, 'the manifest is left alone').toEqual([]);
          expect(result.lines, 'and it says nothing — a normal state, not a broken one').toEqual([]);
          expect(jetpack.exists(path.join(dir, 'firebase.json')), 'no consumer artifact appears').toBe(false);
        } finally {
          jetpack.remove(dir);
        }
      },
    },
  ],
});
