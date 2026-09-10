/**
 * The daily usage reset cron (`events/cron/daily/reset-usage.js`)
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
 *
 * The promises, all of them things a user is silently punished by when broken:
 *  - EVERY counter block under `usage` is reset, whatever its key. Catalog
 *    membership is not the test: the framework's own anti-abuse gates count on
 *    the user doc with an explicit limit and carry no catalog entry, so a
 *    catalog-only sweep left them growing forever and the user permanently
 *    refused after five email-preference changes;
 *  - `usage.overrides` is NEVER touched — an admin granted those credits and a
 *    reset is not a revoke;
 *  - the day counter resets every day, the month counter only on the 1st;
 *  - one write per user, however many counters moved.
 *
 * Plain-node unit test (no emulator): the cron's collaborators are the
 * collection walk and the document write, and both are recorded here rather
 * than performed — which is what makes the resulting patch assertable.
 */
const assert = require('node:assert');

const resetUsage = require('../../dist/manager/events/cron/daily/reset-usage.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const CATALOG = {
  saves: { name: 'Saves', usage: {} },
  support: { name: 'Priority support' },
};

// One user carrying three kinds of key under `usage`: a catalog feature, a
// framework gate the catalog never defines, and the overrides map.
function userDoc() {
  return {
    saves: { monthly: 40, daily: 4, total: 900 },
    'email-preferences': { monthly: 5, daily: 5, total: 12 },
    overrides: { saves: 500 },
  };
}

/** Run the whole cron over one synthetic user and hand back what it wrote. */
async function runCron() {
  const writes = [];
  const usage = userDoc();

  const doc = {
    id: 'user-647',
    ref: { update: async (patch) => writes.push(patch) },
    data: () => ({ usage: usage }),
  };

  const Manager = {
    config: { features: CATALOG },
    storage: () => ({ setState: () => ({ write: () => {} }) }),
    Utilities: () => ({
      // Every query answers with the one user — the cron dedupes by doc id, so
      // a user found by several field paths is still written once
      iterateCollection: async (handler) => handler({ docs: [doc] }),
    }),
  };

  const ctx = { log: () => {}, warn: () => {}, error: () => {}, report: () => {} };
  const libraries = { admin: { firestore: () => ({ recursiveDelete: async () => {}, collection: () => ({}) }) } };

  await resetUsage({ Manager, ctx, context: {}, libraries });

  return { writes, usage };
}

module.exports = defineCases({
  description: 'Daily usage reset cron',
  type: 'group',

  tests: [
    {
      name: 'every counter block resets — a counter the catalog never defined included',

      async run() {
        const { writes } = await runCron();

        assert.equal(writes.length, 1, 'one write per user, however many counters moved');

        const written = writes[0].usage;

        assert.equal(written.saves.daily, 0, 'the catalog feature reset');
        assert.equal(
          written['email-preferences'].daily,
          0,
          'and so did the framework gate the catalog never defines — the counter that used to grow forever',
        );
      },
    },

    {
      name: 'the month counter survives a day that is not the 1st',

      async run() {
        const { writes } = await runCron();
        const written = writes[0].usage;
        const isFirst = new Date().getDate() === 1;

        assert.equal(written.saves.monthly, isFirst ? 0 : 40, 'the month resets on the 1st and only then');
        assert.equal(written.saves.total, 900, 'the all-time counter never resets');
      },
    },

    {
      name: 'overrides are never touched — a reset is not a revoke',

      async run() {
        const { writes } = await runCron();

        assert.deepEqual(writes[0].usage.overrides, { saves: 500 }, 'the granted credits survive the sweep');
      },
    },
  ],
});
