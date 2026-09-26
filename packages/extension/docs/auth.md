# Cross-Context Auth

Browser extensions have multiple isolated JavaScript contexts (background SW, popup, options, sidepanel, pages), and each runs its own Firebase instance. @omega.js/extension syncs them over `omega.messenger`, the one lane between contexts, so a sign-in in one context is reflected in all of them without using `chrome.storage`.

## The core idea

**Background's `omega.auth` is the source of truth.** The page contexts compare their auth state with background's on load, and sync up if different. Sign-in/sign-out events are broadcast from background to everyone.

Every context holds the account as one `User` (`@omega.js/account`), never null. A page context's `omega.auth.user` comes from @omega.js/client; background's `omega.auth.user` is built from the WHOLE account document the page contexts push on sync, so both sides read the same `user.plan`, `user.active` and `user.roles`.

This pattern avoids `chrome.storage` (no cross-context tokens on disk, no race conditions). Firebase persists session state in IndexedDB per-context.

## Background's API

Background's `omega.auth` has desktop main's `omega.auth` shape, and `omega.request()` is the page contexts' API fetch, on background's own session:

```js
import omega from '@omega.js/extension/background';

omega.auth.user;                                  // a User, built from the account the pages push
const off = omega.auth.listen(({ user }) => { });
await omega.auth.getIdToken();                    // the session's fresh ID token, null when signed out
await omega.auth.signOut();

// The page contexts' API fetch: a Bearer token from background's session when signed in
const { notes } = await omega.request('/notes?limit=20');
await omega.request('/notes', { method: 'POST', body: { text } });
```

## Sign-in flow

```
User clicks .omega-signin (in popup/options/sidepanel/page)
  ↓
omega.auth.openPage() opens https://<brand.url host>/token?authSourceTabId=<n>
  ↓
Website authenticates, redirects to /token?authToken=xxx
  ↓
background.js's tabs.onUpdated listener detects the brand-site URL + authToken param
  ↓
background.js calls signInWithCustomToken(authToken)
  ↓
background.js broadcasts `omega:signInWithToken` to all open contexts over the messenger
  ↓
background.js closes the /token tab, reactivates original tab (using authSourceTabId)
  ↓
Open contexts receive the broadcast, signInWithCustomToken() locally
```

## Context-load flow

When a popup/options/sidepanel/page boots:

```
Context loads
  ↓
The client boots, waits for auth to settle (omega.auth.listen({ once: true }, ...))
  ↓
Sends `omega:syncAuth` to background over omega.messenger: the local identity plus the account document (user.toJSON())
  ↓
Background compares UIDs:
  - Same UID (including both null) → in sync, no action
  - Different UID, background signed in   → background fetches fresh custom token from server,
                                            sends to context, context signs in
  - Background signed out, context signed in → tells context to sign out
```

## Sign-out flow

```
User clicks .omega-signout
  ↓
@omega.js/client signs out that context's Firebase
  ↓
setupSignOutListener() detects sign-out, sends `omega:signOut` to background
  ↓
background.js signs out its Firebase
  ↓
background.js broadcasts `omega:signOut` to all other contexts
  ↓
All contexts sign out
```

## Required setup

1. **Set `brand.url`** in `config/omega.json5` — the sign-in round trip lands on the
   brand website's `/token` page, and background.js watches for that host:
   ```jsonc
   {
     brand: {
       id: 'tabblar',
       url: 'https://tabblar.com',   // ← required for the /token redirect flow
     },
   }
   ```
   (`cloud.config.authDomain` is the brand host too — the website build
   self-hosts Firebase's `/__/auth/*` handler — but it plays no role in this
   flow; the extension only watches `brand.url`.)
2. **Add `tabs` permission** to `src/manifest.json` — needed for `chrome.tabs.onUpdated` listener that detects the `/token` redirect.

## Functions in `lib/auth-helpers.js`

[src/lib/auth-helpers.js](../src/lib/auth-helpers.js):

| Function | Purpose |
|---|---|
| `syncWithBackground(omega)` | Called on context boot. Compares the context's UID with background's, pushes the account document, syncs if different. |
| `setupAuthBroadcastListener(omega)` | Listens for sign-in / sign-out broadcasts from background. |
| `setupSignOutListener(omega)` | Notifies background when this context signs out. |
| `setupAuthEventListeners(omega)` | Registers the extension's `omega-signin` and `omega-account` click triggers on @omega.js/client's shared registry. |

Every page context's `initialize()` calls these automatically. See [contexts.md](contexts.md).

`omega.auth.openPage(options)` ([src/lib/extension-auth.js](../src/lib/extension-auth.js)) opens a page on the brand site (`options.path`, default `/token`) with `authSourceTabId` for tab restoration.

## Auth button classes

Add these classes to HTML elements to wire up auth UI without writing JS:

| Class | Action |
|---|---|
| `.omega-signin` | Opens `/token` page on website. After authentication, signs in across all contexts. |
| `.omega-signout` | Signs out via @omega.js/client. Notifies background, which broadcasts to other contexts. |
| `.omega-account` | Opens `/account` page on website in a new tab. Same brand-URL resolution as `.omega-signin`. |

## Reactive bindings

@omega.js/client's bindings drive `data-omega-bind` attributes for show/hide/text/attr based on auth state. The auth root is `auth.user`, the `User` written out:

```html
<!-- Sign-in button shown when logged out -->
<button class="btn omega-signin" data-omega-bind="@show !auth.user.authenticated">
  Sign In
</button>

<!-- Account UI shown when logged in -->
<div data-omega-bind="@show auth.user.authenticated" hidden>
  <img data-omega-bind="@attr src auth.user.profile.photoURL">
  <span data-omega-bind="@text auth.user.profile.displayName"></span>
  <button class="omega-account">Account</button>
  <button class="omega-signout">Sign Out</button>
</div>
```

| Binding | Behavior |
|---|---|
| `@show auth.user.authenticated` | Element visible only when signed in |
| `@show !auth.user.authenticated` | Element visible only when signed out |
| `@show auth.user.active` | Element visible only on an active paid plan |
| `@text auth.user.profile.displayName` | Element text content set from path |
| `@text auth.user.plan` | Same: any path under `auth.user.*` |
| `@attr src auth.user.profile.photoURL` | Set element attribute from path |

These bindings live in @omega.js/client, not @omega.js/extension, but they're how every @omega.js/extension extension surfaces auth state in views.

## Important implementation details

1. **No storage.** Auth state is NOT in `chrome.storage`. Firebase persists sessions in IndexedDB per-context. @omega.js/client handles UI bindings off those persisted sessions.

2. **Firebase in service workers requires static imports.** A service worker cannot fetch code at runtime under MV3, so dynamic `import()` is not an option there. @omega.js/extension's background.js uses static `import { initializeApp } from 'firebase/app'`.

3. **Config path is fixed.** The watched host comes from omega.json5's `brand.url` (bridged into the packaged snapshot via the `OMEGA_BUILD_JSON` file the bundle task writes, `build.js`).

4. **Tabs permission required.** Without it, background.js can't watch for `/token?authToken=…` redirects.

## See also

- [contexts.md](contexts.md): each page context's `initialize()` wires the auth helpers
- [components.md](components.md) — which contexts participate in auth sync
- [extension.md](extension.md) — `chrome.tabs.onUpdated` access via the extension wrapper
