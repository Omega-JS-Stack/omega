---
status: active
created: 2026-07-20
---
# OMEGA System Review — 2026-07-20

> Comprehensive architecture, security, code quality, testing, and DX audit.
> Scope: 2,395 files, ~147K lines, all 10 packages, 16 parallel review agents.

---

## Critical (3) — Fix before launch

### C1. Path traversal → arbitrary `require()` in legacy command API (unauthenticated)
- **Package:** backend
- **File:** `src/manager/functions/core/actions/api.js:348-353`
- **Issue:** Single-pass `.replace(/\.\.\//g, '')` is bypassable (`....//` survives). Feeds `require()`. No auth check before dispatch. Unconditionally wired into every deployed `omega_api` Cloud Function (`src/manager/index.js:934-951`).
- **Fix:** Allowlist valid commands via an explicit registry. Reject anything not in the map.

### C2. Payment webhooks accept forged events — no cryptographic signature verification
- **Package:** backend
- **Files:** `routes/payments/webhook/processors/{stripe,paypal,chargebee}.js`, `routes/payments/webhook/post.js:28`
- **Issue:** All three processors trust `req.body` outright. The only gate is one shared static key (`OMEGA_WEBHOOK_KEY`) as a query param. The "fetch fresh from API" backstop falls back to trusting the forged payload on fetch failure. The `test` processor is reachable in production with zero checks. Manager also logs this key in cleartext (`services/payment/ensure/stripe-webhook.js:104,110`).
- **Fix:** Implement per-processor signature verification (`constructEvent` for Stripe, HMAC for PayPal/Chargebee). Remove `rawFallback` trust-on-failure. Gate `processor=test` to non-production. Redact key from logs.

### C3. Two of six publishable packages have no build/vendor pipeline
- **Packages:** web, manager
- **Files:** `packages/web/package.json`, `packages/manager/package.json`
- **Issue:** Both ship `src/` directly (no `dist/`, no `prepare` script) and declare never-published private packages (`config`, `devkit`, `template-kit`, `account`) as regular `dependencies`. First `npm install` by any external consumer fails. CI's `pack-smoke` job only tests backend/client/extension/desktop — these two are not in the list (`.github/workflows/ci.yml:227`).
- **Fix:** Add `preparePackage` + vendor pipeline (same pattern backend/desktop/extension use). Move private deps to `devDependencies`. Add both to CI `pack-smoke`.

---

## High (21) — Fix soon

### H1. Unauthenticated RCE via `remote-scripts.js`, on by default
- **Package:** desktop
- **File:** `src/lib/remote-scripts.js:120-127`
- **Issue:** Fetches `${brand.url}/data/scripts/main.js` and runs via `new AsyncFunction` with full main-process access. SHA-256 dedup hash only — not a signature. `_enabled` defaults to `true`. Website compromise = silent RCE on every installed app.
- **Fix:** Verify a code signature (public key baked at build time) or default `enabled: false`.

### H2. Auth token handoff has no CSRF/replay protection (desktop + extension)
- **Package:** desktop, extension
- **Files:** `desktop/lib/deep-link.js:146-157`, `extension/src/background.js:355-395`
- **Issue:** Both unconditionally sign in on any delivered auth token with no state/nonce check. The dev/test loopback path correctly uses a nonce; production doesn't. Classic login-CSRF/session-fixation.
- **Fix:** Bind the returned token to a nonce generated when `openAuthFlow()` was called.

### H3. Systemic shell injection: `execSync` + string interpolation across 6 packages
- **Packages:** manager, desktop, web, devkit, extension
- **Sites (~18+):**
  - Manager: macOS keychain password (`keychain.js:63,86,108`), certificate password (`certificate-manager.js:130`), GitHub description/homepage (`github-api.js:91,116,117,137`)
  - Desktop: Windows signing password (`sign-windows.js:170-172`)
  - Web: git deploy commands (`deploy.js:104-109`)
  - Devkit: `rm -rf` with dir name (`clean-dirs.js:19`), git remote name (`deploy.js:39`)
  - Extension: build error notification (`build.js:64`), store publish credentials (`publish.js:253-303`)
