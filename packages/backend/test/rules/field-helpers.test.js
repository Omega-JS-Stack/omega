/**
 * Test: the framework's field helpers, on CREATE and on UPDATE
 * ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)).
 *
 * `resource` is null on a create, and reading through a null is an ERROR that
 * denies the whole rule — so the v2 helpers (`!(field in resource.data) && …`)
 * were silently false on every create, and `!isWritingProtectedUserField()`
 * denied every client create outright. v3 reads an absent document as the
 * empty map (`getExistingData()`), which is what makes the helpers mean the same
 * thing on both paths. This suite pins that on the real engine, both ways.
 *
 * The probe collections are BRAND-only paths compiled in through the same
 * merge-by-match pipeline a consumer uses — which also proves a brand's rules
 * can call the framework's helpers across the seam.
 *
 * Run: npx omega test backend:rules/field-helpers
 */
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { compiledWith, environment } = require('./_environment.js');

const UID = 'field-helpers-user';
const EMAIL = `${UID}@test.com`;

const PROBE_RULES = [
  '    match /probe-creating/{id} {',
  '      allow read: if true;',
  '      allow write: if isCreatingField(\'a\');',
  '    }',
  '',
  '    match /probe-updating/{id} {',
  '      allow read: if true;',
  '      allow write: if isUpdatingField(\'a\');',
  '    }',
  '',
  '    match /probe-writing/{id} {',
  '      allow read: if true;',
  '      allow write: if isWritingField(\'a\');',
  '    }',
  '',
  '    match /probe-writing-any/{id} {',
  '      allow read: if true;',
  '      allow write: if isWritingAny([\'a\', \'b\']);',
  '    }',
  '',
  '    match /probe-owner/{id} {',
  '      allow read: if true;',
  '      allow write: if isOwner();',
  '    }',
  '',
  '    match /probe-email-verified/{id} {',
  '      allow read: if true;',
  '      allow write: if isEmailVerified();',
  '    }',
  '',
  '    match /probe-is-user/{identity} {',
  '      allow read: if true;',
  '      allow write: if isUser(identity);',
  '    }',
].join('\n');

/**
 * One environment for the whole suite's probes.
 * @param {string} projectId
 * @returns {Promise<object>}
 */
function probeEnvironment(projectId) {
  return environment(projectId, compiledWith(PROBE_RULES));
}

/**
 * Write documents with the rules OFF — the "before" state of an update test.
 * @param {object} env
 * @param {object} documents - `{ path: data }`.
 * @returns {Promise<void>}
 */
async function seed(env, documents) {
  await env.withSecurityRulesDisabled(async (context) => {
    for (const [documentPath, data] of Object.entries(documents)) {
      await context.firestore().doc(documentPath).set(data);
    }
  });
}

