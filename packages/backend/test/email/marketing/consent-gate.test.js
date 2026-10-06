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
const expect = require('../../../dist/vendor/devkit/test/expect.js');
const Marketing = require('../../../dist/omega/libraries/email/marketing/index.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const { isMarketingRevoked } = Marketing;

// Proceed cases must stop at the testing-mode provider guard — never let an ambient
// TEST_EXTENDED_MODE (or provider API keys) in the shell turn this into a live call.
delete process.env.TEST_EXTENDED_MODE;

// ─── isMarketingRevoked(): ONLY the literal 'revoked' blocks ───
const GATE_CASES = [
  { name: 'status revoked', doc: { consent: { marketing: { status: 'revoked' } } }, expected: true },
  { name: 'status granted', doc: { consent: { marketing: { status: 'granted' } } }, expected: false },
  { name: 'status null', doc: { consent: { marketing: { status: null } } }, expected: false },
  { name: 'status missing', doc: { consent: { marketing: {} } }, expected: false },
  { name: 'marketing missing', doc: { consent: {} }, expected: false },
  { name: 'consent missing (legacy user)', doc: { auth: { email: 'legacy@gmail.com' } }, expected: false },
  { name: 'empty doc', doc: {}, expected: false },
  { name: 'null doc (no user)', doc: null, expected: false },
  { name: 'undefined doc', doc: undefined, expected: false },
  { name: 'status REVOKED (case-sensitive literal)', doc: { consent: { marketing: { status: 'REVOKED' } } }, expected: false },
  { name: 'status pending (future enum value)', doc: { consent: { marketing: { status: 'pending' } } }, expected: false },
  { name: 'status true (non-string)', doc: { consent: { marketing: { status: true } } }, expected: false },
];

/**
 * Minimal ctx — just what the Marketing constructor + gate paths read.
 * isTesting() → true so proceed cases stop at the provider guard (no network).
 */
function buildAssistant(admin) {
  const calls = { logs: [], warns: [], errors: [] };

  const ctx = {
    omega: {
      firebase: { admin },
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

module.exports = defineCases({
  description: 'Marketing consent gate (revoked-only skip on add/sync)',
  type: 'group',
  tests: [
    // ─── 1. isMarketingRevoked() semantics ───
    ...GATE_CASES.map(({ name, doc, expected }) => ({
      name: `isMarketingRevoked: ${name}`,

      run() {
        const actual = isMarketingRevoked(doc);

        expect(actual, `Expected ${expected}, got ${actual}`).toBe(expected);
      },
    })),

    // ─── 2. sync() blocks a revoked doc (gate fires before validation/providers) ───
    {
      name: 'sync(): blocks revoked doc',

      async run() {
        const { ctx, calls } = buildAssistant(null);
        const result = await new Marketing(ctx).sync(REVOKED_DOC);

        expect(result.blocked, `Expected blocked='consent', got ${JSON.stringify(result)}`).toBe('consent');
        expect(result.email, `blocked result must include the email, got ${JSON.stringify(result)}`).toBe('revoked.user@gmail.com');
        expect(calls.warns.length, `revoked skip must log a warn, got ${calls.warns.length}`).toBe(1);
      },
    },

    // ─── 3. sync() proceeds on missing consent (legacy user) ───
    {
      name: 'sync(): proceeds on missing consent',

      async run() {
        const { ctx } = buildAssistant(null);
        const result = await new Marketing(ctx).sync(LEGACY_DOC);

        expect(result.blocked, `Expected no block, got ${JSON.stringify(result)}`).toBe(undefined);
      },
    },

    // ─── 4. sync() proceeds on granted consent ───
    {
      name: 'sync(): proceeds on granted consent',

      async run() {
        const { ctx } = buildAssistant(null);
        const result = await new Marketing(ctx).sync(GRANTED_DOC);

        expect(result.blocked, `Expected no block, got ${JSON.stringify(result)}`).toBe(undefined);
      },
    },

    // ─── 5. sync() by uid blocks when the fetched doc is revoked ───
    {
      name: 'sync(uid): blocks revoked fetched doc',

      async run() {
        const { admin, captured } = buildAdmin({ userDoc: REVOKED_DOC });
        const { ctx } = buildAssistant(admin);
        const result = await new Marketing(ctx).sync('revoked-uid');

        expect(result.blocked, `Expected blocked='consent', got ${JSON.stringify(result)}`).toBe('consent');
        expect(captured.docPaths[0], `Expected a users/{uid} fetch, got ${JSON.stringify(captured.docPaths)}`).toBe('users/revoked-uid');
      },
    },

    // ─── 6. add() blocks when the email maps to a revoked user ───
    {
      name: 'add(): blocks revoked user by email',

      async run() {
        const { admin, captured } = buildAdmin({ userDoc: REVOKED_DOC });
        const { ctx, calls } = buildAssistant(admin);
        const result = await new Marketing(ctx).add({ email: 'revoked.user@gmail.com' });

        expect(result.blocked, `Expected blocked='consent', got ${JSON.stringify(result)}`).toBe('consent');
        expect(result.email, `blocked result must include the email, got ${JSON.stringify(result)}`).toBe('revoked.user@gmail.com');
        expect(calls.warns.length, `revoked skip must log a warn, got ${calls.warns.length}`).toBe(1);

        const query = captured.queries[0];

        expect(query
            && query.collection === 'users'
            && query.field === 'auth.email'
            && query.op === '=='
            && query.value === 'revoked.user@gmail.com', `add() must look up users by auth.email (the webhook-provider query), got ${JSON.stringify(query)}`).toBeTruthy();
      },
    },

    // ─── 7. add() normalizes the email for the lookup ───
    {
      name: 'add(): lookup trims + lowercases the email',

      async run() {
        const { admin, captured } = buildAdmin({ userDoc: null });
        const { ctx } = buildAssistant(admin);
        await new Marketing(ctx).add({ email: '  Revoked.User@GMAIL.com  ' });

        expect(captured.queries[0]?.value, `Got ${JSON.stringify(captured.queries[0])}`).toBe('revoked.user@gmail.com');
      },
    },

    // ─── 8. add() proceeds when no user doc exists (pure newsletter contact) ───
    {
      name: 'add(): proceeds when no user doc exists',

      async run() {
        const { admin } = buildAdmin({ userDoc: null });
        const { ctx } = buildAssistant(admin);
        const result = await new Marketing(ctx).add({ email: 'newsletter.reader@gmail.com' });

        expect(result.blocked, `Expected no block, got ${JSON.stringify(result)}`).toBe(undefined);
      },
    },

    // ─── 9. add() proceeds when the matched user has no consent field (legacy) ───
    {
      name: 'add(): proceeds on legacy user (no consent field)',

      async run() {
        const { admin } = buildAdmin({ userDoc: LEGACY_DOC });
        const { ctx } = buildAssistant(admin);
        const result = await new Marketing(ctx).add({ email: 'legacy.user@gmail.com' });

        expect(result.blocked, `Expected no block, got ${JSON.stringify(result)}`).toBe(undefined);
      },
    },

    // ─── 10. add() fails open when the lookup errors ───
    {
      name: 'add(): fails open on lookup error',

      async run() {
        const { admin } = buildAdmin({ failLookup: true });
        const { ctx, calls } = buildAssistant(admin);
        const result = await new Marketing(ctx).add({ email: 'someone@gmail.com' });

        expect(result.blocked, `Expected no block, got ${JSON.stringify(result)}`).toBe(undefined);
        expect(calls.errors.length, `lookup error must be logged, got ${calls.errors.length}`).toBe(1);
      },
    },
  ],
});
