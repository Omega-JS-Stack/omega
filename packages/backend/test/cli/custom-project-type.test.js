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
 *     brand has to remember to pass to `omega.initialize()`;
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
 * Real config files on real temp dirs, the real omega, the real command
 * classes. The one seam is `powertools.execute` — stubbed to a recorder, so a
 * deploy that DID reach the shell would be visible instead of running.
 *
 * Run: npx omega test backend:cli/custom-project-type
 */
const expect = require('../../dist/vendor/devkit/test/expect.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const powertools = require('node-powertools');
const { baseMissingKeys } = require('../../dist/vendor/config/index.js');

const { resolveProjectType, isCustomProject, FIREBASE_ONLY_VERBS, FIREBASE_ONLY_SCAFFOLD, FIREBASE_ONLY_SETUP_CHECKS } = require('../../dist/cli/utils/project-type.js');
const frameworkPackage = require('../../package.json');
const BuildCommand = require('../../dist/cli/commands/build.js');
const DeployCommand = require('../../dist/cli/commands/deploy.js');
const DevCommand = require('../../dist/cli/commands/dev.js');
const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const ServeCommand = require('../../dist/cli/commands/serve.js');
const { ensureTargetOffline } = require('../helpers/_ensure-target-offline.js');
const { stageFunctions } = require('../../dist/cli/utils/stage-functions.js');
const TestCommand = require('../../dist/cli/commands/test.js');
const { getTests } = require('../../dist/cli/commands/setup-tests/index.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const OMEGA_PATH = require.resolve('../../dist/omega/index.js');
const Context = require('../../dist/omega/context.js');

/**
 * A backend target on disk: package.json, an authored src/, and a brand
 * config declaring the project type (omitted = the firebase default).
 */
function targetDir({ projectType }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-project-type-')));
  const backend = projectType ? { type: 'backend', projectType } : { type: 'backend' };

  // The peers declared, so the verb's alignment step installs nothing here
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0', dependencies: frameworkPackage.peerDependencies }));
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
async function runSetupScaffold(dir) {
  const lines = [];
  const log = (message) => lines.push(String(message));

  await ensureTargetOffline({ projectDir: dir, log });
  stageFunctions({ projectDir: dir, log });

  return { output: lines.join('\n') };
}

/** The target checks a target actually runs, by class name, in order. */
function setupCheckNames(dir) {
  return getTests({ main: { firebaseProjectPath: dir } }).map((test) => test.constructor.name);
}

/**
 * Boot a REAL Omega instance against a fixture target, with every required env key
 * present so the #581 boot guard passes, and restore the process env after. The
 * boot is the test-runner boot (`runnerHost: true`); an option passed in still wins.
 */
function bootOmega(dir, options = {}) {
  const saved = {};
  for (const { key: name } of baseMissingKeys({}, { target: 'backend', verb: 'start' })) {
    saved[name] = process.env[name];
    process.env[name] = process.env[name] || 'fixture-value';
  }

  delete require.cache[OMEGA_PATH];
  const { Omega } = require(OMEGA_PATH);

  try {
    return new Omega().initialize({ cwd: dir, runnerHost: true, ...options });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete require.cache[OMEGA_PATH];
  }
}

// The process services a consumer's routes reach for on the instance, and the
// request services every Context carries.
const PROCESS_SERVICES = ['utilities', 'email', 'ai'];
const REQUEST_SERVICES = ['user', 'usage', 'analytics', 'email', 'ai'];

module.exports = defineCases({
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
          expect(resolveProjectType(custom)).toBe('custom');
          expect(resolveProjectType(firebase)).toBe('firebase');
          expect(resolveProjectType(bare), 'an unset projectType is the Cloud Functions default').toBe('firebase');
          expect(isCustomProject(custom)).toBe(true);
          expect(isCustomProject(bare)).toBe(false);

          // No consumer config at all (the framework booting itself) is not a
          // custom backend — it is no backend target, and firebase is the answer
          // that changes nothing.
          expect(resolveProjectType(os.tmpdir())).toBe('firebase');
        } finally {
          for (const dir of [custom, firebase, bare]) fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a custom boot loads no firebase-functions, and every service still answers',

      run() {
        const custom = targetDir({ projectType: 'custom' });
        const firebase = targetDir({});

        try {
          const customOmega = bootOmega(custom);
          expect(customOmega.options.projectType, 'the config is the switch — no init flag needed').toBe('custom');
          expect(customOmega.firebase.functions, 'custom mode must not load firebase-functions').toBe(null);

          const firebaseOmega = bootOmega(firebase);
          expect(firebaseOmega.options.projectType).toBe('firebase');
          expect(firebaseOmega.firebase.functions, 'firebase mode still loads firebase-functions').toBeTruthy();

          // The whole point of the mode: the SAME backend, minus the artifact.
          for (const [mode, instance] of [['custom', customOmega], ['firebase', firebaseOmega]]) {
            for (const service of PROCESS_SERVICES) {
              expect(typeof instance[service], `omega.${service} must work in ${mode} mode`).toBe('object');
            }
            expect(typeof instance.storage, `omega.storage() must work in ${mode} mode`).toBe('function');

            const ctx = new Context(instance);
            for (const service of REQUEST_SERVICES) {
              expect(typeof ctx[service], `ctx.${service} must work in ${mode} mode`).toBe('object');
            }
          }
          expect(customOmega.config.brand.id, 'the config still resolves in custom mode').toBeTruthy();
        } finally {
          for (const dir of [custom, firebase]) fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'an explicit initialize option still wins over the config',

      run() {
        const custom = targetDir({ projectType: 'custom' });

        try {
          const instance = bootOmega(custom, { projectType: 'firebase' });
          expect(instance.options.projectType, 'an explicit option is the caller saying so').toBe('firebase');
          expect(instance.firebase.functions).toBeTruthy();
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

          expect(run.shell, 'a custom backend must never run `firebase deploy`').toEqual([]);
          expect(run.exitCode, 'a refused deploy must fail the process, never read green').toBe(1);
          expect(run.output, 'the refusal must name the mode').toMatch(/custom/);
          expect(run.output, 'the refusal must name the lane that replaces it').toMatch(/deploy/);
          expect(fs.existsSync(path.join(dir, 'dist')), 'the refusal comes BEFORE staging').toBe(false);
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
          expect(Object.keys(FIREBASE_ONLY_VERBS).sort(), 'the refused verbs live in ONE table').toEqual(['deploy', 'dev', 'emulator', 'serve']);

          for (const [CommandClass, verb] of [[DevCommand, 'dev'], [EmulatorCommand, 'emulator'], [ServeCommand, 'serve']]) {
            const run = await runCommand(CommandClass, dir);

            expect(run.shell, `omega ${verb} must not reach the shell in custom mode`).toEqual([]);
            expect(run.exitCode, `omega ${verb} must fail the process in custom mode`).toBe(1);
            expect(run.output, `omega ${verb} must name the mode`).toMatch(/custom/);
            expect(run.output.includes(FIREBASE_ONLY_VERBS[verb]), `omega ${verb} must print its own replacement lane: ${run.output}`).toBeTruthy();
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'omega test runs the discovered suites with no boot',

      async run() {
        // No emulator, no hosting health check, no seeded accounts: the runner
        // goes straight to the project's suites, which pass or fail on their own
        const { stageProject, runRunnerChild } = require('./_runner-child.js');
        const dir = stageProject({
          'unit/trivial.test.js': "module.exports = { type: 'group', tests: [{ name: 'trivial-case', run({ expect }) { expect(1).toBe(1); } }] };\n",
        });

        try {
          const run = runRunnerChild(dir);

          expect(run.status, run.output).toBe(0);
          expect(run.output, 'the discovered suite ran and passed').toMatch(/✓ trivial-case/);
          expect(run.output, 'no hosting health check').not.toMatch(/Checking server health/);
          expect(run.output, 'no account setup').not.toMatch(/rules testing context/);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a project _init.js setup runs once, before the first case, with the runner context',

      async run() {
        // The setup writes a marker; the case copies what it found to seen.json,
        // so the marker's presence is read at case time, not after the run.
        // Both stay inside the staged project's own test/ folder.
        const { stageProject, runRunnerChild } = require('./_runner-child.js');
        const dir = stageProject({
          '_init.js': [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            'module.exports = ({ projectRoot, config }) => ({',
            '  accounts: [],',
            '  setup(ctx) {',
            "    const file = path.join(__dirname, 'init-marker.json');",
            "    const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { count: 0 };",
            '    fs.writeFileSync(file, JSON.stringify({ keys: Object.keys(ctx).sort(), count: prior.count + 1 }));',
            '  },',
            '});',
            '',
          ].join('\n'),
          'unit/order.test.js': [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "const testDir = path.join(__dirname, '..');",
            "module.exports = { type: 'group', tests: [{ name: 'reads-the-marker', run() {",
            "  const file = path.join(testDir, 'init-marker.json');",
            "  const seen = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;",
            "  fs.writeFileSync(path.join(testDir, 'seen.json'), JSON.stringify(seen));",
            '} }] };',
            '',
          ].join('\n'),
        });

        try {
          const run = runRunnerChild(dir);
          expect(run.status, run.output).toBe(0);

          const seen = JSON.parse(fs.readFileSync(path.join(dir, 'test', 'seen.json'), 'utf8'));
          expect(seen, 'the marker exists when the first case runs').not.toBe(null);
          expect(seen.keys, 'the setup ctx is the runner context').toEqual(['accounts', 'admin', 'config', 'ctx', 'omega', 'projectRoot']);
          expect(seen.count, 'setup ran once before the case').toBe(1);
          expect(JSON.parse(fs.readFileSync(path.join(dir, 'test', 'init-marker.json'), 'utf8')).count, 'and once in the whole run').toBe(1);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a project _init.js that throws on load fails the run naming it, and no case runs',

      async run() {
        const { stageProject, runRunnerChild } = require('./_runner-child.js');
        const dir = stageProject({
          '_init.js': "throw new Error('broken init');\n",
          'unit/never.test.js': [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "module.exports = { type: 'group', tests: [{ name: 'never-runs', run() {",
            "  fs.writeFileSync(path.join(__dirname, 'ran.json'), 'true');",
            '} }] };',
            '',
          ].join('\n'),
        });

        try {
          const run = runRunnerChild(dir);
          expect(run.status, run.output).toBe(1);
          expect(run.output, 'the failure names the broken file').toMatch(/_init\.js/);
          expect(fs.existsSync(path.join(dir, 'test', 'unit', 'ran.json')), 'no case runs after a broken init').toBe(false);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a case that ends the process before the report fails the run',

      async run() {
        const { stageProject, runRunnerChild } = require('./_runner-child.js');
        const dir = stageProject({
          'unit/exits.test.js': "module.exports = { type: 'group', tests: [{ name: 'exits-early', run() { process.exit(0); } }] };\n",
        });

        try {
          const run = runRunnerChild(dir);
          expect(run.status, run.output).not.toBe(0);
          expect(run.stderr, 'stderr names the early end').toMatch(/The test run ended before its report was written/);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'the brand-owned scripts are exactly the ones running a refused verb',

      async run() {
        // The list the manager walk and this framework's own scaffold
        // both read. It is DERIVED knowledge: a script key is the brand's in
        // custom mode precisely because the verb it runs refuses, so it must
        // never drift from the verb table beside it.
        const { CUSTOM_OWNED_SCRIPTS: projectScriptsCustomOwned, verbOfCommand: verbOf } = require('../../dist/cli/utils/project-type.js');
        const projectScripts = require('../../dist/vendor/devkit/verb-scripts.js').projectScripts(frameworkPackage);
        expect(frameworkPackage.projectScriptsCustomOwned, 'derived from FIREBASE_ONLY_VERBS, never hand-kept').toBe(undefined);
        expect([...projectScriptsCustomOwned].sort()).toEqual(['deploy', 'start']);

        for (const key of projectScriptsCustomOwned) {
          expect(projectScripts[key], `projectScriptsCustomOwned names ${key}, which the target scripts must carry`).toBeTruthy();
          expect(FIREBASE_ONLY_VERBS[verbOf(projectScripts[key])], `\`${key}\` is only the brand's because \`omega ${verbOf(projectScripts[key])}\` refuses in custom mode`).toBeTruthy();
        }

        for (const [key, command] of Object.entries(projectScripts)) {
          if (projectScriptsCustomOwned.includes(key)) continue;
          expect(FIREBASE_ONLY_VERBS[verbOf(command)], `\`${key}\` runs a verb this mode refuses — it belongs in projectScriptsCustomOwned`).toBe(undefined);
        }
      },
    },

    {
      name: 'the verbs scaffold no Firebase-only file on a custom backend',

      async run() {
        const dir = targetDir({ projectType: 'custom' });

        try {
          const run = await runSetupScaffold(dir);

          for (const file of FIREBASE_ONLY_SCAFFOLD) {
            expect(fs.existsSync(path.join(dir, file)), `a custom backend has no Firebase lane — the scaffold must not write ${file}: ${run.output}`).toBe(false);
          }
          expect(fs.existsSync(path.join(dir, 'dist', 'firestore.rules')), 'and no compiled rules artifact either — nothing deploys it').toBe(false);

          // What custom mode does NOT take away: the project id, the authored
          // entry, and the staged output every backend builds.
          expect(fs.existsSync(path.join(dir, '.firebaserc')), 'the project id is still the backend\'s — the admin SDK reads it in both modes').toBe(true);
          expect(fs.existsSync(path.join(dir, 'src', 'index.js'))).toBe(true);
          expect(fs.existsSync(path.join(dir, 'dist', 'index.js'))).toBe(true);
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
          const run = await runSetupScaffold(dir);

          for (const file of FIREBASE_ONLY_SCAFFOLD) {
            expect(fs.existsSync(path.join(dir, file)), `the default mode is unchanged — ${file} must still be scaffolded: ${run.output}`).toBe(true);
          }
          expect(fs.existsSync(path.join(dir, 'dist', 'firestore.rules')), 'the stage still compiles the artifact firebase.json points at').toBe(true);
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

          await runSetupScaffold(dir);

          expect(JSON.parse(fs.readFileSync(path.join(dir, 'firebase.json'), 'utf8')), 'an authored firebase.json is left exactly as it was').toEqual(authored);
          expect(fs.readFileSync(path.join(dir, 'firestore.rules'), 'utf8')).toBe(authoredRules);
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

          expect(kept.length, 'every Firebase-only check, and no other, comes off the list').toBe(full.length - FIREBASE_ONLY_SETUP_CHECKS.length);
          expect(kept, 'the surviving checks keep their order').toEqual(full.filter((name) => kept.includes(name)));

          // The two that matter most: one hard-FAILS a custom target ("this is
          // not a firebase project"), the other writes the emulator config.
          expect(kept.includes('IsFirebaseProjectTest'), 'a custom backend is not a broken Firebase project').toBe(false);
          expect(kept.includes('EmulatorConfigTest'), 'there is no emulator to configure').toBe(false);

          // Everything else is identical in both modes — that is the mode.
          for (const check of ['OmegaConfigTest', 'GitignoreTest', 'ServiceAccountTest', 'ProjectDirectoriesTest']) {
            expect(kept.includes(check), `${check} is not a Firebase-lane check`).toBe(true);
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

          expect(fs.existsSync(path.join(dir, 'dist', 'index.js')), `the authored src/ should be staged: ${run.output}`).toBe(true);
          expect(fs.existsSync(path.join(dir, 'dist', 'package.json')), 'the staged manifest is the build output the manager checks for').toBe(true);
          expect(run.exitCode, 'build is not a Firebase-only verb').not.toBe(1);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
});
