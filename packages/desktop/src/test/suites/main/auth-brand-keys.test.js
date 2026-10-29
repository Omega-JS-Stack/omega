// Main-process test for lib/auth.js's desktop:auth:account-resolved intake: a
// brand's own top-level key on the pushed document survives into main's `auth.user`.

const { User } = require('@omega.js/account');
const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'auth brand keys (main)',
  tests: [
    {
      name: 'account-resolved intake: a brand key on the pushed document lands on auth.user',
      run: async (ctx) => {
        const omega = ctx.omega;
        const auth = omega.auth;
        const origAuth = auth._firebaseAuth;
        const origBroadcast = omega.ipc.broadcast;
        omega.ipc.broadcast = () => {};

        // What a signed-in renderer pushes: its stored document, here carrying a
        // key the framework does not own beside the ones it does
        const IDENTITY = { uid: 'u-brand', email: 'brand@y.z', displayName: 'B', photoURL: null, emailVerified: true };
        const DOCUMENT = {
          ...new User({ subscription: { product: { id: 'premium' }, status: 'active' } }, IDENTITY).toJSON(),
          notes: { created: 3 },
        };

        try {
          auth._firebaseAuth = { currentUser: { uid: 'u-brand', email: 'brand@y.z' } };
          const res = await omega.ipc.invoke('desktop:auth:account-resolved', { uid: 'u-brand', document: DOCUMENT, identity: IDENTITY });

          ctx.expect(res.accepted).toBe(true);
          ctx.expect(auth.user.notes).toEqual({ created: 3 });
          ctx.expect(auth.user.toJSON().notes.created).toBe(3);
          ctx.expect(auth.user.plan, 'the framework keys still resolve beside it').toBe('premium');
        } finally {
          // A case that failed midway still leaves main signed out for the suites after it
          if (auth.user.authenticated) auth._handleAuthStateChange(null);
          auth._firebaseAuth = origAuth;
          omega.ipc.broadcast = origBroadcast;
        }
      },
    },
  ],
});
