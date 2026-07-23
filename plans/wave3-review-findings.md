---
status: active
created: 2026-07-22
wave: 3 (web engine + themes)
source: Workflow wf_1fc7d0e0-574 (2× Fable medium, read-only); every finding hand-verified by coordinator
---

# Wave 3 Review Findings — web engine + themes (2026-07-22)

## Context

This is an internal code-quality review of **Ian's own pre-release codebase**, commissioned by Ian and carried out on the repo he owns. It is a staged, wave-by-wave hardening pass over the OMEGA monorepo: each wave reads a package group, records defects, and ships one remediation checkpoint. No third-party system is involved, no production data is accessed, and every item below is a defect in first-party code that the same effort then fixes.

The packages are unpublished (`private: true`, local `file:` specs, zero npm releases). Wave 2 (manager + backend) shipped as cp259. This document is wave 3 (`packages/web`: the build engine, CLI, frontend runtime, service worker, themes, shared Liquid, defaults, scaffold); its remediation is **cp264**.

Findings are ordered by priority (P0 = fix first; none this wave). Each entry names the defect, the file, and the fix. All 21 findings were re-read in source by the coordinator before filing.

## Status (2026-07-22, cp264 — SHIPPED)

**Resolved and tested (20):** W1-W6, W8-W15, W17-W21, plus W7's loud-stub half. Regression tests: purge-safelist suite, head/foot build pins (og:locale/hreflang, JSON-LD parseable with quoted config, no Giscus injection unconfigured), pricing catalog-order warning, malformed-escape fall-through. Web suite 270, full root battery EXIT 0.

**Open, awaiting Ian:** W7 capture wiring (provider/endpoint pick), W16 (synthesized aggregateRating removal).

## Engine (reviewer A — src, core/js, sw, runtime, bin)