module.exports = {
  description: 'Firestore rules: the framework field helpers on create and on update',
  type: 'group',
  timeout: 30000,

  tests: [
    // The two halves of a write, each meaning what it says on both paths.
    {
      name: 'is-creating-field-and-is-updating-field-split-the-two-paths',
      auth: 'none',

      async run() {
        const env = await probeEnvironment('demo-field-helpers-split');

        try {
          await seed(env, {
            'probe-creating/existing': { a: 1 },
            'probe-updating/existing': { a: 1 },
          });
          const db = env.authenticatedContext(UID, { email: EMAIL }).firestore();

          // isCreatingField: true only when the field arrives on a doc that
          // does not carry it — the create path the v2 helper could not see.
          await assertSucceeds(db.doc('probe-creating/fresh').set({ a: 1 }));
          await assertFails(db.doc('probe-creating/fresh-without-a').set({ z: 1 }));
          await assertFails(db.doc('probe-creating/existing').set({ a: 2 }, { merge: true }));

          // isUpdatingField: true only when an existing field CHANGES value.
          await assertFails(db.doc('probe-updating/fresh').set({ a: 1 }));
          await assertSucceeds(db.doc('probe-updating/existing').set({ a: 2 }, { merge: true }));
          await assertFails(db.doc('probe-updating/existing').set({ a: 2 }, { merge: true }));
        } finally {
          await env.cleanup();
        }
      },
    },

    // The Spec's fifth test: the list form, correct on BOTH paths.
    {
      name: 'is-writing-any-is-correct-on-create-and-on-update',
      auth: 'none',

      async run() {
        const env = await probeEnvironment('demo-field-helpers-writing-any');

        try {
          await seed(env, {
            'probe-writing-any/existing': { a: 1, keep: true },
            'probe-writing-any/removal': { a: 1, keep: true },
            'probe-writing-any/untouched': { a: 1, keep: true },
            'probe-writing/existing': { a: 1, keep: true },
          });
          const db = env.authenticatedContext(UID, { email: EMAIL }).firestore();

          // CREATE: a listed field arriving on a brand-new document counts.
          await assertSucceeds(db.doc('probe-writing-any/fresh').set({ b: 2 }));
          await assertFails(db.doc('probe-writing-any/fresh-unlisted').set({ z: 1 }));

          // UPDATE: a listed field changing counts; the same value written
          // back does not; removing one does.
          await assertSucceeds(db.doc('probe-writing-any/existing').set({ a: 2 }, { merge: true }));
          await assertFails(db.doc('probe-writing-any/untouched').set({ keep: false }, { merge: true }));
          await assertSucceeds(db.doc('probe-writing-any/removal').set({ keep: true }));

          // …and the singular form is the same question about one field.
          await assertSucceeds(db.doc('probe-writing/fresh').set({ a: 1 }));
          await assertSucceeds(db.doc('probe-writing/existing').set({ a: 2 }, { merge: true }));
          await assertFails(db.doc('probe-writing/existing').set({ keep: false }, { merge: true }));
        } finally {
          await env.cleanup();
        }
      },
    },

    // The owner-field idiom, offered to brands as a helper — and correct on
    // every op: the STORED owner once the document exists, the INCOMING one on
    // a create.
    {
      name: 'is-owner-reads-the-owner-field-by-uid-or-email',
      auth: 'none',

      async run() {
        const env = await probeEnvironment('demo-field-helpers-owner');

        try {
          await seed(env, {
            'probe-owner/by-uid': { owner: UID, value: 1 },
            'probe-owner/by-email': { owner: EMAIL, value: 1 },
            'probe-owner/by-someone-else': { owner: 'another-user', value: 1 },
            'probe-owner/unowned': { value: 1 },
          });
          const db = env.authenticatedContext(UID, { email: EMAIL }).firestore();
          const verified = env.authenticatedContext(UID, { email: EMAIL, email_verified: true }).firestore();

          await assertSucceeds(db.doc('probe-owner/by-uid').set({ value: 2 }, { merge: true }));
          // isOwner() answers through isUser(), so an EMAIL-keyed owner needs a
          // verified token — an unproven claim on the address is not ownership.
          await assertFails(db.doc('probe-owner/by-email').set({ value: 2 }, { merge: true }));
          await assertSucceeds(verified.doc('probe-owner/by-email').set({ value: 2 }, { merge: true }));
          await assertFails(db.doc('probe-owner/by-someone-else').set({ value: 2 }, { merge: true }));
          // A doc with no owner key at all: null, not an error — the rule
          // simply says no (an error would deny the same way, which is why
          // isOwner() reads through `.get('owner', null)`).
          await assertFails(db.doc('probe-owner/unowned').set({ value: 2 }, { merge: true }));
          // CREATE: there is no stored owner to read, so the INCOMING one
          // answers — a caller may open a document that names them.
          await assertSucceeds(db.doc('probe-owner/fresh').set({ owner: UID }));
          await assertFails(db.doc('probe-owner/fresh-for-someone-else').set({ owner: 'another-user' }));
          // …and on an UPDATE the STORED owner still wins, so a write cannot
          // hand itself a document it does not already own.
          await assertFails(db.doc('probe-owner/by-someone-else').set({ owner: UID }, { merge: true }));
          // DELETE carries no incoming data at all: the stored side answers
          // there too (reading the incoming side would error and deny).
          await assertSucceeds(db.doc('probe-owner/by-uid').delete());
        } finally {
          await env.cleanup();
        }
      },
    },

    // `isUser(identity)` answers "the caller IS this uid or this email". The
    // EMAIL arm is only as trustworthy as the claim behind it: Firebase Auth
    // lets anyone sign up claiming any address, so an unverified token whose
    // email happens to match an email-keyed document must not match it.
    {
      name: 'the-is-user-email-arm-requires-a-verified-token',
      auth: 'none',

      async run() {
        const env = await probeEnvironment('demo-field-helpers-is-user');

        try {
          // The signup nobody proved: same address, no verification.
          const claimed = 'claimed@test.com';
          const unverified = env.authenticatedContext('is-user-unverified', { email: claimed }).firestore();
          await assertFails(unverified.doc(`probe-is-user/${claimed}`).set({ a: 1 }));

          // The same address, verified this time.
          const verified = env.authenticatedContext('is-user-verified', { email: claimed, email_verified: true }).firestore();
          await assertSucceeds(verified.doc(`probe-is-user/${claimed}`).set({ a: 1 }));

          // The UID arm is unaffected — a uid is Firebase Auth's own value, so
          // an unverified caller still matches a document keyed by their uid.
          await assertSucceeds(unverified.doc('probe-is-user/is-user-unverified').set({ a: 1 }));
          // …and neither arm matches somebody else.
          await assertFails(unverified.doc('probe-is-user/is-user-verified').set({ a: 1 }));
          await assertFails(env.unauthenticatedContext().firestore().doc(`probe-is-user/${claimed}`).set({ a: 1 }));
        } finally {
          await env.cleanup();
        }
      },
    },

    // The email gate reads the AUTH TOKEN, the one source a client cannot
    // write. `users/{uid}.verifications` is written by NOTHING server-side, so
    // a gate that read the stored field could only ever be satisfied by a
    // client planting it on its own document first.
    {
      name: 'is-email-verified-reads-the-token-and-no-stored-field',
      auth: 'none',

      async run() {
        const env = await probeEnvironment('demo-field-helpers-email-verified');

        try {
          // The forgery, planted with the rules OFF — the strongest version of
          // what a client could ever get onto its own user document.
          await seed(env, { [`users/${UID}`]: { verifications: { email: true } } });

          const unverified = env.authenticatedContext(UID, { email: EMAIL }).firestore();
          await assertFails(unverified.doc('probe-email-verified/forged').set({ a: 1 }));

          // A token carrying the claim passes — with no user document at all,
          // and on the caller's very first request (no billed read either).
          const verifiedUid = 'field-helpers-verified';
          const verified = env.authenticatedContext(verifiedUid, { email: 'verified@test.com', email_verified: true }).firestore();
          await assertSucceeds(verified.doc('probe-email-verified/token').set({ a: 1 }));

          // …and a signed-out caller carries no token to read.
          await assertFails(env.unauthenticatedContext().firestore().doc('probe-email-verified/anonymous').set({ a: 1 }));

          // The belt: `verifications` is framework-owned, so a client cannot
          // plant it through the rules in the first place.
          await assertFails(verified.doc(`users/${verifiedUid}`).set({ verifications: { email: true } }));
        } finally {
          await env.cleanup();
        }
      },
    },

    // What the create path buys the framework's own user rule.
    {
      name: 'the-framework-field-guard-holds-on-create-as-well-as-update',
      auth: 'none',

      async run() {
        const env = await probeEnvironment('demo-field-helpers-user-create');

        try {
          const db = env.authenticatedContext(UID, { email: EMAIL }).firestore();

          // A framework-owned key can never arrive from a client, not even on
          // the document's first write (v2 denied this by ERRORING; v3 denies
          // it by meaning it).
          await assertFails(db.doc(`users/${UID}`).set({ roles: { admin: true } }));
          await assertFails(db.doc(`users/${UID}`).set({ subscription: { status: 'active' } }));
          // A user's own document, carrying only its own keys, is theirs.
          await assertSucceeds(db.doc(`users/${UID}`).set({ profile: { displayName: 'Mine' } }));
          // Somebody else's is not.
          await assertFails(db.doc('users/another-user').set({ profile: { displayName: 'Theirs' } }));
          // …and the guard still holds on the update that follows.
          await assertFails(db.doc(`users/${UID}`).set({ roles: { admin: true } }, { merge: true }));
          await assertSucceeds(db.doc(`users/${UID}`).set({ profile: { displayName: 'Still mine' } }, { merge: true }));
          // DELETE is not an op the users rule declares: an owner deleting
          // their own document falls through to the admin catch-all and is
          // denied by the RULE, never by an evaluation error (deleting carries
          // no incoming data for a field helper to read).
          await assertFails(db.doc(`users/${UID}`).delete());
        } finally {
          await env.cleanup();
        }
      },
    },
  ],
};
