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
const defineCases = require('@omega.js/backend/dist/vendor/devkit/test/define-cases.js');

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

      async run({ omega, firestore, assert }) {
        for (const id of ['direct-1', 'direct-2']) {
          await omega.events.run('notes/on-create', {
            snapshot: noteSnapshot(id, { id, owner: DIRECT_OWNER, text: 'Counted' }),
            context: { params: { id } },
          });
        }

        const stats = await firestore.get(`notes-stats/${DIRECT_OWNER}`);

        assert.equal(stats.created, 2, 'one count per note');
        assert.equal(stats.owner, DIRECT_OWNER, 'on the owner\'s own stats doc');
      },
    },

    {
      name: 'a-note-without-an-owner-fails-loudly',

      async run({ omega, assert }) {
        let error = null;

        try {
          await omega.events.run('notes/on-create', {
            snapshot: noteSnapshot('ownerless', { id: 'ownerless', text: 'Nobody' }),
            context: { params: { id: 'ownerless' } },
          });
        } catch (e) {
          error = e;
        }

        assert.ok(error, 'an ownerless note rejects instead of counting nowhere');
        assert.match(error.message, /has no owner/, 'and says why');
      },
    },

    {
      name: 'the-deployed-trigger-runs-the-handler',

      async run({ firestore, assert, waitFor }) {
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

        assert.ok(stats, 'the notesOnCreate trigger counted the write');
      },
    },
  ],
});