- **W1 (P2)** — `deployDirect()` builds git commands as interpolated `execSync` shell strings and feeds them config-derived values: `plan.pushUrl` (embeds the github.repo slug / brand.id), `plan.branch`, `plan.cname` (brand.url's host). The one subprocess surface in packages/web still off the execFileSync-argv house standard wave 2 set. `src/commands/deploy.js:104-109`. **Fix:** `execFileSync('git', [...argv])` per call; each config value its own argv element.
- **W2 (P2, prior M20)** — The service worker's Firebase CDN `importScripts` runs top-level, unconditional, unguarded — before the class body and export. A failed fetch (offline, CSP, blocked gstatic) aborts script evaluation and the whole service worker dies, for every brand including those with no firebase config. `sw/manager.js:38-41`. **Fix:** guard the import (try/catch + flag consumed by `initializeFirebase()`); skip it entirely when no firebase config is baked into `/build.js`. Push messaging must never take down the cache-eviction/takeover role.
- **W3 (P2, prior M19)** — The PurgeCSS safelist is only `greedy: [/omega-/]`, so Bootstrap's runtime-added `.collapsing` is stripped sitewide and mobile-nav/accordion transitions snap. `src/assets.js:355`. **Fix:** add Bootstrap's runtime-only classes (`collapsing`, `showing`, `fade`, `show`, `collapse`) to the safelist.
- **W4 (P3, prior L10)** — The sections.js file header still documents the retired `composition: true` contract, inverted from the shipped behavior (body REPLACES by default; `append: true` opts into add-below, per Ian's 2026-07-19 ruling implemented at line 690). `src/sections.js:50-59`. **Fix:** rewrite the header to match `render()`.
- **W5 (P3, prior L12)** — `composeComparison()` inherits missing feature values from the closest earlier plan by array position, with no validation that `payment.products` is authored in ascending tier order; out-of-order catalogs silently produce a wrong comparison matrix. `src/pricing.js:143-150`. **Fix:** warn at build when plan prices are non-monotonic (config boundary), keeping array order as the documented contract.
- **W6 (P3)** — The dev server's clean-URL middleware calls `decodeURIComponent` on the raw request path unguarded (twice); a malformed percent-escape throws `URIError` and surfaces as a 500 instead of falling through. Dev-only. `src/commands/dev.js:303,312`. **Fix:** try/catch, `return next()` on failure.

## Themes + content layer (reviewer B — themes, includes/layouts, css, defaults, scaffold)

- **W7 (P1, prior L11, escalated)** — The newsletter section's submit handler logs the subscriber email to console, simulates a 1-second API call, fires analytics, and shows "Thank you for subscribing!" — no request is made and the address is discarded, with no dev-mode warning. Via `inherit: ['js']` the newsflash override shares the stub, so every newsletter band on both first-party themes is a form confirming success without doing anything — the class of live dead form cp217/cp218 were shipped to remove. `themes/classy/_sections/marketing/newsletter-cta/section.js:24-37`. **Fix (this wave):** loud dev-mode warning + visible non-success state; drop the email value from the log line. **Real capture wiring is Ian's call** (which provider/endpoint).
- **W8 (P2)** — `page-translation-default` is interpolated into `og:locale` and the `hreflang` alternate but never assigned anywhere in the package (the same unassigned read exists in the legacy UJM head.html it was ported from) — every page ships `content=""` and an invalid `hreflang=""`. `core/_includes/core/head.html:157,174`. **Fix:** assign from `site.translation.default | default: 'en'` (root.html already uses that expression).
- **W9 (P2)** — The Person JSON-LD block is gated on `resolved.member.id` (team member pages) but its `@id`/`url`/`name` fields call `uj_member resolved.post.author`, which is absent on member pages — every member page emits a Person schema with empty name/url/@id. `core/_includes/core/foot.html:353-355`. **Fix:** use `resolved.member.id` for all four `uj_member` calls.
- **W10 (P2)** — Neobrutalism's `navbar-scroll.js` toggles a bare `.scrolled` class at runtime; outside the omega- namespace and absent from static HTML, the `&.scrolled` rule is purged in production so the scroll shadow can never appear — the documented theming rule (runtime-stamped classes live in the omega- namespace or the safelist) did not hold. `themes/neobrutalism/js/navbar-scroll.js:15` / `themes/neobrutalism/css/layout/_navigation.scss:33`. **Fix:** ride the shared motion engine (`data-omega-scroll-watch` → `data-omega-scrolled`, the classy pattern).
- **W11 (P3)** — Brand/Website/BlogPosting JSON-LD blocks interpolate config and content strings (`site.brand.description`, names, titles, contact fields) into JSON string positions without `uj_json_escape`; a double quote or backslash yields invalid JSON-LD. The FAQPage block in the same file escapes correctly — the discipline exists, applied inconsistently. `core/_includes/core/foot.html:211,239,261,264,320-321`. **Fix:** append `| uj_json_escape` to every string interpolated inside ld+json.
- **W12 (P3)** — The analytics loader blocks gate on `resolved.analytics.providers.<p>.id` but emit `site.analytics.providers.<p>.id` into the script URLs and init calls; any resolved-layer override loads the tracker with a wrong or empty id while the gate passes. `core/_includes/core/foot.html:126-133,143-159,170-177`. **Fix:** emit the same `resolved.*` path the gate checks.
- **W13 (P3)** — Both post layouts include the Giscus embed unconditionally and `giscus.html` has no internal gate, so unconfigured brands (every scaffold) inject `https://giscus.app/client.js` with empty `data-repo`/`data-repo-id` — a failed third-party embed and console error on every post page. The config key is spelled `gisqus` (ported verbatim) while the service is Giscus. `core/_includes/modules/engagement/giscus.html`; included at `themes/classy/_layouts/frontend/pages/blog/post.html:207`, `themes/newsflash/.../post.html:192`. **Fix:** gate inside giscus.html on `resolved.comments.giscus.repo` (one home) and normalize the key spelling while nothing is published.
- **W14 (P3)** — All three newsletter forms carry `pattern="[a-z0-9._%+-]+@..."`; HTML pattern matching is case-sensitive, so `Ian@Example.com` — valid to `type="email"` — is rejected. `themes/classy/_sections/marketing/newsletter-cta/section.html:22`; newsflash override lines 35, 89. **Fix:** drop the pattern (`type="email"` already validates).
- **W15 (P3)** — The newsflash stats override gates on `{% iftruthy args.items %}` — isTruthy treats an empty array as truthy — so `items: []` renders a head-only band; the classy base checks `args.items.size > 0` and suppresses it, and the override's json5 claims the same contract. `themes/newsflash/_sections/marketing/stats/section.html:6`. **Fix:** match the base check.
- **W16 (P3)** — When `schema.software_application.enabled` is set, the block synthesizes `aggregateRating` (4.8/4.9, 200k-1M count) from a hash of the site URL — review markup not backed by reviews, which search engines treat as structured-data spam. `core/_includes/core/foot.html:410-452`. **Fix proposed:** take rating values from consumer config only; omit `aggregateRating` when none are supplied. **Ian's call** — deliberate legacy behavior; removing changes SEO output.
- **W17 (P3)** — The hero schema ships `defaults.demo.placement: 'bottom'` but no `placement` read exists in the markup — an inert knob presenting as supported API. `themes/classy/_sections/marketing/hero/section.json5:59`. **Fix:** remove the key.
- **W18 (P3)** — The posts feed pipes content through `uj_strip_ads`, which removes pre-cp258 `<ad-unit>`/adunits vocabulary nothing emits anymore (verts are runtime-inserted, never in templateContent) — a no-op presenting as a live step. `defaults/pages/feeds/posts-xml.html:32`; filter at `template-kit/src/filters.js:199`. **Fix:** drop the filter from the feed template; the filter itself is wave-4 (template-kit) scope.
- **W19 (P3)** — classy and neobrutalism READMEs still instruct `@use 'ultimate-jekyll-manager' as *;` — the legacy package name; the migrated form is the `omega:main` importer. `themes/classy/README.md:8,26`; `themes/neobrutalism/README.md:28,37`. **Fix:** rewrite both snippets.
- **W20 (P3)** — Three rules read `var(--omega-radius-pill, 50rem)` but the token is never declared in the token sheet (the documented `--omega-*` contract), so it works only via fallback and is invisible to consumer token overrides. `themes/classy/css/components/_badges.scss:24,53`; `themes/classy/css/marketing/_content.scss:1187`. **Fix:** declare `--omega-radius-pill: 50rem` in the scheme-agnostic block of `core/css/tokens/_index.scss`.
- **W21 (P3)** — The photo-band builds lazy URLs as `{{ photo.src }}&w=640`, assuming an existing query string; correct for the Unsplash defaults, broken (`photo.jpg&w=640`) for any consumer src without one, and the json5 arg description does not state the requirement. `themes/classy/_sections/about/photo-band/section.html:7,14-15`. **Fix:** append via a param-aware filter (or document the resizable-URL requirement in the schema).

## Prior items re-confirmed

M19 (W3), M20 (W2), L10 (W4), L11 (W7, escalated to P1), L12 (W5), DEPLOY-SHELL (W1 — moved to `src/commands/deploy.js` since the system review). The runtime `bg-*` toggles in status/index.js survive purge only because the status layout carries static instances of each class — fragile but working; noted, not filed.

## What the web package already does well

- Runtime DOM builders consistently route interpolated values through `escapeHTML` before innerHTML and encode href components; brand-tokens.js regenerates every emitted color from parsed numbers so no config string reaches the emitted style block verbatim.
- The cp261 omega.request migration and cp262 rename are clean — no leftover authorized-fetch references, no unsupported options at call sites, no residual `data-wm-bind`.
- The sections context-freeness discipline genuinely holds ({ args } only), and the motion layer's no-JS/reduced-motion degradation matches the documented contract exactly.
- The token sheet's dual-theme plumbing is clean (light+dark mixins, OS preference + stamp that wins both directions); shared-band neutral defaults are applied consistently.
- The translation pipeline keeps hreflang alternates honest per produced language and handles the /es redirect-loop live-find correctly; frontmatter-liquid renderData is careful copy-on-write.
- hero-demo-form.js gates its caller-supplied redirect to same-origin path or http(s) before navigating.

## Remediation grouping (cp264)

**Mechanical — no design decision:** W1 (git argv), W2 (SW import guard), W3 (purge safelist), W4 (sections header), W5 (pricing order warning), W6 (decode guard), W8 (translation default), W9 (Person schema), W10 (neobrutalism scroll via motion engine), W11 (JSON-LD escaping), W12 (analytics resolved paths), W13 (giscus gate + key spelling), W14 (email pattern), W15 (stats gate), W17 (dead placement key), W18 (feed filter drop), W19 (README importer), W20 (radius-pill token), W21 (photo-band param), plus W7's loud-stub half (dev warning + no email in the log).

## Open — Ian's call, deliberately not actioned

- **W7 (capture wiring)** — which newsletter provider/endpoint the section should post to. The stub is made loud this wave; real wiring waits on the pick.
- **W16** — whether the synthesized `aggregateRating` goes (proposal: consumer-supplied values only, omit otherwise). Changes emitted SEO markup for any brand enabling the knob.