- **Fix:** Convert all to `spawnSync`/`execFileSync` with argv arrays. Consider a shared `safeExec(cmd, args)` in devkit.

### H4. Dynamic `require()` from unvalidated input — 10 backend route files
- **Package:** backend
- **Files:** `webhook/post.js:43`, `marketing/webhook/post.js:53`, `cancel/post.js:63`, `portal/post.js:36`, `intent/post.js:108`, `refund/post.js:70`, `dispute-alert/post.js:30`, `on-write.js:40`, `oauth2/_helpers.js:71,102`
- **Fix:** One shared `loadProcessor(dir, name)` helper with `/^[a-z0-9-]+$/` allowlist.

### H5. MCP OAuth: `redirect_uri` not validated, PKCE advertised but not enforced
- **Package:** backend
- **File:** `src/mcp/handler.js`
- **Issue:** Dynamic client registration accepts any `redirect_uris` but never persists them. Authorize/token redirect to any caller-supplied URI. Discovery doc claims S256 PKCE but no verifier/challenge handling exists. Admin OAuth returns the raw master key as the access token.
- **Fix:** Persist/validate redirect URIs. Implement PKCE. Issue scoped, expirable tokens instead of the raw admin key.

### H6. Devkit depends on client (inverted dependency)
- **Packages:** devkit, web, template-kit
- **Files:** `devkit/src/icons.js:23`, `template-kit/src/tags/media.js:19`, `devkit/tools/vendor.js:64`
- **Issue:** Devkit (foundation layer) holds a runtime dep on client (top-layer). Vendored `devkit/icons.js` will ship broken for any host not depending on client. Template-kit is missing from `VENDORABLE_PACKAGES`.
- **Fix:** Hoist the icon constant (`PACKAGES`) down to `@omega.js/config`. Add `template-kit` to `VENDORABLE_PACKAGES`.

### H7. Config: company merge layer documented but not implemented
- **Package:** config
- **Files:** `CLAUDE.md:20`, `config/src/merge.js:4-7`, `config/src/load.js:236-244`
- **Issue:** Documented 6-layer chain includes "company" but `loadConfig()` never merges it. Every framework entry point skips company. Company-level shared values (Sentry org, GA4) are invisible to builds.
- **Fix:** Either implement company as a first-class layer in `loadConfig()`, or fix docs in three places.

### H8. Config: secret-key detection regex too narrow
- **Package:** config
- **File:** `config/src/secrets.js:12`
- **Issue:** `/(secret|privateKey|apiSecret)$/i` only matches terminal suffixes. Misses `secretKey`, `secret_key`, `accessToken`, `refreshToken`, `password`, `token`. No backup (no pre-commit hook, gitleaks, or CI secret scan).
- **Fix:** Broaden to whole-word match anywhere in the key (after camelCase/snake_case splitting). Add bypass regression tests.

### H9. Config: schema validation covers ~14 of 34 real top-level sections
- **Package:** config
- **File:** `config/src/schema.js`
- **Issue:** `firebase`, `gcp`, `domain`, `download`, `adsense`, `chatsy`, `replyify`, `certificates`, `server`, `testing`, `migrations`, `enabled` have zero schema rules despite being actively consumed. `targets.web.*` validates one field (`imagemin`), docs promise ~15.
- **Fix:** Extend coverage using the existing rule format, prioritizing sections already load-bearing.

### H10. Affiliatizer hardcodes personal affiliate IDs, runs unconditionally
- **Package:** extension
- **Files:** `src/lib/affiliatizer.js`, `src/content.js:22`
- **Issue:** 225-line module with ~13 hardcoded referral URLs (Amazon, PayPal, NordVPN, etc.). Initialized unconditionally in every consumer extension's content script. No config gate, no docs, no opt-in.
- **Fix:** Move to `src/defaults/` (consumer-owned) or behind an explicit config flag.

