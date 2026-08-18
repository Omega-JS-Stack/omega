/**
 * Test: a brand can TIGHTEN the framework's user-doc write rule
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255)).
 *
 * Firestore ORs `allow` across sibling match blocks, so a brand's own
 * `match /users/{uid}` can only ever WIDEN access. The compiled-rules model's
 * `protectedFields()` hook is the answer: the framework's user write rule ANDs
 * `!isWritingProtectedUserField()`, which folds the brand's list in through
 * `incomingData().diff(existingData()).affectedKeys().hasAny(protectedFields())`.
 *
 * The proof is StudyMonkey's case: `users/{uid}.xp` (an XP bank the backend
 * awards transactionally) must be un-writable by a signed-in client once the
 * brand lists it — and with the shipped default (an empty list) the same write
 * must keep working, so declaring nothing changes nothing.
 *
 * This suite compiles TWO rulesets from the same seed and loads each into its
 * OWN emulator project, so both behaviours are proven in one run against the
 * real Firestore rules engine. Everything else in test/rules/ runs against the
 * fixture project's compiled artifact (the default, empty list).
 *
 * Run: npx omega test backend:rules/user-protected-fields
 */
const jetpack = require('fs-jetpack');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { BRAND_RULES_SEED, compileRules } = require('../../src/cli/utils/compile-rules.js');

const UID = 'protected-fields-user';

/**
 * The seeded brand source with `protectedFields()` declaring `fields`,
 * compiled against the framework half exactly as `omega build` does.
 * @param {string[]} fields
 * @returns {string}
 */
function rulesDeclaring(fields) {
  const list = fields.map((field) => `'${field}'`).join(', ');
  const brandSource = jetpack.read(BRAND_RULES_SEED).replace('return [];', `return [${list}];`);

  return compileRules({ brandSource }).compiled;
}

/**
 * A rules-testing environment on its own project id, carrying `rules`.
 * @param {string} projectId
 * @param {string} rules
 * @returns {Promise<object>}
 */
async function environment(projectId, rules) {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

  return initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules },
  });
}

/**
 * Seed the user doc (rules off), then hand back the signed-in client.
 * @param {object} env
 * @returns {Promise<object>}
 */
async function seedUser(env) {
  await env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`users/${UID}`).set({
      auth: { uid: UID, email: `${UID}@test.com` },
      roles: {},
      xp: { total: 0 },
      profile: { displayName: 'Before' },
    });
  });

  return env.authenticatedContext(UID, { email: `${UID}@test.com` }).firestore();
}

module.exports = {
  description: 'Firestore rules: a brand\'s protectedFields() hook tightens the user-doc write rule',
  type: 'group',
  timeout: 30000,

  tests: [
    // The default the seed ships: declaring nothing changes nothing.
    {
      name: 'default-empty-protected-list-keeps-todays-behavior',
      auth: 'none',

      async run() {
        const env = await environment('demo-protected-fields-default', rulesDeclaring([]));

        try {
          const db = await seedUser(env);

          await assertSucceeds(db.doc(`users/${UID}`).set({ xp: { total: 500 } }, { merge: true }));
          await assertSucceeds(db.doc(`users/${UID}`).set({ profile: { displayName: 'After' } }, { merge: true }));
          // The framework's own list is untouched by the hook
          await assertFails(db.doc(`users/${UID}`).set({ roles: { admin: true } }, { merge: true }));
        } finally {
          await env.cleanup();
        }
      },
    },

    // StudyMonkey's case: the brand lists `xp`, the client write dies.
    {
      name: 'a-declared-protected-field-denies-the-client-write',
      auth: 'none',

      async run() {
        const env = await environment('demo-protected-fields-xp', rulesDeclaring(['xp']));

        try {
          const db = await seedUser(env);

          await assertFails(db.doc(`users/${UID}`).set({ xp: { total: 500 } }, { merge: true }));
          // affectedKeys() is TOP-LEVEL: naming `xp` protects everything under it
          await assertFails(db.doc(`users/${UID}`).update({ 'xp.total': 500 }));
          // …and nothing else tightens: an undeclared field still writes
          await assertSucceeds(db.doc(`users/${UID}`).set({ profile: { displayName: 'After' } }, { merge: true }));
        } finally {
          await env.cleanup();
        }
      },
    },

    // The second hook: `canWriteUser()` ANDs a brand condition into the same
    // rule, so a brand can gate user writes wholesale.
    {
      name: 'can-write-user-hook-gates-the-whole-write-rule',
      auth: 'none',

      async run() {
        const brandSource = jetpack.read(BRAND_RULES_SEED).replace('return true;', 'return false;');
        const env = await environment('demo-protected-fields-cannot-write', compileRules({ brandSource }).compiled);

        try {
          const db = await seedUser(env);

          await assertFails(db.doc(`users/${UID}`).set({ profile: { displayName: 'After' } }, { merge: true }));
          // Reads are a separate rule — still the owner's
          await assertSucceeds(db.doc(`users/${UID}`).get());
        } finally {
          await env.cleanup();
        }
      },
    },
  ],
};
