// Build-layer tests for the renderer's auth bridge (`_wireAuthBridge`) against
// main's REAL lib/auth.js handlers.
//
// The bridge is pure JS (ipc in, ipc out, no DOM), so it runs in plain Node here on
// a REAL renderer instance, the @omega.js/client base class included (a renderer-
// layer suite can't: those bodies run inside a BrowserWindow with no require).
//
// What's pinned:
//   - the sync-request payload carries the signed-in UID, read off the client's
//     Firebase session. A drift here is silent (null → "signed out"), which is
//     exactly how #103 shipped: every renderer boot claimed "signed out" and forced
//     main into a full custom-token round-trip it could have skipped.
//   - every signed-in state pushes `{ uid, document, identity }` to main, and main
//     builds its `auth.user` from that WHOLE document, so its plan reads from it.
//   - the `omega-signin` / `omega-account` click triggers the extension's pages
//     carry route to main's open-flow / open-account channels. Pinned here, not in
//     a renderer-layer page: a real click would open the user's browser.
//   - the client's `omega-signout` trigger routes to main's sign-out channel, and
//     the window signs itself out only on main's broadcast.
//
// Two seams, both named: the backend (`omega.request`, whose wakeup would reach the
// network) and the client's auth state source (`omega.auth.listen`), because a
// real signed-in renderer needs the auth emulator, which the e2e-desktop lane drives.

const path = require('path');

