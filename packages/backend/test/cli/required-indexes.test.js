/**
 * Test: required Firestore indexes cover the queries @omega.js/backend runs
 * ([#225](https://github.com/Omega-JS-Stack/omega/issues/225)).
 *
 * `required-indexes.js` is the SSOT `omega setup` materializes into every
 * brand's firestore.indexes.json. A framework query with no entry there works
 * only in brands where someone hand-created the index — the PayPal expiry cron
 * shipped that way and failed on any fresh brand.
 *
 * Run: npx omega test backend:cli/required-indexes
 */
const requiredIndexes = require('../../src/cli/commands/setup-tests/helpers/required-indexes.js');

/** The entry serving a composite query, matched on collection + field paths in order */
function findIndex(collectionGroup, fieldPaths) {
  return requiredIndexes.find((index) => {
    if (index.collectionGroup !== collectionGroup) {
      return false;
    }

    const paths = index.fields.map((f) => f.fieldPath);

    return paths.length === fieldPaths.length && paths.every((p, i) => p === fieldPaths[i]);
  });
}

module.exports = {
  description: 'Required Firestore indexes SSOT',
  type: 'group',

  tests: [
    {
      name: 'covers-the-paypal-expiry-cron-query',
      async run({ assert }) {
        // events/cron/daily/expire-paypal-cancellations.js queries users on two
        // equalities: subscription.payment.provider + subscription.cancellation.pending
        const index = findIndex('users', ['subscription.payment.provider', 'subscription.cancellation.pending']);

        assert.ok(index, 'The PayPal expiry cron query needs a composite index entry');
        assert.equal(index.queryScope, 'COLLECTION', 'The cron queries one collection, not a group');
        assert.equal(index.fields[0].order, 'ASCENDING', 'An equality filter indexes ascending');
        assert.equal(index.fields[1].order, 'ASCENDING', 'An equality filter indexes ascending');
      },
    },

    {
      name: 'every-entry-is-unique',
      async run({ assert }) {
        // The setup fix rewrites the required entries to the top of each brand
        // file and dedupes against them — two identical SSOT entries would make
        // its own no-duplicates check unsatisfiable
        const seen = new Set();

        for (const index of requiredIndexes) {
          const key = `${index.collectionGroup}:${index.fields.map((f) => `${f.fieldPath}/${f.order || f.arrayConfig}`).join(',')}`;

          assert.equal(seen.has(key), false, `Duplicate required index: ${key}`);
          seen.add(key);
        }
      },
    },
  ],
};
