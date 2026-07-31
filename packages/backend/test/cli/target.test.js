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
const { resolveTarget } = require('../../src/cli/utils/target.js');

const FIREBASE_INIT_PATH = require.resolve('../../src/cli/commands/firebase-init.js');
const FIRESTORE_PATH = require.resolve('../../src/cli/commands/firestore.js');
const AUTH_PATH = require.resolve('../../src/cli/commands/auth.js');

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
  const originalLog = console.log;
  const admin = recordingAdmin();
  const asked = [];
  const printed = [];

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

  console.log = (...line) => printed.push(line.map(String).join(' '));

  try {
    const main = {
      firebaseProjectPath: __dirname,
      argv: { _: args, ...argv },
      options: {},
    };

    await new Command(main).execute();
  } finally {
    console.log = originalLog;
    delete require.cache[commandPath];
    if (originalInit) {
      require.cache[FIREBASE_INIT_PATH] = originalInit;
    } else {
      delete require.cache[FIREBASE_INIT_PATH];
    }
  }

  return { emulator: asked[0]?.emulator, output: printed.join('\n'), writes: admin.writes };
}

module.exports = {
  description: 'CLI target selection — emulator by default, live only with --production',
  type: 'group',

  tests: [
    {
      name: 'every-subcommand-defaults-to-the-emulator',
      async run({ assert }) {
        assert.equal(resolveTarget({}).emulator, true, 'no flags should default to the emulator');
        assert.equal(resolveTarget({}).label, 'emulator', 'no flags should be labelled emulator');
      },
    },

    {
      name: 'production-flag-is-the-only-way-to-the-live-stack',
      async run({ assert }) {
        assert.equal(resolveTarget({ production: true }).emulator, false, '--production should hit live');
        assert.equal(resolveTarget({ production: true }).label, 'production', '--production should be labelled production');
      },
    },

    {
      name: 'emulator-flag-names-the-default-and-consults-nothing',
      async run({ assert }) {
        assert.equal(resolveTarget({ emulator: true }).emulator, true, '--emulator lands where the default already goes');
        assert.equal(resolveTarget({ emulator: true, production: true }).emulator, false, '--production wins; --emulator is not consulted');
      },
    },

    {
      name: 'firestore-set-asks-for-the-emulator-with-no-flag',
      async run({ assert }) {
        const run = await runSubcommand(FIRESTORE_PATH, ['firestore:set', 'users/_test-target', '{"a":1}'], {});

        assert.equal(run.emulator, true, 'firestore:set should have initialized against the emulator');
        assert.equal(run.writes.length, 1, 'The document should have been written');
        assert.equal(run.output.includes('emulator'), true, `The output should name the stack it hit: ${run.output}`);
      },
    },

    {
      name: 'firestore-set-with-production-asks-for-the-live-stack',
      async run({ assert }) {
        const run = await runSubcommand(FIRESTORE_PATH, ['firestore:set', 'users/_test-target', '{"a":1}'], { production: true });

        assert.equal(run.emulator, false, 'firestore:set --production should have initialized against live');
        assert.equal(run.output.includes('production'), true, `The output should name the stack it hit: ${run.output}`);
      },
    },

    {
      name: 'auth-set-claims-asks-for-the-emulator-with-no-flag',
      async run({ assert }) {
        const run = await runSubcommand(AUTH_PATH, ['auth:set-claims', '_test-uid', '{"admin":true}'], {});

        assert.equal(run.emulator, true, 'auth:set-claims should have initialized against the emulator');
        assert.equal(run.writes.length, 1, 'The claims should have been set');
        assert.equal(run.output.includes('emulator'), true, `The output should name the stack it hit: ${run.output}`);
      },
    },

    {
      name: 'auth-set-claims-with-production-asks-for-the-live-stack',
      async run({ assert }) {
        const run = await runSubcommand(AUTH_PATH, ['auth:set-claims', '_test-uid', '{"admin":true}'], { production: true });

        assert.equal(run.emulator, false, 'auth:set-claims --production should have initialized against live');
        assert.equal(run.output.includes('production'), true, `The output should name the stack it hit: ${run.output}`);
      },
    },

    {
      name: 'a-read-subcommand-follows-the-same-emulator-default',
      async run({ assert }) {
        const run = await runSubcommand(AUTH_PATH, ['auth:get', '_test-uid'], {});

        assert.equal(run.emulator, true, 'auth:get should default to the emulator like everything else');
      },
    },

    {
      name: 'a-read-subcommand-reaches-live-with-production',
      async run({ assert }) {
        const run = await runSubcommand(AUTH_PATH, ['auth:get', '_test-uid'], { production: true });

        assert.equal(run.emulator, false, 'auth:get --production should hit live');
      },
    },
  ],
};
