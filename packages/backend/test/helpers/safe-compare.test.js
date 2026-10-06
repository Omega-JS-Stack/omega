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
const safeCompare = require('../../dist/omega/helpers/safe-compare.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'safeCompare() constant-time secret comparison',
  type: 'group',

  tests: [
    // ─── Equality ───

    {
      name: 'identical-strings-match',
      async run({ expect }) {
        expect(safeCompare('sk_live_abc123', 'sk_live_abc123')).toBe(true);
        expect(safeCompare('a', 'a')).toBe(true);
      },
    },

    {
      name: 'different-strings-do-not-match',
      async run({ expect }) {
        expect(safeCompare('sk_live_abc123', 'sk_live_abc124')).toBe(false);
        expect(safeCompare('a', 'b')).toBe(false);
      },
    },

    {
      name: 'comparison-is-case-and-whitespace-sensitive',
      async run({ expect }) {
        expect(safeCompare('Secret', 'secret')).toBe(false);
        expect(safeCompare('secret ', 'secret')).toBe(false);
        expect(safeCompare('\nsecret', 'secret')).toBe(false);
      },
    },

    // ─── The length hazard: the digest is what makes this safe ───

    {
      name: 'different-lengths-return-false-without-throwing',
      async run({ expect }) {
        // A raw timingSafeEqual on these buffers would throw.
        expect(safeCompare('short', 'a-much-longer-secret-value')).toBe(false);
        expect(safeCompare('a-much-longer-secret-value', 'short')).toBe(false);
        expect(safeCompare('prefix', 'prefix-and-more')).toBe(false);
      },
    },

    {
      name: 'a-matching-prefix-is-still-false',
      async run({ expect }) {
        expect(safeCompare('sk_live_', 'sk_live_abc123')).toBe(false);
        expect(safeCompare('sk_live_abc123', 'sk_live_')).toBe(false);
      },
    },

    // ─── Absent / empty / wrong-type: the missing-env-var hazard ───

    {
      name: 'empty-strings-never-match-even-each-other',
      async run({ expect }) {
        expect(safeCompare('', '')).toBe(false);
        expect(safeCompare('', 'secret')).toBe(false);
        expect(safeCompare('secret', '')).toBe(false);
      },
    },

    {
      name: 'undefined-and-null-never-match',
      async run({ expect }) {
        expect(safeCompare(undefined, undefined)).toBe(false);
        expect(safeCompare(null, null)).toBe(false);
        expect(safeCompare(undefined, 'secret')).toBe(false);
        expect(safeCompare('secret', undefined)).toBe(false);
        expect(safeCompare(null, 'secret')).toBe(false);
      },
    },

    {
      name: 'non-string-inputs-never-match',
      async run({ expect }) {
        expect(safeCompare(123, 123)).toBe(false);
        expect(safeCompare('123', 123)).toBe(false);
        expect(safeCompare(true, true)).toBe(false);
        expect(safeCompare({}, {})).toBe(false);
        expect(safeCompare(['a'], ['a'])).toBe(false);
        expect(safeCompare(Buffer.from('secret'), 'secret')).toBe(false);
      },
    },

    // ─── Unicode: the digest works on bytes, not code units ───

    {
      name: 'unicode-secrets-compare-correctly',
      async run({ expect }) {
        expect(safeCompare('sécret-🔑', 'sécret-🔑')).toBe(true);
        expect(safeCompare('sécret-🔑', 'secret-🔑')).toBe(false);
      },
    },
  ],
});
