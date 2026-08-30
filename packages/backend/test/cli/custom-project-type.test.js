/**
 * A backend target in CUSTOM-SERVER mode
 * ([#584](https://github.com/Omega-JS-Stack/omega/issues/584)).
 *
 * `targets.backend.projectType: 'custom'` runs the SAME backend — same routes,
 * same schemas, same auth middleware, same helpers — as an Express app
 * listening on `PORT` for a container host (Render & co) instead of exporting
 * Cloud Functions. What it takes away is the FIREBASE lane: no Functions
 * deploy, no emulator, no emulator test run.
 *
 * What these tests hold it to:
 *   - the project type comes from the brand's omega.json5, not from a flag a
 *     brand has to remember to pass to `Manager.init()`;
 *   - a custom boot loads no `firebase-functions`, and every helper the
 *     framework exposes — the auth middleware included — is there in both modes;
 *   - the Firebase-only verbs REFUSE, loudly and with the lane that replaces
 *     each, instead of running `firebase deploy` against a project that has no
 *     functions in it;
 *   - `omega setup` scaffolds no Firebase-only artifact — no firebase.json, no
 *     rules, no indexes — and drops the checks that maintain them, while an
 *     already-authored one is left alone
 *     ([#614](https://github.com/Omega-JS-Stack/omega/issues/614));
 *   - `omega build` is unchanged: a custom backend stages src/ → dist/ like
 *     any other.
 *
 * Real config files on real temp dirs, the real Manager, the real command
 * classes. The one seam is `powertools.execute` — stubbed to a recorder, so a
 * deploy that DID reach the shell would be visible instead of running.
 *
 * Run: npx omega test backend:cli/custom-project-type
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const powertools = require('node-powertools');
const { requiredEnvKeys } = require('@omega.js/config');

const { resolveProjectType, isCustomProject, FIREBASE_ONLY_VERBS, FIREBASE_ONLY_SCAFFOLD, FIREBASE_ONLY_SETUP_CHECKS } = require('../../src/cli/utils/project-type.js');
const BuildCommand = require('../../src/cli/commands/build.js');
const DeployCommand = require('../../src/cli/commands/deploy.js');
const EmulatorCommand = require('../../src/cli/commands/emulator.js');
const ServeCommand = require('../../src/cli/commands/serve.js');
const { ensureTarget } = require('../../src/cli/utils/ensure-target.js');
const { stageFunctions } = require('../../src/cli/utils/stage-functions.js');
const TestCommand = require('../../src/cli/commands/test.js');
const { getTests } = require('../../src/cli/commands/setup-tests/index.js');

const MANAGER_PATH = require.resolve('../../src/manager/index.js');

/**
 * A backend target on disk: package.json, an authored src/, and a brand
 * config declaring the project type (omitted = the firebase default).
 */
function targetDir({ projectType }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-project-type-')));
  const backend = projectType ? { projectType } : {};

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    targets: { backend },
  }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), '// fixture backend entry\n');

  return dir;
}

/** A `main` shaped like the CLI's, pointed at a fixture target. */
function fakeMain(dir, argv = {}) {
  return {
    firebaseProjectPath: dir,
    argv: { _: [], ...argv },
    options: {},
    testCount: 0,
    testTotal: 0,
  };
}

/**
 * Run a command with console.log/error captured and `powertools.execute`
 * swapped for a recorder — nothing this suite runs may reach a real shell.
 */
