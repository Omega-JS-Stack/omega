# User connections (`/user/connections`)

The lane a brand's users link third-party accounts through: Google, Discord, Spotify, Twitch and Kick ship with the framework, and **a brand adds any other provider — of any grant shape — with one file and one config entry** ([#771](https://github.com/Omega-JS-Stack/omega/issues/771)). No framework edit, ever.

Route: `GET | POST | DELETE /omega/user/connections` ([src/manager/routes/user/connections/](../src/manager/routes/user/connections)). The browser half is `@omega.js/web`'s `/connections/callback` page and the account page's Connections section.

## The record

A connection lives on the user document, keyed by provider name:

```js
users/{uid}.connections.{provider} = {
  type: 'oauth2',    // the KIND of connection — an OAuth grant, today the only one
  token: { access_token, refresh_token, token_type, expires_in, scope },
  identity: { id, … },   // whatever the provider's identity() returned, `id` included
  updated: { timestamp, timestampUNIX },
  refreshing: { instance, timestamp, timestampUNIX },   // present only WHILE a refresh is in flight (see Concurrent refreshes)
}
```

Every record the backend writes carries `type` ([#788](https://github.com/Omega-JS-Stack/omega/issues/788)): a connection will not always be an OAuth grant — an API key or a bot token is a connection too — so the shape says which one this is before another kind exists. `identity.id` is the provider's stable account id, and it is what ONE account per identity is enforced on (below). Legacy brands' `users/*.oauth2` documents move to `connections` (and get their `type`, and their `identity.id`) in ONE step of the brand migration: the manager's `users` migration ([docs/manager/migrations.md](../../../docs/manager/migrations.md)).

The one-time authorize session lives at `usage/{uid}.connections.{provider}` — `{ csrf, verifier, createdAt }` — and is **single-use**: tokenize deletes it as soon as the CSRF token has been validated, BEFORE the exchange runs, so a failed exchange, a rejected identity check or a missing `refresh_token` all leave nothing behind to replay a code against. A retry starts a new authorize leg, which is what mints the next one. It is auto-cleaned daily either way, and the encrypted `state` (10-minute TTL) is what carries the provider, the uid, the CSRF token and — when the authorize leg was given one — the `returnUrl` path through the provider's redirect.

| Call | What it does | `uid` |
|---|---|---|
| `GET ?provider=x&action=authorize` | Answers `{ url }` (or redirects with `redirect=true`) — the authorization URL, with a fresh CSRF token and, for a PKCE provider, a fresh challenge. Takes an optional `returnUrl` (see below) | Refused |
| `GET ?provider=x&action=status` | `connected` / `disconnected` / `error`, through the provider's `status()` step when it has one (`removeInvalidTokens=true` deletes a dead connection) | Admin |
| `POST action=tokenize` | The `/connections/callback` page's call: exchanges `code` + `encryptedState` for tokens, checks the identity, and writes the record. Answers `{ success: true }`, plus `returnUrl` when the authorize leg was given one | Refused |
| `POST action=refresh&provider=x` | Refreshes the access token from the stored refresh token | Admin |
| `DELETE ?provider=x` | Revokes with the provider (best effort) and deletes the record | Admin |

**Admin** in that last column means an admin may pass `uid` to act on another user: `status`, `refresh` and the delete each act AT THE PROVIDER on that user's behalf — checking a connection (and dropping a dead one), refreshing, revoking — which a trusted server does with no browser in the loop. **Refused** means the action takes no `uid` at all: `authorize` and `tokenize` are the connecting user's own legs (the authorization URL their browser opens, the code it comes back with), so a passed `uid` answers 400 naming the argument and a stale caller fails loudly instead of acting on the wrong user ([#782](https://github.com/Omega-JS-Stack/omega/issues/782)). Anyone who is not an admin may only act on themselves.

## Coming back where you started

The callback page lands on `/dashboard/account#connections`. A brand page that starts a connect from its OWN surface — a `/dashboard/channels` listing the platform connections — passes `returnUrl`, and gets the visitor back to it ([#784](https://github.com/Omega-JS-Stack/omega/issues/784)):

```js
url.searchParams.set('returnUrl', location.pathname + location.search + location.hash);
```

`returnUrl` is **a path on this site**: it starts with a single `/` and carries no scheme, no `//`, no backslash and no whitespace (a query and a hash are fine). Anything else answers **400** naming the rule, rather than being dropped — a caller that asked to be sent somewhere would otherwise land on the default and never learn why. The rule has one home, `returnUrlError()` in [_context.js](../src/manager/routes/user/connections/_context.js).

The path rides the **encrypted state**, beside the provider, the uid and the CSRF token: the browser leaves for the provider in between, and the state is the only thing that survives the trip. `tokenize` answers it, and the callback page navigates there on success and offers it as the way back on an error — re-checking the same rule itself first, because it is the code that touches `location`. Absent, everything is exactly as before: no key in the state, no `returnUrl` in the answer, and the page keeps its default. A provider the visitor DENIED never reaches tokenize, so that page keeps the default too.

## Adding a provider — the two things

**1. The module**, at `src/connections/<provider>.js` in the backend target (staged into `dist/` with the rest of `src/`). The lane resolves the brand's directory FIRST and the package's second, so a file named `google.js` replaces the packaged Google outright. The provider name is strictly `[a-z0-9-]` (the confined loader refuses anything else, and the account page draws no live card for a config key outside it).

The module is DATA plus, for anything the data cannot say, a step. Every step takes the SAME one context object and is called as a method on the module ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)):

```js
// src/connections/twitch.js
module.exports = {
  provider: 'twitch',                // the key, matching the file name
  name: 'Twitch',                    // human name (the card's, and the "already connected" refusal's)
  urls: {
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    token: 'https://id.twitch.tv/oauth2/token',                   // the exchange AND the refresh
    revoke: 'https://id.twitch.tv/oauth2/revoke',                 // optional — no url means revoke is unsupported
    removeAccess: 'https://www.twitch.tv/settings/connections',   // named in the "no refresh_token" error
  },
  scope: ['user:read:email'],        // the default; a brand's `connections.twitch.scope` wins
  params: {},                        // extra authorize query params (Google's access_type/prompt live here)
  pkce: 'S256',                      // optional; the whole PKCE declaration

  // The ONE required step: who this token belongs to
  async identity(context) { /* → { id, ...profile } */ },

  // Optional — each one replaces a default (see the step table)
  async authorize(context) {},
  async exchange(context) {},
  async refresh(context) {},
  async revoke(context) {},
  async status(context) {},
};
```

A module that declares neither `urls.authorize` nor `authorize()` — or neither `urls.token` nor `exchange()`, or no `identity()` at all — throws at load naming the file and the missing field (the file NAME, never the deployed path: the request that trips it is a signed-in user's). That is a programmer error, not a caller's typo, so it is never the 400 an unknown provider name gets.

**Never log the token response, the identity, or a code/verifier** ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)): `identity()` opens with the one allowed line (`logIdentityCheck` from [_providers.js](../src/manager/routes/user/connections/_providers.js), or its equivalent — provider, uid, whether the exchange succeeded), and no identity fetch carries wonderful-fetch's `log: true`, which would print the authorization header.

**2. The two env keys**, in the brand `.env`: `CONNECTIONS_<PROVIDER>_CLIENT_ID` and `CONNECTIONS_<PROVIDER>_CLIENT_SECRET` (the provider name uppercased, dashes as underscores: `sandbox-pkce` → `CONNECTIONS_SANDBOX_PKCE_CLIENT_ID`). The redirect URI to register with the provider is `<websiteUrl>/connections/callback`, for every provider.

A **public client** (Twitch registers one; the brand then holds an id and no secret) leaves the secret key out, or empty: the exchange and the refresh bodies omit `client_secret` entirely rather than sending it empty, which a token endpoint reads as a WRONG secret and refuses the grant with ([#785](https://github.com/Omega-JS-Stack/omega/issues/785)). Where the provider supports PKCE, declare `pkce: 'S256'` beside it — for a client with no secret the verifier is what proves the exchange, and the lane already mints one per authorize leg.

(The third thing used to be a config entry carrying the card's `name` and `logo`. It still exists — see the card rule below — but the framework's config defaults carry both for the five packaged providers, so enabling one is one line.)

## The context every step is called with

| Key | What it is |
|---|---|
| `provider` | The provider module itself (so an override never needs `this`) |
| `providerName` | The key it was loaded by |
| `Manager`, `ctx` | The BackendManager and the route context (`ctx.log`) |
| `uid` | The user this connect is for — what `identity()` logs |
| `clientId`, `clientSecret` | The resolved `CONNECTIONS_<PROVIDER>_*` pair (`clientSecret` undefined for a public client) |
| `redirectUri` | `<websiteUrl>/connections/callback` |
| `scope` | The resolved scope array — the brand's config value, else the module's |
| `state` | The encrypted state (authorize only) |
| `pkce` | `{ verifier, challenge }`, or null when the provider declares no PKCE |
| `code` | The authorization code (exchange only) |
| `token` | The exchange RESPONSE for `identity`; the STORED token record for `refresh`, `revoke` and `status` |
| `fetch` | The lane's HTTP call ([wonderful-fetch](https://www.npmjs.com/package/wonderful-fetch)) — the one seam a step makes a request through |

## The steps

| Step | Default | What an override answers |
|---|---|---|
| `authorize` | `urls.authorize` + state, client_id, redirect_uri, response_type, scope, `params`, and the PKCE challenge | The authorization URL, as a string |
| `exchange` | Form-encoded `authorization_code` POST to `urls.token`, plus `code_verifier` when PKCE | The token response object |
| `identity` | **No default — required.** | `{ id, ...profile }`; `id` is the provider's stable account id, as a STRING |
| `refresh` | Form-encoded `refresh_token` POST to `urls.token` | The token response object |
| `revoke` | RFC 7009 form POST to `urls.revoke` carrying `token`, plus `client_id` / `client_secret` when set. **No `urls.revoke` = "unsupported"**, and the record is deleted regardless | Nothing; throw to report a failure |
| `status` | **No default**: a stored refresh token means `connected` | `'connected'` or `'disconnected'` |

```js
// A provider whose token endpoint wants HTTP Basic and JSON
async exchange(context) {
  const { clientId, clientSecret, redirectUri, code, pkce, fetch } = context;

  return fetch(this.urls.token, {
    method: 'POST',
    response: 'json',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: { grant_type: 'authorization_code', redirect_uri: redirectUri, code, code_verifier: pkce?.verifier },
  });
}
```

Device-code grants are out of scope: they have no browser redirect, and this lane is the redirect flow.

## One account per provider identity — the ROUTE's job

After `identity()` answers, `tokenize` runs ONE query, `where('connections.<provider>.identity.id', '==', identity.id)`, and refuses with **400** — `This <Name> account is already connected to a <brand> account` — only when a matching document is NOT the connecting user's ([#791](https://github.com/Omega-JS-Stack/omega/issues/791)). A user reconnecting their own account (to widen a scope, or after a failed refresh left the record behind) passes, which is the bug the per-provider copies of this check all had.

**A provider never writes this check.** Its one job is to answer who the token belongs to, and an `identity()` that answers no string `id` is a programmer error: the route throws naming the provider file, exactly as a missing url does at load.

## PKCE

A provider that needs a code challenge declares one thing:

```js
pkce: 'S256',
```

The lane does the rest: authorize mints a 32-byte verifier, stores it beside the CSRF token in `usage/{uid}`, and sends `code_challenge` + `code_challenge_method=S256`; tokenize reads the verifier back, sends it as `code_verifier`, and deletes the session entry with the CSRF token. The verifier never leaves the server, and no other step changes. `S256` is the only accepted value — anything else throws at load.

## The account page's card

The `connections` CONFIG is the only card list ([#792](https://github.com/Omega-JS-Stack/omega/issues/792)): every entry carrying a `name` and a `logo` draws a card, and there is no template row anywhere to shadow it.

The framework's config DEFAULTS carry `name`, `logo` and `description` for the five packaged providers, so enabling one is one line, and a brand's own value wins per key through the ordinary merge chain:

```json5
connections: {
  twitch: {
    enabled: true,                    // the packaged five default to false — this is what turns one on
    scope: ['user:read:email', 'channel:read:subscriptions'],   // wins over the module's default
  },
  'house-sso': {                      // a brand's own provider says all of it
    enabled: true,
    name: 'House SSO',
    logo: 'https://cdn.example.com/house.svg',
    description: 'Connect to the house directory',
  },
},
```

`logo` takes ONE of two shapes: the NAME of a mark `@omega.js/web` ships (`core/logos/brandmarks/original/<name>.svg`, drawn inline — what the packaged defaults use), or a full URL (drawn as an `<img>`). A value carrying a `/` or a `:` is a URL; anything else is a mark name. An enabled provider with no `name` + `logo` after the merge renders the "unsupported connection" card saying exactly that ([docs/web/index.md](../../../docs/web/index.md)).

## Concurrent refreshes

A backend never runs as ONE process, and a refresh token is single-use at any provider that rotates it (Twitch does). Two instances refreshing the same user's same provider at once spend it twice: the second exchange is refused, and the token it stores is dead. Nothing in a process can see the other one, so a refresh takes a LEASE on the record, in a Firestore transaction ([#783](https://github.com/Omega-JS-Stack/omega/issues/783)).

- **The winner** is the caller that found no `refreshing` note, or one older than the **30-second** expiry. The transaction writes `refreshing: { instance, timestamp, timestampUNIX }` — `instance` being a random id minted once per process — and that caller runs the provider, with the token **the transaction saw** (the read before it can already be one rotation old). Its success write stores the new token and removes the note in the SAME `set(..., { merge: true })`; a provider failure removes the note too, so a crashed instance never wedges the record past the expiry.
- **The loser** is the caller that found a fresh note, and it touches the provider not at all. It re-reads the record every 500 ms for up to 10 seconds, and answers one of three things: the STORED token once `updated.timestampUNIX` moves past what it saw at entry; **409** "did not complete" when the note clears without the stamp moving (the winner's own call failed, and the stored token is the pre-refresh one — never worth answering as a success); **409** naming the stalled refresh when neither happens inside the window. It writes nothing on any path.

**The two numbers hold each other**: the refresh step's HTTP call times out at **20 s**, inside the **30 s** lease. A call allowed to outlive its lease would let a second caller reclaim the lease under a running refresh and spend the same one-time token — the race this whole section exists to stop — so `_lease.js` reads the timeout from `_grant.js` and throws at load if the lease is not the longer of the two. (The token EXCHANGE keeps its 60 s: it holds no lease.)

Both success paths answer `{ success: true, token }`, the token object as stored, so a caller refreshes and reads in one call.

## Reading the token from another target

The stored record is part of the user document, so any target that can read a user reads the connection. **The token is stored in plain text in the user document** — a target that reads one is holding a live third-party credential, and treats it like one.

- **As the user** — `GET /omega/user` returns the full user document, `connections.<provider>.token` included. It answers for whoever authenticated, and takes NO `uid`.
- **As a trusted service** — `GET /omega/admin/firestore?path=users/<uid>` with the `omega-admin-key` header. A plain read of a document is the admin firestore route's job, not a per-route `uid` argument ([#782](https://github.com/Omega-JS-Stack/omega/issues/782)); the answer is the user document, `connections.<provider>.token` included.
- **Refreshing** — `POST /omega/user/connections` `{ action: 'refresh', provider: 'twitch' }` as the user, or with `uid` as an admin. It writes the new token back to the record AND answers it (`{ success: true, token }`), so a refresh needs no second read. Concurrent refreshes are serialized by the lease above.

An access token that has expired is not refreshed implicitly by any read: a consumer that holds one refreshes it explicitly (the call above) before it calls the third party.

## The route folder

One concern per file ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)), and no file re-exports another's utilities:

| File | What lives there |
|---|---|
| `get.js` / `post.js` / `delete.js` | The verbs: authorize + status, tokenize + refresh, the disconnect |
| `_providers.js` | Finding a module (the brand's dir, then the package's), the shape assertion, the credential pair, `logIdentityCheck` |
| `_state.js` | The CSRF token, the PKCE pair, the state cipher and its TTL |
| `_grant.js` | The default steps, `runStep`, and the one context builder |
| `_context.js` | Who a call acts on: `buildContext`, `droppedUidError`, `returnUrlError` |
| `_lease.js` | The refresh lease (above) |

## Testing

The framework's offline cases live in [test/routes/user/connections-grant.test.js](../test/routes/user/connections-grant.test.js) (the PKCE math, the default steps including `revoke`, the override call, the brand-directory precedence, the load-time shape failure), [test/routes/user/connections-identity.test.js](../test/routes/user/connections-identity.test.js) (the route-owned uniqueness: own uid passes, another's refuses, an identity with no id throws, Google's `sub`, and every packaged provider through the shape assertion), [test/routes/user/connections-log-privacy.test.js](../test/routes/user/connections-log-privacy.test.js) (what a provider's identity step may log), [test/routes/user/connections-uid.test.js](../test/routes/user/connections-uid.test.js) (which actions honor an admin's `uid`, that the schemas give `uid` no default, and that this doc sends a trusted read to the admin firestore route), [test/routes/user/connections-refresh-lease.test.js](../test/routes/user/connections-refresh-lease.test.js) (the lease transaction, the winner's one write, the loser's wait and its 409), and [test/routes/user/connections-return.test.js](../test/routes/user/connections-return.test.js) (the `returnUrl` path: the round trip through the state, the 400 per off-site shape, and the answer that names nothing when nothing was asked for). The emulator round trip — a brand provider with `pkce: 'S256'`, authorize through tokenize, against a fake authorization server on this machine — is the sandbox brand's own project test, `brands/sandbox-brand/targets/backend/test/routes/connections-pkce.test.js`.
