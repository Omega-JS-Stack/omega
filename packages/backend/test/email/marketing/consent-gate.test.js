/**
 * Consent gate test — verifies Marketing.add()/sync() skip users whose
 * consent.marketing.status is the literal string 'revoked' (and ONLY then).
 *
 * Plain-node control-flow test (no emulator, no providers, no network):
 * - isMarketingRevoked() — the pure gate semantic (revoked-only skip).
 * - sync() — gate fires after doc resolution, BEFORE validation/providers, so a
 *   revoked doc returns { blocked: 'consent', email } with zero I/O. Proceed cases
 *   stop at the testing-mode provider guard (ctx.isTesting() → true here).
 * - add() — by-email lookup runs through a minimal in-memory firestore stand-in to
 *   exercise add()'s wiring (block on revoked, proceed on no-user, fail open on
 *   lookup error). The emulator suites (test/routes/marketing/*) remain the
 *   integration surface for the real Firestore paths.
 */
const assert = require('node:assert');
const Marketing = require('../../../src/manager/libraries/email/marketing/index.js');

const { isMarketingRevoked } = Marketing;

// Proceed cases must stop at the testing-mode provider guard — never let an ambient
// TEST_EXTENDED_MODE (or provider API keys) in the shell turn this into a live call.
delete process.env.TEST_EXTENDED_MODE;

// ─── isMarketingRevoked(): ONLY the literal 'revoked' blocks ───
const GATE_CASES = [
  { name: 'status revoked', doc: { consent: { marketing: { status: 'revoked' } } }, expect: true },
  { name: 'status granted', doc: { consent: { marketing: { status: 'granted' } } }, expect: false },
  { name: 'status null', doc: { consent: { marketing: { status: null } } }, expect: false },
  { name: 'status missing', doc: { consent: { marketing: {} } }, expect: false },
  { name: 'marketing missing', doc: { consent: {} }, expect: false },
  { name: 'consent missing (legacy user)', doc: { auth: { email: 'legacy@gmail.com' } }, expect: false },
  { name: 'empty doc', doc: {}, expect: false },
  { name: 'null doc (no user)', doc: null, expect: false },
  { name: 'undefined doc', doc: undefined, expect: false },
  { name: 'status REVOKED (case-sensitive literal)', doc: { consent: { marketing: { status: 'REVOKED' } } }, expect: false },
  { name: 'status pending (future enum value)', doc: { consent: { marketing: { status: 'pending' } } }, expect: false },
  { name: 'status true (non-string)', doc: { consent: { marketing: { status: true } } }, expect: false },
];

/**
 * Minimal ctx — just what the Marketing constructor + gate paths read.
 * isTesting() → true so proceed cases stop at the provider guard (no network).
 */
function buildAssistant(admin) {
  const calls = { logs: [], warns: [], errors: [] };

  const ctx = {
    Manager: {
      libraries: { admin },
      config: {},
    },
    isTesting: () => true,
    log: (...args) => calls.logs.push(args),
    warn: (...args) => calls.warns.push(args),
    error: (...args) => calls.errors.push(args),
  };

  return { ctx, calls };
}

/**
 * Minimal in-memory firestore stand-in for add()'s by-email lookup and sync()'s
 * by-uid fetch. `userDoc: null` → empty query result / nonexistent doc.
 * `failLookup: true` → the query get() rejects (exercises the fail-open path).
 */
function buildAdmin({ userDoc = null, failLookup = false } = {}) {
  const captured = { queries: [], docPaths: [] };

  const admin = {
    firestore: () => ({
      collection: (name) => ({
        where: (field, op, value) => {
          captured.queries.push({ collection: name, field, op, value });
          return {
            limit: () => ({
              get: async () => {
                if (failLookup) {
                  throw new Error('firestore unavailable');
                }
                return userDoc
                  ? { empty: false, docs: [{ id: 'test-uid', data: () => userDoc }] }
                  : { empty: true, docs: [] };
              },
            }),
          };
        },
      }),
      doc: (path) => {
        captured.docPaths.push(path);
        return {
          get: async () => ({
            exists: !!userDoc,
            data: () => userDoc,
          }),
        };
      },
    }),
  };

  return { admin, captured };
}

const REVOKED_DOC = {
  auth: { email: 'revoked.user@gmail.com' },
  consent: { marketing: { status: 'revoked' } },
};

const GRANTED_DOC = {
  auth: { email: 'granted.user@gmail.com' },
  consent: { marketing: { status: 'granted' } },
};

const LEGACY_DOC = {
  auth: { email: 'legacy.user@gmail.com' },
  // No consent field at all — pre-consent-system user, must keep syncing
};

