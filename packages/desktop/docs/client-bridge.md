# Client Bridge — Auth State Sync

@omega.js/desktop keeps Firebase auth state in sync across all processes (main + every renderer window). The pattern mirrors BXM's background/foreground architecture: **main is the source of truth**, renderers reflect.

## Why this exists

In Electron, you can't just initialize Firebase in the renderer and forget about it:

- Multiple renderer windows would each have their own Firebase instance with no coordination.
- Main-process code (tray, menu, deep-link routes) needs to know who's signed in.
- A deep-link auth-token (`myapp://auth/token?token=...`) arrives in main, but the user's UI lives in the renderer — somebody has to bridge them.

The bridge handles all three.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│  MAIN (client-bridge.js)                               │
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

1. User signs in on the website. Web-manager generates a custom token. Website opens `myapp://auth/token?token=XYZ` (deep link).
2. @omega.js/desktop's deep-link `auth/token` built-in fires `manager.omega.handleAuthToken(token)`.
3. Main calls `signInWithCustomToken(auth, token)` against its own Firebase Auth → main is now signed in.
4. Main broadcasts `desktop:auth:sign-in-with-token` IPC with the same token to all renderer windows.
5. Each renderer receives the broadcast, calls `omega.auth().signInWithCustomToken(token)` against its own (@omega.js/client-managed) Firebase Auth → all renderers signed in with the same user.
6. Tokens are NOT stored — they expire in 1 hour. Auth state persists via Firebase's built-in IndexedDB persistence.

### Auth flow: renderer load → sync with main

When a renderer window opens (cold or warm), it asks main for the current state:

1. Renderer sends `desktop:auth:sync-request` IPC with its current UID (or null).
2. Main compares with its own UID:
   - **Same UID** → no sync needed, returns `{ needsSync: false }`.
   - **Main signed out, renderer signed in** → returns `{ needsSync: true, signOut: true }`. Renderer signs out.
   - **Main signed in, renderer not (or different user)** → main fetches a fresh custom token from `POST ${apiUrl}/omega/user/token` (responds `{ token }`) and returns `{ needsSync: true, customToken, user }`. Renderer signs in with that token.

### Sign-out flow

Any renderer (or main code) calls `manager.omega.signOut()`:

1. Main signs out its own Firebase.
2. Main broadcasts `desktop:auth:sign-out` IPC to all renderers.
3. Each renderer signs out its own Firebase.

## Public API

### Main process (`manager.omega`)

```js
// Sign in via a custom token (called automatically by the auth/token deep-link route).
await manager.omega.handleAuthToken(token);

// Read the currently signed-in user (snapshot, no sensitive fields).
manager.omega.getCurrentUser();
//   → { uid, email, displayName, photoURL, emailVerified } | null

// Fresh Firebase ID token for calling authenticated backend routes from main
// (send as `Authorization: Bearer <token>`). null when signed out.
await manager.omega.getIdToken();

// Subscribe to auth state changes (e.g. to refresh tray/menu items).
const off = manager.omega.onAuthChange((user) => {
  manager.tray.refresh();
  manager.menu.refresh();
});
off();   // unsubscribe

// Sign out from any process.
await manager.omega.signOut();

// The renderer-resolved subscription — THE main-side plan source. Renderers run
// @omega.js/client's full auth cycle (Firestore account fetch → resolveSubscription)
// and push the result to main (desktop:auth:account-resolved, uid-guarded); main can't
// run Firestore itself. null until a renderer has resolved.
manager.omega.getResolvedPlan();
//   → { plan, active, trialing, cancelling } | null
manager.omega.getResolvedRoles();
//   → { admin, betaTester, ... } | null
```

### Renderer process (the @omega.js/desktop Manager you `initialize()`)

```js
// Read the user from main (always returns main's authoritative state).
const user = await renderer.getMainUser();

// Sign out (goes through main; broadcasts to all other renderers).
await renderer.signOut();
```

The renderer's `Manager.initialize()` automatically:
- Boots @omega.js/client (so renderer-side Firebase is available).
- Wires the auth bridge (`desktop:auth:sync-request` on load + listens for broadcasts).
- Runs @omega.js/client's **full auth cycle** (`auth().listen()`): waits for auth to settle,
  fetches the Firestore account, resolves the subscription, and auto-populates the
  **`data-omega-bind` bindings** — so @omega.js/desktop app views can use UJM/BXM-style reactive HTML
  (`@show auth.user`, `@text auth.account.plan.id`, `@show auth.account.plan.id === 'premium'`,
  see @omega.js/client's docs/bindings.md). Each settle pushes `{ resolved, roles }` to main
  (`desktop:auth:account-resolved`) and re-offers it whenever main announces a state change,
  so a renderer that resolved before main signed in still delivers.

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

Storage only — distribution across processes stays the IPC sync protocol above.
The session restores at boot (offline included: no network round trip), so a restart
keeps the user signed in; renderers then re-resolve the account and re-push the plan.

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

If `cloud.config` is empty/missing, the bridge logs a warning and runs in no-op mode (everything returns harmless defaults).

## Firebase (bundled)

Firebase is **bundled by webpack from @omega.js/desktop's module context** (@omega.js/client owns it in @omega.js/desktop's dependency tree) — the same treatment `json5` gets in main. It was previously runtime-resolved, which silently failed in every symlinked dev app (see CHANGELOG 1.11.1).

