/**
 * Test: Realtime Database Security Rules - Sessions
 * The `sessions/$room` tree is where a signed-in app records the devices it is
 * signed in on. Everything a route does there goes through the Admin SDK, which
 * bypasses rules entirely — so `database.rules.json` is the ONLY thing standing
 * between a client and every other user's session list
 * ([#357](https://github.com/Omega-JS-Stack/omega/issues/357)).
 *
 * Rules being tested:
 * - A user's own-uid query read of the room passes
 * - Another user's uid in the same query is denied
 * - An unfiltered list read (the room, and the tree above it) is denied
 * - A point read of another user's session record is denied
 * - A client write to another user's session record is denied
 *
 * @see templates/database.rules.json (the file `omega setup` ships to a brand)
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { envPort, CLASSIC_PORTS } = require('@omega.js/config');

// The REAL shipped ruleset, read straight from templates/ — the same file the
// verbs' scaffold copies into a brand's target root as `database.rules.json`
// (src/cli/utils/ensure-target.js). No test copy exists to drift out of sync.
const DATABASE_RULES = path.resolve(__dirname, '..', '..', 'templates', 'database.rules.json');

// Its own emulator project, so the ruleset this suite loads (and the data it
// clears) can never touch the fixture project's namespace — where the boot seed
// keeps the personas' real sessions. Mirrors the firestore suites that carry
// their own ruleset (see ./_environment.js).
const PROJECT_ID = 'demo-rtdb-sessions';

// `app` is the room both sessions routes default to (schemas/user/sessions/get.js).
const ROOM = 'sessions/app';

const OWNER = 'rtdb-rules-owner';
const OTHER = 'rtdb-rules-other';
const OTHER_SESSION = 'rtdb-rules-other-session';

/**
 * A rules-testing environment on the shipped ruleset, holding one session
 * record that belongs to somebody else — the record every denial case aims at.
 * @returns {Promise<object>}
 */
async function environment() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      host: '127.0.0.1',
      port: envPort('database') || CLASSIC_PORTS.database,
      rules: jetpack.read(DATABASE_RULES),
    },
  });

  // The namespace is shared with whatever ran before on the same emulator.
  await env.clearDatabase();

  await env.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`${ROOM}/${OTHER_SESSION}`).set({
      uid: OTHER,
      platform: 'macos',
      timestampUNIX: 1787000000,
    });
  });

  return env;
}

module.exports = {
  description: 'Realtime Database security rules for sessions',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'own-uid-query-read-passes',
      auth: 'none',

      async run() {
        const env = await environment();

        try {
          const db = env.authenticatedContext(OWNER).database();

          await assertSucceeds(db.ref(ROOM).orderByChild('uid').equalTo(OWNER).once('value'));
        } finally {
          await env.cleanup();
        }
      },
    },

    {
      name: 'cross-uid-query-read-denied',
      auth: 'none',

      async run() {
        const env = await environment();

        try {
          const db = env.authenticatedContext(OWNER).database();

          await assertFails(db.ref(ROOM).orderByChild('uid').equalTo(OTHER).once('value'));
        } finally {
          await env.cleanup();
        }
      },
    },

    {
      name: 'unfiltered-list-read-denied',
      auth: 'none',

      async run() {
        const env = await environment();

        try {
          const db = env.authenticatedContext(OWNER).database();

          // The tree above the room, where every room would come back at once
          await assertFails(db.ref('sessions').once('value'));
          // …and the room with no `equalTo` filter — the enumeration vector the
          // room rule exists to close
          await assertFails(db.ref(ROOM).once('value'));
        } finally {
          await env.cleanup();
        }
      },
    },

    {
      name: 'point-read-of-another-users-session-denied',
      auth: 'none',

      async run() {
        const env = await environment();

        try {
          const db = env.authenticatedContext(OWNER).database();

          await assertFails(db.ref(`${ROOM}/${OTHER_SESSION}`).once('value'));
        } finally {
          await env.cleanup();
        }
      },
    },

    {
      name: 'client-write-of-another-users-session-denied',
      auth: 'none',

      async run() {
        const env = await environment();

        try {
          const db = env.authenticatedContext(OWNER).database();

          await assertFails(db.ref(`${ROOM}/${OTHER_SESSION}`).set({
            uid: OTHER,
            platform: 'hijacked',
            timestampUNIX: 1787000001,
          }));
        } finally {
          await env.cleanup();
        }
      },
    },
  ],
};