module.exports = {
  description: 'Marketing consent gate (revoked-only skip on add/sync)',
  type: 'group',
  tests: [
    // ─── 1. isMarketingRevoked() semantics ───
    ...GATE_CASES.map(({ name, doc, expect }) => ({
      name: `isMarketingRevoked: ${name}`,

      run() {
        const actual = isMarketingRevoked(doc);

        assert.strictEqual(actual, expect, `Expected ${expect}, got ${actual}`);
      },
    })),

    // ─── 2. sync() blocks a revoked doc (gate fires before validation/providers) ───
    {
      name: 'sync(): blocks revoked doc',

      async run() {
        const { ctx, calls } = buildAssistant(null);
        const result = await new Marketing(ctx).sync(REVOKED_DOC);

        assert.strictEqual(result.blocked, 'consent', `Expected blocked='consent', got ${JSON.stringify(result)}`);
        assert.strictEqual(result.email, 'revoked.user@gmail.com', `blocked result must include the email, got ${JSON.stringify(result)}`);
        assert.strictEqual(calls.warns.length, 1, `revoked skip must log a warn, got ${calls.warns.length}`);
      },
    },

    // ─── 3. sync() proceeds on missing consent (legacy user) ───
    {
      name: 'sync(): proceeds on missing consent',

      async run() {
        const { ctx } = buildAssistant(null);
        const result = await new Marketing(ctx).sync(LEGACY_DOC);

        assert.strictEqual(result.blocked, undefined, `Expected no block, got ${JSON.stringify(result)}`);
      },
    },

    // ─── 4. sync() proceeds on granted consent ───
    {
      name: 'sync(): proceeds on granted consent',

      async run() {
        const { ctx } = buildAssistant(null);
        const result = await new Marketing(ctx).sync(GRANTED_DOC);

        assert.strictEqual(result.blocked, undefined, `Expected no block, got ${JSON.stringify(result)}`);
      },
    },

    // ─── 5. sync() by uid blocks when the fetched doc is revoked ───
    {
      name: 'sync(uid): blocks revoked fetched doc',

      async run() {
        const { admin, captured } = buildAdmin({ userDoc: REVOKED_DOC });
        const { ctx } = buildAssistant(admin);
        const result = await new Marketing(ctx).sync('revoked-uid');

        assert.strictEqual(result.blocked, 'consent', `Expected blocked='consent', got ${JSON.stringify(result)}`);
        assert.strictEqual(captured.docPaths[0], 'users/revoked-uid', `Expected a users/{uid} fetch, got ${JSON.stringify(captured.docPaths)}`);
      },
    },

    // ─── 6. add() blocks when the email maps to a revoked user ───
    {
      name: 'add(): blocks revoked user by email',

      async run() {
        const { admin, captured } = buildAdmin({ userDoc: REVOKED_DOC });
        const { ctx, calls } = buildAssistant(admin);
        const result = await new Marketing(ctx).add({ email: 'revoked.user@gmail.com' });

        assert.strictEqual(result.blocked, 'consent', `Expected blocked='consent', got ${JSON.stringify(result)}`);
        assert.strictEqual(result.email, 'revoked.user@gmail.com', `blocked result must include the email, got ${JSON.stringify(result)}`);
        assert.strictEqual(calls.warns.length, 1, `revoked skip must log a warn, got ${calls.warns.length}`);

        const query = captured.queries[0];

        assert.ok(
          query
            && query.collection === 'users'
            && query.field === 'auth.email'
            && query.op === '=='
            && query.value === 'revoked.user@gmail.com',
          `add() must look up users by auth.email (the webhook-processor query), got ${JSON.stringify(query)}`,
        );
      },
    },

    // ─── 7. add() normalizes the email for the lookup ───
    {
      name: 'add(): lookup trims + lowercases the email',

      async run() {
        const { admin, captured } = buildAdmin({ userDoc: null });
        const { ctx } = buildAssistant(admin);
        await new Marketing(ctx).add({ email: '  Revoked.User@GMAIL.com  ' });

        assert.strictEqual(captured.queries[0]?.value, 'revoked.user@gmail.com', `Got ${JSON.stringify(captured.queries[0])}`);
      },
    },

    // ─── 8. add() proceeds when no user doc exists (pure newsletter contact) ───
    {
      name: 'add(): proceeds when no user doc exists',

      async run() {
        const { admin } = buildAdmin({ userDoc: null });
        const { ctx } = buildAssistant(admin);
        const result = await new Marketing(ctx).add({ email: 'newsletter.reader@gmail.com' });

        assert.strictEqual(result.blocked, undefined, `Expected no block, got ${JSON.stringify(result)}`);
      },
    },

    // ─── 9. add() proceeds when the matched user has no consent field (legacy) ───
    {
      name: 'add(): proceeds on legacy user (no consent field)',

      async run() {
        const { admin } = buildAdmin({ userDoc: LEGACY_DOC });
        const { ctx } = buildAssistant(admin);
        const result = await new Marketing(ctx).add({ email: 'legacy.user@gmail.com' });

        assert.strictEqual(result.blocked, undefined, `Expected no block, got ${JSON.stringify(result)}`);
      },
    },

    // ─── 10. add() fails open when the lookup errors ───
    {
      name: 'add(): fails open on lookup error',

      async run() {
        const { admin } = buildAdmin({ failLookup: true });
        const { ctx, calls } = buildAssistant(admin);
        const result = await new Marketing(ctx).add({ email: 'someone@gmail.com' });

        assert.strictEqual(result.blocked, undefined, `Expected no block, got ${JSON.stringify(result)}`);
        assert.strictEqual(calls.errors.length, 1, `lookup error must be logged, got ${calls.errors.length}`);
      },
    },
  ],
};
