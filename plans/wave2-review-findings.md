---
status: fixed-pending-ian
created: 2026-07-21
wave: 2 (manager + backend)
source: Workflow wf_223c4172-bb1 (2× Fable medium, read-only); hand-verified by coordinator
---

# Wave 2 Review Findings — manager + backend (2026-07-21)

## Context

This is an internal code-quality review of **Ian's own pre-release codebase**, commissioned by Ian and carried out on the repo he owns. It is a staged, wave-by-wave hardening pass over the OMEGA monorepo: each wave reads a package group, records defects, and ships one remediation checkpoint. No third-party system is involved, no production data is accessed, and every item below is a defect in first-party code that the same effort then fixes.

The packages here are unpublished (`private: true`, local `file:` specs, zero npm releases). One brand backend is deployed to Ian's own Firebase project. Wave 1 (repo-foundation + devkit) shipped as cp240/cp241. This document is wave 2 (manager + backend); its remediation is **cp259**.

Findings are ordered by priority (P0 = fix first). Each entry names the defect, the file, and the fix. Reproduction cases live in the regression tests rather than in this document.

## Status (2026-07-21, cp259 — UNCOMMITTED on Ian's order)

**Resolved and tested (13):** B1, B3, B4, B5, B6, B7, B8, B10, B11, MGR-1, MGR-2, MGR-3, MGR-4, MGR-5, MGR-6, MGR-8, MGR-9.
Full root battery green: backend 1326 passing / 44 skipped, manager 779/779, corpus 8/8 shapes + 1310, cross-stack e2e + verts e2e + wizard journey all passed. B1, B4, B6, B7, B10 and MGR-1/5/8 carry dedicated regression tests (B1's was confirmed to fail against the pre-fix code); the rest are covered by the existing battery rather than a purpose-written test.

**Third-pass review (2026-07-21, 4-lens + scorer):** confirmed all 13 fixes; three more same-class items found and closed in the same batch — the two email-template endpoints now resolve their caller-supplied id through `loadTemplate` (beside `loadProcessor`, B6's class); `errorify()`'s header-attach step is gated on `headersSent` so a direct `errorify(..., {send:true})` after a response no longer crashes (B5's class); and the CHANGELOG/build-system.md boot-throw wording was corrected to the shipped projectId comparison. Four new tests (2 loader, 2 omit-field rules cases). Backend 1332/44 after.

**Requires a deploy to take effect:** B3 — the live `verts/serve` Firestore read fails until the brand backend is redeployed. The rules copy in the sibling `omega-brand` repo also still carries the pre-B7 notifications block — regenerate + deploy rules with the same redeploy.

**Open, awaiting Ian's direction (not defects of omission — deliberate holds):** B2, B9, M21, M22. See the bottom section.

**Not in this batch:** MGR-7 (retry/backoff). H5 (MCP OAuth) was not re-read this pass — depth budget. Both carry forward.

## Backend

- **B1 (P0, confirms C1)** — Command names in the legacy command API were resolved to a module path without validation. The sanitizer stripped `../` in a single pass, which does not account for overlapping sequences, so a malformed name could resolve outside the intended command directory and load an unintended module. No allowlist, and the resolution happened before any auth gate. `functions/core/actions/api.js:349`, wired at `index.js:945-947`. **Fix:** validate against a strict colon-joined `[a-z0-9_-]` pattern before any path math; reject anything else with a 400. **Verified in source.**
- **B2 (P0, confirms C2)** — Payment webhook requests are authenticated only by a static shared key passed as a query param, compared with `!==`. No per-processor signature verification (no Stripe `constructEvent`/HMAC). `fetchResource` falls back to trusting the request body when the processor API fetch fails. The `test` processor is reachable in production and derives the subscription owner from request-supplied `metadata.uid` with no external confirmation fetch. `routes/payments/webhook/post.js:28`. **Fix:** per-processor signature verification; drop the trust-on-failure fallback; restrict `test` to non-production; constant-time key comparison. **Verified in source.** *(Ian's call — payment gate.)*
- **B3 (P1, root cause of the live `UNAUTHENTICATED`)** — Deployed Firestore auth used the staged `service-account.json` rather than the runtime's own identity. Cloud Functions gen1 does not set `GOOGLE_APPLICATION_CREDENTIALS`, so the runtime always took the cert branch; a key for the wrong project then fails every Firestore read with gRPC `UNAUTHENTICATED (16)`, surfacing far from the cause (`verts/serve` is simply the first public path to hit it). The project-mismatch guard only warned and continued. `index.js:431-446`. **Fix:** no-arg `admin.initializeApp()` on any managed runtime (`K_SERVICE`/`FUNCTION_TARGET`/emulator/explicit ADC); when a cert genuinely is in play, throw at boot on a project mismatch instead of logging. The check compares the cert's `project_id` to the resolved Firebase `projectId` EXACTLY — an earlier revision compared it to `brand.id` by substring, which false-negatives (brand `omega-playground` runs on project `omegajs-playground`) and false-positives (a two-letter brand id matches almost anything). When no expected project is resolvable, boot proceeds rather than guessing. **Verified in source.**
- **B4 (P1, confirms H14)** — `admin/post` preferred caller-supplied `githubUser`/`githubRepo` over brand config while using the shared `GH_TOKEN`, so a blogger-role account could direct a commit at any repo that token could reach. The schema accepted both as free strings. `post.js:101-102,374-375`. **Fix:** always derive owner/repo from brand config; remove both keys from the schemas. **Verified in source.**
- **B5 (P1, confirms H13)** — Responding twice on a write failure crashes the request. `return` inside a `.catch` callback exits only the callback, so three routes continued to the success response: `user/feedback/post.js:66-70`, `admin/database/post.js:27-31`, `user/api-keys/post.js:44-48`. `assistant.respond()` had no guard. **Fix:** `res.headersSent` guard in `respond()` and `errorify()`; convert the routes to the codebase's `.catch(e => e)` + `instanceof Error` idiom. The first pass converted only the three crashing routes; the corroborating review found the same shape in six more (`admin/database/get.js`, `admin/firestore/{get,post}.js`, `admin/firestore/query/post.js`, `user/token/post.js`, `user/sessions/get.js`), where the guard stopped the crash but a TypeError still followed the 500. All nine are converted.
- **B6 (P1, confirms H4)** — Nine route/event files resolved a processor module from a caller-supplied name with no validation (`path.resolve` honors `../`). Sites: `payments/{webhook,cancel,portal,intent,refund,dispute-alert}`, `marketing/webhook`, `payments-disputes` and `payments-webhooks` on-write. **Fix:** one shared `loadProcessor(dir, name)` restricted to `/^[a-z0-9-]+$/`. The first pass converted nine sites; the corroborating review found four more of the same shape (`user/oauth2/_helpers.js` ×2, the legacy `user/oauth2` command, and `admin/cron`), now converted too — thirteen in total, and `loadProcessor` is genuinely the only lookup path.
- **B7 (P2)** — The shipped `notifications` rules granted read and create to any client: `create: if true`, and the `existingData().token == token` condition is always true for a point read since the doc id *is* the token, so it added no restriction. Any client could enumerate and rewrite another user's push token and owner. `templates/firestore.rules:20-24`. **Fix:** point `get` only (the token is the capability), `list` denied so tokens cannot be enumerated by query, and create/update require `token` to match the doc id with `owner` either null or the caller's own uid.
- **B8 (P2, related M4)** — `authenticate()` wrote full credential values (admin key, bearer and session tokens) into log lines, which persist in Cloud Logging. `helpers/assistant.js:684,694,710`. **Fix:** log presence and last-4 only.
- **B9 (P2, partial H12)** — `firestore:set` and `auth:set-claims` still default to the production project with no confirmation step (`del` received a gate; these did not). `logs.js` also builds a gcloud shell string from `--search`/`--filter` without escaping. **Fix:** default to the emulator unless `--production`; add a confirm step; argv array for gcloud. *(Ian's call — changes established CLI behavior.)*
- **B10 (P2, confirms M4)** — Secret comparison used `===`/`!==` on the admin key (`assistant.js:654`) and the webhook key, which leaks match length through timing. **Fix:** shared length-safe `crypto.timingSafeEqual` helper.
- **B11 (P3)** — `getInventory()` had no error handling (`verts/utils.js:255-298`), so a transient Firestore error returned 500 from the public `verts/serve` route instead of a 204 no-fill, and the empty cache was re-fetched on every impression. **Fix:** try/catch returning last-good cache or `[]`, leaving `cache.fetched` untouched so the next impression retries.

Prior items re-confirmed as still present: M3 (`ensurePublicInvoker` silent), M21 (hardcoded email identity), M22 (`markdown-it html:true` on third-party content).

**What the backend already does well:** `verts/serve` `renderVertUnit` escapes every interpolated value, gates img src, and JSON.stringify's the inline script; `verts/redirect` is fail-closed to its own stored link; Firestore rules default-deny to `isAdmin`; the admin key is header-only; the inventory cache is sound (TTL, emulator ttl=0, reset on CRUD).

## Manager (no P0)

- **MGR-1 (P1, partial C2)** — All three payment webhook services printed the `OMEGA_WEBHOOK_KEY`-bearing URL to console (`payment/ensure/{stripe,paypal,chargebee}-webhook.js`; URL built at `payment/lib/payment-utils.js:53-59`). Campaigns and newsletter build the same URL and correctly do not print it. **Fix:** shared helper that masks `key=***`.
- **MGR-2 (P1, confirms H3)** — `github/lib/github-api.js` built shell strings escaping only `"`, so shell metacharacters in a brand description would be interpreted; `createRepo`'s homepage (line 117) was unescaped entirely. The sibling `seo/lib/gh-api.js` has a correct `shellEscape` that was never adopted. **Fix:** `execFileSync('gh', argv)` throughout.
- **MGR-3 (P1, confirms H3)** — Keychain and certificate passwords were interpolated into `execSync` strings (`certificates/lib/keychain.js:62/85/107`, `certificate-manager.js:130`, where `-passout pass:${pw}` was unquoted). A macOS login password containing `$` or `!` breaks it. **Fix:** `execFileSync` argv; password via `-passout env:`.
- **MGR-4 (P1, confirms+amplifies H15)** — Cross-brand provisioning-profile collision. `profiles.js:79` had no brand segment in the path while `certificates/index.js:200-201` shares `appleDir` at companyRoot, so `disperse/write/certs.js:44` copied one shared profile into every brand's apps and brand A shipped brand B's profile with the wrong bundle ID. **Fix:** brand segment in the path and in the disperse source map.
- **MGR-5 (P2, confirms M5)** — `env-secret.js:writeEnvValue` wrote secrets unescaped (the sibling `disperse/write/env.js:envLine` does it correctly) and passed the value as a `String.replace` replacement, so `$&`/`$1` inside a secret was expanded and corrupted. **Fix:** reuse `envLine`; use a replacer function.
- **MGR-6 (P2)** — The keychain import failure path printed `CSC_KEY_PASSWORD` in full (`keychain.js:116-121`), against the names-only discipline held elsewhere. **Fix:** print the env var name.
- **MGR-7 (P2, confirms H16)** — No shared retry/backoff on any manager API client; Stripe constructed without `maxNetworkRetries`; the migration runner writes 500-doc pages fully concurrently, so one 429 aborts the batch. **Fix:** shared `retryWithBackoff`; set `maxNetworkRetries`; cap migration concurrency. *(Not in cp259 — carry forward.)*
- **MGR-8 (P3)** — The Google OAuth token store (refresh token, cloud-platform scope) was written 0644 (`google-auth.js:74-81`). **Fix:** file `0o600` in a `0o700` dir, with a chmod so pre-existing stores are tightened.
- **MGR-9 (P3, confirms H3)** — The bookmark-sync WebSocket bound `0.0.0.0`, exposing a 10-second window to the local network; `getDeployedFunctions` built a gcloud shell string with an interpolated projectId. **Fix:** bind `127.0.0.1`; `execFileSync`.

Prior items confirmed fixed: C3 (manager publish lane, cp240/241), H17 (CI pack-smoke covers all six).

**What the manager already does well:** `cloud/lib/access-heal.js` is the model for subprocess safety (execFileSync argv, structured role fallback, no silent fallback); `lib/preflight.js` + `env-secrets.js` hold names-only discipline rigorously; `service-runner.js` `splitReturn` enforces a strict return contract; `disperse/write/env.js` is a careful escaping .env editor; `account/lib/password.js` derives admin passwords by HMAC and never prints them; deploy/update fan-outs spawn with `shell:false` argv.

## Remediation grouping (as executed in cp259)

**Mechanical — no design decision, all shipped:** B1 (command allowlist), B5 (respond guard + 3 routes), B6 (loadProcessor), B7 (notifications rules), B8 (log redaction), B10 + MGR-1 + MGR-6 (constant-time compare + redacted prints), B11 (getInventory error handling), MGR-2/3/9 (execFileSync), MGR-5 (env escaping), MGR-8 (token file mode), MGR-4 (brand-segment profile path).

**B3** — shipped; needs Ian's redeploy to take effect on the live backend.

## Open — Ian's call, deliberately not actioned

- **B2** — test-processor restriction plus full per-processor signature verification. Touches payment, which sits behind Ian's GO-payment gate. An open question was put to him: whether to take the cheap half now (restrict `test` to non-production, a few lines) separately from full signature verification. No answer yet.
- **B9** — CLI production-default flip (emulator unless `--production`). Changes established behavior.
- **M21** — config-drive the email identity off `brand.*`/`company.*`; same family as cp257's de-ITW work.
- **M22** — `markdown-it html:true` on third-party and AI-generated content.