### H11. `prepare-package` postinstall mutates root `package.json`
- **Package:** devkit (upstream)
- **Issue:** Confirmed by reproduction. Hoisted `prepare-package` targets monorepo root via `INIT_CWD`, adding stray fields and firing a CDN purge call. Every `npm ci` in CI triggers this.
- **Fix:** Upstream: verify target `package.json` actually declares `prepare-package` as a dependency before treating it as the host.

### H12. Backend CLI: production is silent default for destructive writes
- **Package:** backend
- **File:** `src/cli/commands/firestore.js:14`
- **Issue:** `firestore:set`, `auth:set-claims` target production unless `--emulator` is passed. No confirmation prompt. `logs.js` builds shell string from `--search`/`--filter` (injection surface).
- **Fix:** Flip default to emulator-unless-`--production`. Add `confirm()` gate. Rebuild logs as argv array.

### H13. Backend: double-`respond()` crash in 3 framework routes
- **Package:** backend
- **Files:** `user/feedback/post.js:51-68`, `admin/database/post.js:26-31`, `user/api-keys/post.js:39-46`
- **Issue:** `.catch` callback returns `respond()` but only exits the callback, not the outer function. On any write failure: `ERR_HTTP_HEADERS_SENT`. No `_responded` guard in `assistant.respond()`.
- **Fix:** Fix the three routes. Add structural `_responded` guard to close the bug class.

### H14. Backend: `admin/post` lets "blogger" role redirect commits to arbitrary repos
- **Package:** backend
- **File:** `routes/admin/post/post.js:42,101-102`
- **Issue:** Caller-supplied `githubUser`/`githubRepo` override the brand's configured repo. `commitAll()` uses the server's shared `GH_TOKEN`. Org-scoped token = blogger can write to any repo.
- **Fix:** Ignore caller-supplied values or hard-validate them equal to brand config.

### H15. Manager: cross-brand provisioning-profile collision
- **Package:** manager
- **File:** `services/certificates/ensure/profiles.js:79`
- **Issue:** Profile download path has no brand segment but `appleDir` is the shared company signing tree. Brand B's profile silently overwrites Brand A's cached file.
- **Fix:** Add brand segment: `profiles/{certType}/{brandId}/{platform}.mobileprovision`.

### H16. Manager: zero retry/backoff/timeout across ~17 API clients
- **Package:** manager
- **Files:** All `services/*/lib/*-api.js`
- **Issue:** Zero 429/5xx retry anywhere. `new Stripe()` doesn't set `maxNetworkRetries`. Migration runner does up to 500 concurrent writes with no cap. One transient 429 aborts the entire run.
- **Fix:** One shared retry-with-backoff wrapper. Concurrency cap on migration runner. Set `maxNetworkRetries` on Stripe.

### H17. CI pack-smoke skips the two broken packages
- **Package:** root
- **File:** `.github/workflows/ci.yml:227,242`
- **Issue:** `pack-smoke` tests only backend/client/extension/desktop. The grep pattern excludes `@omega.js/client` refs too.
- **Fix:** Add `web` and `manager` to the matrix. Extend grep to all `@omega.js/*` names not in the host's declared deps.

---

## Medium (25) — Address in the near term

### M1. No ESLint or Prettier anywhere in the entire monorepo
- Every review agent independently confirmed. Many findings (unused vars, dead statements, `self.api` typo) are exactly what a linter catches for free.

### M2. Desktop: no CSP anywhere, no navigation hardening
- Zero CSP headers/meta tags, zero `setWindowOpenHandler`, zero `will-navigate` handling. Mitigated by `loadFile()` but violates Electron's security checklist.

### M3. Backend deploy's `ensurePublicInvoker()` swallows all failures silently
- Three silent exit points with zero logging. Production functions return 403 with no breadcrumb. Contradicts the "loud, probe-first" rule.

### M4. Non-constant-time secret comparisons throughout
- MCP admin key, webhook keys, assistant auth — all `===`. Zero `crypto.timingSafeEqual` codebase-wide.

