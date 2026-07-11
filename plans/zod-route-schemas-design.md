# Zod route schemas — design (N4, shapes preserved)

> Status: DESIGN (survey complete, implementation queued). Decision source: core-changes inbox "zod route schemas". Hard rule: **wire shapes are preserved** — zod replaces the validation ENGINE, not the observed behavior. Survey: cp73c route-inventory agent (full per-route detail lived in that report; this doc is the self-contained distillation).

## What exists today (the seam zod slots into)

- **One HTTPS function serves the whole HTTP surface**: `omega_api` (`src/manager/index.js:924-942`), dispatched by `BackendRouter.resolve()` → legacy command actions (`command` contains `:`) or `Middleware.run()` for RESTful routes.
- **Every RESTful route already has a declarative schema**: `schemas/<route>/<method>.js` (fallback `<route>/index.js`), resolved by `Settings.resolve` (`src/manager/helpers/settings.js:20-164`), which runs `powertools.defaults(settings, schema)` then per-node `required`/`clean`. Called from the ONE choke point `Middleware.run()` (`helpers/middleware.js:153`), followed by an unconditional string-trim (`:181`) and opt-in HTML sanitize (`:186`).
- **Consumer routes shadow framework routes** (`_processMiddleware` checks the consumer's `routes/` first) — the schema-file convention is part of the consumer contract.
- Auth fields (`backendManagerKey`, `authenticationToken`, `apiKey`, captcha responses, `wakeup`/`command`/`payload`) are read from **raw `request.data`** by `assistant.authenticate()`/usage — they never pass through the schema and must keep working untouched.
- Error responses are **plain text** (`assistant.errorify` → `res.status(code).send(String)`), plus the `omega-properties` JSON header. Success = JSON via `assistant.respond`.

## Slot-in design (decided)

Extend the schema-module contract: a `schemas/<route>/<method>.js` may export a **zod schema** (or `{ schema, zod }` during migration). `Settings.resolve` detects a ZodType and runs `.safeParse` in place of `powertools.defaults`; validation failures go through the EXISTING error path (`assistant.respond(message, { code: 400 })` at middleware.js:155) so the plain-text body + `omega-properties` header shape is untouched. Nothing changes at the router or middleware level; per-route wiring stays declarative and co-located. The legacy command API (`functions/core/actions/api/**`) has NO schema seam — it reads `payload.*` inline and is migrated separately (or never; it's opt-in `setupFunctionsLegacy`, default off).

## The preservation checklist (powertools semantics zod MUST replicate)

Verified against `node-powertools/dist/index.js` (`defaults` :294-336, `enforceValidTypes`/`enforceMinMax` :265-293, `force*` :82-169):

1. **Unknown/extra keys are silently STRIPPED, never rejected** → zod `.strip()` (the default), NEVER `.strict()`. Validate `settings` (post-strip), never raw `request.data`.
2. **Single-typed fields COERCE, never reject** — with powertools' exact rules, NOT `z.coerce`: `types:['number']` + `"42"` → 42, **unparseable string → `1`**, null/undefined → `0`; `types:['boolean']`: `"false"`/`"0"` → false, other truthy strings → true; `types:['array']` + `"a,b"` → `['a','b']` (comma-split, trimmed, empties dropped). Implement once as shared `z.preprocess` helpers mirroring `forceType`/`forceBoolean`/`forceArray`.
3. **Multi-typed fields replace-with-default on mismatch** (no error): `z.union([...]).catch(default)`.
4. **min/max CLAMP/TRUNCATE, never reject**: numbers clamp to [min,max]; strings/arrays truncate to max. Transforms, not `.min()/.max()` validators.
5. **`required` fires ONLY on `undefined`** — `''`, `null`, `0`, `false` all pass; handlers' own manual `if (!x)` re-checks (with their exact messages, e.g. "Missing required parameter: title") stay where they are. Do NOT use `.nonempty()`.
6. **Object-typed fields pass ALL nested content through**: `config`, `data`, `verification`, `attribution`, `supplemental`, `notification`, `filters`, `payload`, `queries[]`, `recurrence`, `utm`, `existingSettings`, `newSettings`, `consent` → `.passthrough()` / `z.record(z.any())`.
7. **`enum` is currently DECORATIVE** (declared in `schemas/user/oauth2/*` but never enforced). A zod enum would newly reject — that's a tightening decision for Ian, not a silent change. Ship non-enforcing first.
8. **Legacy aliases survive**: `general/uuid` `input`→`name`; `version` accepts `5`/`'5'`/`'v5'`; `user/api-keys` `keys` array|string; `admin/email` recipients array|string|object; `asmId`/`group`/`sendAt`/`start`/`end`/`limit` string|number.
9. **Hyphenated literal keys** stay: `'g-recaptcha-response'`, `'h-captcha-response'`.
10. **Webhook routes keep EMPTY schemas by design** (`payments/webhook`, `payments/dispute-alert`, `marketing/webhook`, `marketing/webhook/forward`): auth is `?key=OMEGA_WEBHOOK_KEY` in the query, body is the raw provider payload parsed downstream — zod must not touch the body.
11. **Env-gated auth quirk**: `admin/backup|cron|hook|users/sync` skip auth checks when `!isProduction()` — schemas must not assume authenticated context.
12. **The trim step** (middleware.js:181) runs AFTER resolve on all strings — keep order.
13. Known oddities preserved as-is (candidates for a later deliberate cleanup, not this change): `restart` schema declares `delay` the handler never reads; `marketing/email-preferences` doc-comment mentions stale `opt-in`/`opt-out` actions; admin-403 message inconsistency (`'Admin required.'` vs `'Admin required'`).

## Migration order

1. Land the `Settings.resolve` zod branch + the shared preprocess helpers (+ tests proving parity on `test/schema`, the reference route that exercises every field option).
2. Convert routes in cohorts, cheapest/lowest-risk first (test/*, general/*), diffing resolved `settings` old-vs-new per route fixture.
3. Admin + payments + marketing last (nested passthrough heavy).
4. Leave the legacy command API alone.
5. AFTER parity ships, propose the tightenings to Ian as one list (enum enforcement, empty-string required, unknown-key rejection on admin routes).
