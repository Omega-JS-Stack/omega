/**
 * Firestore rules for the notes feature (firestore.rules, compiled with the
 * framework half into dist/firestore.rules): a note is its owner's alone, and
 * the notes-stats counter is read-only to its owner.
 *
 * Seeded through the Admin SDK (rules bypassed), then exercised as the notes
 * personas test/_init.js declares.
 *
 * Run (from this target): npx omega test rules/notes
 */
const defineCases = require('@omega.js/backend/dist/vendor/devkit/test/define-cases.js');

const NOTE = 'notes/rules-note';

module.exports = defineCases({
  description: 'Firestore rules for notes and notes-stats',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'seed-a-note-and-its-counter',

      async run({ firestore, accounts }) {
        const owner = accounts['notes-owner'].uid;

        await firestore.set(NOTE, { id: 'rules-note', owner, text: 'Rules' });
        await firestore.set(`notes-stats/${owner}`, { owner, created: 1 });
      },
    },

    {
      name: 'the-owner-reads-the-note',

      async run({ rules }) {
        await rules.expectSuccess(rules.asAccount('notes-owner').doc(NOTE).get());
      },
    },

    {
      name: 'another-account-cannot-read-the-note',

      async run({ rules }) {
        await rules.expectFailure(rules.asAccount('notes-other').doc(NOTE).get());
      },
    },

    {
      name: 'a-signed-out-visitor-cannot-read-the-note',

      async run({ rules }) {
        await rules.expectFailure(rules.asAnonymous().doc(NOTE).get());
      },
    },

    {
      name: 'the-owner-creates-a-note-in-their-own-name',

      async run({ rules, accounts }) {
        const owner = accounts['notes-owner'].uid;

        await rules.expectSuccess(
          rules.asAccount('notes-owner').doc('notes/rules-own').set({ id: 'rules-own', owner, text: 'Mine' }),
        );
      },
    },

    {
      name: 'nobody-creates-a-note-in-another-accounts-name',

      async run({ rules, accounts }) {
        const victim = accounts['notes-owner'].uid;

        await rules.expectFailure(
          rules.asAccount('notes-other').doc('notes/rules-forged').set({ id: 'rules-forged', owner: victim, text: 'Forged' }),
        );
      },
    },

    {
      name: 'the-owner-cannot-hand-the-note-to-another-account',

      async run({ rules, accounts }) {
        await rules.expectFailure(
          rules.asAccount('notes-owner').doc(NOTE).update({ owner: accounts['notes-other'].uid }),
        );
      },
    },

    {
      name: 'another-account-cannot-delete-the-note',

      async run({ rules }) {
        await rules.expectFailure(rules.asAccount('notes-other').doc(NOTE).delete());
      },
    },

    {
      name: 'the-owner-deletes-the-note',

      async run({ rules }) {
        await rules.expectSuccess(rules.asAccount('notes-owner').doc(NOTE).delete());
      },
    },

    {
      name: 'the-owner-reads-their-counter-and-nobody-else-does',

      async run({ rules, accounts }) {
        const path = `notes-stats/${accounts['notes-owner'].uid}`;

        await rules.expectSuccess(rules.asAccount('notes-owner').doc(path).get());
        await rules.expectFailure(rules.asAccount('notes-other').doc(path).get());
      },
    },

    {
      name: 'the-counter-is-server-written-only',

      async run({ rules, accounts }) {
        const path = `notes-stats/${accounts['notes-owner'].uid}`;

        await rules.expectFailure(rules.asAccount('notes-owner').doc(path).set({ created: 999 }));
      },
    },
  ],
});
