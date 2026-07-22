---
status: active
created: 2026-07-22
---
> Ian 2026-07-22: GO + name RATIFIED — ctx / RouteContext.

# Assistant library review + optimization (backend `helpers/assistant.js`)

Ian's ask (2026-07-22, verbatim intent): "can you table a review+optimization of the whole assistant library? I made that thing so long ago and the functions are so disorganized and badly named and bad signatures. like sentry integration there is weird right? but I do like the headers and status codes management, I just think assistant is a bad name and should be [renamed] to something more sensible."

## Scope
- **Rename** the `assistant` concept (class `BackendAssistant`, the `{ assistant }` context key every route/schema/hook receives) to a sensible name. This touches the whole route contract — every handler, test, doc, and consumer project. Naming is Ian's call: propose candidates first.
- **Reorganize + rename functions, fix signatures** — the file is a grab-bag (auth, logging, request parsing, response, usage, errors). Likely split into focused modules per the one-concern-per-file rule.
- **Sentry integration** — Ian flags it as weird (errorify's `options.sentry`/`options.log` defaulting dance, capture inside the response path). Rework deliberately.
- **KEEP the semantics Ian likes**: the `omega-properties` header management and status-code handling (including the cp259 `headersSent` guards and code-clamping behavior).

## Proposal (cp263 survey, 2026-07-22 — awaiting Ian's name pick)

Survey facts: 1149-line single file; usage across the tree is dominated by `assistant.log` (559),
`.respond` (372), `.error` (172), `.request` (95), `.errorify` (25); handlers receive
`({ assistant, user, settings, libraries })`; NO brand/consumer routes touch `assistant`
(omega-brand + in-repo brands checked) — the rename is framework-internal + docs/templates.
Live defect found: `logProd()` references an undefined `args` and would throw if called.

### Name candidates (the context key + class)
1. **`ctx` (class `RouteContext`) — recommended.** Industry vocabulary (Koa/route context),
   terse for the 559 log call sites: `ctx.log()`, `ctx.respond({token})`, `ctx.authenticate()`.
2. `api` (class `ApiContext`) — reads well (`api.respond(...)`) but overloads "api".
3. `exchange` (class `Exchange`) — precise (one HTTP request/response pair), unusual in JS.

### Module split (`helpers/context/` — one concern per file, mixin onto the class)
- `index.js` — class + init wiring (req/res refs, tag/id, parsed request assembly)
- `logging.js` — `log`/`warn`/`error` + prefix management; `logProd` deleted (broken, zero callers)
- `respond.js` — `respond`/`redirect` + status-code clamping + the omega-properties header
  attach (KEPT semantics verbatim, incl. cp259 headersSent guards) — the wire contract's one home
- `authenticate.js` — `authenticate()`
- `client-info.js` — the 13 `getHeader*` readers collapse to one `getClient()` returning
  `{ ip, continent, country, region, city, latitude, longitude, userAgent, language, platform,
  mobile, url }` (individual getters retired; ~zero external callers each)
- `parse.js` — body/query/multipart parsing; `parseRepo` RELOCATES to the github library
  (repo-string parsing is not request-context work)

### Signature fixes
- **One response door**: `respond(payload, options)` — an Error payload takes the error path;
  `errorify` (25 sites) + the `errorManager` alias retire. Status-code semantics unchanged.
- `init(ref, options)` keeps its shape (middleware is its only caller).

### Sentry rework (the "weird" part)
Today errorify does an `options.sentry`/`options.log` defaulting dance per call site. Proposal:
delete both flags; ONE rule at the response layer — server-fault responses (code >= 500) capture
to Sentry automatically, client-fault (4xx) never do; hand-picked captures use an explicit
`ctx.report(error)`. Predictable, zero per-call ceremony.

### Migration
In-repo sweep only (handlers, middleware, tests, docs, consumer templates/defaults, the
`{ assistant }` destructures). No-backwards-compat ruling applies — no alias key left behind.
Proof: backend suite + full root battery.

## Constraints
- Consumer-facing contract change → migration story required (data-shape preservation ruling applies to route semantics; flag breaking changes with a plan, don't just build).
- Sequence AFTER cp260 (the legacy command lane deletion shrinks the surface first) and fits naturally with the wave 2 follow-up work.
- Propose the new name + module split to Ian before executing.