If you're building a no-auth Electron app, just leave `cloud.config` empty — the bridge is a clean no-op.

## Common patterns

### Refresh tray when auth state changes

```js
// In src/tray/index.js or wherever you have access to manager:
manager.omega.onAuthChange((user) => {
  manager.tray.refresh();   // re-evaluates dynamic labels
});
```

```js
// In src/tray/index.js:
tray.item({
  label: () => {
    const user = manager.omega.getCurrentUser();
    return user ? `Signed in as ${user.email}` : 'Sign in';
  },
  click: () => {
    if (manager.omega.getCurrentUser()) {
      manager.omega.signOut();
    } else {
      require('electron').shell.openExternal(`${manager.config.brand.url}/sign-in?desktop=true`);
    }
  },
});
```

### Gate a deep-link route on auth

```js
manager.deepLink.on('user/profile/:id', (ctx) => {
  if (!manager.omega.getCurrentUser()) {
    require('electron').shell.openExternal(`${manager.config.brand.url}/sign-in?return=profile/${ctx.params.id}`);
    ctx.handled = true;
    return;
  }
  manager.windows.show('main');
  manager.windows.get('main').webContents.send('navigate', { to: `/profile/${ctx.params.id}` });
});
```

### Sign-out button in a renderer

```html
<button id="signout">Sign out</button>
<script>
  document.getElementById('signout').addEventListener('click', async () => {
    await renderer.signOut();   // goes through main, propagates everywhere
  });
</script>
```

## IPC channels

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `desktop:auth:sync-request` | renderer → main | `{ contextUid }` | "I'm at this UID, are we in sync?" |
| `desktop:auth:sign-out` | renderer → main | (none) | "Sign me (and everyone) out." |
| `desktop:auth:get-user` | renderer → main | (none) | Read main's current user. |
| `desktop:auth:sign-in-with-token` | main → all renderers | `{ token }` | "Sign in with this custom token now." |
| `desktop:auth:sign-out` | main → all renderers | `{}` | "Sign out now." |
| `desktop:auth:state-changed` | main → all renderers | `{ uid, email, ... } \| null` | Auth state changed (informational). |

## Testing

### Unit tests (always run)

`client-bridge.test.js` covers the dispatch logic, IPC handler shape, sync-request comparison, and the `auth/token` deep-link integration — all without hitting Firebase.

### Extended tests (skip without opt-in + creds)

`client-bridge.integration.test.js` actually mints custom tokens via `firebase-admin` and signs in — it hits REAL Firebase, so it's gated behind extended mode (the cross-framework `TEST_EXTENDED_MODE` opt-in; see [test-framework.md](test-framework.md#extended-vs-normal-mode)). To run:

```bash
npm i -D firebase-admin                                   # already in @omega.js/desktop's devDeps
export OMEGA_TEST_FIREBASE_ADMIN_KEY=/path/to/service-account.json
export OMEGA_TEST_USER_UID=desktop-test-user                      # optional, defaults to desktop-test-user
npx omega test --extended                                   # or: TEST_EXTENDED_MODE=true npx omega test
```

Without the extended-mode opt-in the suite skips cleanly with a clear reason; same when `OMEGA_TEST_FIREBASE_ADMIN_KEY` (or `GOOGLE_APPLICATION_CREDENTIALS`) isn't set. CI without creds → tests stay green.

## Implementation notes

- Firebase app name in main is `omega-auth` (avoids clashes if a consumer's main code also wants its own Firebase instance).
- The bridge does NOT persist user info to @omega.js/desktop storage — Firebase's IndexedDB persistence handles session restoration. Matches BXM.
- Custom tokens are NEVER stored. Renderers receive them once via broadcast, sign in, discard. Fresh tokens are minted on demand from `POST /omega/user/token` via @omega.js/client's shared request layer (`createRequest` from `@omega.js/client/modules/request.js`) — same code path as the extension background's token sync.
- `manager.getApiUrl()` returns the dev or prod URL, so the bridge automatically hits the right backend. Available across all four Manager contexts (main / renderer / preload / build) via the shared `src/utils/url-helpers.js` module — same code path everywhere. See the Cross-context helpers section of the framework guide ([docs/desktop/index.md](../../../docs/desktop/index.md)).
- All sensitive Firebase user fields (`stsTokenManager`, `providerData`, etc.) are stripped before sending over IPC. Only `{uid, email, displayName, photoURL, emailVerified}` cross the bridge.