async function runCommand(CommandClass, dir, argv) {
  const lines = [];
  const shell = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExecute = powertools.execute;
  const originalExitCode = process.exitCode;

  console.log = (...args) => lines.push(args.map(String).join(' '));
  console.error = (...args) => lines.push(args.map(String).join(' '));
  powertools.execute = async (command) => { shell.push(command); return ''; };

  try {
    await new CommandClass(fakeMain(dir, argv)).execute();
    return { output: lines.join('\n'), shell, exitCode: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    powertools.execute = originalExecute;
    process.exitCode = originalExitCode;
  }
}

/**
 * The SCAFFOLD pass every verb runs (#675): ensureTarget() writes the config
 * artifacts, then the stage builds dist/ — the same pair `ensureStaged()`
 * makes. The CHECKS need a Firebase CLI and a network; which of them a custom
 * target even RUNS is its own case below.
 */
function runSetupScaffold(dir) {
  const lines = [];
  const log = (message) => lines.push(String(message));

  ensureTarget({ projectDir: dir, log });
  stageFunctions({ projectDir: dir, log });

  return { output: lines.join('\n') };
}

/** The target checks a target actually runs, by class name, in order. */
function setupCheckNames(dir) {
  return getTests({ main: { firebaseProjectPath: dir } }).map((test) => test.constructor.name);
}

/**
 * Boot a REAL Manager against a fixture target, with every required env key
 * present so the #581 boot guard passes, and restore the process env after.
 */
function bootManager(dir, options = {}) {
  const saved = {};
  for (const name of requiredEnvKeys('backend')) {
    saved[name] = process.env[name];
    process.env[name] = process.env[name] || 'fixture-value';
  }

  delete require.cache[MANAGER_PATH];
  const FreshManager = require(MANAGER_PATH);

  try {
    return new FreshManager().init(null, { cwd: dir, log: false, ...options });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete require.cache[MANAGER_PATH];
  }
}

// Every helper a consumer's routes reach for through the Manager handle.
const HELPERS = ['RouteContext', 'User', 'Analytics', 'ApiManager', 'Roles', 'Usage', 'Middleware', 'BackendRouter', 'EventMiddleware', 'Settings', 'Metadata', 'Email', 'AI', 'Utilities'];

module.exports = {
  description: "Backend custom-server mode (#584): the config switch, the boot, and the Firebase-only verbs' refusal",
  type: 'group',

  tests: [
    {
      name: 'the project type comes from the brand config, firebase by default',

      run() {
        const custom = targetDir({ projectType: 'custom' });
        const firebase = targetDir({ projectType: 'firebase' });
        const bare = targetDir({});

        try {
          assert.strictEqual(resolveProjectType(custom), 'custom');
          assert.strictEqual(resolveProjectType(firebase), 'firebase');
          assert.strictEqual(resolveProjectType(bare), 'firebase', 'an unset projectType is the Cloud Functions default');
          assert.strictEqual(isCustomProject(custom), true);
          assert.strictEqual(isCustomProject(bare), false);

          // No consumer config at all (the framework booting itself) is not a
          // custom backend — it is no backend target, and firebase is the answer
          // that changes nothing.
          assert.strictEqual(resolveProjectType(os.tmpdir()), 'firebase');
        } finally {
          for (const dir of [custom, firebase, bare]) fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a custom boot loads no firebase-functions, and every helper still answers',

      run() {
        const custom = targetDir({ projectType: 'custom' });
        const firebase = targetDir({});

        try {
          const customManager = bootManager(custom);
          assert.strictEqual(customManager.options.projectType, 'custom', 'the config is the switch — no init flag needed');
          assert.strictEqual(customManager.libraries.functions, null, 'custom mode must not load firebase-functions');

          const firebaseManager = bootManager(firebase);
          assert.strictEqual(firebaseManager.options.projectType, 'firebase');
          assert.ok(firebaseManager.libraries.functions, 'firebase mode still loads firebase-functions');

          // The whole point of the mode: the SAME backend, minus the artifact.
          for (const helper of HELPERS) {
            assert.strictEqual(typeof customManager[helper], 'function', `${helper}() must work in custom mode`);
            assert.strictEqual(typeof firebaseManager[helper], 'function', `${helper}() must work in firebase mode`);
          }
          assert.ok(customManager.config.brand.id, 'the config still resolves in custom mode');
        } finally {
          for (const dir of [custom, firebase]) fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'an explicit init option still wins over the config',

      run() {
        const custom = targetDir({ projectType: 'custom' });

        try {
          const manager = bootManager(custom, { projectType: 'firebase' });
          assert.strictEqual(manager.options.projectType, 'firebase', 'an explicit option is the caller saying so');
          assert.ok(manager.libraries.functions);
        } finally {
          fs.rmSync(custom, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'omega deploy refuses in custom mode — nothing is staged, nothing reaches firebase',

      async run() {
        const dir = targetDir({ projectType: 'custom' });

        try {
          const run = await runCommand(DeployCommand, dir);

          assert.deepStrictEqual(run.shell, [], 'a custom backend must never run `firebase deploy`');
          assert.strictEqual(run.exitCode, 1, 'a refused deploy must fail the process, never read green');
          assert.match(run.output, /custom/, 'the refusal must name the mode');
          assert.match(run.output, /deploy/, 'the refusal must name the lane that replaces it');
          assert.strictEqual(fs.existsSync(path.join(dir, 'dist')), false, 'the refusal comes BEFORE staging');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'every Firebase-only verb refuses in custom mode, each naming its replacement lane',

      async run() {
        const dir = targetDir({ projectType: 'custom' });

        try {
          assert.deepStrictEqual(
            Object.keys(FIREBASE_ONLY_VERBS).sort(),
            ['deploy', 'emulator', 'serve', 'test'],
            'the refused verbs live in ONE table',
          );

          for (const [CommandClass, verb] of [[EmulatorCommand, 'emulator'], [ServeCommand, 'serve'], [TestCommand, 'test']]) {
            const run = await runCommand(CommandClass, dir);

            assert.deepStrictEqual(run.shell, [], `omega ${verb} must not reach the shell in custom mode`);
            assert.strictEqual(run.exitCode, 1, `omega ${verb} must fail the process in custom mode`);
            assert.match(run.output, /custom/, `omega ${verb} must name the mode`);
            assert.ok(run.output.includes(FIREBASE_ONLY_VERBS[verb]), `omega ${verb} must print its own replacement lane: ${run.output}`);
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'the verbs scaffold no Firebase-only file on a custom backend',

      async run() {
        const dir = targetDir({ projectType: 'custom' });

        try {
          const run = runSetupScaffold(dir);

          for (const file of FIREBASE_ONLY_SCAFFOLD) {
            assert.strictEqual(fs.existsSync(path.join(dir, file)), false, `a custom backend has no Firebase lane — the scaffold must not write ${file}: ${run.output}`);
          }
          assert.strictEqual(fs.existsSync(path.join(dir, 'dist', 'firestore.rules')), false, 'and no compiled rules artifact either — nothing deploys it');

          // What custom mode does NOT take away: the project id, the authored
          // entry, and the staged output every backend builds.
          assert.strictEqual(fs.existsSync(path.join(dir, '.firebaserc')), true, 'the project id is still the backend\'s — the admin SDK reads it in both modes');
          assert.strictEqual(fs.existsSync(path.join(dir, 'src', 'index.js')), true);
          assert.strictEqual(fs.existsSync(path.join(dir, 'dist', 'index.js')), true);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a firebase-mode backend scaffolds every one of them, exactly as before',

      async run() {
        const dir = targetDir({});

        try {
          const run = runSetupScaffold(dir);

          for (const file of FIREBASE_ONLY_SCAFFOLD) {
            assert.strictEqual(fs.existsSync(path.join(dir, file)), true, `the default mode is unchanged — ${file} must still be scaffolded: ${run.output}`);
          }
          assert.strictEqual(fs.existsSync(path.join(dir, 'dist', 'firestore.rules')), true, 'the stage still compiles the artifact firebase.json points at');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'the scaffold never rewrites what a custom project authored itself',

      async run() {
        const dir = targetDir({ projectType: 'custom' });
        const authored = { functions: { source: 'functions' }, hosting: { public: 'public' } };
        const authoredRules = "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /mine/{id} { allow read: if true; }\n  }\n}\n";

        try {
          // This brand runs custom mode AND keeps a firebase.json of its own
          // (it deploys rules by hand, say). Skipping is not deleting — and not
          // migrating it under the brand either.
          fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify(authored));
          fs.writeFileSync(path.join(dir, 'firestore.rules'), authoredRules);

          runSetupScaffold(dir);

          assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'firebase.json'), 'utf8')), authored, 'an authored firebase.json is left exactly as it was');
          assert.strictEqual(fs.readFileSync(path.join(dir, 'firestore.rules'), 'utf8'), authoredRules);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'the Firebase-only target checks are dropped in custom mode, and only those',

      async run() {
        const custom = targetDir({ projectType: 'custom' });
        const firebase = targetDir({});

        try {
          const full = setupCheckNames(firebase);
          const kept = setupCheckNames(custom);

          assert.strictEqual(
            kept.length,
            full.length - FIREBASE_ONLY_SETUP_CHECKS.length,
            'every Firebase-only check, and no other, comes off the list',
          );
          assert.deepStrictEqual(kept, full.filter((name) => kept.includes(name)), 'the surviving checks keep their order');

          // The two that matter most: one hard-FAILS a custom target ("this is
          // not a firebase project"), the other writes the emulator config.
          assert.strictEqual(kept.includes('IsFirebaseProjectTest'), false, 'a custom backend is not a broken Firebase project');
          assert.strictEqual(kept.includes('EmulatorConfigTest'), false, 'there is no emulator to configure');

          // Everything else is identical in both modes — that is the mode.
          for (const check of ['OmegaConfigTest', 'GitignoreTest', 'ServiceAccountTest', 'ProjectDirectoriesTest']) {
            assert.strictEqual(kept.includes(check), true, `${check} is not a Firebase-lane check`);
          }
        } finally {
          for (const dir of [custom, firebase]) fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'omega build is unchanged — a custom backend stages src/ into dist/',

      async run() {
        const dir = targetDir({ projectType: 'custom' });

        try {
          const run = await runCommand(BuildCommand, dir);

          assert.strictEqual(fs.existsSync(path.join(dir, 'dist', 'index.js')), true, `the authored src/ should be staged: ${run.output}`);
          assert.strictEqual(fs.existsSync(path.join(dir, 'dist', 'package.json')), true, 'the staged manifest is the build output the manager checks for');
          assert.notStrictEqual(run.exitCode, 1, 'build is not a Firebase-only verb');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
};
