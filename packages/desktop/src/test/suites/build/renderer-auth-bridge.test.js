// Build-layer tests for renderer.js's auth bridge (_wireAuthBridge).
//
// The bridge is pure JS — ipc in, ipc out, no DOM — so it runs in plain Node here
// against the REAL @omega.js/client Auth class (a renderer-layer suite can't: those
// bodies run inside a BrowserWindow with no require).
//
// What's pinned: the sync-request payload carries the signed-in UID. The renderer
// reads it from the client's auth handle, whose accessor is `getUser()` — an
// accessor-name drift here is silent (optional chain → undefined → contextUid null),
// which is exactly how #103 shipped: every renderer boot claimed "signed out" and
// forced main into a full custom-token round-trip it could have skipped.

const path = require('path');

const { WAKEUP_ROUTE } = require('@omega.js/client/modules/request.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

const RENDERER_PATH = path.join(__dirname, '..', '..', '..', 'renderer.js');
const CLIENT_BRIDGE_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'client-bridge.js');

// The real client Auth, wired to a manager stub whose firebaseAuth reports `user`.
// `_resolveFirebaseConfig` returns an apiKey-less blob so listen() settles immediately
// with a null user instead of hanging on a Firebase that isn't there.
async function makeClientAuth(user) {
  const { default: Auth } = await import('@omega.js/client/modules/auth.js');
  return new Auth({
    firebaseAuth: { currentUser: user },
    _resolveFirebaseConfig: () => ({}),
  });
}

// A renderer Manager with the client already booted and an ipc stub whose invoke
// answers are supplied by `handle`. Returns the manager, the recorded invokes,
// the recorded backend requests, and the `timeline` of both in the order the
// bridge produced them — the wakeup ping's whole point is that it is FIRST.
function makeRenderer(auth, handle) {
  const Manager = require(RENDERER_PATH);
  const manager = new Manager();
  const invokes = [];
  const requests = [];
  const timeline = [];

  manager.ipc = {
    on: () => {},
    invoke: async (channel, payload) => {
      invokes.push({ channel, payload });
      timeline.push(channel);
      return handle(channel, payload);
    },
  };
  manager.omega = {
    auth: () => auth,
    request: async (url, options = {}) => {
      requests.push({ url, options });
      timeline.push(options.wakeup ? 'wakeup' : url);
    },
  };

  return { manager, invokes, requests, timeline };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'renderer auth bridge — sync-request context UID',
  tests: [
    {
      name: 'the client auth handle exposes getUser() (and no user() accessor)',
      run: async (ctx) => {
        const auth = await makeClientAuth({ uid: 'uid-abc', email: 'a@b.co' });
        ctx.expect(typeof auth.getUser).toBe('function');
        ctx.expect(auth.getUser().uid).toBe('uid-abc');
        ctx.expect(auth.user).toBeUndefined();
      },
    },
    {
      // #644: main answers a sync-request that needs a token by POSTing
      // /omega/user/token — the app's first backend call, on a function that is
      // cold at every launch. The ping goes out before the bridge waits on
      // anything, so the cold start burns down while auth settles.
      name: 'the bridge warms the backend first, then syncs',
      run: async (ctx) => {
        const auth = await makeClientAuth({ uid: 'uid-abc', email: 'a@b.co' });
        const { manager, requests, timeline } = makeRenderer(auth, () => ({ needsSync: false }));

        await manager._wireAuthBridge();

        ctx.expect(requests.length).toBe(1);
        ctx.expect(requests[0].url).toBe(WAKEUP_ROUTE);
        ctx.expect(requests[0].options.wakeup).toBe(true);
        ctx.expect(timeline[0]).toBe('wakeup');
        ctx.expect(timeline[1]).toBe('desktop:auth:sync-request');
      },
    },
    {
      name: 'sync-request carries the signed-in UID as contextUid',
      run: async (ctx) => {
        const auth = await makeClientAuth({ uid: 'uid-abc', email: 'a@b.co' });
        const { manager, invokes } = makeRenderer(auth, () => ({ needsSync: false }));

        await manager._wireAuthBridge();

        const sync = invokes.find((i) => i.channel === 'desktop:auth:sync-request');
        ctx.expect(sync).toBeDefined();
        ctx.expect(sync.payload.contextUid).toBe('uid-abc');
      },
    },
    {
      name: 'sync-request carries null when nobody is signed in',
      run: async (ctx) => {
        const auth = await makeClientAuth(null);
        const { manager, invokes } = makeRenderer(auth, () => ({ needsSync: false }));

        await manager._wireAuthBridge();

        const sync = invokes.find((i) => i.channel === 'desktop:auth:sync-request');
        ctx.expect(sync.payload.contextUid).toBeNull();
      },
    },
    {
      name: 'matching UIDs short-circuit against the real main-side handler — no token round-trip',
      run: async (ctx) => {
        // Main's side is the REAL client-bridge handler with its auth stubbed to the
        // same user; the only thing under test is whether the renderer's claim matches.
        const bridge = require(CLIENT_BRIDGE_PATH);
        const origAuth = bridge._firebaseAuth;
        bridge._firebaseAuth = { currentUser: { uid: 'uid-abc' } };

        try {
          const auth = await makeClientAuth({ uid: 'uid-abc', email: 'a@b.co' });
          let signIns = 0;
          let signOuts = 0;
          auth.signInWithCustomToken = async () => { signIns++; };
          auth.signOut = async () => { signOuts++; };

          let result = null;
          const { manager } = makeRenderer(auth, async (channel, payload) => {
            if (channel !== 'desktop:auth:sync-request') return null;
            result = await bridge._handleSyncRequest(payload.contextUid);
            return result;
          });

          await manager._wireAuthBridge();

          ctx.expect(result.needsSync).toBe(false);
          // The handler's catch ALSO returns needsSync:false (with an error field), so a
          // null contextUid falling through to the token fetch would pass the line above —
          // the absent error is what proves the uid match short-circuited.
          ctx.expect(result.error).toBeUndefined();
          ctx.expect(signIns).toBe(0);
          ctx.expect(signOuts).toBe(0);
        } finally {
          bridge._firebaseAuth = origAuth;
        }
      },
    },
  ],
});
