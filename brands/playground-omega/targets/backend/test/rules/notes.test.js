/**
 * Firestore rules for the notes feature (firestore.rules, compiled with the
 * framework half into dist/firestore.rules): a note is its owner's alone, and
 * the counter on the owner's user document (`users/{uid}.notes`) is
 * server-written only, while the rest of the user document stays the owner's.
 *
 * Seeded through the Admin SDK (rules bypassed), then exercised as the notes
 * personas test/_init.js declares.
 *
 * Run (from this target): npx omega test rules/notes
 */
const fs = require('node:fs');
const path = require('node:path');
const { defineCases } = require('@omega.js/backend/test');

const NOTE = 'notes/rules-note';

// The compiled artifact firebase.json points the emulator at
const COMPILED_RULES = path.join(__dirname, '..', '..', 'dist', 'firestore.rules');

module.exports = defineCases({
  description: 'Firestore rules for notes and the user notes counter',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'seed-a-note',

      async run({ firestore, accounts }) {
        const owner = accounts['notes-owner'].uid;

        await firestore.set(NOTE, { id: 'rules-note', owner, text: 'Rules' });
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
      name: 'the-owner-cannot-write-their-notes-counter',

      async run({ rules, accounts }) {
        const userPath = `users/${accounts['notes-owner'].uid}`;

        await rules.expectFailure(rules.asAccount('notes-owner').doc(userPath).update({ notes: { created: 999 } }));
      },
    },

    {
      name: 'the-owner-still-writes-another-own-field',

      async run({ rules, accounts }) {
        const userPath = `users/${accounts['notes-owner'].uid}`;

        await rules.expectSuccess(rules.asAccount('notes-owner').doc(userPath).update({ 'personal.name.first': 'Noted' }));
      },
    },

    {
      name: 'notes-stats-is-gone-from-the-compiled-rules',

      async run({ expect }) {
        const compiled = fs.readFileSync(COMPILED_RULES, 'utf8');

        expect(/match\s+\/notes-stats\//.test(compiled), 'the sibling counter collection still has a rule').toBe(false);
      },
    },
  ],
});
