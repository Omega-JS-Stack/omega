# authorizedFetch — one harmonized API-fetch layer (proposal)

> Ian's own codebase; self-commissioned design note. Raised at cp260 item 4; scope widened by Ian 2026-07-22:
> "i want our backend and frontend fetches overall to be harmonized … the backend sends things like usage
> data as a header, we need to process that intelligently and ideally automatically by passing the usage
> to the bindings system — that could be part of the authorized fetch addition/rework."
> STATUS: BUILT (cp261, 2026-07-22) — Ian GO'd all three calls: name `omega.request()`, server usage
> keeps the `usage` bindings key (local device stats moved to `device`), built standalone ahead of the
> assistant refactor. Implementation: `packages/client/src/modules/request.js` (+ `device.js` rename);
> desktop client-bridge and extension background consume `createRequest`. This file is now the record
> of the design; behavior docs live in client docs/modules.md + docs/bindings.md.

## Prior art (the legacy one worked)

Legacy UJM `src/assets/js/libs/authorized-fetch.js`:
- wonderful-fetch wrapper; fresh `user.getIdToken(true)` → `Authorization: Bearer`
- forced `output: 'complete'` internally so it could read response headers, returned body unless caller asked for complete
- parsed the `bm-properties` header and merged `usage.current` + `usage.limits` into the bindings
  `usage` context key (shape `{ credits: { monthly, daily, limit } }`) — automatic `data-wm-bind` refresh

Defect was placement, not design: it lived in UJM page-JS, so desktop main, the extension SW, and BXM
hand-rolled their own fetches (the cp260 token-sync bugs). The backend still emits the header —
now `omega-properties` (`code, tag, usage: {current, limits}, schema, additional`,
`helpers/assistant.js _attachHeaderProperties`, exposed via Access-Control-Expose-Headers) — and NOTHING
in the monorepo reads it today.

## Proposed shape

One implementation in `@omega.js/client` (the runtime dep of web/desktop/extension already):

```js
// omega.request() — module `src/modules/request.js` (name RATIFIED, Ian 2026-07-22)
const data = await omega.request('/omega/user/token', { method: 'POST', body: {} });
```

- **Route-relative**: leading-`/` paths resolve through the host framework's `getApiUrl()`
  (each Manager hands its url-helpers to the client at initialize); absolute URLs pass through.
- **Auth automatic**: current user → fresh ID token → Bearer header; warn (not throw) when signed out,
  matching legacy. Explicit `auth: false` opt-out for public routes.
- **JSON in/out**: object body → JSON.stringify + content-type; non-ok → throw an Error carrying
  `code` + body message (aligns with backend assistant status-code semantics — keep, per Ian).
- **omega-properties processing, automatic**: every response parses the header; `usage` merges into
  the bindings context exactly like legacy (server API usage, distinct from the client `usage` module's
  local device stats — key naming decided at build time to avoid collision); `code/tag/schema/additional`
  exposed on the returned response object for callers that want them. In non-bindings contexts
  (desktop main, extension SW) the header still parses and surfaces; bindings sync no-ops cleanly.
- **Context-safe**: browser, Electron renderer, Electron main (Node fetch), extension SW/popup/content.
  Desktop main + extension background replace their hand-rolled blocks (client-bridge `_fetchCustomToken`,
  background syncAuth) — the `test:auth` e2e lane pins the contract through the rework.
- wonderful-fetch stays or goes based on what it still buys us (retries/timeouts) vs native fetch —
  decide at build; not a shape question.

## Open for Ian

1. ~~Name~~ — RATIFIED: `omega.request()` (Ian 2026-07-22; `omega.api()` rejected earlier same day).
2. Bindings key for server usage (legacy used top-level `usage`; client's local-usage module also binds
   `usage` — one must move or merge).
3. Sequence: standalone, or folded into the assistant refactor (plans/assistant-refactor.md) since
   the header emitter is being reworked there anyway.
