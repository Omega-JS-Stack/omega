/**
 * The notes/on-create event (src/events/notes/on-create.js): the handler run
 * through the real dispatcher (omega.events.run), and the deployed trigger
 * (notesOnCreate in src/index.js) running it on a real Firestore write.
 *
 * Owners here are fabricated uids with no account behind them: the counter is
 * keyed by the note's owner and nothing else, so no persona is touched.
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

module.exports = defineCases({
  description: 'Notes: the on-create event counts each new note for its owner',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'the-handler-bumps-the-owners-counter',

      async run({ omega, firestore, expect }) {
        for (const id of ['direct-1', 'direct-2']) {
          await omega.events.run('notes/on-create', {
            snapshot: noteSnapshot(id, { id, owner: DIRECT_OWNER, text: 'Counted' }),
            context: { params: { id } },
          });
        }

        const stats = await firestore.get(`notes-stats/${DIRECT_OWNER}`);

        expect(stats.created, 'one count per note').toBe(2);
        expect(stats.owner, 'on the owner\'s own stats doc').toBe(DIRECT_OWNER);
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
        await firestore.set('notes/trigger-1', {
          id: 'trigger-1',
          owner: TRIGGER_OWNER,
          text: 'Written straight to Firestore',
          metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.round(Date.now() / 1000) } },
        });

        const stats = await waitFor(async () => {
          const doc = await firestore.get(`notes-stats/${TRIGGER_OWNER}`);
          return doc?.created === 1 ? doc : null;
        }, 20000, 500);

        expect(stats, 'the notesOnCreate trigger counted the write').toBeTruthy();
      },
    },
  ],
});
