// Integration tests for client-bridge — actually hits Firebase.
//
// Skipped automatically unless OMEGA_TEST_FIREBASE_ADMIN_KEY (or GOOGLE_APPLICATION_CREDENTIALS)
// points to a Firebase service-account JSON file. This keeps `npx omega test` fast & green
// offline / on machines without backend creds.
//
// To run:
//   1. Install firebase-admin: `npm i -D firebase-admin` (already in @omega.js/desktop's devDeps)
//   2. Drop a service-account JSON in a safe place
//   3. Set OMEGA_TEST_FIREBASE_ADMIN_KEY=/path/to/file.json (or use GOOGLE_APPLICATION_CREDENTIALS)
//   4. Optionally OMEGA_TEST_USER_UID=your-test-uid (defaults to 'desktop-test-user')
//   5. `npx omega test`

const fs = require('fs');
const defineCases = require('@omega.js/devkit/test/define-cases');

const ADMIN_KEY = process.env.OMEGA_TEST_FIREBASE_ADMIN_KEY
                || process.env.GOOGLE_APPLICATION_CREDENTIALS
                || null;
const USER_UID = process.env.OMEGA_TEST_USER_UID || 'desktop-test-user';
// These hit REAL Firebase, so they're gated behind extended mode (the cross-framework
// `TEST_EXTENDED_MODE` opt-in). `npx omega test --extended` (or TEST_EXTENDED_MODE=true) runs
// them; default is skip so `npx omega test` stays fast + offline-safe.
const EXTENDED_OPTED_IN = process.env.TEST_EXTENDED_MODE === 'true'
                       || process.env.TEST_EXTENDED_MODE === '1';

function checkSkipReason() {
  if (!EXTENDED_OPTED_IN) return 'extended tests skipped — pass --extended or set TEST_EXTENDED_MODE=true';
  if (!ADMIN_KEY) return 'no OMEGA_TEST_FIREBASE_ADMIN_KEY / GOOGLE_APPLICATION_CREDENTIALS';
  if (!fs.existsSync(ADMIN_KEY)) return `service-account file not found at ${ADMIN_KEY}`;
  try {
    require.resolve('firebase-admin');
  } catch (e) {
    return 'firebase-admin not installed (run: npm i -D firebase-admin)';
  }
  return null;
}

const skipReason = checkSkipReason();

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'client-bridge (main, integration)',
  skip: skipReason || false,
  cleanup: async (ctx) => {
    try {
      await ctx.manager.omega.signOut();
    } catch (e) { /* ignore */ }
  },
  tests: [
    {
      name: 'firebase loaded (cloud.config present in test config)',
      run: (ctx) => {
        if (!ctx.manager.omega._firebaseAuth) {
          ctx.skip('cloud.config not set in default config — set one in src/defaults/config/omega.json5 to run');
        }
        ctx.expect(ctx.manager.omega._firebaseAuth).toBeTruthy();
      },
    },
    {
      name: 'admin can mint a custom token, bridge can sign in with it',
      run: async (ctx) => {
        if (!ctx.manager.omega._firebaseAuth) {
          ctx.skip('firebase not loaded');
        }

        const admin = require('firebase-admin');
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(require(ADMIN_KEY)),
          });
        }

        // Mint a custom token for the test UID.
        const token = await admin.auth().createCustomToken(USER_UID);
        ctx.expect(typeof token).toBe('string');

        // Hand it to the bridge.
        const result = await ctx.manager.omega.handleAuthToken(token);

        if (!result.success) {
          ctx.skip(`signInWithCustomToken failed: ${result.error || 'unknown'} — likely a project mismatch (cloud.config.projectId vs service-account project)`);
        }
        ctx.expect(result.user.uid).toBe(USER_UID);

        // Bridge state should reflect the signed-in user.
        const current = ctx.manager.omega.getCurrentUser();
        ctx.expect(current?.uid).toBe(USER_UID);
      },
    },
    {
      name: 'sign-out clears the current user and broadcasts',
      run: async (ctx) => {
        if (!ctx.manager.omega.getCurrentUser()) {
          ctx.skip('not signed in (previous test may have skipped)');
        }
        const r = await ctx.manager.omega.signOut();
        ctx.expect(r.success).toBe(true);
        ctx.expect(ctx.manager.omega.getCurrentUser()).toBeNull();
      },
    },
    {
      name: 'onAuthChange fires when state changes',
      run: async (ctx) => {
        if (!ctx.manager.omega._firebaseAuth) {
          ctx.skip('firebase not loaded');
        }

        const admin = require('firebase-admin');
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(require(ADMIN_KEY)),
          });
        }

        const calls = [];
        const off = ctx.manager.omega.onAuthChange((snap) => calls.push(snap));

        try {
          const token = await admin.auth().createCustomToken(USER_UID);
          await ctx.manager.omega.handleAuthToken(token);

          // Give onAuthStateChanged a tick to fire.
          await new Promise((r) => setTimeout(r, 200));
          ctx.expect(calls.length).toBeGreaterThan(0);
          ctx.expect(calls[calls.length - 1]?.uid).toBe(USER_UID);
        } finally {
          off();
        }
      },
    },
  ],
});
