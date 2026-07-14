# TODO: Admin Key → `omega-admin-key` Header — retire the `backendManagerKey` wire field

> Decision Ian 2026-07-14: the admin key should travel as a **request header**, not a query-string
> or body field. This doc is the sweep plan + full site inventory. Sister doc:
> [TODO-WEBHOOK-KEY-UPGRADE.md](TODO-WEBHOOK-KEY-UPGRADE.md) (scoped webhook key — the ONE lane
> that legitimately stays query-string, because Stripe/PayPal/Chargebee can't set custom headers;
> its env names are BEM-era — monorepo equivalents are `OMEGA_ADMIN_KEY` / `OMEGA_WEBHOOK_KEY`).

## Context — the wire truth today

The BEM port renamed the **env var** (`BACKEND_MANAGER_KEY` → `OMEGA_ADMIN_KEY`) but NOT the
**wire field**: `authenticate()` ([src/manager/helpers/assistant.js:678](src/manager/helpers/assistant.js#L678))
still reads `options.backendManagerKey || data.backendManagerKey`, and since
`request.data = _.merge({}, body, query)` ([assistant.js:249](src/manager/helpers/assistant.js#L249)),
the admin key is accepted from the request **body OR the query string** today. Our own MCP client
literally does `url.searchParams.set('backendManagerKey', …)` on GETs.

The `Authorization: Bearer` header is the **user lane** (JWT → Firebase verify; non-JWT →
`users.api.privateKey` lookup) and stays user-only. Admin-acting-on-user requests legitimately
carry BOTH credentials at once (e.g. the user/delete admin flow, MCP admin ops targeting a user) —
which is why the admin key can never share the `Authorization` header.

## The new convention

```
omega-admin-key: <OMEGA_ADMIN_KEY>
```

- **Header, raw value** (no `Bearer` scheme — schemes belong to `Authorization`).
- **Name rationale**: 1:1 with the `OMEGA_ADMIN_KEY` env var; unambiguous vs the user `apiKey`
  concept; no `x-` prefix (RFC 6648 deprecated it; codebase precedent is the un-prefixed
  `omega-properties` response header).
- **Why not query**: keys land in LB/CDN/server access logs, browser history, and Referer headers.
- **Why not body**: pollutes every payload/schema, impossible on GET, forces auth-after-parse, and
  every client must remember to merge it into its JSON (the bug class the Ghostii pin guards).
- Firebase Hosting rewrites forward custom request headers to Cloud Functions — no infra blocker.
- The MCP client is plain fetch (wonderful-fetch), NOT EventSource — nothing forces its
  query-string lane; it flips cleanly.

## Sweep plan

**Phase 1 — core accepts the header** (additive):
`authenticate()` reads `req.headers['omega-admin-key']` FIRST, then the legacy `options/data`
field. Log a deprecation note when the legacy field is the lane that matched.

**Phase 2 — every first-party caller flips to the header:**

| File | Sites | Nature |
|---|---|---|
| [src/mcp/client.js](src/mcp/client.js) | 14, 40–57 | kill `searchParams.set` + body merge → header |
| [src/mcp/handler.js](src/mcp/handler.js) / [src/mcp/index.js](src/mcp/index.js) | 1 / 4 | server-side read → header |
| [src/cli/commands/mcp.js](src/cli/commands/mcp.js), [test.js](src/cli/commands/test.js), [setup.js](src/cli/commands/setup.js), [deploy.js](src/cli/commands/deploy.js) | 2/3/1/1 | env read + threading |
| [src/test/utils/http-client.js](src/test/utils/http-client.js) | 24–70 | new auth type `adminKey` (header); keep a legacy-lane case only as acceptance-window coverage |
| [src/test/runner.js](src/test/runner.js) | 4 | context threading |
| [src/manager/routes/handler/post/post.js](src/manager/routes/handler/post/post.js) | 39, 82 | self-call → header |
| [src/manager/functions/core/actions/api/general/send-email.js](src/manager/functions/core/actions/api/general/send-email.js) | 28, 91 | self-call → header |
| [src/manager/routes/user/delete.js](src/manager/routes/user/delete.js) | 57 | self-call → header |
| [src/manager/functions/core/actions/api/user/delete.js](src/manager/functions/core/actions/api/user/delete.js) | 1 | payload passthrough |
| [src/manager/functions/core/actions/api.js](src/manager/functions/core/actions/api.js) | 186–188 | payload passthrough |
| [src/manager/functions/core/actions/api/special/setup-electron-manager-client.js](src/manager/functions/core/actions/api/special/setup-electron-manager-client.js) | 2 | pairs with the desktop framework flip |
| [src/manager/functions/_legacy/actions/create-post-handler.js](src/manager/functions/_legacy/actions/create-post-handler.js) | 1 | flip or retire with `_legacy/` |

**Phase 3 — outbound cross-product clients: PINNED, do NOT flip** (each flips only when its
TARGET migrates to the new stack):

| File | Target | Trigger |
|---|---|---|
| [src/manager/libraries/content/ghostii.js:44,145](src/manager/libraries/content/ghostii.js#L44) | Ghostii production (legacy BEM) | Ghostii backend migrates |
| `packages/manager/src/devlog/lib/ghostii.js:54` | Ghostii production (legacy BEM) | same (pin comment already in place) |
| [src/manager/libraries/content/source-resolver.js:216](src/manager/libraries/content/source-resolver.js#L216) | `$parent` brand's backend | that parent brand migrates |

Add the devlog-style wire-pin comment to the two backend files (only devlog has it today).

**Phase 4 — tests + docs**: the 17 `backendManagerKey` sites under `test/` pin BOTH lanes during
the acceptance window; README auth section, [docs/admin-post-route.md](docs/admin-post-route.md),
[docs/mcp.md](docs/mcp.md), and the middleware's commented-out block get the new spelling.

**Phase 5 — retire the legacy field (fleet-gated).** Drop `options/data.backendManagerKey`
acceptance from `authenticate()` once no deployed LEGACY caller still sends it. Inbound legacy
traffic we don't control the update cadence of: legacy EM desktop apps
([src/manager/routes/special/electron-client/post.js:40](src/manager/routes/special/electron-client/post.js#L40)
validates `config.backendManagerKey` from the client), and legacy BEM child brands calling a
migrated parent's feed. This is a **wire-compat window for deployed binaries**, not config
dual-read — it retires per-fleet, with the brand-rebuild arc.

## Success criteria

- `authenticate()` grants admin from the header; backend suite green with the header as the
  DEFAULT test lane and one legacy-lane pin.
- Zero first-party `backendManagerKey` writes outside the three pinned outbound clients + tests.
- Query string carries NO admin key anywhere (webhooks keep their scoped `?key=` per the sister doc).
