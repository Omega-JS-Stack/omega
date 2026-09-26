# Auth: `omega.auth` and the state sync

@omega.js/desktop keeps Firebase auth state in sync across all processes (main + every renderer window). **Main is the source of truth**, renderers reflect: the same pattern as @omega.js/extension's background and page contexts. In main the lib is `omega.auth` ([src/lib/auth.js](../src/lib/auth.js)); in a renderer `omega.auth` is @omega.js/client's Auth module. Both sides hold the account as one `User` (`@omega.js/account`), never null.

## Why this exists

In Electron, you can't just initialize Firebase in the renderer and forget about it:

- Multiple renderer windows would each have their own Firebase instance with no coordination.
- Main-process code (tray, menu, deep-link routes) needs to know who's signed in.
- A deep-link auth-token (`myapp://auth/token?token=...`) arrives in main, but the user's UI lives in the renderer — somebody has to bridge them.

The bridge handles all three.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│  MAIN (lib/auth.js, omega.auth)                         │
│  - Owns Firebase Auth instance ("omega-auth" app)              │
│  - Source of truth for auth state                           │
│  - Listens for desktop:auth:* IPC from renderers                 │
│  - Broadcasts desktop:auth:* IPC to all renderers on changes     │
└─────────────────────────────────────────────────────────────┘
              ▲                     │ broadcasts
              │ sync-request        ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│  RENDERER (window 1)     │  │  RENDERER (window 2)     │
│  @omega.js/client + Firebase  │  │  @omega.js/client + Firebase  │
└──────────────────────────┘  └──────────────────────────┘
```

### Auth flow: deep-link → all processes signed in

**Consumers never collect credentials.** There is no login form to build: call `omega.openAuthFlow()` (documented in `lib/auth-flow.js`), which opens the brand website's sign-in page in the user's browser and receives the result through the deep link below.

1. User signs in on the website. The website's token page mints a custom token and opens `myapp://auth/token?authToken=XYZ` (deep link).
2. @omega.js/desktop's deep-link `auth/token` built-in calls `omega.auth.handleToken(token)`.
3. Main calls `signInWithCustomToken(auth, token)` against its own Firebase Auth → main is now signed in.
4. Main broadcasts `desktop:auth:sign-in-with-token` IPC with the same token to all renderer windows.
5. Each renderer receives the broadcast, calls `omega.auth.signInWithCustomToken(token)` against its own (@omega.js/client-managed) Firebase Auth → all renderers signed in with the same user.
6. Tokens are NOT stored — they expire in 1 hour. Auth state persists via Firebase's built-in IndexedDB persistence.

### Auth flow: renderer load → sync with main

When a renderer window opens (cold or warm), it asks main for the current state:

1. Renderer sends `desktop:auth:sync-request` IPC with its current UID (or null).
2. Main compares with its own UID:
   - **Same UID** → no sync needed, returns `{ needsSync: false }`.
   - **Main signed out, renderer signed in** → returns `{ needsSync: true, signOut: true }`. Renderer signs out.
   - **Main signed in, renderer not (or different user)** → main fetches a fresh custom token from `POST ${apiUrl}/omega/user/token` (responds `{ token }`) and returns `{ needsSync: true, customToken, user }`. Renderer signs in with that token.

### Sign-out flow

