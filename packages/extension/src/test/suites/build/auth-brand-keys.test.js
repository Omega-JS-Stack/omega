// Build-layer test for lib/background-auth.js: a brand's own top-level key on
// the document a page pushes survives into the background's `auth.user`.
//
// Loaded for real the way omega.test.js loads the background: src/omega.js and
// lib/background-auth.js, with `chrome.runtime` present while they load
// (utils/chrome-runtime.js).

const defineCases = require('@omega.js/devkit/test/define-cases');
const { withRuntime, importWithRuntime } = require('../../utils/chrome-runtime.js');

const IDENTITY = { uid: 'user-brand', email: 'brand@example.com', displayName: 'Brand', photoURL: null, emailVerified: true };
const DOCUMENT = { subscription: { product: { id: 'premium' }, status: 'active' }, notes: { created: 3 } };

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'Background auth: a brand\'s own user keys',
  timeout: 60000,
  tests: [
    {
      name: 'background auth.user keeps a brand key of the pushed document',
      run: async (ctx) => {
        const { Omega } = await importWithRuntime('omega.js');
        const { BackgroundAuth } = await importWithRuntime('lib', 'background-auth.js');

        const auth = new BackgroundAuth(withRuntime(() => new Omega('background')));

        // The worker's session, signed in as the page's uid. The one seam: a real
        // signed-in worker session needs the auth emulator, which the
        // e2e-extension lane drives.
        auth._firebaseAuth = { currentUser: { uid: IDENTITY.uid, email: IDENTITY.email } };

        ctx.expect(await auth.handleSyncAuth({ ...IDENTITY, document: DOCUMENT })).toEqual({ needsSync: false });
        ctx.expect(auth.user.constructor.name).toBe('User');
        ctx.expect(auth.user.notes).toEqual({ created: 3 });
        ctx.expect(auth.user.toJSON().notes.created).toBe(3);
        ctx.expect(auth.user.plan, 'the framework keys still resolve beside it').toBe('premium');

        auth.handleAuthStateChange(null);
      },
    },
  ],
});
