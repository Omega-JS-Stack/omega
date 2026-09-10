/**
 * Test: helpers/safe-compare.js — constant-time secret comparison
 *
 * Run: npx omega test backend:helpers/safe-compare
 *
 * safeCompare is the ONE door every secret check goes through (admin keys,
 * webhook keys). Two contracts:
 *   - Correctness: true ONLY for two identical non-empty strings. Anything
 *     absent, empty, or non-string is false — a missing env var must never
 *     compare equal to a missing header.
 *   - Constant time: both sides are reduced to a fixed-length SHA-256 digest
 *     before crypto.timingSafeEqual, so DIFFERENT-LENGTH inputs must compare
 *     without throwing (timingSafeEqual itself rejects unequal buffers).
 */
const safeCompare = require('../../dist/manager/helpers/safe-compare.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'safeCompare() constant-time secret comparison',
  type: 'group',

  tests: [
    // ─── Equality ───

    {
      name: 'identical-strings-match',
      async run({ assert }) {
        assert.equal(safeCompare('sk_live_abc123', 'sk_live_abc123'), true);
        assert.equal(safeCompare('a', 'a'), true);
      },
    },

    {
      name: 'different-strings-do-not-match',
      async run({ assert }) {
        assert.equal(safeCompare('sk_live_abc123', 'sk_live_abc124'), false);
        assert.equal(safeCompare('a', 'b'), false);
      },
    },

    {
      name: 'comparison-is-case-and-whitespace-sensitive',
      async run({ assert }) {
        assert.equal(safeCompare('Secret', 'secret'), false);
        assert.equal(safeCompare('secret ', 'secret'), false);
        assert.equal(safeCompare('\nsecret', 'secret'), false);
      },
    },

    // ─── The length hazard: the digest is what makes this safe ───

    {
      name: 'different-lengths-return-false-without-throwing',
      async run({ assert }) {
        // A raw timingSafeEqual on these buffers would throw.
        assert.equal(safeCompare('short', 'a-much-longer-secret-value'), false);
        assert.equal(safeCompare('a-much-longer-secret-value', 'short'), false);
        assert.equal(safeCompare('prefix', 'prefix-and-more'), false);
      },
    },

    {
      name: 'a-matching-prefix-is-still-false',
      async run({ assert }) {
        assert.equal(safeCompare('sk_live_', 'sk_live_abc123'), false);
        assert.equal(safeCompare('sk_live_abc123', 'sk_live_'), false);
      },
    },

    // ─── Absent / empty / wrong-type: the missing-env-var hazard ───

    {
      name: 'empty-strings-never-match-even-each-other',
      async run({ assert }) {
        assert.equal(safeCompare('', ''), false);
        assert.equal(safeCompare('', 'secret'), false);
        assert.equal(safeCompare('secret', ''), false);
      },
    },

    {
      name: 'undefined-and-null-never-match',
      async run({ assert }) {
        assert.equal(safeCompare(undefined, undefined), false);
        assert.equal(safeCompare(null, null), false);
        assert.equal(safeCompare(undefined, 'secret'), false);
        assert.equal(safeCompare('secret', undefined), false);
        assert.equal(safeCompare(null, 'secret'), false);
      },
    },

    {
      name: 'non-string-inputs-never-match',
      async run({ assert }) {
        assert.equal(safeCompare(123, 123), false);
        assert.equal(safeCompare('123', 123), false);
        assert.equal(safeCompare(true, true), false);
        assert.equal(safeCompare({}, {}), false);
        assert.equal(safeCompare(['a'], ['a']), false);
        assert.equal(safeCompare(Buffer.from('secret'), 'secret'), false);
      },
    },

    // ─── Unicode: the digest works on bytes, not code units ───

    {
      name: 'unicode-secrets-compare-correctly',
      async run({ assert }) {
        assert.equal(safeCompare('sécret-🔑', 'sécret-🔑'), true);
        assert.equal(safeCompare('sécret-🔑', 'secret-🔑'), false);
      },
    },
  ],
});
