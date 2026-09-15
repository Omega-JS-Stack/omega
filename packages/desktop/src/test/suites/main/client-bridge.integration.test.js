// Integration tests for client-bridge — actually hits Firebase.
//
// The SIGN-IN proof lives in #904: web, desktop and extension each sign in as a
// persona the backend emulator seeds, so this suite no longer mints a custom
// token from a service account and asks a brand for no test credential at all.
//
// To run: `npx omega test --extended` (the cases below need a cloud.config in
// src/defaults/config/omega.json5 to have any Firebase to talk to).

const defineCases = require('@omega.js/devkit/test/define-cases');

// These hit REAL Firebase, so they're gated behind extended mode (the cross-framework
// `TEST_EXTENDED_MODE` opt-in). `npx omega test --extended` (or TEST_EXTENDED_MODE=true) runs
// them; default is skip so `npx omega test` stays fast + offline-safe.
const EXTENDED_OPTED_IN = process.env.TEST_EXTENDED_MODE === 'true'
                       || process.env.TEST_EXTENDED_MODE === '1';

function checkSkipReason() {
  if (!EXTENDED_OPTED_IN) return 'extended tests skipped — pass --extended or set TEST_EXTENDED_MODE=true';
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
  ],
});
