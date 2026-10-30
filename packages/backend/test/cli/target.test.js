/**
 * Test: which stack a backend CLI subcommand talks to
 * ([#51](https://github.com/Omega-JS-Stack/omega/issues/51)).
 *
 * Ruling (uniformity amendment, Ian 2026-07-30): EVERY backend CLI subcommand
 * targets the EMULATOR by default — reads and writes alike, one rule for the
 * whole surface; `--production` is the only opt-in to touch live. A habitual
 * `--emulator` names the default and consults nothing.
 *
 * Two layers: the resolver itself (pure), then the two command classes actually
 * asking it — `initFirebase` is swapped for a recorder there because the real one
 * would reach for a service account and a live project.
 *
 * Run: npx omega test backend:cli/target
 */
const { resolveTarget } = require('../../dist/cli/utils/target.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { captureOutput } = require('../helpers/_capture-output.js');

const FIREBASE_INIT_PATH = require.resolve('../../dist/cli/commands/firebase-init.js');
const FIRESTORE_PATH = require.resolve('../../dist/cli/commands/firestore.js');
const AUTH_PATH = require.resolve('../../dist/cli/commands/auth.js');

// A firebase-admin stand-in: the writes the subcommands make, recorded.
function recordingAdmin() {
  const writes = [];

  return {
    writes,
    firestore: () => ({
      doc: (docPath) => ({
        set: async (data, options) => writes.push({ op: 'set', docPath, data, options }),
        delete: async () => writes.push({ op: 'delete', docPath }),
      }),
    }),
    auth: () => ({
      getUser: async (uid) => ({ uid, email: null, toJSON: () => ({ uid }) }),
      getUserByEmail: async (email) => ({ uid: 'uid-for-email', email, toJSON: () => ({ email }) }),
      setCustomUserClaims: async (uid, claims) => writes.push({ op: 'set-claims', uid, claims }),
      deleteUser: async (uid) => writes.push({ op: 'delete-user', uid }),
    }),
  };
}

// Run a CLI subcommand with the Firebase door swapped for a recorder, capturing
// both the target it asked for and everything it printed.
async function runSubcommand(commandPath, args, argv) {
  const originalInit = require.cache[FIREBASE_INIT_PATH];
  const admin = recordingAdmin();
  const asked = [];

  require.cache[FIREBASE_INIT_PATH] = {
    id: FIREBASE_INIT_PATH,
    filename: FIREBASE_INIT_PATH,
    loaded: true,
    exports: {
      initFirebase: (options) => {
        asked.push(options);
        return { admin, projectId: options.emulator ? 'demo-fixture' : 'live-fixture' };
      },
      resolveProjectId: () => 'demo-fixture',
    },
  };

  // Drop the command module so it re-requires the stubbed door.
  delete require.cache[commandPath];
  const Command = require(commandPath);

  try {
    const main = {
      firebaseProjectPath: __dirname,
      argv: { _: args, ...argv },
      options: {},
    };

    const { stdout } = await captureOutput(() => new Command(main).execute());

    return { emulator: asked[0]?.emulator, output: stdout, writes: admin.writes };
  } finally {
    delete require.cache[commandPath];
    if (originalInit) {
      require.cache[FIREBASE_INIT_PATH] = originalInit;
    } else {
      delete require.cache[FIREBASE_INIT_PATH];
    }
  }
}

module.exports = defineCases({
  description: 'CLI target selection — emulator by default, live only with --production',
  type: 'group',

  tests: [
    {
      name: 'every-subcommand-defaults-to-the-emulator',
      async run({ expect }) {
        expect(resolveTarget({}).emulator, 'no flags should default to the emulator').toBe(true);
        expect(resolveTarget({}).label, 'no flags should be labelled emulator').toBe('emulator');
      },
    },

    {
      name: 'production-flag-is-the-only-way-to-the-live-stack',
      async run({ expect }) {
        expect(resolveTarget({ production: true }).emulator, '--production should hit live').toBe(false);
        expect(resolveTarget({ production: true }).label, '--production should be labelled production').toBe('production');
      },
    },

    {
      name: 'emulator-flag-names-the-default-and-consults-nothing',
      async run({ expect }) {
        expect(resolveTarget({ emulator: true }).emulator, '--emulator lands where the default already goes').toBe(true);
        expect(resolveTarget({ emulator: true, production: true }).emulator, '--production wins; --emulator is not consulted').toBe(false);
      },
    },

    {
      name: 'firestore-set-asks-for-the-emulator-with-no-flag',
      async run({ expect }) {
        const run = await runSubcommand(FIRESTORE_PATH, ['firestore:set', 'users/_test-target', '{"a":1}'], {});

        expect(run.emulator, 'firestore:set should have initialized against the emulator').toBe(true);
        expect(run.writes.length, 'The document should have been written').toBe(1);
        expect(run.output.includes('emulator'), `The output should name the stack it hit: ${run.output}`).toBe(true);
      },
    },

    {
      name: 'firestore-set-with-production-asks-for-the-live-stack',
      async run({ expect }) {
        const run = await runSubcommand(FIRESTORE_PATH, ['firestore:set', 'users/_test-target', '{"a":1}'], { production: true });

        expect(run.emulator, 'firestore:set --production should have initialized against live').toBe(false);
        expect(run.output.includes('production'), `The output should name the stack it hit: ${run.output}`).toBe(true);
      },
    },

    {
      name: 'auth-set-claims-asks-for-the-emulator-with-no-flag',
      async run({ expect }) {
        const run = await runSubcommand(AUTH_PATH, ['auth:set-claims', '_test-uid', '{"admin":true}'], {});

        expect(run.emulator, 'auth:set-claims should have initialized against the emulator').toBe(true);
        expect(run.writes.length, 'The claims should have been set').toBe(1);
        expect(run.output.includes('emulator'), `The output should name the stack it hit: ${run.output}`).toBe(true);
      },
    },

    {
      name: 'auth-set-claims-with-production-asks-for-the-live-stack',
      async run({ expect }) {
        const run = await runSubcommand(AUTH_PATH, ['auth:set-claims', '_test-uid', '{"admin":true}'], { production: true });

        expect(run.emulator, 'auth:set-claims --production should have initialized against live').toBe(false);
        expect(run.output.includes('production'), `The output should name the stack it hit: ${run.output}`).toBe(true);
      },
    },

    {
      name: 'a-read-subcommand-follows-the-same-emulator-default',
      async run({ expect }) {
        const run = await runSubcommand(AUTH_PATH, ['auth:get', '_test-uid'], {});

        expect(run.emulator, 'auth:get should default to the emulator like everything else').toBe(true);
      },
    },

    {
      name: 'a-read-subcommand-reaches-live-with-production',
      async run({ expect }) {
        const run = await runSubcommand(AUTH_PATH, ['auth:get', '_test-uid'], { production: true });

        expect(run.emulator, 'auth:get --production should hit live').toBe(false);
      },
    },
  ],
});
