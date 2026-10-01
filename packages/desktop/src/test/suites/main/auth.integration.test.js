// Integration tests for lib/auth.js (`omega.auth`): actually hits Firebase.
//
// The SIGN-IN proof is the root desktop auth lane (scripts/e2e-desktop-auth.js):
// a persona the backend emulator seeds, signed in through the real deep link.
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
  description: 'auth (main, integration)',
  skip: skipReason || false,
  tests: [
    {
      name: 'firebase loaded (cloud.config present in test config)',
      run: (ctx) => {
        if (!ctx.omega.auth._firebaseAuth) {
          ctx.skip('cloud.config not set in default config — set one in src/defaults/config/omega.json5 to run');
        }
        ctx.expect(ctx.omega.auth._firebaseAuth).toBeTruthy();
      },
    },
  ],
});