const { User } = require('@omega.js/account');
const { WAKEUP_ROUTE } = require('@omega.js/client/modules/request.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

const ROOT = path.join(__dirname, '..', '..', '..');
const mainAuth = require(path.join(ROOT, 'lib', 'auth.js'));

// A signed-in renderer's account: the stored document with an active paid plan
const IDENTITY = { uid: 'uid-abc', email: 'a@b.co', displayName: 'Abc', photoURL: 'https://example.com/a.png', emailVerified: true };
const DOCUMENT = { subscription: { product: { id: 'premium' }, status: 'active' } };

/**
 * A fresh renderer instance on a recording bridge. `handle(channel, payload)`
 * answers each ipc.invoke. Returns the instance, the recorded invokes and
 * backend requests, the `timeline` of both in the order the bridge produced
 * them (the wakeup ping's whole point is that it is FIRST), and `deliver`, the
 * client's auth listener the bridge registered.
 * @param {{ uid: string }|null} firebaseUser - the client's Firebase session user.
 * @param {Function} handle - the ipc.invoke answerer.
 * @returns {object} the renderer and its recordings.
 */
function makeRenderer(firebaseUser, handle) {
  const invokes = [];
  const requests = [];
  const timeline = [];
  const listeners = [];

  const desktop = {
    ipc: {
      on: () => () => {},
      invoke: async (channel, payload) => {
        invokes.push({ channel, payload });
        timeline.push(channel);
        return handle(channel, payload);
      },
    },
  };

  const saved = globalThis.window;
  globalThis.window = { desktop };
  let omega;
  try {
    const { Omega } = require(path.join(ROOT, 'renderer.js'));
    omega = new Omega();
  } finally {
    if (saved === undefined) delete globalThis.window;
    else globalThis.window = saved;
  }

  // The client's Firebase session, as its `firebaseAuth` getter reads it
  omega._firebaseAuth = { currentUser: firebaseUser };
  omega.request = async (url, options = {}) => {
    requests.push({ url, options });
    timeline.push(options.wakeup ? 'wakeup' : url);
  };
  omega.auth.listen = (callback) => {
    listeners.push(callback);
    return () => {};
  };

  const deliver = (state) => listeners.forEach((callback) => callback(state));

  return { omega, invokes, requests, timeline, deliver };
}

/**
 * A click inside an element carrying `className`, handed to the registry's one
 * delegated listener. closest() answers only when the registry's selector names
 * that class, so the class is the registered one.
 * @param {object} omega - the renderer instance.
 * @param {string} className - the trigger class clicked.
 */
function clickTrigger(omega, className) {
  omega.triggers._handleClick({
    target: {
      closest: (selector) => (selector.split(',').includes(`.${className}`)
        ? { classList: { contains: (name) => name === className } }
        : null),
    },
    preventDefault: () => {},
    stopPropagation: () => {},
  });
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'renderer auth bridge: sync-request context UID + the account push main builds its user from',
  tests: [
    {
      // #644: main answers a sync-request that needs a token by POSTing
      // /omega/user/token, the app's first backend call, on a function that is
      // cold at every launch. The ping goes out before the bridge waits on
      // anything, so the cold start burns down while auth settles.
      name: 'the bridge warms the backend first, then syncs',
      run: async (ctx) => {
        const { omega, requests, timeline } = makeRenderer({ uid: 'uid-abc' }, () => ({ needsSync: false }));

        await omega._wireAuthBridge();

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
        const { omega, invokes } = makeRenderer({ uid: 'uid-abc' }, () => ({ needsSync: false }));

        await omega._wireAuthBridge();

        const sync = invokes.find((i) => i.channel === 'desktop:auth:sync-request');
        ctx.expect(sync).toBeDefined();
        ctx.expect(sync.payload.contextUid).toBe('uid-abc');
      },
    },
    {
      name: 'sync-request carries null when nobody is signed in',
      run: async (ctx) => {
        const { omega, invokes } = makeRenderer(null, () => ({ needsSync: false }));

        await omega._wireAuthBridge();

        const sync = invokes.find((i) => i.channel === 'desktop:auth:sync-request');
        ctx.expect(sync.payload.contextUid).toBeNull();
      },
    },
    {
      name: 'matching UIDs short-circuit against the real main-side handler: no token round-trip',
      run: async (ctx) => {
        // Main's side is the REAL lib/auth.js handler with its session stubbed to the
        // same user; the only thing under test is whether the renderer's claim matches.
        const origAuth = mainAuth._firebaseAuth;
        mainAuth._firebaseAuth = { currentUser: { uid: 'uid-abc' } };

        try {
          let result = null;
          const { omega } = makeRenderer({ uid: 'uid-abc' }, async (channel, payload) => {
            if (channel !== 'desktop:auth:sync-request') return null;
            result = await mainAuth._handleSyncRequest(payload.contextUid);
            return result;
          });
          let signIns = 0;
          let signOuts = 0;
          omega.auth.signInWithCustomToken = async () => { signIns++; };
          omega.auth.signOut = async () => { signOuts++; };

          await omega._wireAuthBridge();

          ctx.expect(result.needsSync).toBe(false);
          // The handler's catch ALSO returns needsSync:false (with an error field), so a
          // null contextUid falling through to the token fetch would pass the line above;
          // the absent error is what proves the uid match short-circuited.
          ctx.expect(result.error).toBeUndefined();
          ctx.expect(signIns).toBe(0);
          ctx.expect(signOuts).toBe(0);
        } finally {
          mainAuth._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'the signin and account triggers route a click to main\'s open-flow and open-account channels',
      run: async (ctx) => {
        const { omega, invokes } = makeRenderer(null, () => ({ needsSync: false }));

        await omega._wireAuthBridge();

        clickTrigger(omega, 'omega-signin');
        clickTrigger(omega, 'omega-account');

        const opens = invokes.map((i) => i.channel).filter((channel) => channel.startsWith('desktop:auth:open-'));
        ctx.expect(opens).toEqual(['desktop:auth:open-flow', 'desktop:auth:open-account']);
      },
    },
    {
      // The client registers `omega-signout` (the one registration, at
      // initialize); on desktop it signs MAIN out, and this window's own
      // sign-out is the broadcast listener's, so nothing signs out twice.
      // `confirm` is the one seam: Node has no dialog.
      name: 'the client\'s signout trigger invokes main\'s sign-out channel, and the window does not sign itself out',
      run: async (ctx) => {
        const { omega, invokes } = makeRenderer({ uid: 'uid-abc' }, (channel) => (channel === 'desktop:auth:sign-out' ? { success: true } : { needsSync: false }));
        let localSignOuts = 0;
        const notices = [];
        omega.auth.signOut = async () => { localSignOuts++; };
        omega.utilities.showNotification = (message, type) => notices.push([message, type]);

        await omega._wireAuthBridge();
        omega.auth.setupEventListeners();

        globalThis.confirm = () => true;
        try {
          clickTrigger(omega, 'omega-signout');
          await new Promise((resolve) => setImmediate(resolve));
        } finally {
          delete globalThis.confirm;
        }

        ctx.expect(invokes.filter((i) => i.channel === 'desktop:auth:sign-out').length).toBe(1);
        ctx.expect(localSignOuts).toBe(0);
        ctx.expect(notices).toEqual([['Successfully signed out.', 'success']]);
      },
    },
    {
      name: 'a signed-out state pushes nothing',
      run: async (ctx) => {
        const { omega, invokes, deliver } = makeRenderer(null, () => ({ needsSync: false }));

        await omega._wireAuthBridge();
        deliver({ user: new User(), denied: false });
        await Promise.resolve();

        ctx.expect(invokes.some((i) => i.channel === 'desktop:auth:account-resolved')).toBe(false);
      },
    },
    {
      name: 'a signed-in state pushes { uid, document, identity }, and main\'s auth.user is built from it',
      run: async (ctx) => {
        // Main's side is the REAL lib/auth.js intake, on a session holding the same uid
        const saved = { firebaseAuth: mainAuth._firebaseAuth, omega: mainAuth._omega, user: mainAuth.user, state: mainAuth.state };
        const broadcasts = [];
        mainAuth._firebaseAuth = { currentUser: { uid: IDENTITY.uid } };
        mainAuth._omega = { ipc: { broadcast: (channel, payload) => broadcasts.push({ channel, payload }) } };
        mainAuth._land(new User());

        try {
          let pushed = null;
          const { omega, deliver } = makeRenderer({ uid: IDENTITY.uid }, (channel, payload) => {
            if (channel === 'desktop:auth:sync-request') return { needsSync: false };
            if (channel === 'desktop:auth:account-resolved') {
              pushed = payload;
              return mainAuth._handleAccountResolved(payload);
            }
            return null;
          });

          await omega._wireAuthBridge();
          ctx.expect(mainAuth.user.authenticated).toBe(false);
          ctx.expect(mainAuth.user.plan).toBe('basic');

          const rendererUser = new User(DOCUMENT, IDENTITY);
          deliver({ user: rendererUser, denied: false });
          await Promise.resolve();

          ctx.expect(pushed).toEqual({ uid: IDENTITY.uid, document: rendererUser.toJSON(), identity: IDENTITY });
          ctx.expect(mainAuth.user.uid).toBe(IDENTITY.uid);
          ctx.expect(mainAuth.user.plan).toBe('premium');
          ctx.expect(mainAuth.user.active).toBe(true);
          ctx.expect(mainAuth.user.profile.displayName).toBe('Abc');
          ctx.expect(mainAuth.user.toJSON()).toEqual(rendererUser.toJSON());
          ctx.expect(broadcasts).toEqual([{ channel: 'desktop:auth:plan-changed', payload: { document: rendererUser.toJSON() } }]);
        } finally {
          mainAuth._firebaseAuth = saved.firebaseAuth;
          mainAuth._omega = saved.omega;
          mainAuth.user = saved.user;
          mainAuth.state = saved.state;
        }
      },
    },
  ],
});