Main code calls `omega.auth.signOut()`; a renderer calls `omega.signOut()`, which a click on any `.omega-signout` element runs (@omega.js/client's trigger: confirm, then `desktop:auth:sign-out` to main). Either way:

1. Main signs out its own Firebase.
2. Main broadcasts `desktop:auth:sign-out` IPC to all renderers.
3. Each renderer signs out its own Firebase, on that broadcast alone (the clicked window included), so nothing signs out twice.

## Public API

### Main process (`omega.auth`)

```js
// The account, always a `User`: signed out until a renderer pushes the account
// document of the uid main's session holds, and signed out again the moment that
// session ends.
omega.auth.user;
//   → User: .authenticated .uid .email .plan .active .trialing .cancelling .everPaid,
//     .roles, .subscription, ..., .profile { displayName, photoURL, emailVerified }

// Subscribe to state changes (e.g. to refresh tray/menu items). Called with
// `{ user }`, plus a catch-up with the current state after listen() returns.
const off = omega.auth.listen(({ user }) => {
  omega.tray.refresh();
  omega.menu.refresh();
});
off();   // unsubscribe

// Sign in via a custom token (called automatically by the auth/token deep-link route).
await omega.auth.handleToken(token);

// Fresh Firebase ID token for calling authenticated backend routes from main
// (send as `Authorization: Bearer <token>`). null when signed out.
await omega.auth.getIdToken();

// Or let the instance fetch: @omega.js/client's request, built once on main,
// attaches that token itself (the renderer's and the extension's shape).
await omega.request('/notes', { method: 'POST', body: { text: 'hi' } });

// Sign main out and broadcast the sign-out to every renderer.
await omega.auth.signOut();
```

Main can't run Firestore, so the account crosses from the renderers: each renderer runs @omega.js/client's full auth cycle and pushes the WHOLE stored document (`desktop:auth:account-resolved`, `{ uid, document, identity }`, uid-guarded), and main builds its `omega.auth.user` from it. `user.plan`, `user.active` and `user.roles.admin` read the same in main as in the renderer.

### Renderer process (the renderer's `omega`)

```js
// The renderer's own account, from @omega.js/client
omega.auth.user;                        // a User, the same class main holds
omega.auth.listen(({ user, denied }) => { });

// Main's authoritative account: { uid, document, identity }
const main = await omega.getMainUser();

// Sign out through main (broadcasts to every renderer). omega.auth.signOut()
// signs out this renderer alone.
await omega.signOut();
```

The renderer's `omega.initialize()` automatically:
- Boots @omega.js/client (so renderer-side Firebase is available).
- Wires the auth bridge (`desktop:auth:sync-request` on load + listens for broadcasts).
- Registers the auth click triggers the extension's pages carry, so a view signs in with markup
  alone: `.omega-signin` runs main's `omega.openAuthFlow()` (`desktop:auth:open-flow`),
  `.omega-account` opens the website's `/account` page in the user's browser
  (`desktop:auth:open-account`), and `.omega-signout` (@omega.js/client's) runs `omega.signOut()`,
  signing the whole app out through main (`desktop:auth:sign-out`).
- Runs @omega.js/client's **full auth cycle** (`omega.auth.listen()`): waits for auth to settle,
  fetches the Firestore account, lands one `User`, and auto-populates the
  **`data-omega-bind` bindings**, so @omega.js/desktop app views use the same reactive HTML as
  every OMEGA browser surface (`@show auth.user.authenticated`, `@text auth.user.plan`,
  `@show auth.user.plan === 'premium'`, see @omega.js/client's docs/bindings.md). Each signed-in
  state pushes its account to main (`desktop:auth:account-resolved`) and re-offers it whenever
  main announces a state change, so a renderer that resolved before main signed in still delivers.

You don't write any of this — it just works.

## Session persistence (main)

Renderers persist their Firebase sessions in IndexedDB for free (browser contexts).
Main is Node — Firebase defaults to in-memory there — so @omega.js/desktop plugs in its own vault:
**`lib/auth-persistence.js`**, a PLUGGABLE strategy behind a custom Firebase
`Persistence` (the `getReactNativePersistence()` shape).

- **`safeStorage`** (default) — values encrypted via Electron `safeStorage` (macOS
  Keychain / Windows DPAPI / kwallet-gnome) before touching disk
  (`{userData}/omega-auth-session.json` holds base64 ciphertext only). This is the same
  os_crypt machinery Chromium uses for its cookie jar — stronger than browser
  IndexedDB/localStorage, which are plaintext LevelDB on disk.
- **`none`** — explicit opt-out (in-memory, pre-1.12 behavior).
- **Custom** — `require('@omega.js/desktop/lib/auth-persistence').register(name, { available, getItem, setItem, removeItem })` before `initialize()`, then select it via config.

```jsonc
{
  "omega": {
    "authPersistence": "safeStorage"   // 'safeStorage' (default) | 'none' | custom name
  }
}
```

A TEST RUN is always `none`, whatever this config says, on the main and boot layers
alike: the harness never signs a real user in, so it never asks the OS keychain
([#907](https://github.com/Omega-JS-Stack/omega/issues/907), the mechanics in
[test-framework.md](test-framework.md)).

Storage only — distribution across processes stays the IPC sync protocol above.
The session restores at boot (offline included: no network round trip), so a restart
keeps the user signed in; renderers then re-resolve the account and re-push it.

## Config

```jsonc
{
  "cloud": {
    "provider": "firebase",
    "config": {
      "apiKey":            "...",
      "authDomain":        "myapp.com",
      "projectId":         "myapp",
      // ... etc.
    }
  }
}
```

If `cloud.config` is empty/missing, `omega.auth` logs a warning and runs in no-op mode (`user` stays the signed-out `User`, everything else returns harmless defaults).

## Firebase (bundled)

Firebase is **bundled from @omega.js/desktop's module context** (@omega.js/client owns it in @omega.js/desktop's dependency tree), the same treatment `json5` gets in main.

If you're building a no-auth Electron app, just leave `cloud.config` empty — the bridge is a clean no-op.

In a TESTING run (`OMEGA_ENVIRONMENT=testing`) the bridge connects its auth instance to the local auth emulator, on the port it reads in three steps: `OMEGA_AUTH_PORT` when the CLI that booted the stack published one, then the `dev.ports.auth` value the bundle baked into `OMEGA_BUILD_JSON` (a packaged main process has no parent env, [#745](https://github.com/Omega-JS-Stack/omega/issues/745)), then the classic `9099`. Same chain `getApiUrl()` walks ([environment-detection.md](environment-detection.md)) and the same move it makes when it maps testing to localhost, and the same one @omega.js/extension's background worker makes for its emulator runs; development and production are untouched.

## Common patterns

### Refresh tray when auth state changes

```js
// In src/integrations/tray/index.js, or anywhere main code reaches omega:
omega.auth.listen(() => {
  omega.tray.refresh();   // re-evaluates dynamic labels
});
```

```js
// In src/integrations/tray/index.js:
tray.item({
  label: () => {
    const { user } = omega.auth;
    return user.authenticated ? `Signed in as ${user.email}` : 'Sign in';
  },
  click: () => {
    if (omega.auth.user.authenticated) {
      omega.auth.signOut();
    } else {
      omega.openAuthFlow();
    }
  },
});
```

### Gate a deep-link route on auth

```js
omega.deepLink.on('user/profile/:id', (ctx) => {
  if (!omega.auth.user.authenticated) {
    omega.openAuthFlow();
    ctx.handled = true;
    return;
  }
  omega.windows.show('main');
  omega.windows.get('main').webContents.send('navigate', { to: `/profile/${ctx.params.id}` });
});
```

### Sign-out button in a renderer

```html
<button id="signout">Sign out</button>
<script>
  document.getElementById('signout').addEventListener('click', async () => {
    await omega.signOut();   // goes through main, propagates everywhere
  });
</script>
```

## IPC channels

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `desktop:auth:sync-request` | renderer → main | `{ contextUid }` | "I'm at this UID, are we in sync?" |
| `desktop:auth:sign-out` | renderer → main | (none) | "Sign me (and everyone) out." The `.omega-signout` trigger and `omega.signOut()`; main runs `omega.auth.signOut()`. |
| `desktop:auth:get-user` | renderer → main | (none) | Read main's account: `{ uid, document, identity }`. |
| `desktop:auth:account-resolved` | renderer → main | `{ uid, document, identity }` | The account this renderer's client resolved; main builds `omega.auth.user` from it (uid-guarded). |
| `desktop:auth:open-flow` | renderer → main | (none) | The `.omega-signin` trigger: main runs `omega.openAuthFlow()`. |
| `desktop:auth:open-account` | renderer → main | (none) | The `.omega-account` trigger: main opens `<getWebsiteUrl()>/account` in the user's browser. |
| `desktop:auth:plan-changed` | main → all renderers | `{ document }` | Main landed a new account. |
| `desktop:auth:sign-in-with-token` | main → all renderers | `{ token }` | "Sign in with this custom token now." |
| `desktop:auth:sign-out` | main → all renderers | `{}` | "Sign out now." |
| `desktop:auth:state-changed` | main → all renderers | `{ uid, email, ... } \| null` | Auth state changed (informational). |

## Testing

### Unit tests (always run)

`auth.test.js` covers the dispatch logic, IPC handler shape, sync-request comparison, and the `auth/token` deep-link integration, all without hitting Firebase.

### The real-surface e2e lane (monorepo root)

`npm run test:e2e-desktop` ([scripts/e2e-desktop-auth.js](../../../scripts/e2e-desktop-auth.js)) boots a real Electron app against the backend emulator and delivers `<brand.id>://auth/token` from a SECOND instance — the OS-forwarded argv path — then asserts main AND the renderer both land on the emulator user. Offline; it is the lane that proves this whole chain end to end.

### Extended tests (skip without the opt-in)

`auth.integration.test.js` talks to REAL Firebase, so it is gated behind extended mode (the cross-framework `TEST_EXTENDED_MODE` opt-in; see [test-framework.md](test-framework.md#extended-vs-normal-mode)):

```bash
npx omega test --extended                                   # or: TEST_EXTENDED_MODE=true npx omega test
```

It asks for NO credential of its own. The SIGN-IN proof belongs to [#904](https://github.com/Omega-JS-Stack/omega/issues/904), which signs desktop in as a persona the backend emulator seeds, the same mechanism web and the extension use. Without the opt-in the suite skips cleanly with a reason, so CI stays green.

## Implementation notes

- Firebase app name in main is `omega-auth` (avoids clashes if a consumer's main code also wants its own Firebase instance).
- The bridge does NOT persist user info to @omega.js/desktop storage: the session vault (above) and the renderers' IndexedDB persistence handle session restoration, the same as @omega.js/extension.
- Custom tokens are NEVER stored. Renderers receive them once via broadcast, sign in, discard. Fresh tokens are minted on demand from `POST /omega/user/token` through main's `omega.request()` (@omega.js/client's `createRequest`, built once on the instance), the same code path as the extension background's token sync.
- `omega.getApiUrl()` returns the dev or prod URL, so the bridge automatically hits the right backend. Available on all three process instances (main / renderer / preload) via the shared `src/utils/url-helpers.js` module, the same code path everywhere. See the Cross-context helpers section of the framework guide ([docs/desktop/index.md](../../../docs/desktop/index.md)).
- All sensitive Firebase user fields (`stsTokenManager`, `providerData`, etc.) are stripped before sending over IPC. Only the identity `{uid, email, displayName, photoURL, emailVerified}` and the stored account document cross the bridge.
