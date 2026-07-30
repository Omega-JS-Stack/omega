# Cross-Context Auth

Browser extensions have multiple isolated JavaScript contexts (background SW, popup, options, sidepanel, pages) — each runs its own Firebase instance. @omega.js/extension syncs them via messaging so a sign-in in one context is reflected in all of them without using `chrome.storage`.

## The core idea

**Background.js is the source of truth.** Other contexts compare their auth state with background's on load, and sync up if different. Sign-in/sign-out events are broadcast from background to everyone.

This pattern avoids `chrome.storage` (no cross-context tokens on disk, no race conditions). Firebase persists session state in IndexedDB per-context.

## Sign-in flow

```
User clicks .omega-signin (in popup/options/sidepanel/page)
  ↓
openAuthPage() opens https://<brand.url host>/token?authSourceTabId=<n>
  ↓
Website authenticates, redirects to /token?authToken=xxx
  ↓
background.js's tabs.onUpdated listener detects the brand-site URL + authToken param
  ↓
background.js calls signInWithCustomToken(authToken)
  ↓
background.js broadcasts the token to all open contexts via chrome.runtime.sendMessage
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
Web Manager initializes, waits for auth to settle (auth.listen({ once: true }))
  ↓
Sends `omega:syncAuth` message to background, including local UID
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
Web Manager signs out that context's Firebase
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
| `syncWithBackground(context)` | Called on context boot. Compares context's UID with background's, syncs if different. |
| `setupAuthBroadcastListener(context)` | Listens for sign-in / sign-out broadcasts from background. |
| `setupSignOutListener(context)` | Notifies background when this context signs out. |
| `setupAuthEventListeners(context)` | Registers the extension's `omega-signin` click trigger on @omega.js/client's shared registry. |
| `openAuthPage(context, options)` | Opens the website's `/token` page with `authSourceTabId` for tab restoration. |

Every popup/options/sidepanel/page Manager calls these automatically in `initialize()`. See [managers.md](managers.md).

## Auth button classes

Add these classes to HTML elements to wire up auth UI without writing JS:

| Class | Action |
|---|---|
| `.omega-signin` | Opens `/token` page on website. After authentication, signs in across all contexts. |
| `.omega-signout` | Signs out via Web Manager. Notifies background, which broadcasts to other contexts. |

## Reactive bindings

Web Manager exposes `data-omega-bind` attributes for show/hide/text/attr based on auth state:

```html
<!-- Sign-in button shown when logged out -->
<button class="btn omega-signin" data-omega-bind="@show !auth.user">
  Sign In
</button>

<!-- Account UI shown when logged in -->
<div data-omega-bind="@show auth.user" hidden>
  <img data-omega-bind="@attr src auth.user.photoURL">
  <span data-omega-bind="@text auth.user.displayName"></span>
  <button class="omega-signout">Sign Out</button>
</div>
```

| Binding | Behavior |
|---|---|
| `@show auth.user` | Element visible only when signed in |
| `@show !auth.user` | Element visible only when signed out |
| `@text auth.user.displayName` | Element text content set from path |
| `@text auth.user.email` | Same — any path under `auth.user.*` |
| `@attr src auth.user.photoURL` | Set element attribute from path |

These bindings live in Web Manager, not @omega.js/extension — but they're how every @omega.js/extension extension surfaces auth state in views.

## Important implementation details

1. **No storage.** Auth state is NOT in `chrome.storage`. Firebase persists sessions in IndexedDB per-context. Web Manager handles UI bindings off those persisted sessions.

2. **Firebase in service workers requires static imports.** Dynamic `import()` fails with webpack chunking inside SWs. @omega.js/extension's background.js uses static `import { initializeApp } from 'firebase/app'`.

3. **Config path is fixed.** The watched host comes from omega.json5's `brand.url` (bridged into the packaged snapshot via the `OMEGA_BUILD_JSON` webpack DefinePlugin replacement).

4. **Tabs permission required.** Without it, background.js can't watch for `/token?authToken=…` redirects.

## See also

- [managers.md](managers.md) — each Manager's `initialize()` wires the auth helpers
- [components.md](components.md) — which contexts participate in auth sync
- [extension.md](extension.md) — `chrome.tabs.onUpdated` access via the extension wrapper
