/**
 * Test: a brand TIGHTENS a framework rule by writing an ordinary match block
 * ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)).
 *
 * Firestore ORs `allow` across sibling match blocks, so a brand's own
 * `match /users/{uid}` can only ever WIDEN access. Merge-by-match is the
 * answer: the compiler folds a brand block into the framework block with the
 * same canonicalized path, ANDing the brand's condition onto every op both
 * declare. The v2 hooks (`protectedFields()`, `canWriteUser()`) are gone.
 *
 * The proof is StudyMonkey's case: `users/{uid}.xp` (an XP bank the backend
 * awards transactionally) must be un-writable by a signed-in client once the
 * brand protects it — while a brand that writes nothing keeps today's exact
 * behaviour.
 *
 * Each case compiles its own ruleset and loads it into its OWN emulator
 * project, so every behaviour is proven against the real Firestore rules
 * engine in one run.
 *
 * Run: npx omega test backend:rules/brand-merge
 */
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { compiledWith, environment } = require('./_environment.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const UID = 'brand-merge-user';

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

module.exports = defineCases({
  description: 'Firestore rules: a brand match block merges into the framework block it names',
  type: 'group',
  timeout: 30000,

  tests: [
    // The file every brand starts from: writing nothing changes nothing.
    {
      name: 'the-shipped-seed-keeps-todays-behavior',
      auth: 'none',

      async run() {
        const env = await environment('demo-merge-seed', compiledWith());

        try {
          const db = await seedUser(env);

          await assertSucceeds(db.doc(`users/${UID}`).set({ xp: { total: 500 } }, { merge: true }));
          await assertSucceeds(db.doc(`users/${UID}`).set({ profile: { displayName: 'After' } }, { merge: true }));
          // The framework's own keys stay the framework's
          await assertFails(db.doc(`users/${UID}`).set({ roles: { admin: true } }, { merge: true }));
        } finally {
          await env.cleanup();
        }
      },
    },

    // StudyMonkey's case: the brand protects `xp` in its own users block, and
    // the client write the framework alone allowed now dies.
    {
      name: 'a-merged-brand-condition-denies-what-the-framework-alone-allowed',
      auth: 'none',

      async run() {
        const env = await environment('demo-merge-tighten', compiledWith([
          '    match /users/{uid} {',
          '      allow create, update: if !isWritingAny([\'xp\']);',
          '    }',
        ].join('\n')));

        try {
          const db = await seedUser(env);

          await assertFails(db.doc(`users/${UID}`).set({ xp: { total: 500 } }, { merge: true }));
          // Fields are TOP-LEVEL: naming `xp` protects everything under it
          await assertFails(db.doc(`users/${UID}`).update({ 'xp.total': 500 }));
          // …and nothing else tightened: an untouched field still writes
          await assertSucceeds(db.doc(`users/${UID}`).set({ profile: { displayName: 'After' } }, { merge: true }));
          // Reads are a different op — the brand said nothing about them
          await assertSucceeds(db.doc(`users/${UID}`).get());
        } finally {
          await env.cleanup();
        }
      },
    },

    // The whole-rule gate the retired `canWriteUser()` hook used to buy: an
    // ordinary condition on the same op now does it.
    {
      name: 'a-merged-condition-can-gate-the-whole-write-rule',
      auth: 'none',

      async run() {
        const env = await environment('demo-merge-gate', compiledWith([
          '    match /users/{uid} {',
          '      allow create, update: if false;',
          '    }',
        ].join('\n')));

        try {
          const db = await seedUser(env);

          await assertFails(db.doc(`users/${UID}`).set({ profile: { displayName: 'After' } }, { merge: true }));
          await assertSucceeds(db.doc(`users/${UID}`).get());
        } finally {
          await env.cleanup();
        }
      },
    },

    // A brand's wildcard name is its own business: the block merges on the
    // PATH, and the compiler renames the variable inside the folded condition.
    {
      name: 'a-brand-wildcard-name-canonicalizes-onto-the-framework-block',
      auth: 'none',

      async run() {
        const env = await environment('demo-merge-wildcard', compiledWith([
          '    match /users/{userId} {',
          '      allow create, update: if isUser(userId) && !isWritingAny([\'xp\']);',
          '',
          '      match /journal/{entryId} {',
          '        allow read, write: if isUser(userId);',
          '      }',
          '    }',
        ].join('\n')));

        try {
          const db = await seedUser(env);

          // The renamed `userId` still resolves — a broken rename would error
          // and deny every write, so this succeeding IS the rename proof.
          await assertSucceeds(db.doc(`users/${UID}`).set({ profile: { displayName: 'After' } }, { merge: true }));
          await assertFails(db.doc(`users/${UID}`).set({ xp: { total: 500 } }, { merge: true }));
          // The nested block spliced in and reads the renamed variable too
          await assertSucceeds(db.doc(`users/${UID}/journal/today`).set({ text: 'hello' }));
          await assertFails(db.doc('users/somebody-else/journal/today').set({ text: 'nope' }));
        } finally {
          await env.cleanup();
        }
      },
    },

    // Paths the framework never declares are the brand's alone, and an op only
    // the brand declares appends — that op widens, exactly as a sibling block
    // always did.
    {
      name: 'a-brand-only-collection-and-a-brand-only-op-keep-working',
      auth: 'none',

      async run() {
        const env = await environment('demo-merge-brand-only', compiledWith([
          '    match /leaderboards/{id} {',
          '      allow read: if true;',
          '      allow write: if isAdmin();',
          '    }',
          '',
          '    match /users/{uid} {',
          '      allow delete: if isUser(uid);',
          '    }',
        ].join('\n')));

        try {
          const db = await seedUser(env);

          // Brand-only path: through untouched, calling a framework helper
          await assertSucceeds(db.doc('leaderboards/weekly').get());
          await assertFails(db.doc('leaderboards/weekly').set({ hacked: true }));

          // Brand-only op: the framework declares no `delete`, so this grants it
          await assertSucceeds(db.doc(`users/${UID}`).delete());
          // …and the ops the framework DOES declare are untouched by it
          await assertFails(db.doc('users/somebody-else').set({ profile: {} }, { merge: true }));
        } finally {
          await env.cleanup();
        }
      },
    },
  ],
});
