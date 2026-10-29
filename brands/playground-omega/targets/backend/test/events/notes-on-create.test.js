/**
 * The notes/on-create event (src/events/notes/on-create.js): the handler run
 * through the real dispatcher (omega.events.run), and the deployed trigger
 * (notesOnCreate in src/index.js) running it on a real Firestore write.
 *
 * The counter lives on the owner's own user document (`users/{owner}.notes`).
 * Owners here are fabricated uids with a bare user document and no account
 * behind it, so no persona's counter moves.
 *
 * Run (from this target): npx omega test events/notes-on-create
 */
const { defineCases } = require('@omega.js/backend/test');

const DIRECT_OWNER = '_test-notes-event-direct';
const TRIGGER_OWNER = '_test-notes-event-trigger';

// The snapshot the Firestore trigger hands the handler, for a note that is
// never written: the dispatcher path alone runs, and no trigger fires beside it
function noteSnapshot(id, note) {
  return { id, data: () => note };
}

// A real owner always has a user document before their first note
async function seedOwner(firestore, uid) {
  await firestore.set(`users/${uid}`, { auth: { uid } });
}

module.exports = defineCases({
  description: 'Notes: the on-create event counts each new note for its owner',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'the-handler-bumps-the-owners-counter',

      async run({ omega, firestore, expect }) {
        await seedOwner(firestore, DIRECT_OWNER);

        for (const id of ['direct-1', 'direct-2']) {
          await omega.events.run('notes/on-create', {
            snapshot: noteSnapshot(id, { id, owner: DIRECT_OWNER, text: 'Counted' }),
            context: { params: { id } },
          });
        }

        const user = await firestore.get(`users/${DIRECT_OWNER}`);

        expect(user.notes?.created, 'one count per note, on the owner\'s own user document').toBe(2);
        expect(await firestore.exists(`notes-stats/${DIRECT_OWNER}`), 'no sibling stats doc is written').toBe(false);
      },
    },

    {
      name: 'a-note-without-an-owner-fails-loudly',

      async run({ omega, expect }) {
        let error = null;

        try {
          await omega.events.run('notes/on-create', {
            snapshot: noteSnapshot('ownerless', { id: 'ownerless', text: 'Nobody' }),
            context: { params: { id: 'ownerless' } },
          });
        } catch (e) {
          error = e;
        }

        expect(error, 'an ownerless note rejects instead of counting nowhere').toBeTruthy();
        expect(error.message, 'and says why').toMatch(/has no owner/);
      },
    },

    {
      name: 'the-deployed-trigger-runs-the-handler',

      async run({ firestore, expect, waitFor }) {
        await seedOwner(firestore, TRIGGER_OWNER);

        await firestore.set('notes/trigger-1', {
          id: 'trigger-1',
          owner: TRIGGER_OWNER,
          text: 'Written straight to Firestore',
          metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.round(Date.now() / 1000) } },
        });

        const user = await waitFor(async () => {
          const doc = await firestore.get(`users/${TRIGGER_OWNER}`);
          return doc?.notes?.created === 1 ? doc : null;
        }, 20000, 500);

        expect(user, 'the notesOnCreate trigger counted the write').toBeTruthy();
        expect(await firestore.exists(`notes-stats/${TRIGGER_OWNER}`), 'no sibling stats doc is written').toBe(false);
      },
    },
  ],
});
