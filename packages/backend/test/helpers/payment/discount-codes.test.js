/**
 * Test: what validate() hands the rest of the system
 * ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
 *
 * A validate() result is not just read — `POST /payments/intent` WRITES it into
 * `payments-intents/{orderId}` (`intent/post.js`, the `discount:` field). Firestore
 * refuses a document containing an `undefined` value and firebase-admin throws
 * SYNCHRONOUSLY when it validates the data, with no `ignoreUndefinedProperties`
 * set anywhere in this framework. That throw lands AFTER the provider has already
 * created the real checkout session, so a single undefined-valued key on the result
 * turns every discounted checkout into a 500 with a live session stranded behind it.
 *
 * The rule this pins: a code carries the ONE shape it has (percent or amount) and
 * the result never carries a key whose value is undefined — for every entry in the
 * table, so a code added tomorrow is covered without touching this file.
 *
 * Run: npx omega test framework:helpers/payment/discount-codes
 *
 * firebase-admin's document validation is the real thing here, not a stand-in: it
 * runs synchronously inside set(), before any I/O, so the check needs no live
 * Firestore. The returned promise is deliberately never awaited (the write itself
 * is not the subject) and its rejection is swallowed.
 */
const admin = require('firebase-admin');
const discountCodes = require('../../../dist/manager/libraries/payment/discount-codes.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const { DISCOUNT_CODES, validate } = discountCodes;

/**
 * The runner has already initialized the admin app; outside it a demo project
 * needs no credentials for the synchronous validation this exercises.
 */
function firestore() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'demo-discount-codes' });
  }

  return admin.firestore();
}

/**
 * Ask firebase-admin to accept the document `POST /payments/intent` writes.
 * Returns the synchronous error it refused with, or null.
 */
function refusedBy(discount) {
  const ref = firestore().doc('payments-intents/_test-discount-writable');

  try {
    const write = ref.set({ discount: discount }, { merge: true });

    if (write && typeof write.catch === 'function') {
      write.catch(() => {});
    }

    return null;
  } catch (e) {
    return e;
  }
}

module.exports = defineCases({
  description: 'Discount codes: the validate() contract',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'the-table-is-not-empty-so-this-suite-covers-something',
      async run({ assert }) {
        assert.ok(Object.keys(DISCOUNT_CODES).length > 1, 'Several codes should be seeded');
      },
    },

    {
      name: 'every-code-validates-into-a-firestore-writable-object',
      async run({ assert }) {
        for (const code of Object.keys(DISCOUNT_CODES)) {
          const result = validate(code);

          assert.equal(result.valid, true, `${code} should validate (eligibility is skipped with no user)`);

          const refusal = refusedBy(result);

          assert.equal(
            refusal,
            null,
            `${code}: the intent route writes this object — Firestore refused it: ${refusal?.message?.split('\n')[0]}`
          );
        }
      },
    },

    {
      name: 'a-validated-code-carries-only-the-shape-it-has',
      async run({ assert }) {
        for (const [code, entry] of Object.entries(DISCOUNT_CODES)) {
          const result = validate(code);

          if (entry.percent !== undefined) {
            assert.equal(result.percent, entry.percent, `${code} should report its percent`);
            assert.equal('amount' in result, false, `${code} is percent-based — it must not carry an amount key at all`);
          } else {
            assert.equal(result.amount, entry.amount, `${code} should report its amount`);
            assert.equal('percent' in result, false, `${code} is amount-based — it must not carry a percent key at all`);
          }

          for (const [key, value] of Object.entries(result)) {
            assert.notEqual(value, undefined, `${code}.${key} is undefined — Firestore refuses the whole document`);
          }
        }
      },
    },

    {
      name: 'every-table-entry-declares-exactly-one-shape',
      async run({ assert }) {
        // The readers downstream branch on the shape (the providers' coupon
        // params, the order email's promo line) — a code carrying both, or
        // neither, has no defined meaning at any of them.
        for (const [code, entry] of Object.entries(DISCOUNT_CODES)) {
          const shapes = [entry.percent, entry.amount].filter((v) => v !== undefined);

          assert.equal(shapes.length, 1, `${code} should declare exactly one of percent/amount, found ${shapes.length}`);
          assert.ok(shapes[0] > 0, `${code}'s discount should be a positive number`);
        }
      },
    },

    {
      name: 'a-refused-code-is-writable-too',
      async run({ assert }) {
        // The route only persists a VALID result today, but the invalid shape is
        // one object away from the same write path
        const refusal = refusedBy(validate('NOT-A-REAL-CODE'));

        assert.equal(refusal, null, `An invalid result should be writable too: ${refusal?.message?.split('\n')[0]}`);
      },
    },
  ],
});