### M5. Manager: `.env` writer doesn't escape values
- `src/lib/env-secret.js:writeEnvValue` has no escaping. Sibling `disperse/write/env.js:envLine` does it correctly.

### M6. Prototype pollution in migration runner
- `migration-runner.js:226-239`: `=== undefined` guard doesn't catch `__proto__`.

### M7. Client: CSS selector injection in FormManager
- `form-manager.js:195`: URL query param names interpolated unescaped into `querySelector`. DoS via crafted link.

### M8. Client: `motion.js` leaks listeners/observers on `stop()`
- `setupDotfield`/`setupSegmented` listeners never captured for teardown. SPA route changes leak.

### M9. `data-wm-bind` DOM-binding engine has zero behavioral test coverage
- `bindings.js` (314 lines) — only the context store is tested, not the directive syntax or DOM mutation.

### M10. Template-kit: path traversal in icon/logo/flag tag arguments
- `tags/media.js:100,149,195`: no `../` validation before `path.join` → `fs.readFileSync`.

### M11. Config: `brand.color` undocumented and unvalidated
- Drives the entire theming system but has zero schema validation and isn't in `docs/config.md`.

### M12. Vendor propagation rebuilds frameworks that don't depend on the changed package
- `devkit/src/local.js:455-474`: `dirty` set computed but never used to filter dependents.

### M13. Extension: two confirmed bugs
- `lib/extension.js:96`: `self.api = ...` should be `self[api] = ...` (typo breaks fallback tier).
- `lib/messaging.js:10`: `if (!init || !init)` checks same condition twice; never validates `init.sender`.

### M14. Client: `sentry.js` unguarded property access breaks error capture
- `sentry.js:91`: `config.page.startTime` — `config.page` doesn't exist in default config shape. Runs inside `beforeSend`.

### M15. Desktop: IPC storage handlers don't validate payload
- `lib/storage.js:85-89`: zero validation on key/val. Violates the project's own `audit.md` DSK-04 rule.

### M16. Extension: production debug logs + dead code shipping
- `background.js:330-333`: unguarded debug output. `gulp/tasks/BU/`: 5 dead files in dist. `src/index.js`: fully commented out.

### M17. Devkit: `runner-core.js` requires `glob` without declaring it
- Works only by lucky hoisting from sibling packages.

### M18. Desktop: restart-manager installer skips checksum verification
- `parseFeed()` has the sha512; `pickArtifact()` discards it. Downloaded binaries execute unverified.

### M19. Web: PurgeCSS strips Bootstrap's `.collapsing` class sitewide
- Verified empirically. Mobile nav and FAQ accordions snap instead of animating on every classy/newsflash site.
- **Fix:** Extend safelist with Bootstrap's JS-toggled classes.

### M20. Web: service worker unconditionally imports Firebase CDN
- `sw/manager.js:38-41`: top-level `importScripts` not try/caught. Failed fetch kills SW registration for non-Firebase brands.

### M21. Backend: hardcoded personal identity in email templates
- Welcome/discount emails signed "Ian Wiedenman, CEO". `base.js` hardcodes `PARENT_NAME`/`PARENT_WORDMARK`. `transactional/index.js` BCCs `support@itwcreativeworks.com`. None reads from config.

### M22. Backend: third-party content can inject HTML into outbound email
- `markdown-it({ html: true })` + RSS/AI-sourced content interpolated unescaped into email HTML.

### M23. Client: `bindings.js` URL sanitization narrower than canonical `sanitizeURL()`
- Blocks only `javascript:` via hand-rolled regex instead of reusing `Utilities.sanitizeURL()` which also blocks `data:`/`vbscript:`.

### M24. Extension: messenger always `null` despite being in scaffold and docs
- `Messaging` is never instantiated. Scaffold destructures it. CLAUDE.md documents it as "automatically wired."

### M25. Extension: store-publish credentials interpolated into shell command strings
- `publish.js:253-303`: OAuth credentials in double-quoted CLI args via `execute(command)`.

---

## Low (14) — When convenient

