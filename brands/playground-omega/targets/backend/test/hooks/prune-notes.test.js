/**
 * The daily prune job (src/hooks/cron/daily/prune-notes.js), run the way the
 * cron runner runs it: the staged module, called with the real omega and ctx.
 *
 * Run (from this target): npx omega test hooks/prune-notes
 */
const path = require('path');
const defineCases = require('@omega.js/backend/dist/vendor/devkit/test/define-cases.js');

const OWNER = '_test-notes-prune';
const DAY = 24 * 60 * 60;

function note(id, ageDays) {
  const timestampUNIX = Math.round(Date.now() / 1000) - (ageDays * DAY);

  return {
    id,
    owner: OWNER,
    text: `${ageDays} days old`,
    metadata: { created: { timestamp: new Date(timestampUNIX * 1000).toISOString(), timestampUNIX } },
  };
}

module.exports = defineCases({
  description: 'Notes: the daily job prunes notes older than 30 days',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'old-notes-go-and-recent-notes-stay',

      async run({ omega, ctx, firestore, assert }) {
        await firestore.set('notes/prune-old', note('prune-old', 31));
        await firestore.set('notes/prune-recent', note('prune-recent', 29));

        // The runner reads the STAGED job off omega.cwd, and so does this
        const job = require(path.join(omega.cwd, 'hooks', 'cron', 'daily', 'prune-notes.js'));
        const result = await job({ ctx, omega, context: {} });

        assert.ok(result.pruned >= 1, 'the job reports what it deleted');
        assert.equal(await firestore.exists('notes/prune-old'), false, 'a 31-day-old note is pruned');
        assert.ok(await firestore.exists('notes/prune-recent'), 'a 29-day-old note is kept');
      },
    },
  ],
});