- L1. **PROGRESS.md and CHANGELOG.md violate own conciseness rules** — single bullets up to 8,933 chars.
- L2. **17 CLAUDE.md files with no AGENTS.md** — mechanical `git mv` pass needed.
- L3. **Desktop <5% JSDoc coverage; extension 33%; client 41%** — ported-legacy gap.
- L4. **Duplicated logic** — client's `_deepMerge`, devkit's 5x JSON.parse, manager's two `gh` wrappers, extension's 4 copy-pasted context files, `_resolveItem` triplication.
- L5. **No glossary for project shorthand** — `cp238`, `D13`, `C5`, `N7`, `§7` appear hundreds of times with no lookup table.
- L6. **Account: zero documentation** — no README, no CLAUDE.md, no docs page.
- L7. **God functions** — `motion.js` createMotion (519 lines), `FormManager` (1,436 lines), `engine.js` configureOmega (520 lines).
- L8. **Client: `class mod` naming** — `sentry.js:18` exports `class mod` instead of `Sentry`.
- L9. **Client: hardcoded `ui-avatars.com`** — `auth.js:53` sends user initials to third-party domain.
- L10. **Web: stale JSDoc in `sections.js:50-59`** — describes old behavior (body adds below composition); code does the opposite.
- L11. **Web: newsletter form is non-functional stub** — shows "Thank you!" and discards email with no dev-mode warning.
- L12. **Web: pricing comparison assumes ascending tier order** — no validation if products listed out of order.
- L13. **Devkit: two files call bare `process.exit()`** — violates own `attach-log-file` flush contract.
- L14. **Client: commented-out dead code** — `index.js:670-692` (~23 lines of `_loadPolyfillsIfNeeded`).

---

## Verified strengths (12)

1. **Testing infrastructure** — ~3,500 tests, zero mocking libraries, real Firebase emulators/Electron/Chromium/Eleventy.
2. **Error messages** — consistently actionable across every package reviewed.
3. **Vendoring tool** — transactional, selective, self-verifying. Standout engineering.
4. **CLI dispatch** — robust, unified, well-tested across all four frameworks.
5. **Package boundaries** — `account` and `config` are exemplary thin leaves. No circular runtime deps.
6. **XSS discipline** — `escapeHTML`/`sanitizeURL` correctly used at every DOM-write boundary.
7. **No committed secrets** — grepped entire repo for key patterns, zero hits.
8. **Deploy pipeline** — all four targets converge on one executor, no drift from docs.
9. **Documentation accuracy** — spot-checked docs/testing.md C5 grammar against source; exact match.
10. **Config writeback** — comment-preserving, self-verifying. Never corrupts user data.
11. **The codebase knows what "good" looks like** — correct patterns exist already for every finding. The issue is consistency, not knowledge.
12. **Onboarding friction log** — real first-run friction log with 35 dated findings, majority fixed.

---

## Prioritized action plan

### Tier 1 — Mechanical fixes (no decisions needed)
- Broaden secret regex (one line in `secrets.js`)
- Convert shell injection sites to `spawnSync` with argv arrays
- Fix PurgeCSS safelist (one array extension)
- Fix extension bugs (`self.api` typo, `messaging.js`)
- Add `_responded` guard to `assistant.respond()` + fix 3 routes
- Add `crypto.timingSafeEqual` everywhere
- Add ESLint baseline (`no-unused-vars`, `no-undef`)

### Tier 2 — Clear path, some design
- Implement per-processor webhook signature verification
- Replace legacy command API with static command registry
- Add build/vendor pipeline to web + manager
- Fix devkit→client dependency inversion
- Add shared retry/backoff wrapper for API clients

### Tier 3 — Ian's call (business/design decisions)
- Affiliatizer: remove from framework or make opt-in?
- Email templates: config-drive personal identity from `brand.*`?
- Remote-scripts.js: disable by default or add code signing?
- CLI production default: flip to emulator-unless-`--production`?
- CLAUDE.md → AGENTS.md migration (17 files)
