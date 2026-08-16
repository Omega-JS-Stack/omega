# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.32.0] 2026-08-16
### Added
- [#268](../../issues/268) [`0f35477c`](../../commit/0f35477c) Thanks [@ianwieds]! — A save offer now stands between "Cancel subscription" and the questionnaire: a paid subscriber is pitched a discount on their next cycle, accepting applies it and calls the cancel off, declining carries on unchanged. The offer is the brand's (`payment.winback`, 50% off by default), claimable once, applied by Stripe.

### Fixed
- [#306](../../issues/306) [`0f35477c`](../../commit/0f35477c) Thanks [@ianwieds]! — One guarded analytics helper is the SSOT for gtag, fbq and ttq across web core, and every call site routes through it, so a blocked provider can no longer throw mid-action and take the refund, data request or install click with it.
- [#309](../../issues/309) [`0f35477c`](../../commit/0f35477c) Thanks [@ianwieds]! — The dev-only `window._billing.test(account)` renders as the account it was handed and stashes the real one, so a synthetic trialing render keeps the trial-cancel trigger alive and `_billing.restore()` always comes back to the real account.
- [#303](../../issues/303) [`0f35477c`](../../commit/0f35477c) Thanks [@ianwieds]! — Every theme gets the dashboard chrome the base layer renders: `.btn-icon` and the `.omega-search` ⌘K pill (input and shortcut badge) moved from classy's partials to the core component sheet, so newsflash and neobrutalism stop painting a native button box beside the breadcrumb and a cream-slab `kbd`.
- [#307](../../issues/307) [`0f35477c`](../../commit/0f35477c) Thanks [@ianwieds]! — The `omega` dispatcher's brand-root rule learns `dist/`: running the CLI inside a staged backend's build output dispatches as the backend framework, not as a brand, matching the config loader's own rule.
- [#308](../../issues/308) [`0f35477c`](../../commit/0f35477c) Thanks [@ianwieds]! — `omega emulator` (and every staging command) run from the framework package itself refuses loudly instead of wiping `packages/backend/dist` and dying on a missing config, so the framework CLI stays bootable.

## [0.31.1] 2026-08-16
### Fixed
- [#282](../../issues/282) [`8d6534f4`](../../commit/8d6534f4) Thanks [@ianwieds]! — The confirmation page reads a one-time buy as a purchase: `frequency=once` stops rendering the subscription sentence with its cadence slots empty, the receipt labels an item instead of a plan, and the one-time note says nothing renews.
- [#283](../../issues/283) [`8d6534f4`](../../commit/8d6534f4) Thanks [@ianwieds]! — A blocked analytics script can no longer kill a billing action: `trackBilling()` asks for gtag, fbq and ttq per provider, so undo cancellation, plan change, upgrade and the billing portal all run with the snippets missing.
- [#300](../../issues/300) [`8d6534f4`](../../commit/8d6534f4) Thanks [@ianwieds]! — The browser learns bumped emulator ports: the dev server reads the sibling backend's resolved map per render (and per request for the auth proxy), desktop and extension bake the same map, and a page falling back to classic ports says so loudly instead of failing as an auth mystery.
- [#292](../../issues/292) [`8d6534f4`](../../commit/8d6534f4) Thanks [@ianwieds]! — The test wipe clears the project it is actually testing: the runner's env carries `GCLOUD_PROJECT`, the auth bulk-clear resolves its project from the admin app, and a disagreeing id aborts the wipe instead of reporting a clean slate the emulator never gave.
- [#299](../../issues/299) [`8d6534f4`](../../commit/8d6534f4) Thanks [@ianwieds]! — A staged `dist/` resolves config exactly like `functions/`: every remaining walk (probe, app-layer fallback, instance id, compose, brand-root search) normalizes both, so a standalone app loading from its build output finds its own config and its own instance.
- [#304](../../issues/304) [`8d6534f4`](../../commit/8d6534f4) Thanks [@ianwieds]! — Stopping the emulator takes the java emulators with it: the stop path signals the pids it recorded at boot (never one recycled onto another brand's jar), sweeps the orphans that record missed, then reports any port still held. A boot that never comes up runs the same teardown.
- [#291](../../issues/291) [`8d6534f4`](../../commit/8d6534f4) Thanks [@ianwieds]! — `omega test` against an HTTPS `omega emulator` passes the payment journeys: the runner child carries the resolved plain-http port map, never the TLS front, so the test processor's auto-webhook reaches hosting instead of dying on the proxy's certificate.

## [0.31.0] 2026-08-15
### Added
- [#301](../../issues/301) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — A steady-state trialing persona: the seeder stands up `_test.premium-trialing` (active on the paid plan, trial claimed, its term and the trial ending on the same date the catalog's `trial.days` sets, with the purchase record behind it) and the dev palette offers it as "Trialing".

### Changed
- [#267](../../issues/267) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — Cancelling inside a free trial ends access immediately instead of riding to period end: the 24-hour young-subscription guard is waived for a trial, every processor cancels now, and the billing page warns before it does.
- [#305](../../issues/305) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — Two register rules land in the design system: product copy never uses em dashes (twelve rendered lines swept clean), and every loading state animates, starting with a spinner on the confirmation page's confirming moment that parks under reduced motion.

### Fixed
- [#264](../../issues/264) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The firefox artifact is a real firefox artifact: the chrome-only side panel keys translate to `sidebar_action`, the `sidePanel` permission is dropped, and a missing `browser_specific_settings.gecko.id` derives deterministically from the brand config (a declared id stays authoritative; only a project with no brand facts fails the compile).
- [#260](../../issues/260) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — A declared manifest value beats the framework default, arrays included: an empty `externally_connectable` ships no origins, so the dev origin stops riding along in production builds. An absent key still takes the default.
- [#259](../../issues/259) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — Static images reach `dist/`: the extension build stopped excluding them for an imagemin task that never existed, so consumers no longer copy their own images from a build hook.
- [#261](../../issues/261) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — A brand's shared `theme.id` naming a website theme no longer kills the extension's sass build: an id the framework does not ship falls back to its default theme with one warning naming the key, the value, and the valid set. Per-target override: `targets.extension.theme.id`.
- [#247](../../issues/247) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — A consumer page keeps `redirect` and `prerender_icons` in its frontmatter: both are shipped layout contracts the meta-only guard was stripping, so a brand's redirect pages bounced to the homepage instead of their configured target.
- [#249](../../issues/249) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The `js/modules` esbuild lane claims framework layers only. A consumer's own `js/modules/` is left alone with one warning naming the directory and the `js/libs/` convention, instead of being swept into a standalone-IIFE lane it never opted into.
- [#250](../../issues/250) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — `targets.web.purgecss.safelist` is live: it merges over the framework's built-in safelist in the purge pass (pattern lanes take strings and compile to regexes), instead of validating as a silent no-op.
- [#251](../../issues/251) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The chatsy preconnect fires for chatsy-enabled brands: it gates on `inbound.chat.providers.chatsy.enabled`, the SSOT the client loader and foot chrome already read.
- [#270](../../issues/270) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The blueprint/pricing shell stops skipping a heading level: the cards band carries a visually-hidden h2, so the h3 card names no longer follow the page h1 directly.
- [#271](../../issues/271) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — No page ships an empty-`@type` JSON-LD block: `brand.type` carries the framework default (`Organization`), which also repairs the `#<type>` node id every other schema block cross-references.
- [#272](../../issues/272) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — `brand.color` is declared in the config schema: optional, hex-validated (`#RGB` / `#RRGGBB`), so a typo fails validation instead of silently dropping the accent ramps.
- [#273](../../issues/273) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The pricing defaults stop contradicting themselves: trial copy derives from the catalog (`trial.days`, rendered only when there is one), and every invented refund claim — the guarantee line, the FAQ aside's chip and fragment — renders only for a brand that sets `pricing.guarantee`.
- [#242](../../issues/242) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — `omega-chip` renders styled under every theme: its structure moved from classy's badges partial to the core component sheet (token-painted, emitted before the theme), so a brand off classy stops showing bare badge text in the sidebar and billing modal.
- [#243](../../issues/243) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The account page's accordion triggers keep a visible keyboard focus ring: the bare `outline: none` is replaced by a token-based `:focus-visible` ring.
- [#211](../../issues/211) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — Watch-deadline flakes stop reading as breakage: the rebuild-watching web suites take their deadline from `OMEGA_TEST_DEADLINE_SCALE`, which the root lane runner exports (30s solo, 90s in a lane). A junk value throws instead of silently running unscaled.
- [#265](../../issues/265) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — Extension and web CI work in a brand monorepo: `omega setup` composes the app's workflow into the repo root's `.github/workflows/` (app-scoped, per-app concurrency, regenerated on every setup) instead of scaffolding a per-app copy GitHub would never run, and `omega deploy` dispatches the composed workflow.
- [#275](../../issues/275) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The middleware stops writing credentials to the log: the user line carries an allow-listed projection (id, plan, enabled roles) instead of the raw document with `api.privateKey`, and the header and body credential channels render as presence plus last-4.
- [#240](../../issues/240) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — PayPal v2 capture refunds enter the webhook pipeline: `PAYMENT.CAPTURE.REFUNDED` is accepted and resolved through the capture its links name, and the refund amount reads v2's `value`/`currency_code` spelling alongside v1's `total`/`currency`.
- [#244](../../issues/244) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — A non-finite number resolves to the field's default: `NaN` and `±Infinity` pass a `typeof` number check and slip every min/max comparison, so they used to reach sinks like `usage.increment()` and poison later limit checks.
- [#256](../../issues/256) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — Schema leaf detection is shape-checked: a `types` key counts as a declaration only when it holds a list of type names, so a field literally named `types` no longer collapses the whole schema to `{}`. A malformed `types` throws, naming the path.
- [#257](../../issues/257) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — A backend's staged `dist/` normalizes up to the app root the way `functions/` does, so `omega test` loads the brand-root `.env` cascade and finds a standalone project's company marker.
- [#258](../../issues/258) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — `omega test` adopts a running emulator only on proof of identity, read from firebase-tools' hub locator file (origin port plus a live pid). Another brand's stack on the classic ports is no longer hijacked — the run boots its own on free ports.
- [#274](../../issues/274) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The emulator's orphan sweep and pre-boot reaper signal only processes they can prove are ours — this run's recorded pids, or a command line naming this project — instead of whatever holds the shared hub and storage ports.
- [#241](../../issues/241) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The google-provider seed is idempotent: each persona's uid is deleted before the import, so a back-to-back suite run against a warm emulator stops failing the entire seed on an existing `localId`.
- [#232](../../issues/232) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The payment confirmation page gates on real account state: it polls the account doc for the plan the redirect claims, reveals the order details and the celebration together once it lands, and on timeout points at support with the order number and nothing celebratory.
- [#254](../../issues/254) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — A `once` discount code stops discounting the renewal line — the recurring price shows list unless the code's duration really rides every cycle — and a trial's terms quote the discounted first charge, naming the renewal price separately.
- [#245](../../issues/245) [`b7589cfc`](../../commit/b7589cfc) Thanks [@ianwieds]! — The `_dev_trialEligible` checkout URL override no longer survives production bundles; the read sits inside a dev-only block that strips at build.

## [0.30.0] - 2026-08-15
### Added
- [#236](../../issues/236) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — The billing plan-switch modal is a real product surface: cadence toggle matching the pricing page, feature cards with hover detail, the current plan grayed and disabled, and always-rendered detail slots that say "Unknown" instead of vanishing.
- [#236](../../issues/236) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — The pricing page's switch buttons open the account billing modal preselected to that plan and cadence, then clean their query params so refresh does not re-open it.
- [#263](../../issues/263) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — Journey and lifecycle test personas seed like real purchases: catalog-resolved price and frequency, cycle-true expiries, and matching order fixtures created at boot.

### Fixed
- [#239](../../issues/239) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — The test processor applies discount codes to charged amounts end-to-end: percent and flat codes fold into the first charge, real-processor coupons carry both shapes, and checkout/confirmation display the discounted price. Orders keep the list price with the discount recorded beside it.
- [#237](../../issues/237) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — `/payments/plan` rejects a switch to the plan the account already has, and a mid-trial plan switch carries the trial end date over instead of restarting or dropping it.
- [#238](../../issues/238) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — The development-only routes left production: they now live under `/omega/health` behind one gate with no carve-outs, and the unauthenticated `/test/usage` write path is gone. A dot-segment bypass of the gate was proven and closed with a containment guard.
- [#235](../../issues/235) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — The `_dev_cardProcessor` checkout URL override no longer survives production bundles; the read sits inside a dev-only block that strips at build.
- [#223](../../issues/223) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — A declined win-back checkout now matches a transition rule, so the decline is recorded instead of falling through the pipeline silently.
- [#224](../../issues/224) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — The PayPal library resolves sale resources, so one-time refunds ride real payload data instead of the flagged stale fallback.
- [#225](../../issues/225) [`f97b4053`](../../commit/f97b4053) Thanks [@ianwieds]! — The PayPal expiry cron's query has its required-indexes entry, so a fresh project deploys with the index instead of failing at first run.

## [0.29.0] - 2026-08-14
### Added
- [#212](../../issues/212) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — `POST /payments/uncancel` and `POST /payments/plan`: owned, cross-provider, capability-gated subscription management (PayPal hides uncancel; the billing portal stays the fallback).
- [#212](../../issues/212) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — Checkout-decline simulation: the intent schema's allow-listed `simulate` field drives a test-processor decline through `/payments/intent`, proving the dunning journey (decline → suspended → recovery) end-to-end.
- [#212](../../issues/212) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — One-time purchase refunds end-to-end: the refund route takes an `orderId`, every processor implements the refund, webhook parsers stop dropping subscriptionless refunds, and the `purchase-refunded` transition records the amount.
- [#212](../../issues/212) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — Trial-lapse sweep: a daily cron confirms expired trials with the processor and lapses the abandoned ones to basic, stamping `subscription.trial.outcome`.
- [#220](../../issues/220) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — Failed webhooks get a bounded retry: `retryCount` on the event doc, a frequent cron re-flips failures under a ceiling of 5, then dead-letters loudly.
- [#218](../../issues/218) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — A returning subscriber after full cancellation gets the `subscription-winback` transition: confirmation email and purchase analytics instead of silence and a mislabeled renewal.
- [#226](../../issues/226) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — The billing page drives the new routes: an "Undo cancellation" button for cancelling subscriptions (hides for a processor that cannot resume, pointing at the portal), an in-page plan/frequency switcher with proration messaging, and a "Decline next checkout" arm in the palette's checkout section (`_dev_decline`, applied like the other controls).

### Changed
- [#227](../../issues/227) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — Brand-root `npm start` now boots the dev stack; the bare manage cycle moves to `npm run manage` (`npm run dev` stays as an alias). Onboarding scaffolds the new shape and the workspace walk migrates the legacy `start: "omega"` value idempotently, minting a missing `manage` everywhere.
- [#230](../../issues/230) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — The dev boot stops drowning the terminal: emulator runs suppress the TEST banner lines, the auth `onCreate` headline shrinks to uid and email (full record behind the new `OMEGA_DEBUG` switch), and `omega dev` collapses consecutive duplicate leg lines into one plus a repeat counter.
- [#231](../../issues/231) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — `omega dev` tees to `logs/dev.log` and `omega manage` keeps `logs/manage.log`, so booting the dev stack no longer truncates the record of the last service walk.
- [#234](../../issues/234) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — The dev palette accepts page-scoped sections: a page registers its controls and the palette renders them on open, merged by id. The checkout gear is gone; its controls (decline toggle included) show only on checkout, and the persona switcher is now a dropdown.
- [#229](../../issues/229) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — Every manager verb is named: `omega manage` is the service walk (no alias), and a bare `omega` prints help instead of silently walking the brand. The brand's `manage` script heals to `omega manage`.
- [#228](../../issues/228) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — `omega dev`'s boot manage cycle runs the local lane only (workspace, assets, disperse) and never prompts: human gates, including a dead Google grant, land in the run summary's ⚑ pending list. Cloud services and rebuilds move to `npm run manage` or `omega dev --full`.

### Fixed
- [#219](../../issues/219) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — The pipeline's subscription, order, and intent writes land in one atomic batch, so a mid-sequence failure no longer splits state.
- [#222](../../issues/222) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — The stale-payload fallback asks each processor library for its own envelope shape, so a Chargebee or PayPal API failure degrades to the flagged stale payload instead of throwing.
- [#221](../../issues/221) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — The PayPal expiry cron updates the order record alongside the subscription and takes the pipeline's staleness discipline, so expiries no longer leave stale orders or clobber concurrent webhook writes.
- [#216](../../issues/216) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — The refund test processor resolves the product from the subscription when no order record exists, matching the cancel processor's fix.
- [#212](../../issues/212) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — First-checkout declines fire `checkout-declined` instead of `payment-failed`, so never-subscribed users stop receiving the renewal-dunning email; a refund merges into the order record instead of degrading it to an unknown product.
- [#233](../../issues/233) [`4218c80f`](../../commit/4218c80f) Thanks [@ianwieds]! — Checkout discount codes now apply: the client read a raw unparsed response, so every valid code rendered "Invalid discount code". The discount field also keeps its rounded left corners, and the billing cadence line centers under the plan tiles.

## [0.28.0] (2026-08-07)
### Added
- [#215](../../issues/215) [`50498beb`](../../commit/50498beb) Thanks [@ianwieds]! — The dev palette lists the four billing-journey personas for one-click sign-in, and a signed-in test account gains a "Reset to seed" button: a development-only backend route rebuilds that account (auth user, user doc, order fixtures) from its canonical seed shape.

### Fixed
- [#212](../../issues/212) [`50498beb`](../../commit/50498beb) Thanks [@ianwieds]! — The payment routes stopped trusting the caller and the processor: cancel's `skipGuards` and the portal's `returnUrl` are privilege- and origin-checked, a suspended subscription force-cancels only on "already gone", webhook and dispute-alert deliveries claim atomically, Chargeblast alerts verify their signature, Stripe renewals reach the pipeline, and PayPal prorations derive their period.
- [#212](../../issues/212) [`50498beb`](../../commit/50498beb) Thanks [@ianwieds]! — The webhook pipeline recognizes Chargebee refunds and renewals, dispatches a reprocessed refund once, flags a processor API failure's fallback as stale, fails the checkout intent behind a failed webhook, reconstructs one-time test resources, reports dispute-email outcomes truthfully, and logs its silent parse failures.
- [#210](../../issues/210) [`50498beb`](../../commit/50498beb) Thanks [@ianwieds]! — Cancelling a test-processor subscription no longer depends on checkout metadata: the cancel processor derives the product from the order document or the seeded subscription, so emulator accounts without a live checkout cancel cleanly.

### Security
- [#213](../../issues/213) [`50498beb`](../../commit/50498beb) Thanks [@ianwieds]! — The payments webhook verifies each processor's native signature, not just the shared key: Stripe events are checked against the raw request bytes whenever `STRIPE_WEBHOOK_SECRET` is set, and unsigned or tampered payloads get a 401. Unset, the route stays key-only and warns. PayPal, Chargebee, and `test` remain key-only.

## [0.27.0] (2026-08-06)
### Added
- [#207](../../issues/207) [`e7e720f2`](../../commit/e7e720f2) Thanks [@ianwieds]! — `targets.web.collections` declares a brand's own collections: documents under `_<name>/` get contract URLs, and the engine generates the listing, pagination, and per-category pages from one themeable layout pair; a consumer page at any generated URL takes it over.
- [#208](../../issues/208) [`e7e720f2`](../../commit/e7e720f2) Thanks [@ianwieds]! — Generated sample content now says what it is: every sample document carries a `generated: true` marker, and a TEST pill in the warn status color renders on the post page and every blog listing row. Development only, as before — production ships neither the samples nor the badge.
- [#209](../../issues/209) [`e7e720f2`](../../commit/e7e720f2) Thanks [@ianwieds]! — The flows e2e lane gained four billing journeys on dedicated seeded personas: upgrade to paid, cancel with access kept until term end, a declined renewal suspending a payer, and a trial claimed then converted.

## [0.26.1] (2026-08-06)
### Added
- [#205](../../issues/205) [`f95eff6f`](../../commit/f95eff6f) Thanks [@ianwieds]! — The Google account convention is recorded in the manager README's cloud row: sign every consent as the company account (the consenting identity owns every created project); personal accounts stay IAM members, with `access-heal.js` repairing wrong-identity projects.

### Fixed
- [#206](../../issues/206) [`f95eff6f`](../../commit/f95eff6f) Thanks [@ianwieds]! — A config reset no longer restarts the dev server: `devServerOptions()` hands Eleventy one stable object per session, so resets read as unchanged and the edit-burst restart race (`ERR_SERVER_ALREADY_LISTEN`, dev server terminating mid-session) is gone.
- [#204](../../issues/204) [`f95eff6f`](../../commit/f95eff6f) Thanks [@ianwieds]! — Stale `docs/themes.md` pointers in the web themes and the layers test page now name the real homes (`docs/shared/theming.md`, `docs/web/sections.md`), and the layers page comment drops the never-built `OMEGA_TEST_LAYERS` flag for the real manual steps.

## [0.26.0] (2026-08-06)
### Added
- [#200](../../issues/200) [`e3aafead`](../../commit/e3aafead) Thanks [@ianwieds]! — Dev watch targets register themselves: config-time reads go through `@omega.js/devkit/reads` (reading IS registration, a guard test fails direct reads), scan-shaped answers refresh live on their own rescan lane, and duplicate permalinks get a loud dev diagnostic and a failed production build.

### Fixed
- [#139](../../issues/139) [`e3aafead`](../../commit/e3aafead) Thanks [@ianwieds]! — The last stale config-time captures are gone: a brand's first real post retires the sample corpus mid-session without a restart, and permalink collisions surface immediately instead of silently last-one-wins.

## [0.25.0] (2026-08-06)
### Added
- [#144](../../issues/144) [`a7dfad42`](../../commit/a7dfad42) Thanks [@ianwieds]! — A published install wires itself whole: `@omega.js/mcp-router` becomes the seventh publishable and a manager dependency, the vendored Claude plugin launches it through an in-plugin resolver in any layout, and the repo map ships as the manager's `docs/AGENTS.md` so a brand's docs chain resolves on disk and from npm.

### Changed
- [#202](../../issues/202) [`a7dfad42`](../../commit/a7dfad42) Thanks [@ianwieds]! — `omega setup` no longer writes live marketing-campaign seeds as a side effect: the check reads every run and reports drift as a warning, and creating or enforcing seeds now requires the explicit `--seed-campaigns` flag. demo-* and no-connection behavior is unchanged.

### Fixed
- [#198](../../issues/198) [`a7dfad42`](../../commit/a7dfad42) Thanks [@ianwieds]! — The boot freshness heal now walks the host's `@omega.js/*` runtime dependency chain (deps first, host last), so a brand website boot heals a stale linked `@omega.js/client` instead of serving yesterday's bundle.
- [#199](../../issues/199) [`a7dfad42`](../../commit/a7dfad42) Thanks [@ianwieds]! — Desktop and extension boots now judge their vendored web assets for freshness: a `vendorAssets` source newer than its vendored copy, or a copy that was never vendored, marks the dist stale and triggers the rebuild.
- [#139](../../issues/139) [`a7dfad42`](../../commit/a7dfad42) Thanks [@ianwieds]! — Editing a theme layer's font files now reaches the dev server: theme `fonts/` directories joined the config-reset watch lane, so `site.fontPreloads` regenerates instead of serving a stale preload list.

### Removed
- [#203](../../issues/203) [`a7dfad42`](../../commit/a7dfad42) Thanks [@ianwieds]! — Dead code swept: the devkit dispatcher's unused `frameworkOf` helper and the extension's never-loaded `gulp/tasks/BU/` folder are gone.

## [0.24.1] (2026-08-06)
### Fixed
- [#196](../../issues/196) [`400818e3`](../../commit/400818e3) Thanks [@ianwieds]! — The flows-lane flake is closed at its root: a signout page no longer bounces to the homepage when the redirect policy races the sign-out, and the client delivers auth states strictly in order (a slow account fetch can never resurface a stale signed-in state).

## [0.24.0] (2026-08-06)
### Added
- [#197](../../issues/197) [`97dc9850`](../../commit/97dc9850) Thanks [@ianwieds]! — Every surface now logs to a greppable file: framework verbs write `logs/dev|build|test.log` per app, backend children keep rolling logs, the brand fan-out writes `logs/manage.log`, root lanes and the watcher tee to `.temp/logs/`, and e2e runners record per-step verdicts. Terminal keeps colors; files are stripped and cleared each launch.

## [0.23.1] (2026-08-05)
### Fixed
- [#195](../../issues/195) [`51422487`](../../commit/51422487) Thanks [@ianwieds]! — Local dist freshness is judged file by file: a missing or older dist file is stale on its own, deleted-source leftovers count, and vendor writes can no longer mask an uncopied edit. Heals lock per package, re-exec on every heal, and a CLI booting with no monorepo watcher warns loudly.
- [#194](../../issues/194) [`51422487`](../../commit/51422487) Thanks [@ianwieds]! — The `omega` dispatcher no longer dead-ends in a standalone app scaffolded before its framework dependency lands: a brand-shaped directory without `@omega.js/manager` falls back to the host framework's CLI with a stderr note instead of exiting.

## [0.23.0] (2026-08-05)
### Added
- [#148](../../issues/148) [`ab652b37`](../../commit/ab652b37) Thanks [@ianwieds]! — The breaking-changes register: `docs/shared/breaking-changes.md` documents every contract that changed shape from the legacy frameworks, one lineage section each plus cross-cutting, with the by-hand migration step per row and the deliberate external compatibilities that remain.
- [#191](../../issues/191) [`ab652b37`](../../commit/ab652b37) Thanks [@ianwieds]! — `omega audit` runs a full production build, serves `dist/` on an ephemeral port, and scores the home page plus any page-path arguments with Lighthouse in headless Chrome. Report-only until `--min-<category>` arms the gate; a score under its minimum exits non-zero.
- [#189](../../issues/189) [`ab652b37`](../../commit/ab652b37) Thanks [@ianwieds]! — `omega setup` publishes the app's resolved `.env` cascade to the brand repo's GitHub Actions secrets (`@omega.js/devkit/actions-secrets`, the `gh` CLI, values on stdin, never logged) and regenerates the scaffolded workflow's env block from the same keys. `--no-secrets` opts out; CI, no keys, no remote, or a foreign remote skip loudly.
- [#193](../../issues/193) [`ab652b37`](../../commit/ab652b37) Thanks [@ianwieds]! — Markdown images render optimized: `![alt](src)` in a post or page goes through the same builder as `omega_image` (responsive picture, lazy placeholder), and `@post/<file>` resolves to the post's own image directory — off a post it fails the build loudly.
- [#190](../../issues/190) [`ab652b37`](../../commit/ab652b37) Thanks [@ianwieds]! — Dev-mode collection sampling: `targets.web.dev.limitCollections` ({ posts: 50, randomize: true }) keeps N documents per collection in a development build and drops the rest before they render. Production never samples, every sampled build says so, and an unknown collection name fails the build.

### Removed
- [#148](../../issues/148) [`ab652b37`](../../commit/ab652b37) Thanks [@ianwieds]! — No framework accepts a superseded form at runtime anymore: the manager stops migrating old state keys, healing retired AGENTS.md imports and `omega-manager` scripts, and shipping its vestigial `omega-manager` bin; web drops bracket frontmatter refs and layout aliases (unmigrated layouts fail loudly); the client version check reads only current `build.json`.

## [0.22.3] (2026-08-05)
### Added
- [#188](../../issues/188) [`f52ea7c0`](../../commit/f52ea7c0) Thanks [@ianwieds]! — A web-package guard test compiles every core sheet, theme, and vendored Bootstrap, and fails on any bare `var()` consuming a custom property nothing defines, the mechanism behind invisible surfaces.

### Fixed
- [#27](../../issues/27) [`f52ea7c0`](../../commit/f52ea7c0) Thanks [@ianwieds]! — Newsflash dropdown menus, the mobile nav drawer, the 404 URL chip, and the pricing billing toggle rendered transparent: the theme's `--bs-card-bg` paper alias is now defined at `:root` so every consumer resolves it.
- [#187](../../issues/187) [`f52ea7c0`](../../commit/f52ea7c0) Thanks [@ianwieds]! — The updates page's code and pre blocks paint their tinted panels again: two uses of a misnamed `--bs-body-tertiary-bg` are renamed to Bootstrap's real `--bs-tertiary-bg`.

## [0.22.2] (2026-08-05)
### Fixed
- [#186](../../issues/186) [`85ceef38`](../../commit/85ceef38) Thanks [@ianwieds]! — The reduced-motion park guard now covers the theme trees too: `animations.test.js` derives its roster from every looping theme sheet as well as core css, compiling each through its theme, so an unparked theme loop fails the suite.
- [#36](../../issues/36) [`85ceef38`](../../commit/85ceef38) Thanks [@ianwieds]! — Devkit's isolated e2e-harness pass runs the file directly instead of through `node --test`, removing the runner-IPC deserialize fault that failed the file while every subtest passed; the retry and evidence log stay as a net for unknown flakes.

## [0.22.1] (2026-08-04)
### Fixed
- [#183](../../issues/183) [`a6907a0f`](../../commit/a6907a0f) Thanks [@ianwieds]! — Icon presentation is ONE sheet for every target: web's icon sheet is vendored to desktop and extension at prepare, it implements the `fa-bounce`/`fa-beat` core markup already uses, and `icon-core` parses all 12 shipped size classes as modifiers instead of icon names.
- [#185](../../issues/185) [`a6907a0f`](../../commit/a6907a0f) Thanks [@ianwieds]! — Every continuous loop in the web package's core css parks under `prefers-reduced-motion`, not just the `.animation-*` utilities: the lazy-load and binding shimmers, the exit-popup wave, the studio record pulse, and the download/extension pointers, with the test roster derived from every looping sheet.
- [#182](../../issues/182) [`a6907a0f`](../../commit/a6907a0f) Thanks [@ianwieds]! — `assets.test.js` builds its fixtures into a per-process out dir and clears it when the file finishes, so two concurrent web-suite runs no longer wipe each other's assets mid-flight.

## [0.22.0] (2026-08-04)
### Added
- [#180](../../issues/180) [`06c93e28`](../../commit/06c93e28) Thanks [@ianwieds]! — Rendered icons get a square glyph-centered box keyed on the renderer's own hooks, and a `.fa-spin` utility with a reduced-motion park; `docs/shared/icons.md` gains the Animation section.

### Fixed
- [#178](../../issues/178) [`06c93e28`](../../commit/06c93e28) Thanks [@ianwieds]! — The mcp-router resolves bare `npx`/`npm`/`node` to the absolute binaries beside its own node at spawn time, the interpolation understands `${NAME:-default}` so the bundled electron upstream no longer launches through a shell, and session env overrides reach placeholder resolution.
- [#175](../../issues/175) [`06c93e28`](../../commit/06c93e28) Thanks [@ianwieds]! — Backend rules files are stamped with `RULES_VERSION`, a rules schema version, instead of the package version, and every committed rules file is settled to it, so a dev boot no longer dirties the tree.
- [#179](../../issues/179) [`06c93e28`](../../commit/06c93e28) Thanks [@ianwieds]! — `contract.test.js` builds each theme in its own child process, ending Eleventy's layout-cache leak across same-process theme builds, with a marker pin that fails if any theme renders another theme's homepage.
- [#181](../../issues/181) [`06c93e28`](../../commit/06c93e28) Thanks [@ianwieds]! — Theme markup cleanup: the account page's dead `_px-3` typo is `px-3` again, the nonexistent `pt-8` is removed, and eight stale "Classy v2" header comments in `themes/base` now describe base-owned markup.
- [#184](../../issues/184) [`06c93e28`](../../commit/06c93e28) Thanks [@ianwieds]! — Every continuous `.animation-*` loop utility parks under `prefers-reduced-motion`, each at a sane resting state, with a roster-derived pin so a future unparked loop fails the suite.

## [0.21.0] (2026-08-04)
### Changed
- [#177](../../issues/177) [`840841e1`](../../commit/840841e1) Thanks [@ianwieds]! — Themes are rebuilt on a base/skin/fork model: `themes/base` owns all shared structural markup as `omega-*` BEM, every theme is a scss skin over it, and only bounded identity forks carry theme-prefixed markup, with a census guard in the web suite failing the drift.

## [0.20.4] (2026-08-04)
### Fixed
- [#174](../../issues/174) [`8e814fc0`](../../commit/8e814fc0) Thanks [@ianwieds]! — `omega-mcp refresh` runs the same guarded one-shot as `router__refresh_upstream`: the connect deadline, the bounded tools/list read, and the failure cleanup now live in one shared helper both surfaces call, so the CLI no longer hangs indefinitely on a stalled upstream.

## [0.20.3] (2026-08-04)
### Fixed
- [#173](../../issues/173) [`51c4d107`](../../commit/51c4d107) Thanks [@ianwieds]! — `router__refresh_upstream`'s tools/list read runs on the router's own 30s spawn budget instead of the SDK's 60s default, so a stalled upstream fails the refresh at the shorter deadline with the child terminated and the failure in `last_error`.

## [0.20.2] (2026-08-03)
### Fixed
- [#172](../../issues/172) [`a94445ff`](../../commit/a94445ff) Thanks [@ianwieds]! — `router__refresh_upstream` no longer leaks its one-shot child when the tools/list read fails after a successful handshake: the transport is closed, the failure lands in `last_error` like a failed spawn's, and the next successful refresh clears it.

## [0.20.1] (2026-08-03)
### Added
- [#163](../../issues/163) [`22c5f20d`](../../commit/22c5f20d) Thanks [@ianwieds]! — The web package's shared JS modules have an inventory: `docs/web/libs.md` documents every `core/js/libs/` module, the `__main_assets__` import idiom, and the rule that consumers import the framework helpers and never name the underlying library.

### Fixed
- [#164](../../issues/164) [`22c5f20d`](../../commit/22c5f20d) Thanks [@ianwieds]! — Enabling firestore point-in-time recovery no longer fails with "Operation does not exist": the PITR PATCH answers with an already-finished operation that firestore purges immediately, so the manager stops polling a finished operation and surfaces an embedded operation error directly.
- [#170](../../issues/170) [`22c5f20d`](../../commit/22c5f20d) Thanks [@ianwieds]! — `router__refresh_upstream`'s one-shot connect runs on the same 30s deadline as a cold spawn and terminates its child on any connect failure, instead of hanging the call for the SDK's 60s and leaking the child.
- [#171](../../issues/171) [`22c5f20d`](../../commit/22c5f20d) Thanks [@ianwieds]! — Packing `@omega.js/manager` passes the vendor guard again: the SDK its vendored translation module can lazily require is declared as an optional peerDependency, mirroring the web package.

## [0.20.0] (2026-08-03)
### Added
- [#169](../../issues/169) [`e1539dd1`](../../commit/e1539dd1) Thanks [@ianwieds]! — `@omega.js/web` draws diagrams the way it draws charts: `core/js/libs/graph.js` owns mermaid behind `loadGraph`/`graphSlot`/`drawGraph`, lazily loaded into its own chunk so a page with no diagram pays nothing, and themed off the live `--omega-*` tokens.
- [#168](../../issues/168) [`e1539dd1`](../../commit/e1539dd1) Thanks [@ianwieds]! — The manage cycle provisions the translation SDK: a web app whose resolved config enables translation with the `claude` provider gets `@anthropic-ai/claude-agent-sdk` written into its package.json and installed, converge-to-config (declared already = no-op, dry run plans, disable never uninstalls).

### Fixed
- [#166](../../issues/166) [`e1539dd1`](../../commit/e1539dd1) Thanks [@ianwieds]! — `router__refresh_upstream` re-reads the upstream's layered config from disk before spawning, so a `command` edited mid-session is what refresh actually runs, matching `router__enable_upstream`.
- [#167](../../issues/167) [`e1539dd1`](../../commit/e1539dd1) Thanks [@ianwieds]! — A child that corrupts the stdio handshake no longer wedges its mcp-router upstream for the whole session: `spawnUpstream` races `client.connect` against a 30s deadline, terminates the child, records the error, and the next call spawns fresh.

## [0.19.0] (2026-08-03)
### Changed
- [#115](../../issues/115) [`f778ece0`](../../commit/f778ece0) Thanks [@ianwieds]! — The `framework:` test scope is declared local-era only, and `docs/shared/testing.md` now says so: web's framework suite requires the unbuilt `src/` tree and dev dependencies a published install never receives, so shipping `test/` in the tarball would not make it runnable.
- [#37](../../issues/37) [`f778ece0`](../../commit/f778ece0) Thanks [@ianwieds]! — `@omega.js/web` no longer ships `@anthropic-ai/claude-agent-sdk` as a runtime dependency, so a brand install stops pulling a heavy SDK it never uses. A brand that enables translation installs the SDK itself, and the claude provider fails loud with the install command when it is absent.
- [#133](../../issues/133) [`f778ece0`](../../commit/f778ece0) Thanks [@ianwieds]! — The backend's signup guard reads its per-IP daily cap from config instead of a hardcoded 2: `targets.backend.auth.signup.maxPerIpPerDay` (positive integer, default 2) lets a brand whose users share egress (NAT/CGNAT, VPNs, offices) raise the limit that was blocking legitimate signups.

### Fixed
- [#56](../../issues/56) [`f778ece0`](../../commit/f778ece0) Thanks [@ianwieds]! — Interactive Google consent is ONE session per run: concurrent and later services join the open flow (or the one that already failed) instead of minting a fresh loopback url each time, and the open flow reprints its live url every minute.
- [#56](../../issues/56) [`f778ece0`](../../commit/f778ece0) Thanks [@ianwieds]! — The billing step stops announcing a plan it never read: a failed billing API read (unauthenticated, no permission, API off) reports "could not check the billing plan" and warns, distinct from a checked Spark verdict.
- [#56](../../issues/56) [`f778ece0`](../../commit/f778ece0) Thanks [@ianwieds]! — A hosting custom-domain claim waiting on DNS verification reports as pending instead of failing with "Operation timed out": the long-operation poller separates a terminal failure from a known-pending state.
- [#56](../../issues/56) [`f778ece0`](../../commit/f778ece0) Thanks [@ianwieds]! — A consumer test run asking for the boot layer with nothing to run explains itself (framework boot suites are self-test only; consumers write theirs under `test/boot/`) instead of ending silent.

## [0.18.2] (2026-08-03)
### Fixed
- [#38](../../issues/38) [`69377340`](../../commit/69377340) Thanks [@ianwieds]! — A vendor after-hook failure now aborts the prepare flow instead of warning and continuing: prepare-package 2.2.0 adds an opt-in `hooks.afterBlocking` flag, and all six publishables set it, so a package can no longer build a tarball missing its vendored internals.
- [#17](../../issues/17) [`69377340`](../../commit/69377340) Thanks [@ianwieds]! — The payments/intent 403-before-verify finding was verified stale: the route never carried the empty-token pre-check (the cp265 review generalized the contact route's defect to checkout incorrectly). A guard comment now pins that verify() owns the whole decision.

### Changed
- [#22](../../issues/22) [`69377340`](../../commit/69377340) Thanks [@ianwieds]! — The desktop package's own CHANGELOG records the remote-scripts opt-in flip under Unreleased, so the entry ships with the package at first publish.

## [0.18.1] (2026-08-03)
### Fixed
- [#158](../../issues/158) [`9c5d839c`](../../commit/9c5d839c) Thanks [@ianwieds]! — The sample posts and sample team members ship their imagery: the header and portrait pictures ride the `core/images/placeholder` set instead of hotlinking Unsplash, and the guard test now walks `defaults/` alongside the theme layer.
- [#161](../../issues/161) [`9c5d839c`](../../commit/9c5d839c) Thanks [@ianwieds]! — The built site answers the browser's `/favicon.ico` probe: the static channel mirrors the shipped `assets/images/favicon/favicon.ico` to the site root, in dev and in production builds alike.
- [#159](../../issues/159) [`9c5d839c`](../../commit/9c5d839c) Thanks [@ianwieds]! — Analytics events fire on web instead of being dropped: the client hands each event to the page's own `gtag` (the Measurement Protocol stays on extension and desktop, so the api_secret never reaches a page), which is what makes the host-side `vert_click` reach GA4.
- [#160](../../issues/160) [`9c5d839c`](../../commit/9c5d839c) Thanks [@ianwieds]! — A relative `authReturnUrl` such as `/pricing` is honored instead of silently falling back to the policy default: redirect validation resolves a path-relative value against the page origin before the same-host check.

## [0.18.0] (2026-08-02)
### Added
- [#155](../../issues/155) [`47db79ea`](../../commit/47db79ea) Thanks [@ianwieds]! — A real-browser e2e lane, `npm run test:flows`, drives the crucial user flows against the full local stack: the Google picker's redirect leg, the password forms, checkout to its confirmation, the vert ladder, and the account page. It boots its own emulator and `omega dev` on fresh ports.

### Fixed
- [#154](../../issues/154) [`47db79ea`](../../commit/47db79ea) Thanks [@ianwieds]! — Classy's default about and pricing pages no longer hotlink Unsplash: the about photo band and section photo demos ride a placeholder set shipped in `core/images/placeholder`, and the pricing testimonials wear their initial badge. A guard test fails any packaged theme that hotlinks an image host.

## [0.17.0] (2026-08-02)
### Added
- [#157](../../issues/157) [`0ce69247`](../../commit/0ce69247) Thanks [@ianwieds]! — An mcp-router overlay entry can carry `locked: true`: that upstream refuses every enable, from `omega-mcp enable` (non-zero, naming the field) and from `router__enable_upstream` (no override). `--force` is the shell-only escape hatch; disable, remove, and refresh stay open, and both listings show the state.

### Changed
- [#156](../../issues/156) [`0ce69247`](../../commit/0ce69247) Thanks [@ianwieds]! — Provider sign-in runs the redirect flow in development, as it does in production. `omega dev` serves the auth emulator through the site origin, so its OAuth handler and helper iframe are first-party and the returning credential survives storage partitioning. The popup now covers only iframed pages and `?authPopup=true`.

### Fixed
- [#153](../../issues/153) [`0ce69247`](../../commit/0ce69247) Thanks [@ianwieds]! — The agents-md service no longer dangles a brand's map import: the scope walk skips an empty local `node_modules/@omega.js/` directory (a partial-install leftover) and lands on the hoisted scope that actually holds the install, so the import it writes always resolves.

## [0.16.0] (2026-08-01)
### Changed
- [#44](../../issues/44) [`e74d0a5f`](../../commit/e74d0a5f) Thanks [@ianwieds]! — The legacy `uj` prefixes are gone: filters and tags are `omega_*`, globals are `site.omega.*`, classes and schema ids are `omega-*`, auth flags are `window.__OMEGA_*`, and the page library is `omega.library()`. No aliases — `omega migrate` renames a legacy consumer's spellings, and a guard test fails any surface reintroducing one.

### Removed
- [#44](../../issues/44) [`e74d0a5f`](../../commit/e74d0a5f) Thanks [@ianwieds]! — The redirect layout's `modifier` lane and its only entry, `search-cse`, are gone. Nothing supplied a modifier value: no page, config key, or doc reached it, so the layout, the data attribute, and the resolver went together.

## [0.15.0] (2026-08-01)
### Changed
- [#44](../../issues/44) [`af216cc3`](../../commit/af216cc3) Thanks [@ianwieds]! — Every affirmation tick now wears Bootstrap's `text-success`, bridged to `--omega-ok` in each theme, and the `.omega-check` utility plus its `--omega-check` token are gone. One success green, one vocabulary for it.
- [#152](../../issues/152) [`af216cc3`](../../commit/af216cc3) Thanks [@ianwieds]! — Light-mode `--omega-surface-2` is a visible well at `#ececeb`, not the `#f6f6f5` that sat one point off the page ground. Components painting it straight on the page, the download page's platform rail among them, are readable in light mode again.
- [#44](../../issues/44) [`af216cc3`](../../commit/af216cc3) Thanks [@ianwieds]! — A vert click's `utm_source` is the host brand's own `brand.id` on both lanes, not the page's domain. The parent host stays the targeting input and the fallback, and an advertiser's own tags still win.
- [#44](../../issues/44) [`af216cc3`](../../commit/af216cc3) Thanks [@ianwieds]! — The verts test page gains a narrow sidebar rail demo (a skyscraper slot in a 264px column, the app shell sidebar width, where the card stacks) and a Reload button on every demo slot that re-mounts that unit.
- [#44](../../issues/44) [`af216cc3`](../../commit/af216cc3) Thanks [@ianwieds]! — A configured `cloud.config.authDomain` must be the brand's own host, which self-hosts `/__/auth/*` for redirect sign-in. A `*.firebaseapp.com` value or any other host fails validation, naming both. Emulator-only `demo-*` projects are exempt.

### Fixed
- [#44](../../issues/44) [`af216cc3`](../../commit/af216cc3) Thanks [@ianwieds]! — A blog post's dot band opens the page like every other hero: the nav clearance moves from the article to the band itself, so the dots run up behind the transparent nav instead of starting below it and reading detached.

## [0.14.0] (2026-07-31)
### Added
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — A vert unit never renders empty: when every lane fails it renders the built-in omegajs.dev promo, lazy-armed, as a real unit: sandboxed iframe, the same postMessage and link contract, document inlined by srcdoc so nothing loads. The footer gains a quiet powered-by-omegajs.dev line.

### Changed
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — Vert clicks carry UTM tags automatically in both lanes (`utm_medium=omega-vert`, campaign per vert or promo), leaving any tag the advertiser already set untouched, and the host fires a `vert_click` analytics event off the frame's click message instead of routing through a forward page.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — Every vert document, served in-house ads and the built-in promo alike, now comes from one renderer in `@omega.js/client`: a compact media-row card (thumbnail left, title and clamped description, hairline, Sponsored label, accent CTA) sized to its content instead of stretching to the slot.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The classy about surfaces take image args (hero photo lead with a scrim'd masthead, letter-aside photo, wide photo band) with imageless defaults unchanged; the playground's about page ships three photographs, office-first, with a short lede as the whole top half.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The checkout page joins the classy design language: surface panels for plan, account, and payment, a sticky receipt-style order summary, and motion reveals. Every payment JS hook survives, pinned by a build-failing test.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The animated dots reach blog posts and update pages as masthead bands that never sit behind prose; bare-card auth, legal, and app surfaces stay deliberately plain.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The pricing rainbow is the hand-mixed pastel again and the hero dots now sweep the card's exact eight stops, pinned together by test. The 0.13.0 unification ran the wrong direction and is reversed.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The exit popup's subscriber row ships four real portraits with the framework (lazy-loaded, config-overridable, an explicit empty list keeps neutral slots); the legacy row hotlinked them.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — Every affirmation check and status green now share `--omega-ok`: `--omega-check` rides the success hue instead of the brand accent, so a green-branded site no longer shows two near-miss greens.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — Every root test lane and the whole pipeline print their wall time, workspace summaries carry per-package times, and the manage walk prints per-service durations with every number kept in the run record.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — QA cleanup: download and extension pages drop the repeated lead-in above the platform cards (heroes stay), the download modal drops its started card, footer button, and gappy help spacing, the contact reply-privacy line and status powered-by line are removed, and the footer stops stranding narrow-screen space.

### Fixed
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — Signing in with Google during local dev no longer dead-ends on return: dev uses the provider popup, because the emulator's redirect credential never reaches the site's origin. A redirect that comes home with no result now reports itself and tells the user instead of going quiet.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The classy signin card's "Forgot password?" link is accent-colored in both modes, matching the card's other links, instead of the muted helper-text gray.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — Vert units follow the site's theme instead of the machine's: mount passes the page's `data-bs-theme` into both the house serve URL and the promo document, a host can pin its own with `data-omega-vert-theme`, and a theme toggle after render re-stamps live promo frames with no network.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — A vert card in dark mode no longer shows white notches around its rounded corners or a white sliver under its bottom edge: the unit document declares its `color-scheme`, so the canvas the browser paints when it rasterizes the frame follows the card's theme instead of defaulting to white.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The compact vert card now fits the leaderboard slot: its thumbnail, paddings and rule spacing are budgeted under the 90px ceiling, so the shortest preset shows the whole card instead of clipping its bottom border.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — A vert unit no longer paints a band of its own under the card: the unit document reports its card box instead of the frame-filling root element, so the host shrinks to the card, and the host element carries no background, radius or clipping in any theme.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The classy blog's featured card no longer paints its image under the text column between 992 and 1150px wide: the media frame takes its width from the grid track instead of deriving it from its minimum height.
- [#44](../../issues/44) [`51216029`](../../commit/51216029) Thanks [@ianwieds]! — The backend's firestore index setup tests required a module path that never existed, so a real-project setup run crashed the moment index syncing ran; both now require the actual indexes command, guarded by a resolvability test.

## [0.13.0] (2026-07-31)

### Added
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — An enterprise tier is declared in data: `enterprise: true` on a `payment.products` entry renders it as its own full-width contact band below the plan grid, out of the cards and billing math. The hardcoded always-on enterprise card and its `pricing.enterprise: false` opt-out are gone.

### Changed
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — Blog search is client-side: the build emits a small `/blog/index.json` and the blog page ranks matches locally with a `?q=` deep link. The Google CSE form, the dead `/search/cse` targets in the schema SearchAction and opensearch.xml, and the never-wired legacy filter are gone.
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — Automatic vert placements (blog post, blog feed, mid-article, dashboard rail) render only when `advertising` is configured, a post opts out with `verts: false`, and the rail keys on the sidebar's `bottom.vert.enabled`. Hand-authored vert tags stay ungated.
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — The pricing rainbow and the omega dots share one color formula: the gradient samples the client's hue ramp instead of hand-mixed pastels. Geometry is unchanged.
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — The exit popup's subscriber line regains its overlapping avatar row: a brand supplies faces via `client.exitPopup.config.avatars`, and the default renders neutral slots with no external images.
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — Site copy drops the em-dash everywhere: 185 sentences across themes, core layouts, default pages, and shipped sample content rewritten to read naturally without it. Code comments and numeric ranges keep theirs.
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — Classy polish, first wave: pricing gains breathing room, the billing toggle reads in light mode, the footer copyright credits a configured parent company across all themes, the team page drops the stock-photos line, and the Google sign-in button renders the full-color Google brandmark.

### Fixed
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — Classy's first-section nav clearance keys on `:first-of-type`, not `:first-child`, so a preceding non-section element (the pricing promo banner, the blog read-progress bar) no longer steals the hero's top padding — /pricing and /about now start level. The contact page's decorative live-support chat demo is removed.
- [#44](../../issues/44) [`1074e039`](../../commit/1074e039) Thanks [@ianwieds]! — `omega dev` opens with a full manage cycle before spawning any app leg, so brand-level edits (the brandmark and its derived set, `.env`, certs) are redistributed on boot instead of going stale; errors in that cycle stop the boot. What refreshes when is documented as the redistribution contract in local-dev.

## [0.12.1] (2026-07-31)

### Fixed
- [#150](../../issues/150) [`1beb150e`](../../commit/1beb150e) Thanks [@ianwieds]! — The client's verts module reads AdSense slot ids from the schema's `advertising.providers.adsense.*Slot` keys (`displaySlot`, `inArticleSlot`, `inFeedSlot`, `multiplexSlot`); the old `slots.*` read never matched any schema shape, so `data-ad-slot` was never set from config. Settles [#35](../../issues/35)'s reader half.

## [0.12.0] (2026-07-31)

### Changed
- [#23](https://github.com/Omega-JS-Stack/omega/issues/23) [`e74b1cd2`](../../commit/e74b1cd2) Thanks [@ianwieds]! — omega.json5 keys name the ROLE, not the vendor, and every key is camelCase: `forms.providers.slapform`, `inbound.chat.providers.chatsy`, `inbound.email.providers.replyify`, `edge.providers.cloudflare`, `captcha.providers.recaptcha`, `search.providers.searchConsole`, `repo.providers.github`, `advertising.providers.adsense` (settling [#35](https://github.com/Omega-JS-Stack/omega/issues/35)'s naming half); `gcp` and `firebase` fold into `cloud.*`. Old spellings are hard validator errors — rename them.

### Fixed
- [#151](https://github.com/Omega-JS-Stack/omega/issues/151) [`e74b1cd2`](../../commit/e74b1cd2) Thanks [@ianwieds]! — The vendor-docs structure test now scopes its "everything the lane writes is generated" check to the lane's own destinations, not each package's whole `docs/` directory, so uncommitted edits to committed docs no longer turn the scripts lane red. A lane write to a non-gitignored path still fails it.

## [0.11.1] (2026-07-30)

### Changed
- [#51](../../issues/51) [`1081639c`](../../commit/1081639c) [`41913f90`](../../commit/41913f90) Thanks [@ianwieds]! — The emulator default now covers EVERY backend CLI subcommand: reads (`firestore:get`, `firestore:query`, `auth:get`, `auth:list`) join the writes, one rule with `--production` as the only path to live. The read-only live default and its `--emulator` opt-in are gone.

## [0.11.0] (2026-07-30)

### Added
- [#28](../../issues/28) [`1081639c`](../../commit/1081639c) Thanks [@ianwieds]! — Desktop builds resolve their macOS signing certificate in one order: `CSC_LINK`, the brand's gitignored `.omega/certificates/apple/` tree, its company's tree via the `.omega/company.json` stamp, then the Keychain — still the default. A tree certificate is used only when `CSC_KEY_PASSWORD` opens it.
- [#55](../../issues/55) [`1081639c`](../../commit/1081639c) Thanks [@ianwieds]! — The extension's Affiliatizer is documented in [packages/extension/docs/affiliatizer.md](packages/extension/docs/affiliatizer.md): the hostname-match redirect, its default-on storage flag, the 24-hour per-partner dedupe, `?affiliatizerStatus=block|allow|reset`, and the disclosure. The partner map is a fixed framework constant, not per-brand config ([#147](../../issues/147)).

### Changed
- [#51](../../issues/51) [`1081639c`](../../commit/1081639c) Thanks [@ianwieds]! — The backend CLI's state-mutating subcommands (`firestore:set`, `firestore:delete`, `auth:set-claims`, `auth:delete`, joining `auth:token`) now target the EMULATOR by default; `--production` is the deliberate opt-in to touch live, and every one names the stack it hit in its success line. Read-only subcommands keep their live default with `--emulator`.
- [#50](../../issues/50) [`1081639c`](../../commit/1081639c) Thanks [@ianwieds]! — The payments webhook's `test` processor is now non-production only: `POST /payments/webhook?processor=test` answers 403 in production, the rule the intent side already enforced. The shared `?key=<OMEGA_WEBHOOK_KEY>` compare stays the verification story for every real processor.

## [0.10.1] (2026-07-30)

### Changed
- [#140](../../issues/140) [`51a70310`](../../commit/51a70310) Thanks [@ianwieds]! — The omega Claude plugin's 11 skill descriptions are now single trigger sentences (8,760 → 2,654 chars), keeping the always-resident skill listing inside its context budget; a structure-lane test hard-fails any description over 300 characters.

### Fixed
- [#143](../../issues/143) [`51a70310`](../../commit/51a70310) Thanks [@ianwieds]! — An update page carrying a summary no longer gets the version and brand name glued onto its meta description; the "Release notes for version X of Brand" text is now reachable only when no summary exists, on the page itself and in `pages.json` / `llms.txt`.

## [0.10.0] (2026-07-30)

### Added
- [#64](../../issues/64) [`02638d89`](../../commit/02638d89) Thanks [@ianwieds]! — Every publishable package now ships the docs that match its version: prepare vendors the framework's guide as `docs/index.md` plus the shared contracts under `docs/shared/`, so a consumer install has the knowledge locally instead of pointers into a monorepo it doesn't have.
- [#62](../../issues/62) [`02638d89`](../../commit/02638d89) Thanks [@ianwieds]! — Consumer brands get the omega Claude plugin automatically: it is vendored into `@omega.js/manager`, and the manage cycle writes the brand's committed `.claude/settings.json` to enable it from the installed package — every collaborator's session, no setup. Published installs only; other settings are never touched.
- [#48](../../issues/48) [`02638d89`](../../commit/02638d89) Thanks [@ianwieds]! — `omega pipeline` now closes a launch by proving it: after the `--deploy` legs, `verify:site` / `verify:domain` / `verify:cloudflare` check the live surface as scorecard rows, failing the run like any deploy leg. `--verify` runs the sweep alone; demo-only brands record gated skips instead of network calls.
- [#142](../../issues/142) [`02638d89`](../../commit/02638d89) Thanks [@ianwieds]! — A config carrying a retired key (`web_manager`, `firebaseConfig`) now fails validation wherever the key sits, naming its replacement (`client`, `cloud`) and the mapping table. There is no dual-read, so the old name used to be ignored silently along with everything under it.

### Fixed
- [#141](../../issues/141) [`02638d89`](../../commit/02638d89) Thanks [@ianwieds]! — `pages.json` and `llms.txt` no longer emit unrendered Liquid: titles and descriptions contributed by a layout (the `/updates/*` release pages' `Version {{ page.update.version }}`) are rendered against the page they belong to, exactly as that page's own `<title>` renders them.

## [0.9.0] (2026-07-30)

### Added
- [#4](../../issues/4) [`7fcaf670`](../../commit/7fcaf670) Thanks [@ianwieds]! — Every web build now emits `llms.txt` ([llmstxt.org](https://llmstxt.org)): the brand heading, a summary, then the site's pages and posts as markdown links. It joins the machine files already shipped (robots, sitemap, feeds, ads, humans, opensearch, security), and a consumer file at `/llms.txt` replaces it.

### Changed
- [#1](../../issues/1) [`7fcaf670`](../../commit/7fcaf670) Thanks [@ianwieds]! — The web config key `web_manager` is now `client`. No dual-read: rename it in `omega.json5` and layout frontmatter; `omega migrate` emits the new name. A page may also set `client` in its own frontmatter now, reaching `resolved.client` with the layout chain merged underneath.

### Fixed
- [#18](../../issues/18) [`7fcaf670`](../../commit/7fcaf670) Thanks [@ianwieds]! — Production desktop bundles no longer ship `@dev-only` code: the webpack lane strips the marked blocks in production the way web and extension already did, and the marker contract now lives in one home (`@omega.js/devkit`) that all three frameworks strip through.

## [0.8.3] (2026-07-30)

### Fixed
- [#136](../../issues/136) [`e9eebbd2`](../../commit/e9eebbd2) Thanks [@ianwieds]! — `omega dev` serves edits to the packaged defaults tree (default pages, the section showcase, the sample-content corpora) on the very next rebuild, instead of re-rendering the copy captured when the server started.
- [#138](../../issues/138) [`e9eebbd2`](../../commit/e9eebbd2) Thanks [@ianwieds]! — `omega dev` serves edits to section and component entries (`_sections`/`_components`, consumer and theme layers) on the very next rebuild — the per-registration template and `section.json5` caches are rebuilt instead of served stale until restart.
- [#137](../../issues/137) [`e9eebbd2`](../../commit/e9eebbd2) Thanks [@ianwieds]! — A consumer-local theme at `src/themes/<id>` reaches the dev asset build and its watcher: the asset lane now resolves the theme chain from the same directory the engine does, so the brand's own theme styles the dev site instead of the packaged theme's.

## [0.8.2] (2026-07-30)

### Fixed
- [#134](../../issues/134) [`2ecae1af`](../../commit/2ecae1af) Thanks [@ianwieds]! — `omega dev` serves layout and include edits from every layer, not just the consumer's: the theme layers' and the framework core's `_layouts`/`_includes` are watch targets too, so such an edit lands on the next rebuild with no restart. Only those subtrees — css and page edits keep their lanes.

## [0.8.1] (2026-07-30)

### Fixed
- [#135](../../issues/135) [`0ff4150d`](../../commit/0ff4150d) Thanks [@ianwieds]! — The self-hosted Firebase sign-in pages render instead of downloading: `omega build` writes them as `handler.html`/`iframe.html` so GitHub Pages serves the `/__/auth/*` URLs as HTML through its clean-URL fallback, which a literal extensionless file was defeating with `application/octet-stream`.
- [#49](../../issues/49) [`0ff4150d`](../../commit/0ff4150d) Thanks [@ianwieds]! — `omega dev` serves layout and include edits on the very next rebuild. An edit under `src/_layouts/` or `src/_includes/` now rebuilds Eleventy's config, so the layered layouts and the json-in-`_includes` data system are re-read instead of re-rendering the copy captured at startup — no dev-server restart needed.

## [0.8.0] (2026-07-30)

### Added
- [#94](../../issues/94) [`fbbb6a63`](../../commit/fbbb6a63) Thanks [@ianwieds]! — Consumers can discover what they may override: `omega customize --list` prints every shadowable file (sections, includes, css, pages) with its owning layer and the consumer's existing shadows, and `omega customize <path>` materializes ONE of them there, with a provenance header naming the source layer. Existing consumer files are never overwritten.

### Changed
- [#130](../../issues/130) [`fbbb6a63`](../../commit/fbbb6a63) Thanks [@ianwieds]! — Backend log lines open with a `[HH:MM:SS]` local time bracket outside production, where nothing else stamps them; production lines are unchanged — Cloud Logging already carries the timestamp.

### Removed
- [#125](../../issues/125) [`fbbb6a63`](../../commit/fbbb6a63) Thanks [@ianwieds]! — The top-level `html` override leaves the admin email lane: the schema strips it from `POST /admin/email`, the internal-only guard rejects anything that slips past the schema, and the MCP `send_email` tool no longer advertises the parameter — matching the `content.html` policy: raw HTML that bypasses the rendered template is first-party-only.

### Fixed
- [#129](../../issues/129) [`fbbb6a63`](../../commit/fbbb6a63) Thanks [@ianwieds]! — The footer language switcher wears flags again: each row renders the country flag for its language before the native name, from the same core flag set the retired dropdown used. A language the set has no flag for shows the name alone rather than a broken image.

- [#126](../../issues/126) [`fbbb6a63`](../../commit/fbbb6a63) Thanks [@ianwieds]! — The extension build's error notification no longer passes a machine-specific icon path to notifly; the notification works identically on any machine.

### Security
- [#127](../../issues/127) [`fbbb6a63`](../../commit/fbbb6a63) Thanks [@ianwieds]! — The admin email route's request log line carries recipient count, template, and subject instead of the full send payload.

## [0.7.0] (2026-07-29)

### Added
- [#98](../../issues/98) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — A theme that reaches neither CSS fall-through lane no longer breaks silently: the web asset lane checks the compiled bundle for the shared `classy-*` vocabulary and warns once, naming the theme, the missing piece (hatch or floor), and the line to add. The neobrutalism theme gained the floor it lacked.

- [#88](../../issues/88) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — Three quality skills ship in the omega plugin — `omega:seo`, `omega:accessibility`, `omega:brandcheck` — and a hook fires them by construction: editing a web surface names the skills that own it, and the Stop pass blocks a sign-off that skipped their checklists.

- [#80](../../issues/80) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — The sitemap covers translations: every produced `/{lang}/...` page joins `dist/sitemap.xml` as its own entry, and each entry of a translated set — source and copies alike — carries `xhtml:link` hreflang alternates with `x-default` at the source language. A skipped or failed pair is listed nowhere.

- [#80](../../issues/80) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — Visitors can switch language: the shared footer dropup renders client-side from the page's own hreflang alternates, so it lists only the languages actually produced, names each in its own tongue, marks the current one, and hides when there is no choice. The old dropdown's flag icons retire.

- [#122](../../issues/122) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — Extensions get an `omega-account` click trigger: any `.omega-account` element opens the brand site's `/account` page in a new tab, resolved from `brand.url` exactly like `.omega-signin`. The never-wired `.auth-account-btn` name does not return.

### Fixed
- [#90](../../issues/90) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — Outbound email closes its escape-lane bypasses: the raw-HTML fields (`data.content.html`, `contentHtml`, `trustedContent`) are rejected with a coded 400 on the API lanes (`/admin/email`, `/marketing/campaign` — the MCP tools) and stay first-party-only, and every interpolated `href` is scheme-checked, so a `javascript:` URL is dropped instead of escaped.

- [#123](../../issues/123) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — A machine without the notifly binary no longer sees a raw `spawn notifly ENOENT` dump after an extension build error: the reporter detects the missing binary and warns `notifly not installed — skipping desktop notification` once. Every other spawn failure keeps its logged-not-thrown error.

- [#80](../../issues/80) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — Translated pages stop over-advertising and stop shipping half-translated: a copy's hreflang/`og:locale:alternate` tags name only the languages actually produced for that page, a provider failure skips its page-language pair whole with a loud warning, and `og:locale` now carries Open Graph's `language_TERRITORY` form (`en_US`, `es_ES`).

### Changed
- [#124](../../issues/124) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — Derived desktop download links are now opt-in: `site.targets.desktop.releasesUrl` and the derived `site.download` appear only when the config carries a `targets.desktop.releases` block (`enabled` defaults true when present, `false` suppresses), so merely declaring a desktop target no longer publishes releases/latest links before a release exists. An explicit `download` map still wins.

- [#121](../../issues/121) [`05b479cc`](../../commit/05b479cc) Thanks [@ianwieds]! — Backend Cloud Functions logs join the one-tag contract: every `ctx.log`/`ctx.error` line opens with `[@omega.js/backend:<function-name>]` and drops its timestamp bracket (the platform stamps entries), the record classifiers (`skip`, `expire`, `authenticated`, `test-mode`) survive as leading words instead of brackets, and the repo log-tag guard no longer exempts the package.

## [0.6.0] (2026-07-29)

### Added
- [#85](../../issues/85) [`e4a18bd4`](../../commit/e4a18bd4) Thanks [@ianwieds]! — Download and extension pages populate from config `targets` with no hand-supplied links: `site.targets` exposes a curated per-target view, desktop download URLs derive from the GitHub org and releases repo, and extension store listings are schema-declared config; an explicit page map still wins.

### Changed
- [#16](../../issues/16) [`e4a18bd4`](../../commit/e4a18bd4) Thanks [@ianwieds]! — Click-trigger classes unify into one client-owned registry with `omega-*` names: `omega-signout`, `omega-signin`, and `omega-password-toggle` replace the three legacy classes outright (no aliases), and a stock-theme build assertion keeps legacy trigger classes out of dist.

- [#12](../../issues/12) [`e4a18bd4`](../../commit/e4a18bd4) Thanks [@ianwieds]! — Every log line across the frameworks now carries one identity tag, `[@omega.js/<package>:<module>]` — build-time output adds a timestamp bracket, runtime consoles don't — replacing 328 hand-written prefixes; a repo-level guard test keeps new deviants out.

### Fixed
- [#102](../../issues/102) [`e4a18bd4`](../../commit/e4a18bd4) Thanks [@ianwieds]! — Template filters keep their familiar Jekyll-style names and now behave correctly: `group_by_exp` groups by value instead of collapsing everything into one truthiness bucket, numeric and boolean tag options arrive typed (`width=640` is the number 640), and an unparseable date passes through instead of rendering `NaN-NaN-NaN` into the page.

- [#103](../../issues/103) [`e4a18bd4`](../../commit/e4a18bd4) Thanks [@ianwieds]! — A desktop renderer now reports its real signed-in UID in the auth sync-request: it read the client's auth handle through a `user()` accessor that never existed (the real one is `getUser()`), so every boot claimed "signed out" and forced a needless custom-token round-trip.

- [#119](../../issues/119) [`e4a18bd4`](../../commit/e4a18bd4) Thanks [@ianwieds]! — The three negative-DNS cases in the backend email corpus now gate behind `TEST_EXTENDED_MODE` like the sibling suite's, so a default run needs no live DNS answer; the offline-safe pass cases stay in the default lane.

- [#120](../../issues/120) [`e4a18bd4`](../../commit/e4a18bd4) Thanks [@ianwieds]! — A marketing campaign that fails for a permanent reason (a brand-config hole or a bad AI prompt, thrown or carried in a provider result) is marked failed after one cron pass instead of silently retrying forever; temporary failures keep the existing retry.

- [#93](../../issues/93) [`e4a18bd4`](../../commit/e4a18bd4) Thanks [@ianwieds]! — A backend push notification takes its icon and click target from the brand's own config: no brandmark omits the icon, and a missing `brand.url` throws rather than defaulting to the framework author's company. The feedback email's rating faces are unicode glyphs, no longer images from that company's CDN.

## [0.5.0] (2026-07-29)

### Changed
- [#116](../../issues/116) [`3221397b`](../../commit/3221397b) Thanks [@ianwieds]! — The local-dev docs now state that linking is one-time and durable: a linked brand picks up every framework change with its normal `npm start` restart, and `omega i local` reruns exist only to heal an overwritten link — never as part of the edit loop.

- [#117](../../issues/117) [`3221397b`](../../commit/3221397b) Thanks [@ianwieds]! — The desktop `build`/`package`/`publish` verbs now run the pipeline and set the build-mode env flags themselves, the synced npm scripts are thin `npx omega` aliases, and cross-env is gone from every desktop consumer.

- [#87](../../issues/87) [`3221397b`](../../commit/3221397b) Thanks [@ianwieds]! — Desktop bundles now resolve the framework's `node_modules` before the consumer's, so a bare import of a framework-declared dependency always gets the framework's copy — the guarantee web already had, and extension always delivered; a per-lane test now pins all three.

- [#110](../../issues/110) [`3221397b`](../../commit/3221397b) Thanks [@ianwieds]! — Desktop boot tests build and boot in their own staged app root (`.omega/test-app/`) instead of the project's `dist/`, so a boot-test run and a live `npm start` watcher can no longer interleave writes and load each other's half-written bundles.

- [#105](../../issues/105) [`3221397b`](../../commit/3221397b) Thanks [@ianwieds]! — The five backend email tests that ran by hand from `src/manager/libraries/email/` now live in their mirrored spots under `test/email/`, so the runner discovers them — 126 tests the suite never used to run.

### Removed
- [#100](../../issues/100) [`3221397b`](../../commit/3221397b) Thanks [@ianwieds]! — Four checked-in per-app `CLAUDE.md` files predating the agent-docs chain are removed (three brand backend apps and the manager package's extension fixture), and the sandbox backend's `docs/README.md` is re-synced to the current scaffold wording.

### Fixed
- [#104](../../issues/104) [`3221397b`](../../commit/3221397b) Thanks [@ianwieds]! — An extension build error whose message contains an apostrophe now reaches its desktop notification: the reporter spawns notifly with an argv array instead of interpolating the message into a shell string the shell then failed to parse.

## [0.4.0] (2026-07-28)

### Added
- [#109](../../issues/109) [`8bc081f8`](../../commit/8bc081f8) Thanks [@ianwieds]! — The desktop docs cover three consumer traps surfaced on a real brand: shared code that touches `process` throws in isolated renderers, `target="_blank"` does nothing over `file://`, and the client-bridge guide now says sign-in is `manager.openAuthFlow()` — consumers never build a login form.

- [#112](../../issues/112) [`8bc081f8`](../../commit/8bc081f8) Thanks [@ianwieds]! — Web gains the consumer test guide its siblings already ship (`packages/web/docs/test-framework.md`): the layered doctrine, the production-build + smoke step a project run performs, the scope grammar, and how to author `node --test` suites — every claim checked against the command's code.

- [#113](../../issues/113) [`8bc081f8`](../../commit/8bc081f8) Thanks [@ianwieds]! — The omega Claude plugin gains a shape hook: writes of `__tests__/` directories, `*.spec.*` filenames, or `test/tests/` nesting bounce at write time in any project depending on `@omega.js/*` — the layered mantra's mechanical remainder, enforced in consumer sessions too.

### Fixed
- [#114](../../issues/114) [`8bc081f8`](../../commit/8bc081f8) Thanks [@ianwieds]! — `npx omega test` in a web app no longer errors when the app has a `test/` directory: the consumer-suite step hands node a `test/**/*.test.js` glob instead of a bare directory positional, which Node 22+ treats as a module to load.

- [#106](../../issues/106) [`8bc081f8`](../../commit/8bc081f8) Thanks [@ianwieds]! — `omega dev` on a desktop app resolves electron through Node resolution instead of a hardcoded `<app>/node_modules/electron` path, so a brand monorepo that hoists electron to its root launches instead of failing every time.

- [#107](../../issues/107) [`8bc081f8`](../../commit/8bc081f8) Thanks [@ianwieds]! — Fourteen doc lines across the framework guides claimed a bare `npx omega test` runs framework + project suites; every one now states the parser's truth — bare consumer runs are project-only, `framework:` or `full:` reaches the framework corpus. The brand guide gained a layered-doctrine pointer.

- [#111](../../issues/111) [`8bc081f8`](../../commit/8bc081f8) Thanks [@ianwieds]! — Desktop and extension consumers get a working app shell, not just its paint: the core `.omega-shell` grid sheet and the `app-shell.js` toggle module are now vendored alongside the theme skin, and both CSS guides carry a copy-paste markup reference.

- [#108](../../issues/108) [`8bc081f8`](../../commit/8bc081f8) Thanks [@ianwieds]! — The client no longer tries to register a service worker on origins that cannot host one: the boot branch is gated on http(s), so desktop (`file://`) and extension pages skip registration — and the disabled-branch sweep — instead of logging a failure on every window.

## [0.3.0] (2026-07-28)

### Added
- [#46](../../issues/46) [`80e3a3b5`](../../commit/80e3a3b5) Thanks [@ianwieds]! — A new root lane, `npm run test:e2e-extension`, proves the extension ↔ backend auth boundary in a real headless Chrome running the real built extension: the background worker signs in from the brand-site auth tab, then `omega:syncAuth` round-trips a fresh custom token from the backend emulator. Offline; skips without puppeteer's Chrome.

- [#46](../../issues/46) [`80e3a3b5`](../../commit/80e3a3b5) Thanks [@ianwieds]! — A new root lane, `npm run test:e2e-desktop`, proves the desktop ↔ backend auth boundary in a real Electron app: a second instance delivers `<brand.id>://auth/token` the way the OS does, and both main and the renderer land on the emulator user. Offline; skips without an electron binary.

### Changed
- [#46](../../issues/46) [`80e3a3b5`](../../commit/80e3a3b5) Thanks [@ianwieds]! — Every package's suite wears the same shape under the layered mantra ratified in the testing guide: backend's 128 test files gain the `.test.js` suffix, the client suite runs on `node --test` instead of mocha, config's catch-all file splits by module, and ~250 new unit tests close the gaps.

### Fixed
- [#46](../../issues/46) [`80e3a3b5`](../../commit/80e3a3b5) Thanks [@ianwieds]! — An extension build no longer produces an extension Chrome refuses to load: the manifest declares only minted icons, a missing app `version` or any packaging-step error fails the build, the worker's Firebase config arrives under `cloud.config`, and shared theme imports ship. Testing builds point auth at the emulator.

- [#46](../../issues/46) [`80e3a3b5`](../../commit/80e3a3b5) Thanks [@ianwieds]! — The backend router strips the `omega_api` URL prefix correctly: first-match alternation made `/omega_api/user/sign-up` resolve to `_api/user/sign-up`, and any first segment merely starting with a prefix word was truncated.

- [#46](../../issues/46) [`80e3a3b5`](../../commit/80e3a3b5) Thanks [@ianwieds]! — A schema file with a broken inner require now fails loudly: the settings loader's missing-module guard decides from the error's require stack instead of a message substring, so the silent `index.js` fallback no longer masks real defects.

- [#46](../../issues/46) [`80e3a3b5`](../../commit/80e3a3b5) Thanks [@ianwieds]! — The client no longer floats an unhandled unsupported-browser rejection in browsers with a service worker but no push support: messaging initializes only when `PushManager` exists, and `notifications.isSupported()` reports false when messaging is disabled. Repeat `initialize()` calls no longer stack version-check intervals.

- [#46](../../issues/46) [`80e3a3b5`](../../commit/80e3a3b5) Thanks [@ianwieds]! — The backend's `isUserOverStat` helper now means what its name says: it returns true when the user is over quota (the comparison was inverted) and fails closed on a malformed limit.

## [0.2.1] (2026-07-28)

### Added
- [#97](../../issues/97) [`48f04106`](../../commit/48f04106) Thanks [@ianwieds]! — A fresh web scaffold ships a starter walkthrough at `src/pages/example.md.txt`: the meta-only frontmatter allow-list, every `{% section %}` call form, slots, and `omega customize <url>` for starting from a stock page. The `.txt` suffix keeps it out of the build.

### Changed
- [#91](../../issues/91) [`48f04106`](../../commit/48f04106) Thanks [@ianwieds]! — The backend and web consumer scaffolds become AGENTS.md plus a one-line CLAUDE.md pointer, matching desktop and extension: AGENTS.md is marker-merged every setup, required reading points at the live agent-docs chain, and the brand-monorepo retire sweep covers both names.
- [#95](../../issues/95) [`48f04106`](../../commit/48f04106) Thanks [@ianwieds]! — `omega setup` on a web app now says which seed mode it detected — standalone app or brand monorepo — and what follows from it, so a targets-only config and absent per-app agent docs read as the design instead of a bug.
- [#96](../../issues/96) [`48f04106`](../../commit/48f04106) Thanks [@ianwieds]! — The web and backend guides state that the backend app's emulators are a prerequisite of `omega dev`, and name what quietly misbehaves without them: the site renders perfectly while sign-in, every Firestore read, and every API call fail.
- [#99](../../issues/99) [`48f04106`](../../commit/48f04106) Thanks [@ianwieds]! — The Bootstrap tooltip initializer had a byte-identical copy in all three themes; it moves to one home on the core layer that every theme imports, the same lane as the chart helper.

### Fixed
- [#101](../../issues/101) [`48f04106`](../../commit/48f04106) Thanks [@ianwieds]! — A CLAUDE.md an earlier scaffold generation wrote counts as framework-owned again: the brand sweep retires it instead of keeping it behind a false "carries consumer content" warning, and the standalone upgrade heals it to the one-line pointer instead of leaving it stale beside the new AGENTS.md.
- [#92](../../issues/92) [`48f04106`](../../commit/48f04106) Thanks [@ianwieds]! — The terms blueprint no longer ships a commented-out draft clause: HTML comments are still bytes in dist, so the draft reached every built legal page. The contract suite now fails on any HTML comment carrying draft markdown.

## [0.2.0] (2026-07-28)

### Added
- [#86](../../issues/86) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — Stock-brand builds fail on any missing-icon marker in dist, so a Pro-only icon name can never ship silently again.
- [#52](../../issues/52) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — Email identity is config-driven: new `brand.contact.person.*`, `brand.contact.carbonCopy`, and `brand.images.companyWordmark` keys replace every hardcoded personal name, headshot, wordmark, and BCC; a personal signoff without a configured name fails loudly instead of substituting a framework identity.

### Changed
- [#74](../../issues/74) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — The admin dashboard draws its charts through the shared charts helper (status hues kept); a browser-level check proves a chart actually paints.
- [#83](../../issues/83) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — The manager no longer folds company config itself; @omega.js/config owns the layer and a regression test pins that both paths merge identically.
- [#63](../../issues/63) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — The desktop and extension consumer scaffolds become AGENTS.md plus a one-line CLAUDE.md pointer, with required-reading pointers healed to the live agent-docs chain.
- [#87](../../issues/87) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — The framework-dependency reader moves to @omega.js/devkit as the one SSOT and web's esbuild hook reads it; the desktop/extension webpack half stays open on the issue.

### Removed
- [#84](../../issues/84) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — The backend CLI's stale command barrel is removed; the command table is the one dispatch and help home.

### Fixed
- [#9](../../issues/9) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — The cookie policy blueprint is real markdown again, so legal pages render with the same document treatment as terms and privacy; a heading-less legal doc can no longer collapse the layout grid.
- [#13](../../issues/13) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — Status greens (and warning/danger) match site-wide in dark mode via token bridges, and the build manifest gains theme, package versions, repo, and commit fields the status page now renders.

### Security
- [#53](../../issues/53) [`560ce100`](../../commit/560ce100) Thanks [@ianwieds]! — Third-party and AI-generated content renders with HTML disabled in outbound email; only two first-party alert lanes opt into trusted rendering, and both escape every interpolated external value.

## [0.1.0] (2026-07-28)

### Added
- [#2](../../issues/2) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — Consumer code imports any dependency the web framework declares by bare specifier (`import 'chart.js'` just works): an esbuild resolve hook serves the framework's own copy, one shared chunk, no curated list. Cross-framework lanes tracked in [#87](../../issues/87).
- [#54](../../issues/54) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — The company config merge layer is implemented in @omega.js/config itself, so direct framework builds see it — previously only `mgr` runs did. Deploy uploads carry it too.

### Changed
- [#68](../../issues/68) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — The disposable-email-domains dataset splits into a committed seed and a gitignored refresh cache: refreshes write only the cache, lookups read cache-else-seed, and a deliberate promote script advances the baseline. Suite runs no longer dirty the tree.
- [#20](../../issues/20) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — The backend CLI's help listing is generated from the same command table that drives dispatch, so a command can no longer exist without appearing in help.
- [#14](../../issues/14) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — Download page reworked: bigger platform marks, side-by-side Linux buttons, one mobile email form, token-painted modals, tighter intro copy. Auto-population from config targets split to [#85](../../issues/85).
- [#11](../../issues/11) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — Affirmation checks unify on one design-system token (`--omega-check`, accent-driven) with a shared utility class; per-page check colors removed.

### Fixed
- [#73](../../issues/73) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — The brand-root discovery walks in config and devkit stop at the nearest `.git` instead of climbing to the filesystem root.
- [#43](../../issues/43) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — Topbar and page-header actions no longer render a bogus `btn-<N>` class from Liquid's `.size` key count; only `sm`/`lg` produce a size class, and `lg` is no longer overridden by the default.
- [#3](../../issues/3) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — The topbar rail control uses `table-columns`, an icon the free chain resolves; six more Pro-only icon names in shipped themes swapped to free equivalents. Guard test tracked in [#86](../../issues/86).
- [#10](../../issues/10) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — Pricing feature checks align with their text on the first line, including wrapped features.
- [#21](../../issues/21) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — `remoteScripts` is declared in the desktop target schema, matching what the desktop framework reads.
- [#67](../../issues/67) [`fbcbdea2`](../../commit/fbcbdea2) Thanks [@ianwieds]! — The three in-repo brand roots declare `@omega.js/manager`, so a session at those roots gets the manager skill injected like the real brand.

## [0.0.2] (2026-07-27)

### Fixed
- [#77](https://github.com/Omega-JS-Stack/omega/issues/77) [`a747bda8`](../../commit/a747bda8) Thanks [@ianwieds]! — The plugin's `.mcp.json` launches the router from the checkout via `${CLAUDE_PLUGIN_ROOT}` — the npx form never resolved (private, unpublished package). A bare marketplace clone needs no install step: the bin installs its own dependencies on first launch, and the `omega-extension` launcher falls back to the sibling manager package.

## [0.0.1] (2026-07-27)

### Added
- [#75](https://github.com/Omega-JS-Stack/omega/issues/75) [`40e7bd78`](../../commit/40e7bd78) Thanks [@ianwieds]! — @omega.js/mcp-router: one lazy stdio MCP endpoint proxying four bundled browser/extension upstreams, layered over a `~/.omega/mcp-router/` overlay, declared once by the plugin's .mcp.json and documented by the new `omega:browser` skill.
- [#61](https://github.com/Omega-JS-Stack/omega/issues/61) [`dc5d446f`](../../commit/dc5d446f) Thanks [@ianwieds]! — The plugin staleness gate: scripts/skill-claims.test.js extracts every claim a skill makes (repo paths, consumer node_modules paths, omega: skill references, @omega.js package names, CLI verbs) and fails the battery when the repo no longer has it.
- [#72](https://github.com/Omega-JS-Stack/omega/issues/72) [`45448bea`](../../commit/45448bea) Thanks [@ianwieds]! — The web framework owns dataviz and the affordances around it: a chart helper with Chart.js lazily code-split (consumers never name the library), an org-chart component with animated connectors and a reduced-motion carve-out, the `--omega-chart-1…6` categorical ramp, and `.omega-tone-*` / `.omega-badge-tone` / `.omega-interactive` shared-core utilities.
- [#71](https://github.com/Omega-JS-Stack/omega/issues/71) [`45448bea`](../../commit/45448bea) Thanks [@ianwieds]! — @omega.js/client ships live-page primitives (`modules/live-page.js`): write-on-change `swap`, first-paint `loading`, and a declared-feed poller with keep-last-good-on-failure — the fetcher is an argument, never the singleton.
- [#70](https://github.com/Omega-JS-Stack/omega/issues/70) [`45448bea`](../../commit/45448bea) Thanks [@ianwieds]! — @omega.js/client ships `utilities.renderMarkdown(text)`: escape-first mini-markdown for hostile text (headings, code, lists, bold/italic, http(s)-only links), composing `escapeHTML` and `sanitizeURL`, with the tower's adversarial tests ported.
- [#59](https://github.com/Omega-JS-Stack/omega/issues/59) [`f405bfa0`](../../commit/f405bfa0) Thanks [@ianwieds]! — The Claude plugin ships from the monorepo: agent-plugins/claude carries seven ported skills plus the inject hook that loads the matching framework skill per project, the repo-root marketplace manifest lists it, and committed project settings auto-install it after one trust prompt. Structure and hook behavior pinned by scripts/agent-plugins.test.js.

### Changed
- (no issue) — The root AGENTS.md map is the one agent entry: every per-package AGENTS.md/CLAUDE.md is deleted, consumer brands import `node_modules/@omega.js/AGENTS.md` (a symlink the workspace service maintains at the map), the brand-root guide moved to docs/manager/brand.md, and upstream-first gained the permission gate — surface a proposed framework change and wait for the go.
- [#60](https://github.com/Omega-JS-Stack/omega/issues/60) [`816314d3`](../../commit/816314d3) Thanks [@ianwieds]! — The Claude plugin's skills rewritten for the package world: the legacy roster (bem, ujm, em, bxm, wm, mam) is deleted, replaced by web, backend, desktop, extension, client, manager and a rebuilt main hub; the inject hook now maps the `@omega.js/*` packages; the framework guides repointed.
- [#45](https://github.com/Omega-JS-Stack/omega/issues/45) [`ea2b603d`](../../commit/ea2b603d) Thanks [@ianwieds]! — Docs architecture rebuilt: knowledge moved to docs/shared/ + docs/&lt;framework&gt;/ (each framework's guide is index.md, including the new web guide), package AGENTS.md files reduced to thin pointers, root AGENTS.md rewritten as the map with the plugin story and the deterministic-loading doctrine, stale WEB-MANAGER headings fixed, 52 files repointed.

### Fixed
- (no issue) — Doc correctness sweep after the agent-docs rebuild: dead pointers to deleted package AGENTS.md files healed, four package.json files whitelists pruned, audit checklists repointed to the framework guides, the client guide's module inventory completed, consumer-repo paths corrected, and the skills README chain description updated.
- [#69](https://github.com/Omega-JS-Stack/omega/issues/69) [`45448bea`](../../commit/45448bea) Thanks [@ianwieds]! — The classy statgrid sizes from its container instead of the viewport: `--classy-statgrid-cols` is now a column ceiling and cells reflow below a 10rem floor, so one nested in a half-width card wraps on its own width. Its hairline dividers no longer depend on the column count.
- [#66](https://github.com/Omega-JS-Stack/omega/issues/66) [`45448bea`](../../commit/45448bea) Thanks [@ianwieds]! — The web build's PurgeCSS pass scans the built JS as well as the HTML, so classes that appear only inside JS-rendered markup are no longer stripped by `omega build`.
- (no issue) — cp270 desktop remote-scripts is now opt-in: the remote-execution lane initializes only when a brand sets `config.remoteScripts.enabled: true`, otherwise inert with a log line. cp269's TLS gate still applies. Docs and tests updated.
- (no issue) — cp270 dropped two unmaintained runtime deps: `mailchimp-api-v3` removed from the manifest (only the disabled legacy function lane used it) and `npm-api`'s four call sites moved to the new `@omega.js/devkit/npm-registry` helper. `automately` and `chatsy` stay. Root lock regenerated.
- (no issue) — cp270 commit-time three-lens review fix-ins: desktop setup's const-reassignment crash fixed, the opt-in derivation test pinned to a loopback URL, stale spikes references repointed to `_attic/`, extraneous lock stanzas pruned, and consumer locks regenerated.
- (no issue) — cp269 wave-6 review remediation, the last wave: two Fable reviewers swept the monorepo for security posture and developer experience, and the decision-free subset of findings closed as one batch. Rekey-shaped defects, the `spikes/` deletion, and legacy-dep replacement wait on Ian.
- (no issue) — cp269 desktop remote code lanes require TLS: remote-scripts and remote-config refuse a non-https resolved URL (loopback excepted) via the shared `utils/secure-remote-url.js` gate and disable themselves loudly. remote-config's renderer IPC handlers now register before every early return.
- (no issue) — cp269 `omega --help` is real everywhere: the devkit cli-router owns a built-in help resolved before positionals, desktop/extension disable yargs' built-ins, unknown commands print the listing and exit 1, and command errors surface once with their own stack.
- (no issue) — cp269 backend CLI no longer silently no-ops: bare `omega` defaults to `setup`, unknown commands exit 1 with a listing, `help`/`-h`/`--help` print a real listing, `clean` and bare `indexes` dispatch, and the phantom `firebase-init` doc row is gone.
- (no issue) — cp269 closed CLI alias drift: `-t` means test on every framework (translate keeps `--translate`), desktop/extension gained `-d`/`--deploy`, structure suites pin the aliases, and the docs across extension, desktop, backend, web, and manager match the shipped commands.
- (no issue) — cp269 dependabot triage of 71 open alerts plus mechanical bumps: root-lock alerts trace to four unmaintained runtime deps (own checkpoint), astro alerts live in the dead spikes dir, mcp-server lock regenerated, picomatch bumped, and two brand-backend alerts are stale.
- (no issue) — cp269 tests: new devkit cli-router help/unknown contract, backend boot cli-dispatch, desktop transport-gate suites plus the secure-remote-url unit, and yargs/alias source pins in the desktop, extension, and web structure suites. Full battery exit 0.
- (no issue) — cp268 settled the authDomain contract as the brand host with a self-hosted OAuth handler: `omega build` fetches Firebase's six `/__/auth/*` helper files into `dist/__/`, demo and projectless builds skip, and `OMEGA_SKIP_FIREBASE_AUTH` is the escape hatch.
- (no issue) — cp268 stopped dev-only code shipping to the live site: a shared esbuild plugin (`packages/web/src/strip-dev-blocks.js`) strips `@dev-only` blocks from production page bundles, legacy module bundles, and the service worker, while dev builds keep them.
- (no issue) — cp268 made advertising config provider-neutral: the manager's AdSense service keys off `advertising.providers.google-adsense`, gating on the entry's presence, reading and landing the embed-ready `client` value, and the legacy top-level `adsense` key left the config writer's order.
- (no issue) — cp268 converted the five content-bearing framework `CLAUDE.md` files (desktop, extension, backend, client, devkit) to `AGENTS.md` with one-line pointer `CLAUDE.md` files beside them, via a two-commit rename so history follows. Consumer-template defaults stay as-is.
- (no issue) — cp268 commit-time three-lens review fix-ins: seven follow-ons closed, including the AdSense loader's doubled `ca-` prefix, the Disable flow landing `enabled: false`, a content-hash iframe cache breaker, hostname-only domain derivation, and `AGENTS.md` added to publishable `files` arrays.
- (no issue) — cp268 tests: manager cloud suite expects the brand-host authDomain and the adsense suite is rekeyed to the advertising shape; web gains a strip-dev-blocks unit plus prod-vs-dev integration proof and firebase-auth-helpers coverage against a local HTTP server.

- (no issue) — cp267 wave-5 review remediation across desktop, extension, and brands: all 15 defects closed as one batch, including the authDomain decoupling with `getApiUrl()` from `brand.url`, the AdSense deliberate-absence skip, desktop deep-link and update-gate fixes, extension messenger wiring, and eleven behavioral regressions.

- (no issue) — cp266 wave-4 review remediation across config, client, account, and template-kit: all 17 defects closed as one batch, spanning Sentry beforeSend and identity reads, bindings operators, Firestore cancellation safety, the web-push VAPID key wiring, secret-shaped-key detection, and template-kit literal tag arguments.

- (no issue) — cp265 wired the classy newsletter form to the backend's public subscribe endpoint through `omega.request()`, promoted reCAPTCHA to a shared lazily loaded lib, and lowered the SoftwareApplication schema's synthesized rating count to 10k-30k. All 21 wave-3 findings closed.
- (no issue) — cp265 captured and fixed the devkit test "flake": the translate watchdog timer was `unref`'d, so the process could drain before the window. Removing it also fixes production, where a stalled call exited silently instead of failing loud.
- (no issue) — cp264 wave-3 review remediation across the web engine and themes: twenty of 21 defects closed as one batch, covering argv-based deploy, service-worker Firebase gating, the PurgeCSS safelist, shared Liquid metadata and JSON-LD escaping, and theme fixes.

### Changed (cp263 — the assistant library is now RouteContext / `ctx`; Ian-ratified name)
- (no issue) — cp263 renames the backend assistant library to RouteContext: `BackendAssistant` → `RouteContext`, context key `{ assistant }` → `{ ctx }`, `Manager.Assistant()` → `Manager.RouteContext()` across every handler, event, cron, schema, library, test, and doc; the 1,149-line file split into per-concern `helpers/context/` modules.
- (no issue) — cp263 makes `respond(payload, options)` the only sender; `errorify` (25 sites) and the `errorManager` alias retire in favor of `ctx.report(e, { code })`, which decorates and logs an Error without sending. Status-code and omega-properties semantics preserved.
- (no issue) — cp263 reduces Sentry to one rule: server faults (>=500) capture automatically, client faults never do; `respond()` keeps only `log: false`. Removed broken `logProd()`, `parseRepo()`, 13 `getHeader*` methods (now `client-info.js`'s `getClient()`), and deprecated request getter shims.

### Changed (cp262 — legacy-name sweep, Ian 2026-07-22: "wm means web-manager, we dont use that anymore")
- (no issue) — cp262 renames `data-wm-bind` → `data-omega-bind` everywhere (bindings engine, themes, layouts, sections, JSON defaults, docs, consumer templates), with `wm-binding-skeleton` → `omega-binding-skeleton` and `wm-bound` → `omega-bound`. No dual-attribute compatibility.
- (no issue) — cp262 deletes web's duplicate `authorized-fetch.js` and migrates all 16 callers to `omega.request()`, which gained the two semantics they used: `tries` (bounded retry on network errors and 5xx) and `timeout` (per-attempt AbortSignal).
- (no issue) — cp262 retires desktop `em` initials: `window.em` → `window.desktop`, plus Firebase app, session vault, electron-store, CSS classes, theme attribute, signing/runner artifacts, launch flag, webpack alias, and test ids renamed to `omega-`/`desktop-`; one-time re-sign-in and storage reset.
- (no issue) — cp262 retires legacy test-target aliases: `FRAMEWORK_IDS` drops `ujm`/`em`/`bxm`; frameworks answer only to `web:`/`desktop:`/`extension:`/`backend:` plus the universal `mgr:`/`omega:`/`framework:`.
- (no issue) — cp262 renames client storage key `wm_usage` → `omega_device` (device stats reset once), extension `data-bxm-context` → `data-omega-context`, `bem-*`/`bxm-*` test ids, and Stripe idempotency prefixes to `omega-`. Kept deliberately: `uj_`/`data-uj-*`, the `ujm-import` lint id, `<em>` fixtures.

### Added
- (no issue) — cp261 adds `omega.request()` in `@omega.js/client`: route-relative paths resolve via `getApiUrl()`, a fresh Firebase ID token rides as `Authorization: Bearer` (opt out with `auth: false`), non-ok responses throw with `.code`/`.data`/`.properties`, and `omega-properties` usage merges into bindings. `createRequest()` serves desktop and extension.

### Changed
- (no issue) — cp261 renames the client local-stats module `usage` → `device` (`omega.device()`, bindings key `device`), resolving a live collision where server usage and local install/session stats overwrote the same bindings key. The persisted storage key stays `wm_usage`.

### Removed
- (no issue) — cp260 retires the legacy `command: "category:action"` API: 43 action modules, `api.js`, `Manager.Api()`, `Manager._process()`, BackendRouter's legacy branch, 24 legacy test suites and the `--legacy` gate, the http-client `command()` surface, and the command-registry guard are gone; docs swept.
- (no issue) — cp260 removes the extension's silent ITW fallbacks: `background.js` resolves its API URL via BXM `url-helpers` (throwing when unset) and reads Firebase config from canonical `cloud.config`; gulp `validRedirectHosts` defaults drop `itwcreativeworks.com`.

### Fixed
- (no issue) — cp260 fixes desktop and extension sign-in token sync, which threw on every cross-context auth: both now `POST /omega/user/token` and read `data.token`. New root lane `npm run test:auth` exercises a real emulator user through the real desktop client-bridge.

### Security
- (no issue) — cp259 closes 13 wave-2 review defects across backend and manager (command-name validation, runtime-identity Firebase init with boot-time project check, argv-array subprocess calls, notifications rules, credential redaction, constant-time key checks, `headersSent` guards), amended twice; B2, B9, M21, M22 remain open for Ian.

### Changed
- (no issue) — cp258 renamed the entire ad system to "vert" so adblock filter lists never hide the house fallback's own surfaces: routes, Firestore collection, client module, DOM vocabulary, sections, admin page, e2e lane. `ads.txt` and Google's own `ad*` tokens stay.

### Added
- (no issue) — cp257 de-ITW'd the reCAPTCHA ask (brands mint their own keys at the GCP console, never a shared company key) and made a company `analytics.providers.google.accountId` the GA account default for sub-brands, printed as a note instead of prompted.

### Added
- (no issue) — cp256 added the `omega update` verb (aliases `outdated`/`out`) to every framework, the backend, and the manager's brand-root fan-out: one devkit implementation reporting current/installed/wanted/latest per dep, quarantining releases under 7 days old, `--apply` for non-major bumps.

### Added
- (no issue) — cp255 added a declarative per-service `requires: { env, scopes }` map to the manager's service registry plus a preflight phase that checks the enabled set before any service runs, printing one consolidated walkthrough; failing services skip unless `--strict`.

### Added
- (no issue) — cp254 landed multi-instance targets: `targets.<type>` accepts an array of id'd entries, normalized in one home (the `@omega.js/config` instances module). App dirs, compose merge, validator warnings, structure heal, web dev-port offsets, and deploy record keys gain the instance dimension. Zero breaking change.

### Added
- (no issue) — cp253 closed the ads arc with a company-mode proof: a new root e2e lane (`npm run test:ads`) has The Daily Build consume Paperloom's seeded inventory cross-brand, 10/10 scenarios. Two bugs fixed: port-stripped postMessage origin, and the retired `inhouse.serverUrl` schema shape.

### Removed
- (no issue) — cp252 retired the legacy `vert.js` lane from packages/web: the standalone IIFE, the `popupads.js` stub, the `adunits/*` includes, `_verts.scss`, and the assets skip-guard are gone; blog posts, layouts, the demo page, and fixtures now speak the `ads/unit` section.

### Added
- (no issue) — cp251 added the brand-root `omega deploy` verb: fan-out over the brand's apps running each app's own framework deploy, backend first, `--only`/`--except` filters, stop-on-failure. The retired `omega-manager` bin name left every user-facing surface, with a scripts heal for existing brands.

### Added
- (no issue) — cp250 wired the shared client ads module into the desktop and extension client surfaces for `data-omega-ad` auto-bind (scan plus MutationObserver; extension content scripts excluded). The type is pinned to `'house'` at mount, so the AdSense lane is unreachable there.

### Added
- (no issue) — cp249 added the `/admin/ads` CRUD card to the admin dashboard, mirroring admin-users: list with stats, targeting-chip summaries, a create/edit modal over the full collection shape, enable/disable toggle, and delete, all through the phase-1 `/omega/ads` routes.

### Added
- (no issue) — cp248 added an ads module to `@omega.js/client` (`omega.ads()`) — the one fallback ladder for every surface: AdSense lane with rewritten detection, then a sandboxed in-house/company iframe lane, then hide — plus the thin classy `ads/unit` section delegating to it.

### Added
- (no issue) — cp247 added a local-dist freshness guard: every framework CLI boot detects a stale locally-linked dist, rebuilds it, and re-execs the same invocation, so no command runs stale framework code. One shared devkit implementation wired at all five CLI boots.

### Changed
- (no issue) — The scaffolded brand `AGENTS.md` is now just the framework-guide import plus a short `# <brand> — brand notes` heading; the cp244 marker comment and skeleton sentence are gone, and heals scrub legacy copy from existing files.

### Added
- (no issue) — cp246 retired per-app docs in brand context: `CLAUDE.md`/`CHANGELOG.md`/`docs/` never scaffold in a brand app, and framework-owned-only copies are swept once via a new devkit `retire` rule wired in all four frameworks. Consumer-content copies are kept and warned.

## [cp200–cp245] — launch era: real brand, publish lanes, sections close-out (2026-07-16…2026-07-20)

### Added

- (no issue) — cp245 — ads system phase 1: the backend house-ads module. New routes serve HTML ad units, fail-closed redirect, and admin-gated CRUD, with tag-scored weighted selection over a cached inventory; the `ads` collection stays client-inaccessible. Phases 2–4 queued.
- (no issue) — cp244 — every brand root gets a framework-maintained AGENTS.md importing the agent guide shipped in `@omega.js/manager`, plus a one-line CLAUDE.md pointer; a new `workspace` service op creates and heals the chain idempotently. Per-app CLAUDE/CHANGELOG scaffold retirement queued separately.
- (no issue) — cp243 — the assets fonts-union now prunes font files no emitted stylesheet references, so sibling themes stop shipping the base theme's unused faces; partial builds skip the prune.
- (no issue) — cp242 — every target's `omega deploy` auto-detects tree-wide `file:` @omega.js specs and takes its local-artifact lane: web builds direct, extension and desktop run their local release scripts, backend already packed tarballs. CI dispatch stays reserved for registry-clean trees.
- (no issue) — cp241 — web and manager gain publish lanes (dist copy, vendored privates, files whitelists, declared runtime deps); template-kit becomes vendorable, `restoreRegistrySpecs` flips `file:` specs back to registry ranges tree-wide, CI pack-smoke covers all six publishables, and `npm run release:check` is 6/6 green. Runbook: docs/publishing.md.
- (no issue) — cp238 — all ten `@omega.js/*` packages reset 1.0.0 → 0.1.0 with the two real registry ranges following; independent versioning stands, changesets publishes with `access: public`, and `private: true` latches all six publishables until the proving checkpoint. npm org publish rights remain Ian's to confirm.
- (no issue) — cp237 — the cloud service self-heals the identity seam inside `npm start`: probe project access, grant the manage identity owner (falling back to editor plus firebase.admin), re-probe through propagation. Degraded lanes keep the cp236 diagnostic. The first healing run must be Ian's own `npm start`.
- (no issue) — cp236 — the frontmatter guard softens to strip-and-warn instead of failing the build; Google 403s now name the acting account and the exact grant command; the playground rebrands to Paperloom; the `omegajs` project flips real (Blaze, sdkconfig, authDomain); the seo service run lands green.
- (no issue) — cp235 — consumer page frontmatter is enforced meta-only (build fails otherwise); repo and folder rename to `omega-brand`; `repoWebsite` retires for an optional `github.repo` slug; demo-* project ids skip cloud calls; the Firebase project `omegajs` is minted; D5 fonts closed.
- (no issue) — cp234 — a .md page composing sections now skips markdown via the `omega-composition-liquid` preprocessor, fixing the empty `<p>` grid children; the repo renames to `itw-creative-works/omega`; `repo_website` becomes `repoWebsite`; about sectionizes into five classy sections; a page body now replaces the layout composition, `append: true` opting back.
- (no issue) — cp233 — the site repo transfers to the `itw-creative-works` org, with `brandRepoOwner` reading the owner from `repo_website`; language homes now land as `<lang>.html`, ending the `/es/` redirect loop on both brands; Spanish completes on the real brand across 17 pages.
- (no issue) — cp232 — omegajs.dev goes live: repo created and pushed, 70-page production deploy, github and cloudflare services reconciled, HTTP/2 200. `brandRepoName` in @omega.js/config fixes the derivation that had pushed gh-pages to the framework monorepo. Monorepo privacy restore stays Ian's one command.
- (no issue) — cp231 — both homepages convert to the pure composition form, each band's words living in its own `{% section %}` call; the leaked layout-default CTA button dies with it. Both brands exclude 16 app-shell routes from translation; the real brand gains its first seo entry.
- (no issue) — cp230 — `omega build` now writes brand.url's bare host to `dist/CNAME` on every production build, so a CI branch push can no longer clear the GitHub Pages custom domain; no host configured means no file.
- (no issue) — cp229 — the real brand is born as the sibling repo `../omegajs.dev`: the playground's content forked 1:1, identity authored real, every `@omega.js/*` dep a committed relative `file:` spec. Spanish stalled at 12/34 (resumable); the live-publish lane awaits Ian's own terminal.
- (no issue) — cp226 — the classy theme drops its four literal framework accents: the hero command default is removed, the layout cta command lines go, and the bento code label and terminal mock become per-item args with generic defaults. The playground passes its omega voice through those args.
- (no issue) — cp225 — the playground homepage becomes a full composition carrying the real OMEGA pitch (terminal hero, six capability tiles, honest stats, setup CTA), with trusted-by, product-demo, showcase, and testimonials deliberately absent until real assets exist; the about page tells the real consolidation story.
- (no issue) — cp224 — `{% slot name %}` blocks pass finished markup into sections and components: slot content renders in the caller's scope, arrives as an `html`-typed arg merged outermost, and is never re-rendered. `marketing/hero` gains `demo_html` and `marketing/stats` gains `after`.
- (no issue) — cp223 — the last duplicated band becomes a section call: alternatives/index's stats band now composes `marketing/stats`. The audit recorded why every other repeated-looking band stays inline and settled the boundary doctrine — data-only args for sections, includes for context-bound partials, layouts for plumbing pages.
- (no issue) — cp222 — sample content generates instead of copying: each file's date is a rhythm off the corpus epoch, re-anchored to the build day on non-production builds. `omega dev` materializes the set under a self-gitignored `.omega/sample-content/`, removed per collection once the consumer owns it.
- (no issue) — cp221 — `asset_path` is dead: page assets bind to URLs through a resolver that tries the exact key, the per-page-dir `index` spelling, then `[name]` wildcard filenames. Internal uses converted, the `data-asset-path` attribute removed, and the homepage video-tab logic moved into `product-demo/section.js`.
- (no issue) — cp220 — `omega customize <url>` materializes a default page into `src/pages/`, idempotently: composition layouts prefill the default composition as one-liners with no copy inlined, everything else copies the thin default verbatim. No URL lists every customizable default URL and its lane.
- (no issue) — cp219 — `/test/sections` renders the whole resolved section and component library: an index grouped by kind and category, one page per entry with schema-generated args reference, pretty-printed defaults, and every demo variant rendered live. Development builds only, collection-excluded; new folders need no authoring.
- (no issue) — cp218 — newsflash overrides `marketing/cta`: its three inline dark bands compose it and every fallthrough page flips to the panel. The newsletter-cta override gains a `rail` variant, killing the third dead form; the doctrine on when a theme overrides a shared id is documented.
- (no issue) — cp217 — an override folder's json5 may declare `inherit: ['js']` or `'scss'`, filling that asset lane from the first lower entry that has the file. First consumer: newsflash's newsletter-cta override, which inherits classy's FormManager `section.js` and fixes two live dead forms. A third form is parked.
- (no issue) — cp216 — every remaining newsflash band head renders through the components: 20 `section-head` clusters and six more lede clusters flip to `heading/rule-head` and `heading/lede` calls, and the component's link slot goes live; team/index's masthead lede variant stays inline.
- (no issue) — cp215 — `news/story-card` and `news/byline` land: the newsflash story tile converges its six identical instances into one component that nests the byline, which also serves the splash, feed items, and hero cover story. Post lookups ride the site adapter.
- (no issue) — cp214 — the mini fixture grows from 2 to 17 posts, taking the corpus to 115 pages on both themes; under newsflash the strict slot dedup is now corpus-proven end to end, and the feed and more-stories bands finally render.
- (no issue) — cp213 — the newsflash theme gets its first theme-layer section override (`marketing/stats`) plus its own `marketing/rundown` and `marketing/desks` sections and the `heading/rule-head` and `heading/lede` components; the index composes all three bands. cta/hero overrides and posts-driven bands are deliberately deferred.
- (no issue) — cp212 — `heading/section-head` converges 22 h2 clusters, including four section-internal sites where bento, product-demo, showcase, and faq compose the component from their own markup — nested composition proven. Pricing's `| default:` copy stays inline because `resolved.pricing` is engine-composed.
- (no issue) — cp211 — `heading/masthead` becomes the component tier's first production citizen, converging 17 interior-page heads: pages keep their band shells and compose the head inside, with `sub_class`/`h1_class` knobs carrying per-page variants. Golden diff across 98 pages shows zero content differences.
- (no issue) — cp210 — `marketing/faq` converges the Bootstrap-accordion band across four of five pages, with a `center` variant and a `dom_id` knob defaulting to `faq` so per-page collapse ids converge. Pricing's FAQ deliberately stays inline — its aside embeds the bespoke billing-guarantee object.
- (no issue) — cp209 — the §7 asset lane gets its first consumer: `marketing/newsletter-cta` owns its `section.js`, taking the FormManager binding out of the blog index page module, and blog/post converts to the shared band, killing its dead `/email-subscription` form. The band's alert slots are parked as dead markup.
- (no issue) — cp208 — the §7 asset lanes land: every resolved `section.scss` compiles into the main sheet through a synthesized `omega:sections` sass module, every `section.js` bundles into a registry the `bootSections` runtime initializes per present element, and `collectSectionAssets` walks the same layer chain as the tags. docs/sections.md opens.
- (no issue) — cp207 — the canonical newsletter dialect extracts as `marketing/newsletter-cta` and blog/index converts byte-identically. blog/post's conversion is parked with the finding that its plain `action="/email-subscription"` form posts to a page that does not exist — the section can't own the binding until the §7 section-JS lane exists.
- (no issue) — cp206 — the CTA family converges: nine near-copies collapse into `marketing/cta` v2, a union contract with neutral defaults per the shared-band ruling, converting eight callers and deleting ~170 lines of duplicated markup. Blog's two newsletter CTAs and alternative's stats+CTA hybrid stay unconverged, deliberately.
- (no issue) — cp205 — the entire classy homepage becomes composition: the seven remaining index bands extract to `themes/classy/_sections/marketing/*` and the layout body collapses to eight one-line calls. New shapes: the bare-array bridge, the first shared section (`marketing/testimonials`, four callers), and the §6 neutral-defaults ruling for shared bands.
- (no issue) — cp204 — the `{% section %}` and `{% component %}` Liquid tags land in `packages/web/src/sections.js`: dual-form args (inline or YAML body), layer-resolved, schema-validated with did-you-mean warnings, and context-free — markup sees `{ args }` only, interpolation happening at the call site. First extraction: the classy hero.
- (no issue) — cp203 — Ian ratifies the sections spec and rules its three open items: the verb is `omega customize <url>`; sample filler stays shared across themes and gets auto-generated rolling dates into a gitignored path; playground deploys use both the direct lane and the occasional CI dispatch.
- (no issue) — cp202 — the sections/components spec lands as a draft in plans/omega-sections-spec.md, capturing eight rulings: brand topology, the theme content model, the two-tier library replacing frontmatter monoliths, wildcard page modules replacing `asset_path`, the customize verb, the i18n verdict, cross-framework standardization on the web engine, and Liquid staying.
- (no issue) — cp201 — Ian's rulings on the cp199/200 flags: service-worker cache warming returns disabled behind `CACHE_WARMING_ENABLED = false`, machinery kept for a one-flag re-enable; preload breadth is closed, whole-site preloads stay. The extension's write-only background cache stays parked for the same treatment.
- (no issue) — cp200 — the service worker no longer warms any cache: `updateCache` and the `update-cache` command are gone, leaving FCM push and the cross-project takeover, with no fetch handler by design. Font preloads now fall through the theme layer chain. The extension's identical pattern is parked.

### Changed

- (no issue) — cp228 — every package resets to 1.0.0: seven non-1.0.0 packages renumbered in one sweep and the one real registry range (`@omega.js/client`) normalized to `^1.0.0` in both consumers. Nothing has published under the new names, so the renumber is conflict-free; the full battery proves it inert.

### Fixed

- (no issue) — cp227 — three parked findings close: `sitemap.xml` and `pages.json` now emit in URL byte order (Eleventy's collection order varied run to run), the extension background worker's write-only page cache is disabled behind the same `CACHE_WARMING_ENABLED` flag, and the newsletter band's never-toggled alert divs are culled.
- (no issue) — cp225 — the engine re-parses a page's own frontmatter and re-applies it over Eleventy's data cascade inside `resolved`, so arrays replace instead of concatenating and scalars beat objects; virtual templates keep pure cascade behavior. Found by the about draft, where `gallery: false` could never fire.

## [cp100–cp199] — themes, sections, e2e, dogfood hardening (2026-07-11…2026-07-18)

### Added

- (no issue) — cp199 Fable review of cp198: confirmed SW closure, preload mechanics, e2e promotion; fixed permalinkOf to scan only leading frontmatter (+5 pins, 15 total) and sorted font-preload order deterministically. Breadth findings flagged for Ian, no action. All lanes re-proven.
- (no issue) — cp198 Parked-findings sweep: theme-aware font preloads eliminate FOUC, permalinkOf regex fixed for spaced and Liquid paths, the service-worker cached-404 finding closed as unmanifestable, and the sandbox e2e joins root `npm test` with an `OMEGA_SKIP_E2E=1` knob.
- (no issue) — cp197 New brand-SHAPE corpus (`scripts/corpus-shapes.js`, `test:corpus` lane): 7 offline cells born through the real onboard. Rejoining root `npm test` caught a latent red — the sandbox backend corpus had failed silently since cp157; eight signup actors moved to JOURNEY_ACCOUNTS, corpus green.
- (no issue) — cp196 Onboard now `git init`s new brand roots, every deploy verb records itself via new `@omega.js/devkit/deploy-record`, and the testing service distinguishes never-deployed (a nudge) from deployed-but-down (a failure), adopting the record when a live URL hits.
- (no issue) — cp195 The wizard journey becomes a standing lane (`npm run test:journey`, devkit journey-harness) joining root `npm test`; the interactive wizard rehearsal outside the monorepo plus the lane's first runs caught ten framework bugs across web bins, tree-wide linking, setup stamps, and destructive manifest clobbering.
- (no issue) — cp193 The mobile pass at 390×844 for The Daily Build: masthead drawer, post reading column, plan cards and footer all composed, with one defect fixed — the homepage's `g-5` rows out-gutted the container's mobile padding, now `g-4 g-lg-5`; zero horizontal overflow.
- (no issue) — cp192 The newsflash skin pass across every Daily Build surface, both modes, fixing seven defects: the dead footer block rewritten on classy's token-pure floor, share buttons moved off CDN icons to the local chain, dev-server icon emission, ink-on-ink headlines, the pricing grid, and the leaking ticker.
- (no issue) — cp191 Newsflash modernization V closes the arc: build-level pins assert the classy app/auth floor and the cp187 token re-value in the newsflash bundle, theming docs gain the vendored-fonts parity note, and both modes are screenshot-proven at port 4100.
- (no issue) — cp190 Newsflash modernization IV answers the CSS fall-through direction with a two-lane doctrine: partial themes `@forward 'omega:theme'` onto classy's base, full sibling themes import classy's token-pure app/auth partials as a vocabulary floor. Both lanes pinned; theming docs gain the token-purity rule.
- (no issue) — cp189 Newsflash modernization III builds the theme's first nav include, an editorial masthead on classy's nav.json contract. The `uj_post` media contract now honors `post.image` frontmatter (explicit wins, `false` renders nothing), the blog index sheds its hardcoded "The", and the offline brandmark mint is proven.
- (no issue) — cp188 Newsflash modernization II moves the ticker onto the shared marquee engine (`data-omega-marquee`), keeping the skin and a reduced-motion escape. The engine now detabs marquee clones for accessibility, and the dead `masthead-scroll.js` is deleted in favor of the engine's scroll stamp.
- (no issue) — cp187 Newsflash modernization I rebases the theme onto the classy-v2 token contract: the `--omega-*` sheet re-valued with the editorial skin, ~120 component references swept, `--nf-*` kept only for editorial concepts, Fraunces and Schibsted Grotesk vendored, and the Google Fonts CDN link plus core preconnect hints removed.
- (no issue) — cp186 `apps/newsflash-brand` is born: "The Daily Build", copied from the playground and scrubbed offline, wearing the newsflash theme permanently on website port 4100. Two framework catches: `isPortFree` became a triple bind-probe, and brand installs must run from inside an app dir.
- (no issue) — cp185 The account page's rail and content now share one skeleton: the grow chain reaches the row so it fills the panel, and the rail column draws a full-height lane divider (new `hairline-end` utility). Sign out leaves the page for the topbar avatar menu.
- (no issue) — cp184 Plain http on the emulator port didn't redirect because backend's dist carries a vendored devkit copy that nothing re-prepared. New `startVendorPropagation` in `@omega.js/devkit/local` watches the vendorable shared sources and re-runs `npm run prepare` in every watchable package, debounced and coalescing.
- (no issue) — cp183 The account page joins the backend dialect: sections open with the admin page-header anatomy via a new include, the rail speaks the shell sidebar recipe, ~20 cards gain card-header caps, referral stats become a statgrid, and the UJM-era nav-link underline hack dies at its home.
- (no issue) — cp182 The signed-in URL scheme lands: `/account` moves to `/dashboard/account` inside the omega shell, `/admin` renders the overview at its root, permanent redirects keep old links alive, and the redirect machinery gets a real module bundle lane plus fragment forwarding.
- (no issue) — cp181 The account page floated mid-page because the frontmatter resolver only honored the per-page scope for `page.` refs; `resolved.` refs now join them, un-hiding authored layout intent across account, checkout and alternative pages. Dashboard also leaves the default user dropdown.
- (no issue) — cp180 The skin-pass finisher: `/account` de-bootstrapped (quiet rail, classy chips, real dot-status pills, calmer sign-out buttons), the admin firebase explorer moved onto the classy language, and admin/users/new plus the calendar got header and badge touches.
- (no issue) — cp179 Checkout fits one screen with nothing hidden: price rows are always visible, the mobile summary sheds its header row and brandmark, wallet buttons pair two-across, trust foot and help link merge into one page foot, and an SE-class height tier tightens the rhythm. Desktop unchanged.
- (no issue) — cp178 Round-8 punch list: checkout gains Shopify-density with mobile collapse, admin tables get `classy-table`/`classy-iconbtn`/`classy-count` plus chips and dot-status, the dashboard gains an Orders stat, a Needs-attention triage, a signups chart and a content card, devkit's local-https front 307s plain http, and every client GET was reviewed.
- (no issue) — cp177 Checkout recomposed into the classy language: quiet hairline sections, a brand row and secure-checkout status, the restored change-plan escape, and the confirmation page's receipt panel promoted to a shared component. Two catches: one-time checkouts showed $0.00, and backend `getWebsiteUrl` still said http.
- (no issue) — cp175 The admin CMS seed: new `/admin/posts` list view reading the site's own JSON feed, and a `/admin/posts/editor` with create and edit modes on the existing GitHub pipeline. Three backend catches fixed, plus a new `get_post` MCP tool taking the count to 28.
- (no issue) — cp176 HTTPS everywhere: the legacy mkcert flow becomes shared `@omega.js/devkit/local-https` (`ensureLocalHttpsCerts` plus a TLS proxy with WebSocket-upgrade tunneling), consumed by backend `omega serve`, backend `omega emulator` (new, `--no-https` opt-out) and web `omega dev` (new, https by default).
- (no issue) — cp174 `/admin/users` becomes a real directory: the live `GET /admin/users/list` load with auth-join columns, prefix search, cursor pagination and lazy doc fetch. New `POST /admin/users/disable` revokes refresh tokens with a self-disable guard, plus a `set_user_disabled` MCP tool; mcp docs true-up to 27 tools.
- (no issue) — cp173 The default user dashboard is gone: `/dashboard` 404s, authenticated users land on `/account`, and every fallback repoints; the blueprint survives for brands that scaffold their own. Backend gains `GET /admin/users/list` with the Firebase Auth join, prefix search, cursor pagination and a `list_users` MCP tool.
- (no issue) — cp172 Consistency sweep: all five bento tile types now carry a header icon chip, and new `_alerts.scss` gives classy its first alert theming — every alert becomes a quiet hairline note instead of a raw Bootstrap tinted slab.
- (no issue) — cp171 Payment confirmation becomes the receipt moment (ok-tinted check chip, receipt panel, icon rowlist, nudge CTAs), portal email preferences gain a segmented control and quieter notes, and pricing cards get a typographic rebalance across plan names, taglines and feature rows.
- (no issue) — cp170 `/team` gains a data-driven roster line and a "How we work" principles band, member pages gain a teammates rail, and blog articles gain a reading-progress hairline, a sticky xl byline rail, real author positions, and quieted share-button colors at rest.
- (no issue) — cp169 `/404` becomes a full-bleed typographic moment on the dotfield, `/status` becomes an ops console with one card holding every service's 90-day bars and a split subscribe band, and `/updates` becomes a version timeline with a hairline spine and mono version pills.
- (no issue) — cp168 The legal trio (`/terms`, `/privacy`, `/cookies`) gets an editorial document treatment on new shared layout `frontend/pages/legal/document`: a hub switcher, a sticky on-this-page rail, a 46rem measure, an effective-date band and print styles. New optional `brand.company` schema field de-ITWs the blueprints.
- (no issue) — cp167 The REIMAGINE arc opens: `/download` and `/extension` rebuilt as compositions — detected-platform hero CTAs, always-visible platform and browser cards wearing real brandmarks, a split mobile store band with a notify-me flow, and a pin ritual band. Both page JS modules rewired to the card contract.
- (no issue) — cp166 Sample content grows up: five new sample posts take the set to 11 at pagination size 6 so `/blog/page/2` exists and the pager renders, and a new third sample set seeds `_updates` (v1.0.0–v1.3.0) on the same dev-only, consumer-suppression, production-strip lane.
- (no issue) — cp165 Round-5 fixes: dropdown rows gain clearance, the dashboard rail toggle wears the `sidebar` glyph, the legacy 149-SVG logo library ports to `core/logos` so trusted-by inlines real wordmarks, the marquee slows to 60px/s, pricing amounts speak one voice, and the guarantee line joins the reveal system.
- (no issue) — cp164 Dev links stay local at the root: `omega dev` now overrides `site.url` to the resolved local origin so every absolute-URL surface resolves against the running server, and `brand.images.{brandmark,social}` become site-relative paths that each surface absolutizes per environment.
- (no issue) — cp163 Content round: sample posts carry Unsplash heroes (two keep `image: false`), team members gain ids so member pages resolve, the trusted-by marquee moves from typographic names to real brand lockups, and pricing gains the serif "Free", an ok-green guarantee shield and a clearer compare table.
- (no issue) — cp162 The 1,070-line `libs/auth.js` closure becomes eight focused modules under `libs/auth/` with explicit context, behavior preserved and every flow re-proven live. The Google button's CDN logo becomes an inlined icon, and one real race is fixed: the custom-token handler now owns navigation.
- (no issue) — cp161 Twelve placeholder SVGs in `core/icons/solid/` sat first in the icon chain and silently shadowed the real Font Awesome set; deleted. Missing icons are now loud (`data-omega-icon-missing` plus a dev-only browser audit), and the classy ghost button's dark-mode hover is fixed.
- (no issue) — cp160 `--classy-gradient` becomes a pastel spectrum conic that wraps the perimeter, and the hover shimmer becomes a true swirl via a registered `@property` angle transitioning 160°, with a static fallback for reduced motion and unregistered browsers. Card and buttons share the stops token.
- (no issue) — cp159 The cp156 ring gradient unwittingly reproduced legacy classy's aurora recipe with fresh hexes; re-cut as the daybreak arc, itself superseded by cp160's pastel spectrum ring. The same sweep re-colored the payment-confirmation confetti and a checkout dev-log purple to the new brand world.
- (no issue) — cp158 Language flags were the third empty-asset-dir case: the 47-flag legacy set ports in, the loader strips the set's hardcoded 512px dimensions so standard 1em sizing applies, and the footer language dropdown renders real flag chips. The DEV pull-tab becomes a proper flask pill.
- (no issue) — cp157 The dev loop closes: brand-root `omega dev` boots website and backend emulator together with target filtering, a dev-only palette pull-tab switches between seeded personas, `omega auth:token <email>` mints a one-click sign-in URL, and two Google personas now seed for the Auth emulator's picker.
- (no issue) — cp156 Review round 3, nine changes: purple retires for ocean blue, the dot field goes rainbow, gradient rings land, pricing tooltips backfill by feature id, missing-icon root causes are fixed, auth pages get fixes, `/test/components` becomes the living styleguide, and imagery plus a build-time cache-breaker land.
- (no issue) — cp155 Review round 2 part 2: icons sweep onto most buttons, about/contact/pricing gain unique objects, the dot field spreads to every hero grid, the config validator learns union types so `parent: false` stops blocking backend setup, and login is proven live against the emulator.
- (no issue) — cp154 Review round 2 part 1: classy internal hrefs go relative so dev links stay local, the trusted-by marquee is rebuilt to clone until the track covers the container, the nav goes glassier, the promo banner sits above it, and dotfield, segmented-thumb and price-tween systems land.
- (no issue) — cp153 brought the backend dashboard and admin blueprints onto the App DNA with a new panels stylesheet: merged stat grid, panel titles, hairline activity feed. Every JS-populated id untouched.
- (no issue) — cp152 repainted account, checkout, confirmation, and portal onto the classy language — serif heads, ink adaptive buttons, hairline cards — keeping every section, nav, binding, and form contract on these bound app surfaces.
- (no issue) — cp151 remade /signup as a split auth shell with an ink pitch panel, and moved reset, token, and oauth2 onto the classy-auth card. Every auth DOM contract intact.
- (no issue) — cp150 brought status, updates, legal, and 404 to the reference bar: left mastheads, eyebrows, mono breadcrumbs, left-aligned document layout, one-line 404 copy. Status JS machinery untouched.
- (no issue) — cp149 brought download, extension, app launcher, and alternatives to the reference bar: segmented platform and browser rails, hairline rowlist duos, an interstitial launcher, comparison rowlists. Detection JS and element ids preserved.
- (no issue) — cp148 applied Ian's bronn/manus reference round: pricing recut to line up feature rows with tooltip definitions, unboxed editorial blog, a live-support conversation fragment, recomposed team/member/feedback, new content primitives.
- (no issue) — cp147 opened the REMAKE mandate: six dev-only sample posts, post media and author fallbacks, a remade footer and nav, a redirect interstitial, recomposed about/contact/pricing, new compositional vocabulary, and a client count-up formatting fix.
- (no issue) — cp145 closed Draft-1 feedback: auth pages initialize again via segment-based path matching, flat legacy `.html` URL shape restored framework-wide, the service worker ported into every build, real vendored webfonts, and an icon-size parsing fix.
- (no issue) — cp144 landed classy v2 Draft 1 in-repo: re-cut token sheet, dual brand-color ramps, a reusable motion library, the classy gut renovation, remade marketing surfaces, the `.omega-shell` app chrome, token-true cookie consent. D5 webfonts stays OPEN.
- (no issue) — cp143 locked the classy v2 DIRECTION with Ian's GO: ink-on-paper neutrals, zero gradients, ink primaries, brand-color accent, split typography, gray-canvas shell. Spec and comps vendored; Draft 1's gradient palette rejected.
- (no issue) — cp142 ran the full-deployment rehearsal — playground web, backend, extension, and a signed and notarized desktop all shipped — and caught five real bugs, chiefly a config probe that ignored brand-level files.
- (no issue) — cp141 narrowed dev live-reload: the dev server watches built asset trees and classifies changes, so css edits hot-swap without a page reload and js edits reload. The last gap-audit parity item.
- (no issue) — cp140b proved the translation re-key converged on the playground (0 new, 3713 cached, no per-build flapping) and corrected the generator meta tag from "Ultimate Jekyll" to "OMEGA".
- (no issue) — cp140 added production-only HTML minification as an Eleventy transform (JSON-LD and inline scripts preserved) and a direct Cloudflare purge wired to a command, post-deploy, and CI. blogify and optimize parked.
- (no issue) — cp139 added nine default machine files — sitemap, RSS and JSON feeds, robots, ads, humans, opensearch, pages.json, security.txt — so the long-dangling feed link resolves and every brand gets them with zero setup.
- (no issue) — cp138 brought back the imagemin responsive image matrix as a sharp-based build phase, cached outside the repo and restored in CI, with a dev-server fallback that never processes images locally.
- (no issue) — cp137 gave .env files the omega.json5 treatment: one canonical key order, grouping, and comments used by both the scaffold and every reorder, with loss-proof checks and convergence wired into writeback and the workspace service.
- (no issue) — cp136b minted monitoring live for the playground and fixed the invalid desktop Sentry platform slug (`javascript-electron` to `electron`); API errors now surface field-keyed validation bodies instead of a bare "Bad Request".
- (no issue) — cp136 corrected the Sentry token guide before Ian's first live mint: the ask now opens the personal token page and, via a new optional hint field on secret asks, names the required scopes.
- (no issue) — cp135 made the Apple signing tree company-shared when a company marker exists, persisting `CSC_KEY_PASSWORD` to the signing root's .env, and added an interactive rescue that files a freshly downloaded `.p8` into the tree.
- (no issue) — cp133+134 turned every secret ask into a guided walkthrough that opens the minting page, and renamed the four provider-named services to their config roles: firebase to cloud, sentry to monitoring, sendgrid to campaigns, beehiiv to newsletter.
- (no issue) — cp132 added the sentry service — one monitoring project per enabled target with DSNs written into config — and flipped admin auth to the `omega-admin-key` header only, with every first-party caller and the backend fixture updated.
- (no issue) — cp130 shipped the playground web deploy live, ran the SEO service to a public repo, marked translations linguist-generated via `.gitattributes`, and recorded the UJM-to-web gap audit that set the following queue order.
- (no issue) — cp129 ran a config-truth pass: MrLogo credential ladder replacing asset options, reverse-DNS bundle ids, a new top-level `gcp` key, targets sorted last, plus a sound workspace test runner and guided Apple agreements warnings.
- (no issue) — cp126 made slapform, chatsy, and replyify mint brand-owned assets when no id is configured, with tri-auth (operator service account, user API key, interactive paste-back). Playground now owns its form and two agents.
- (no issue) — cp125 graduated the converged search-console, sendgrid, account, and recaptcha seeds into the core service set, and added gated desktop and extension deploy legs behind an explicit `--publish` flag.
- (no issue) — cp124 swept eight parked board-debt items: transactional devkit vendoring, an emulator orphan reaper, a precise demo-project serve warning, a two-pass devkit runner, effective-value push-secrets, CI fixes, and doc reclassifications.
- (no issue) — cp123 fixed three live-site gaps: nav and footer rendered empty (unbound data plus strict JSON parsing of JSON5 section files), empty `<title>` now falls back to brand values, and a new static-asset channel serves minted brand identity.
- (no issue) — cp122 made backend consumers src-first like every other target: authored code in `src/`, a generated `dist/` staged by a new `omega build` verb, and the service account homed once in the brand's gitignored secrets.
- (no issue) — cp121c made the app-layer omega.json5 optional: the loader rides the brand file alone when an app has none, so brand `targets.*` is the one per-target home. Standalone projects still require their own file.
- (no issue) — cp121b slimmed the playground's backend and extension app config files to targets-only after finding stale wrong-world data, ran the slapform, chatsy, and replyify legs against real products, and moved all four service accounts into the brand's own secrets.
- (no issue) — cp121 restored canonical config key ordering, copied legacy seeds into the playground, minted the brandmark non-interactively for real, ran the payment leg's first light in test mode, and gave translate a hard per-call timeout.
- (no issue) — cp120 swept outstanding pipeline warnings: the press-Enter open gate fixed as a class across six flow sites, playground config keys corrected, a SendGrid stale-nickname idempotence gap closed, and Search Console latched green.
- (no issue) — cp119 recorded the first full-stack pipeline pass — 24 services, exit 0, four self-explaining warns, ten deliberate skips — pinned Claude usage to the local login by stripping ANTHROPIC_API_KEY, and added the web `omega deploy --direct` verb. A session-limit hang stays parked.
- (no issue) — cp118 collapsed four per-service Google clients into one shared scope union and token store, so the operator consents once; every browser open is Enter-gated and the GA acknowledgement now finishes in one run.
- (no issue) — cp117 added the `pipeline` command: the real manage cycle spawned non-interactively by construction, asserting the run record with core-service rules, machine-readable skip reasons, and fail-fast headless Google consent. Deliberately excluded from CI.
- (no issue) — cp116 took the playground website live on GitHub Pages end to end, with the manager creating the repo itself, plus a service wave (workspace, disperse, recaptcha, account, testing, sendgrid, beehiiv). First-paint blank flash parked for the skin pass.
- (no issue) — cp115 made Cloudflare proxy eligibility plan-aware: deeper api domains ask the zone for its actual TLS coverage (Total TLS and certificate packs with real wildcard semantics), failing safe to DNS-only.
- (no issue) — cp114b kept deep api domains DNS-only: Cloudflare Universal SSL covers one label, so a proxied two-label CNAME can never handshake. Firebase serves its own certificate for those names.
- (no issue) — cp114 added the `ensureEnvSecrets` gate: missing env vars are asked for with masked prompts and persisted to the brand .env interactively, or skipped non-interactively with a machine-readable list aggregated into a new summary section.
- (no issue) — cp112b moved the icon build chain into a shared devkit module and wired extension icons, making all three targets synonymous. The playground extension build emitted 5,681 icons including Pro-only ones.
- (no issue) — cp112 made plain Font Awesome markup work everywhere through one shared client icon-renderer module that watches insertions and class changes; web builds now emit the merged icon set, desktop supplies IPC transport. New docs/icons.md.
- (no issue) — cp111 added Font Awesome Pro brand supply through a best-first root chain (env download dir, brand Pro install, free floor), with Pro never a framework dependency and family-by-weight class composition on every surface.
- (no issue) — scripts/copy-legacy-env.js is an Ian-run secret mover copying curated key groups from the legacy omega-manager .env into a brand's .env without ever displaying a value, idempotent, with dry-run and filter flags.

### Changed

- (no issue) — cp110 ended the per-app Node split-brain: the manager's spawn seam resolves each app dir's `.nvmrc` against installed nvm versions and prepends that Node's bin to the child's PATH, with fail-fast and one self-healing retry.
- (no issue) — cp109 ended the classy triplication: the web package's themes tree is now the one theme tree for web, desktop, and extension via the vendor-assets channel, with the shared theme built as the union of all three forks.
- (no issue) — cp108 moved icon semantics into one shared client module and made fontawesome-free the default asset source, deleting desktop's vendored 21MB Pro set (published redistribution would have violated the license) and closing web's silent icon gap.
- (no issue) — cp102b standardized run-mode gates in a new manager module: `canPrompt`, `dryRunPlan`, and `needsInteractiveSkip` replace hand-rolled patterns across 46 files, with byte-compatible output and no behavior changes.
- (no issue) — cp107 moved the 1,471-line FormManager verbatim into a shared client module, respelled all 23 web import sites, deleted web's copy, and fixed desktop's dead alias import. One implementation, every surface.
- (no issue) — cp100e made deploys ship the resolved config: a new `composeTargetConfig` freezes the full company-brand-app interleave into one self-contained file staged into the upload and restored after. Live-verified serving real brand values.
- (no issue) — cp102 established the provisioning tri-state — missing asks, `false` opts out, a value is used — across the config-flow engine, with Firebase org, billing, and support-email as first consumers, plus a needs-interactive summary aggregate.
- (no issue) — cp106b moved GA4 Measurement Protocol semantics into one shared client analytics-core module consumed by both the browser engine and desktop's main process, so identity and payload shape can never drift between surfaces.
- (no issue) — cp106a made analytics speak one shape with one identity: the canonical providers config flows end to end, flatten bridges are dead, and cross-surface uuidv5 identity resolves the same human on every target.

### Fixed

- (no issue) — Checkpoint 101d restored the press-Enter-to-open convention as a devkit primitive with a dependency-free browser opener, adopted at the VAPID, sign-in-providers, and OAuth-client steps; the manage OAuth URL auto-opens with a five-minute wait.
- (no issue) — Checkpoint 101c fixed OAuth consent screen creation: supportEmail must be owned by the authorizing user, so the step resolves config, then the authed user's email, then warns. Also added `omega build --translate`.
- (no issue) — Checkpoints 101b and 101d settled build translation: `omega build` translates everything by default (warm from cache, cold live) and `--cached-only` skips cold page-language pairs whole. Documented in docs/translation.md.
- (no issue) — Checkpoint 100d made functions deploy work with local-first packages via a new staging step that packs outside-the-folder `file:` deps into tarballs and regenerates the lockfile, then restores. First live deploy succeeded; a config-cascade gap was logged.
- (no issue) — Checkpoint 100c made the playground brand explicit: renamed to `apps/omega-playground` with identity "OMEGA Playground" on playground.omegajs.dev so derived surfaces scope off it. Two leftovers stay on Ian, including a stale pending domain claim.
- (no issue) — Checkpoint 100b met live manage-cycle acceptance: the firebase service completed against omegajs-playground under ITW authorization — Blaze upgrade, APIs, service account, database, Identity Platform, FCM, config self-heal. The functions deploy proof awaits Ian naming it.
- (no issue) — Checkpoint 100 dogfooded the first real manage run: a dry run across all 25 services with honest skip reasons, plus two fixes (working-tree path parsing, projectId derived from `cloud.config.projectId`). The live firebase run waits on Ian.

### Added

- (no issue) — Checkpoint 105 made advertising role-keyed config with a new schema-known `advertising` section, respelled every consumer to the providers path, removed the hardcoded ITW ad-server fallback and dev special-case, and taught `omega migrate` the new shape.
- (no issue) — Checkpoint 104 opened C4 with cross-target design tokens: a declared-assets vendor channel copies the web package's token sheet into desktop and extension dists, and the vendor scan now fails loud on non-dependency package references.
- (no issue) — Checkpoint 103 added the skin-independent app-shell mechanics — structural regions, rail collapse, mobile drawer with scrim, a locked variant — plus a declarative controller and PurgeCSS's first safelist so client-stamped state attributes survive production builds.
- (no issue) — Checkpoint 102 added two-tier theming mechanics: one theme-chain composer lets a consumer theme beat the packaged theme of the same id with fall-through to classy, and pins the consumer main.scss path.
- (no issue) — Checkpoint 101 opened the C3 systems track with the core design-token layer: the `--omega-*` sheet with dark-mode redefinition and attribute overrides, plus a `brand.color` accent ramp emitted inline. Build deprecation spam fixed.

## [cp1–cp99] — bootstrap → extraction → dogfood arc (2026-07-06…2026-07-11)

### Changed

- (no issue) — checkpoint 98b restores the pricing marketing chrome on by default across all three themes (promo banner, savings badge, guarantees, enterprise card, social proof, testimonials, FAQs), with per-page consumer overrides. Only plan fiction stays dead; plans still come from `payment.products`.

### Added

- (no issue) — checkpoint 98 makes deploys deliberate: new `@omega.js/devkit/deploy` dispatch client, scaffolded web and extension workflows lose their push triggers, `omega deploy` becomes the explicit verb on every target, extension artifacts move to GitHub releases, and content-publish dispatches the website build.
- (no issue) — checkpoint 97 renders pricing from `payment.products` alone via a new web pricing composer, rewrites all three theme pricing layouts with zero fictional defaults, and strips the dispersal-era section markers from 167 packaged files plus their three emitters.
- (no issue) — checkpoint 96b puts omega-brand on the real Firebase project `omegajs-playground` (web app, Firestore, service-account key, live setup 39/39) and fixes setup's stale snapshotted project id, which had silently skipped live seeding.
- (no issue) — checkpoint 96 lands the translation overhaul: a shared `translation` config section, one engine in `@omega.js/devkit/translate` with claude and chatgpt providers, a committed per-app translation cache, and real `omega translate` support in web and extension.
- (no issue) — checkpoint 95c closes the C1 arc's third slice: consumer gulpfile shims fix the cross-brand hoisting bug, dep-home rules relax, the backend answers honest 405s, Electron spawns scrub `ELECTRON_RUN_AS_NODE`, and desktop and extension identity derive from the brand instead of ITW.
- (no issue) — checkpoint 95b makes a fresh demo-* backend setup complete 39/39 and exit 0: demo-project awareness in three checks, scaffolded `database.rules.json`, generated fake service accounts, and config as the project-id source of truth.
- (no issue) — checkpoint 95a burns seven friction findings: layer-aware consumer config seeding (targets-only inside a brand), wizard seeds for framework deps and backend cloud config, schema as the required-key oracle, the `.env` empty-shadowing fix, and extension scaffolding at setup.
- (no issue) — checkpoint 94b closes C5: the `omega` dispatcher detects brand roots and hands over to the manager, whose new `test` command fans out over the brand's apps with per-target routing, and `FRAMEWORK_IDS` becomes the id-alias SSOT.
- (no issue) — checkpoint 94a gives `omega test` one scoping grammar across every framework: bare runs are project-only, the framework suite is explicit via prefixes, `full:` is both, paths scope within a source, and unknown prefixes warn.
- (no issue) — checkpoint 93 scaffolds the OMEGA brand with the real onboarding wizard and proves all four targets live; its real deliverable is a 21-finding dogfood friction log headlined by consumer config seeds shadowing the brand config.
- (no issue) — checkpoint 91 makes auto-created admin accounts owner-defined: `account.admins` in company config, a new nested owner-hooks system in `@omega.js/config` with the first hook `account/password`, per-account password resolution (env, hook, lazy seed), and a wizard accounts step.
- (no issue) — checkpoint 90 completes N7: desktop URL getters read the port env channel, livereload and CDP allocate per target, `mgr serve` joins the allocator and publishes its ports, Stripe webhook forwarding takes explicit targets, and the OAuth loopback binds port 0.
- (no issue) — checkpoint 89 extends port auto-allocation to the browser: `omega dev` allocates and moves to port 4000, publishes and reads sibling ports files, `@omega.js/client` resolves every dev port through the map, and the devkit e2e harness injects it per page.
- (no issue) — checkpoint 88 adds the ports foundation: a `@omega.js/config` ports module with classic defaults, bind-probe allocation, pins, ports files and the `OMEGA_*_PORT` env channel, adopted end-to-end by the backend so a second brand's emulators bump instead of killing the first.
- (no issue) — checkpoint 76 adds a zod route-schema engine preserving powertools semantics byte-for-byte, converting the first cohort; checkpoints 77 and 78 convert the rest, so every framework route schema runs on zod while consumer declarative schemas keep working.
- (no issue) — checkpoint 73a ships D15, the `.env` cascade: a config env module loading company, brand and app `.env` with the shell above all, adopted at every boot surface, and disperse becomes a composer rather than a copier.

### Changed

- (no issue) — checkpoint 86 grows the sandbox cross-stack e2e from 11 to 19 browser-driven steps covering signin, subscribe, cancel, refund, data-request create/status/cancel (first coverage anywhere) and account deletion, with a new signed-request helper in the fixture.
- (no issue) — checkpoint 85 adds a shared backend seed module so `npx omega emulator` seeds personas on boot by default (`--no-seed` skips, failures non-fatal), and generalizes the brand e2e harness into `@omega.js/devkit/test/e2e-harness`.
- (no issue) — checkpoint 84 makes schema `min`/`max` apply only when declared, per Ian: no `min` lets negatives through, no `max` is unbounded, and a declared zero is a real bound. Both engines flip together.
- (no issue) — checkpoint 83 makes every seeded account a signin-able persona with a deterministic `TEST_ACCOUNT_PASSWORD`, adds a `refunded` static persona, and exposes custom-token signin plus id-token access in the sandbox fixture for the lifecycle e2e driver.
- (no issue) — checkpoint 82 ships N5: development mode alone connects the client to local Firebase emulators, with the old env flag deleted, no live-Firebase dev opt-out, and a latent sandbox fixture break (Firebase init silently skipping since cp74) fixed.
- (no issue) — checkpoint 81 closes N4's parked verifies: web's site-wide defaults-style override is achievable through the native data cascade, pinned by a new slice test; `devlog` and `seo` become schema-known config sections.
- (no issue) — checkpoint 80 ships schema tightening #1: `enum` now rejects out-of-list values post-coercion with a `400`, identical in both engines, live on the two `user/oauth2` action fields. Absent fields still pass.
- (no issue) — checkpoint 79 ships schema tightenings #2–#4: a new in-house declarative resolver replaces `powertools.defaults()` at all three call sites, `''` now fails `required`, and per-field `sanitize: false` works. Tightening #1, enum enforcement, still awaits Ian.
- (no issue) — checkpoint 75 harmonizes every machine-parsed marker onto one grammar, re-cutting the rules managed block's four sub-shapes into the shared `========== Label ==========` family across regexes, templates, sandbox files, error messages and the consumer template.
- (no issue) — checkpoint 74 ships D12: omega.json5 keys name a role with a `provider` discriminator — `firebaseConfig` becomes `cloud`, `sentry` becomes `monitoring`, and four `platform` fields become `provider` — swept across every package, fixture and doc. The client's runtime contract is untouched.
- (no issue) — checkpoint 73c consolidates duplicated code round one: rules-marker regexes, `resolveBrandRoot` into `@omega.js/config`, desktop's deep merge, web's slugify, clean-dirs, a Puppeteer helper and `SkipError`. Verified non-duplicates are documented in place; three unifications are deferred.
- (no issue) — the omega-api-proxy worker is un-deprecated, reversing D5 addendum 2, since brands fronting a non-Firebase backend need `/omega` carved out at the Cloudflare edge. CI becomes fully opt-in: push and pull_request triggers off, manual dispatch only.
- (no issue) — the CI emulator-death investigation advanced through runs 6 and 7, ruling out leaked processes and memory pressure; a discovery-timeout leash changed the failure mode to a clean 14-minute failure, but emulator jobs were still canceled externally. The investigation is parked.
- (no issue) — checkpoint 72 executes N3's wire renames across 289 files: route prefix `/omega`, `omega_*` function exports, the `omega` runtime-config section, `omega-properties` header, and roughly 60 env vars unified under `OMEGA_*`. The legacy `/backend-manager` route stays as an alias.
- (no issue) — checkpoint 71 renames the ecosystem to `@omega.js/*` across 650 files, adds universal `omega`, `omg` and `mgr` bins running one context-aware dispatcher, and flips `window.webManager` to `window.omega` across 127 files.
- (no issue) — checkpoint 70 makes Ian's core-changes idea dump binding (10/10 decided), pushes the monorepo to its private GitHub remote for a first CI run, and verifies the monorepo is a superset of every legacy repo, porting the one gap: UJM's nine redirect shortlink pages.

### Removed

- (no issue) — checkpoint 87 deletes the `/account` `?_dev_subscription=` mock fixtures and the dev-only URL-param block that merged them over the real subscription. Dev-testing subscription states now means signing in as a seeded persona, which closes N6.
- (no issue) — checkpoint 73d drops legacy pre-omega file-format support from `mgr setup` per Ian: the rules tests no longer handle the `{{ backend-manager }}` placeholder and the gitignore test no longer strips `# BEM>>>` blocks. Converting older files belongs to the pinned migration tooling.

### Fixed

- (no issue) — checkpoint 89 fixes emulator shutdown crashing on macOS `EPERM`, which killed the CLI before the orphan sweep and left three java emulators alive per e2e run. `EPERM` is now treated like `ESRCH`, and other codes log and proceed.
- (no issue) — checkpoint 74 fixes `omega test` exiting 0 on a config-validation abort, which let any script chaining on the exit code read a hard abort as a pass. The abort now sets exit code 1.
- (no issue) — three backend CLI modules had been hard SyntaxErrors since cp71, because the rename sweep rewrote legacy names inside regex literals; a consumer `mgr setup` would have crashed. The literals are restored, and a new devkit `parse-audit` pre-flight guards the whole tree.
- (no issue) — desktop 2.0.2 fixes the renderer webpack `global` binding: `ProvidePlugin` resolved `'globalThis'` as a module request, silently binding a polyfill on macOS and failing the Linux CI build. It now uses `DefinePlugin`.
- (no issue) — CI environment gaps from the first real run are closed: `firebase-tools` installs globally in both emulator-booting jobs, and the sandbox job fetches puppeteer's Chrome explicitly since npm 11's script-approval gating skips its postinstall download.
- (no issue) — checkpoint 69 lands the local-linking dev loop: a new `@omega.js/devkit/local` module owning every local-dev mechanic, a root `npm start` running all package watches concurrently, `omega dev --local`, and `mgr i local` rewired in all three CLIs.
- (no issue) — checkpoint 69's proofs: devkit 120 tests, a live root watch with four concurrent watchers and clean teardown, a scratch-brand round trip through `omega dev --local`, an idempotent sandbox `mgr i local`, all package suites, and pack-smoke on four tarballs.
- (no issue) — devkit vendor no longer treats published `@omegajs` runtime deps as vendor candidates; only private devDep workspace packages vendor. This stops `@omegajs/client` being frozen into shipped dist, and CI's pack-smoke greps for private references only.
- (no issue) — checkpoint 68 completes Phase 3 with the client cutover: `packages/client` becomes `@omegajs/client@5.0.0`, import specifiers flip monorepo-wide across 561 conversions in 184 files, and desktop's bridge files are renamed. The `webManager` runtime API stays parked.
- (no issue) — upstream web-manager v4.3.5–v4.3.6 folded in at the divergence check: Firebase init skips empty-value config blobs, fixing the invalid-api-key crash on Firebase-less sites, plus its console line.
- (no issue) — parked finding 1.3b is resolved: the `module: "src/index.js"` field routed exports-unaware bundlers into un-vendored source and is removed, leaving the `exports` map as the only entry surface. License changed from CC-BY-4.0 to MIT.
- (no issue) — checkpoint 68's suites: client 77, web 52 with sites bundling the renamed client through the new alias, desktop and extension green on the flipped deps, manager 564, cross-stack e2e green against real emulators, and pack-smoke green.
- (no issue) — checkpoint 67 lands the third Phase-3 rename: `packages/backend` becomes `@omegajs/backend@6.0.0` with new bins, test prefix, audit ids, MCP server name and health field. The deployed wire format stays parked for Phase 5.
- (no issue) — upstream backend-manager v5.12.0 folded in at the divergence check with zero drift: negative usage limits are actually unlimited, plus the test AI provider's path-based directives and their suites.
- (no issue) — checkpoint 67's manager work: the backend target framework and marketing library renamed, prose swept across services, devlog and README, and the sandbox brand consuming the renamed framework. Sweep totals were 674 in-package and 314 cross-package conversions.
- (no issue) — checkpoint 67's suites: the framework boot canary, the sandbox corpus at 1,252 tests against the consumer, cross-stack e2e, manager 564 and pack-smoke all green.
- (no issue) — the backend test runner's pre-flight aborts now exit non-zero; a failed config validation, health check or account setup used to produce a green suite from a dead server. Caught when a boot run "passed" while the api was 500ing.
- (no issue) — backend `linkFixtureDeps` now creates the scoped link's parent directory before symlinking, the same class as the desktop boot-runner fix at checkpoint 66, predicted and confirmed.
- (no issue) — the rename sweep's one regex casualty is fixed: `backend-router.js`'s route-prefix stripper had its parked URL segment converted inside a regex literal, invalidating the pattern and 500ing every api request. The repo-wide audit confirmed it was the only hit.
- (no issue) — checkpoint 66 lands the second Phase-3 rename: `packages/desktop` becomes `@omegajs/desktop@2.0.0` with new bins, SCSS entry, test prefix, framework IPC channels and audit ids, swept across all 40 docs and consumer defaults. The pre-rename point is tagged.
- (no issue) — legacy electron-manager v1.13.0 folded in during the pre-rename divergence check: the FontAwesome `overflow="visible"` serve attribute and the tooltip observer fix for an infinite loop on title-only hosts, with tests and docs. The client dep bump waits for the client cutover.
- (no issue) — checkpoint 66's manager and desktop gates: the desktop target framework renamed with manager 564 green, and the desktop suite at 758 passing including the real-Electron boot canary. Pack-smoke green from the 2.0.0 tarball.
- (no issue) — devkit vendor never treats a host's own package name as a vendor candidate; collecting it folded the host into itself and rewriting it would break the consumer-side resolution boot harnesses rely on. Locked by a new vendor test.
- (no issue) — Desktop boot runner: fixture dependency symlinks now create the link's parent directory, so `node_modules/@omegajs/desktop` no longer fails silently and the boot layer stops dying with "No gulpfile found".
- (no issue) — checkpoint 64: `packages/extension` is now `@omegajs/extension@2.0.0` (was browser-extension-manager@1.7.3) — new bins, SCSS entry, test prefix, config key, auth protocol; consumer defaults and 25 docs speak the new name. Publishing waits on Ian's @omegajs org claim.
- (no issue) — Legacy 1.7.4 divergence folded in: `test/**` defaults are copy-once, so a consumer's `test/_init.js` survives setup reruns. Desktop and backend have the same latent gap, queued for their flips.
- (no issue) — Manager's `TARGET_FRAMEWORKS.extension` points at `@omegajs/extension`, and the companion extension (`packages/manager/extension`, renamed `omega-manager-extension`) consumes it via `file:`; the full consumer canary passes with MV3 manifest, 9 icon sizes, and three browser zips.
- (no issue) — devkit vendor tool: `dist/defaults` is consumer-template content and is no longer scanned, rewritten, or vendored, and the dep-guard strips comments before scanning specifiers. Two new vendor tests (devkit 99 → 101).
- (no issue) — Extension icons task no longer corrupts binaries under gulp 5 — `encoding: false` both ways, matching distribute.js. Pack-smoke of the 2.0.0 tarball (scratch install, entrypoints, bins) also green.

### Added

- (no issue) — checkpoint 65: an upstream sync sweep pinned every legacy-repo delta against the monorepo baselines — BXM 1.7.4 already folded, omega-manager service behaviors already ported, web parity by construction. EM, BEM, and WM deltas annotated onto their queued cutovers.
- (no issue) — The devlog subsystem ported: `omega-manager devlog` collects commits via `gh` across configured orgs and brand repos, has Ghostii write the article, and publishes it into the brand website's `_posts` with a post-file-only commit and push, or previews on `--dry-run`.
- (no issue) — Tests: manager 549 → 564 (+15 devlog — project-map derivation, collect filtering, digest/brief/links, renderPostFile pins, publish against a real temp git repo with a bare remote, and dry-run preview; zero live GitHub or Ghostii calls).
- (no issue) — checkpoint 63: omega-manager is fully ported, nothing parked. Its companion MV3 Chrome extension (bookmark filing plus trusted-CDP browser automation and an MCP bridge) landed at `packages/manager/extension/` as a standalone BXM consumer, and the manager speaks its WebSocket protocol.
- (no issue) — New `bookmark` service between `migrations` and `testing`: brand console and dashboard bookmarks pushed to the extension and filed under `Ω / {Brand} / {Category}`, reshaped to new-world config. Interactive-only — headless runs skip, dry runs print planned groups.
- (no issue) — Beehiiv segment automation is live: interactive runs with missing segments offer extension-driven automation or manual dashboard creation, then re-verify against the API. Non-interactive and dry runs keep the warn-with-conditions behavior and never mutate.
- (no issue) — Assets `templates` operation: brand PSDs seeded from the company root's `assets/templates/`, logo layers re-rastered from the brandmark, config-driven text layers with overflow shrink, composited PNG exports, mtime-diffed. omega-manager's social-images and store-images ops were dead code and are not ported.
- (no issue) — AI brandmark generation is live in the assets setup: a missing brandmark offers the logo-API flow — `assets.brandmark` config, token from `LOGO_API_ID_TOKEN` or minted through the provider brand, creative-direction prompt, SVG landed as committed `assets/logo/brandmark.svg`.
- (no issue) — Tests: manager 523 → 549 (+7 automation-client protocol, +8 bookmark, +3 beehiiv automation end-to-end, +5 PSD templates, +3 brandmark against a local logo API). New manager dependencies: `ws`, `ag-psd`, `canvas`.
- (no issue) — checkpoint 62: the `disperse` service runs between `certificates` and `update` — certs copies signing artifacts from `.omega/certificates/apple/` into desktop and mobile, with a self-protecting `.gitignore`; env composes each app's gitignored `.env`, updating keys in place and preserving Custom sections.
- (no issue) — The meta/tiktok pixel-token paste-in is live: interactive runs save the entered token to the brand `.env` and disperse carries it to the backend; empty entry, non-interactive, and dry runs keep the warned guidance.
- (no issue) — Tests: manager 503 → 523 (+18 disperse over temp brand monorepos pinning the cross-package key contract, mtime-proven converged reruns, and dry-run zero-write for both operations; +2 pixel paste-in over fake TTYs).
- (no issue) — checkpoint 61: every wait-and-verify site rides the devkit flow primitives in interactive runs — pending Cloudflare zones, email-routing retries, Firebase hosting verification, AdSense site add, reCAPTCHA domain confirmation, SendGrid domain-auth, and Search Console verification all open the right page and poll.
- (no issue) — Non-interactive and dry runs keep their exact one-shot warned behavior — every poll is gated on `isInteractive() && !dryRun`, so a headless run never sits in a poll loop.
- (no issue) — Tests: manager 494 → 503 (+9 interactive polls end-to-end over fake TTYs with the browser opener stubbed, including the API-registrar deferral, the mid-poll ACME write with post-verify CNAME proxy, and the reCAPTCHA stamp never re-prompting).
- (no issue) — checkpoint 60: `@omegajs/devkit/flows` ports the onboarding primitives — TTY-safe browser-open, spinners, and polling with keyboard controls, degrading to printed guidance without a TTY. Manager side, `src/lib/config-flow.js` reshapes the schema-prompter engine with writeback into omega.json5.
- (no issue) — Missing required config now sets itself up in interactive runs: chatsy/replyify/slapform ids, GA account and property, AdSense account, Firebase project, the three payment processors' keys, and Beehiiv's create-publication poll. Non-interactive and dry runs keep their clean skips.
- (no issue) — Tests: devkit 99 (+14 flow units over fake TTY streams, shared harness extracted to `@omegajs/devkit/test/prompt-streams`), manager 494 (+25 config-flow engine and per-service flows on real keystrokes). Proven by a scripted-TTY run through the real manage loop.
- (no issue) — checkpoint 59: `@omegajs/config` gained the comment-preserving omega.json5 editor — `applyConfigEdits`/`writeConfigValues` make surgical span edits with `[key=value]` array matchers, already-equal skips, and a re-parse verification gate so a corrupted config can never reach disk.
- (no issue) — Services now land resolved IDs in omega.json5 directly, with state as a mirror: sendgrid list id, beehiiv publication id, stripe/paypal product ids, and firebase's `firebaseConfig` drift healed in place (dry runs keep the paste block). Manager side: `lib/config-write.js`.
- (no issue) — Interactive selections (GA property, AdSense account, slapform/chatsy/replyify ids) stay parked by design — comments retargeted to the onboarding-flows port, which now has the writeback it was waiting on.
- (no issue) — Tests: manager 471, config 58 (+18 editor units including matchers, single-line and comment-only inserts, and never-corrupt errors), devkit 84. A CLI-onboarded scratch brand took the full 8-path write set as pure insertions and reran byte-identical.
- (no issue) — checkpoint 58: `omega-manager onboard` — the brand-creation wizard scaffolds the brand-monorepo skeleton (config/omega.json5, root package.json with `apps/*` workspaces, `.gitignore`, a commented `.env` stub, README, per-target app package.jsons) and proves the config loads before calling it done.
- (no issue) — Onboard is context-sensitive like manage: company roots place the brand under `brands.roots[0]`, an existing brand resumes, anywhere else the cwd becomes the brand root. Fill-missing throughout; flags win, prompts fill gaps, `--dry-run` plans without writing.
- (no issue) — Deliberately structural: no framework deps wired into app package.jsons, so update records dep-less apps as skipped and testing's missing-build-output errors on a fresh brand are the designed next-step nudge, pinned by test.
- (no issue) — Manager 453 → 465 tests: the wizard through real inquirer prompts, never-overwrite convergence, dry-run-never-prompts, company placement, resume-from-inside, and the real `--manage` child handoff, plus a live PTY proof. `--manage` stopped being a manage-command routing alias.
- (no issue) — checkpoint 57: `@omegajs/devkit/prompt` — the TTY-safe `@inquirer/prompts` wrapper every OMEGA package uses instead of importing inquirer directly; without a TTY input/select/checkbox throw instead of hanging and `confirm` auto-returns its default unless required.
- (no issue) — omega-manager's `setParallelMode` global is gone by construction — company-mode children are piped, so the TTY check covers parallel runs. Dry-run never prompts.
- (no issue) — Five parked manager flows are live interactively, with non-interactive behavior unchanged: the Stripe Radar and dispute-protection confirms, the Search Console GA-association confirm, the OAuth redirect-URI confirm, and the Firebase VAPID paste-back.
- (no issue) — Tests drive the real inquirer prompts through fake TTY streams; the fake output must ignore `end()` like a real TTY or the second prompt on a pair renders nothing. devkit 69 → 84, manager 447 → 453.
- (no issue) — Stale breadcrumb sweep: every "rides the prompting port" pointer now names its true remaining blocker — the onboarding, config-writeback, extension, or disperse port.
- (no issue) — checkpoint 55: company mode — a root whose config carries a `brands` key discovers brands and runs the per-brand manage as a child process each (sequential with teed logs, `--parallel`, `--brand` filtering), so secrets never bleed. Brands stamp `.omega/company.json` and layer company config. Suite 447.
- (no issue) — checkpoint 54: the testing service's target-checks grew into the full per-target health surface — installed framework version vs npm latest, website homepage fetch with retries, backend API health, working-tree cleanliness, and the latest GitHub Actions run. Dry runs never touch the network.
- (no issue) — checkpoint 53: the `migrations` service runs only with `--migration`, rebuilding omega-manager's Firestore migration runner on REST with leaf-masked patches, snapshots, and schema validation, and ports the two BEM-schema migrations (notifications and users). Company one-offs stay in the company instance. Suite 407.
- (no issue) — checkpoint 52: the `account` service converges the brand's Firebase Auth to `account.admins` — accounts verified by sign-in probe, missing ones created through the real signup flow, admin roles and plans leaf-patched, and an audit failing on any unauthorized admin. Passwords derive via HMAC from `ACCOUNT_PASSWORD_SEED`.
- (no issue) — checkpoint 51: the `seo` service reconciles each `seo.github.content[]` item to a programmatically managed public repo — created if missing, the developer-tool template pushed with content-compared writes, stale files deleted, metadata reconciled, and a collision guardrail that refuses to touch a real repo. Suite 349.
- (no issue) — checkpoint 50: the `certificates` service does Apple code-signing for desktop and mobile brands via the App Store Connect API — api-key, certificates, bundle-ids, and profiles operations, everything brand-local under gitignored `.omega/certificates/apple/`, non-interactive, with a full dry-run guard. Suite 329.
- (no issue) — checkpoint 49: the `assets` service — five local image-processing operations (logo-gen, process, icons, social-icons, favicons) reconciling the brand's derived collateral from its committed logo sources into gitignored `.omega/assets/`. Every operation is mtime-diffed, so a converged brand is a no-op. Suite 306.
- (no issue) — checkpoint 48: the `server` service replace-syncs `brands/{brand.id}` on the company server's Firestore with only the whitelisted sections, reading first and rewriting only on drift. The shared Firestore REST client gained `setDoc`. Suite 290.
- (no issue) — checkpoint 47: the `replyify` service — agent and user operations reconciling the brand's customer-service email agent, with the Gmail filter and knowledge composed from `config/replyify.md`. The company's sponsorship prose is gone from the package and discounts render only when configured. Suite 276.
- (no issue) — checkpoint 46: the `chatsy` service — chat and user operations reconciling the brand's support agent, knowledge built from the baseline plus `config/chatsy.md` and pricing from `payment.products`. Fixes omega-manager's literal `{website}/pricing` bug; owner-plan logic extracted to a shared lib. Suite 255.
- (no issue) — checkpoint 45: the `slapform` service — form and user operations reconciling the brand's contact form, diff-synced with leaf-masked patches. New shared `src/lib/firestore-rest.js` authenticates with a plain RS256 service-account JWT, dropping the firebase-admin dependency. Suite 234.
- (no issue) — checkpoint 44: the `payment` service — all 11 operations across Stripe, PayPal, and Chargebee, reconciling accounts, products, prices, plans, and webhooks to `payment.products`, with self-healing id matching, dry-run guards, and `--processor` narrowing. Radar and dispute protection stay warned-until-confirmed. Suite 216.
- (no issue) — checkpoint 43: the `beehiiv` service — publication, custom-fields, segments, and webhook operations reconciling the brand's newsletter to `marketing.newsletter`. Segments are verify-only (no create API) and the webhook always points at the parent backend's forwarder. Suite 182.
- (no issue) — checkpoint 42: the `sendgrid` service — all six operations (domain-auth, sender-identity, list, custom-fields, segments, event-webhook) reconciling the brand's email-marketing stack to `marketing.campaigns`. The CAN-SPAM address now comes from `brand.address` and `parent` defaults to null. Suite 166.
- (no issue) — checkpoint 41: the `adsense` service verifies the brand's domain is present in the configured AdSense account and reports its approval state. The API is read-only, so a missing domain warns with the add-site deep-link; `adsense.accountId` is required config. Suite 145.
- (no issue) — checkpoint 40: the `search-console` service — property, ga-link, and sitemaps operations. The domain property verifies in one pass via a Cloudflare TXT record, the GA association stays warned until confirmed in state, and sitemaps submit only when missing. Suite 135.
- (no issue) — checkpoint 39: the `analytics` service — google-streams, google-firebase-link, meta-pixel, and tiktok-pixel operations reconciling to `analytics.providers`. No property auto-creation until config writeback exists, so `propertyId` is required config. Suite 119.
- (no issue) — checkpoint 38: the `recaptcha` service proves the brand's reCAPTCHA secret valid via the siteverify endpoint, failing with `.env` guidance on a bad key. The console deep-link's project is config now. Suite 102.
- (no issue) — checkpoint 37: the `firebase` service — all 13 operations reconciling the brand's Firebase/GCP project (billing, services, settings, OAuth consent, service account, hosting, firestore, database, authentication, storage, functions, cloud messaging, SDK config). Billing account and support email are config now. Suite 93.
- (no issue) — checkpoint 36: the `domain` service's `nameservers` operation reconciles the registrar's nameservers to the Cloudflare zone's pair — Namecheap via its XML API, manual registrars treated as already set when the zone is active. Multi-part TLD splitting fixed via psl. Suite 76.
- (no issue) — checkpoint 35: the `cloudflare` service — all 12 operations reconciling the zone to config through read, diff, write (zone, DNS records, email routing, settings, five rulesets, managed transforms, speed tests, workers). Company-specific values moved from engine hardcode into config. Suite 62.
- (no issue) — checkpoint 34: the `github` service — org profile, the one brand-monorepo repo, and Pages, reconciled through the `gh` CLI with dry-run reads only. Company mode's design was settled with Ian and recorded as Task M3; build rides later ports. Suite 42.
- (no issue) — checkpoint 33: `@omegajs/manager` lands in the monorepo — `npx omega-manager` resolves the brand root from any cwd, loads `config/omega.json5`, and walks SERVICE_ORDER idempotently. First services: workspace, update, testing. 27 tests; migrator work paused per Ian's directive.
- (no issue) — Phase B4 (Task 2.8): `omega migrate` and the liquid-lint scanner land in `packages/web` — one command converts a UJM consumer in place (config, codemod, asset layer, legacy-file removal), `--check` reports without writing. Live-proven on real consumers; web 52/52.
- (no issue) — Phase B3 (Task 2.7): the `omega` CLI, consumer scaffolding, the ESM boot runtime, and a Ruby-free CI template land in `packages/web`. Bundles switched to ESM with code splitting so web-manager is one shared singleton. Web 38/38.
### Changed

- (no issue) — `packages/extension` reads `config/omega.json5` through the vendored `@omegajs/config`; `config/browser-extension-manager.json` is no longer read anywhere. The template's analytics secret moved to `.env`, consumers gain a `./config` export, and `bxm setup` no longer deletes consumer-only config keys.
- (no issue) — `packages/backend` reads `functions/config/omega.json5` through the vendored `@omegajs/config`; `backend-manager-config.json` is no longer read anywhere. The loader normalizes the `functions/` runtime dir to the app root, setup/test/deploy commands flipped with it, and the sandbox dogfoods the full brand hierarchy.
- (no issue) — `packages/desktop` reads `config/omega.json5` through the vendored `@omegajs/config`; `config/electron-manager.json` is no longer read anywhere. Per-OS config moved from `targets` to `platforms`, EM's own schema and validator were deleted, and consumers gain a `require('electron-manager/config')` export. Existing consumers must convert their file.

### Added

- (no issue) — Task 2.6: the real UJM content now lives in `packages/web` — blueprints, three themes, ~60 default pages, the real chrome and runtime, ported by codemod (521 files, 127 Liquid-transformed). Engine gained consumer layouts, Jekyll site emulation, and a layer-root asset pipeline. Four real bugs fixed.
- (no issue) — Task 2.5: `@omegajs/web@0.1.0` exists, promoted from the winning bake-off spike and split into engine, collections, layouts, build, and paths modules with the SSG-agnostic shared modules moved in. Both spikes became thin harnesses; the package stays private until first publish.
- (no issue) — Task 2.4: the bake-off is decided — `@omegajs/web` builds on Eleventy 3, scoring 4.70 versus Astro's 3.55. Migration cost was measured by porting three real files into both candidates; eight extracted codemod rules seed the consumer conversion plan. Output parity verified across 1,279 corpus pages.
- (no issue) — Task 2.3b: `spikes/bakeoff-astro` builds the complete A1 slice on Astro 5.18.2 — 5.56 s cold over the shared corpus, 1,279 HTML files with a URL set identical to the Eleventy build. Layouts must port by hand. Shared pipeline extracted into `spikes/bakeoff-shared`.
- (no issue) — Task 2.3: `spikes/bakeoff-eleventy` builds the complete A1 slice on Eleventy 3.1.6 — 3.60 s cold versus the 332 s Jekyll baseline, 1,279 HTML files. Every load-bearing bet validated: layered virtual-template layouts, layered includes, template-kit, and the data cascade as `page.resolved`.
- (no issue) — Task 2.2: `@omegajs/template-kit` ports the complete jekyll-uj-powertools surface to engine-neutral JS — 13 filters and 16 tags with injectable context plus a LiquidJS adapter. `@omegajs/config` gained `toSiteGlobal()`. Deep doc: `docs/template-kit.md`.
- (no issue) — Phase 2 A0: `spikes/bakeoff-shared` holds the Eleventy-versus-Astro bake-off infrastructure — the measured 332 s somiibo Jekyll baseline in `BASELINE.md`, a deterministic corpus generator matching somiibo's real content statistics, a zero-dependency bench harness, and the A2 scorecard skeleton.
- (no issue) — Task 1.4c: `packages/backend` scaffolds defaults through the devkit engine, and its defaults tree grew from five to seven files with `_.env` and `_.gitignore` marker-merged on setup. BEM's custom-key promotion flowed backward into devkit, so every framework inherits it.
- (no issue) — `@omegajs/devkit` gained the defaults-engine slice: `applyDefaults()` as the shared defaults-scaffolding engine over a minimatch file map, plus the extracted `merge-line-files` marker merge. Adopted by desktop and extension, which unblocks the backend defaults expansion.
- (no issue) — `@omegajs/devkit` gained the cli-router slice: `createCliRouter()` as the framework CLI dispatcher, extracted from three drift-identical copies. Extension and desktop adopted it, each keeping only its alias table and commands dir. BEM's differently designed CLI stays framework-specific.
- (no issue) — `docs/config.md` documents the omega.json5 format — locations, shape, resolution chain, hard rules, validation — plus per-framework migration mapping tables. EM's table is live; the BEM, UJM, and omega-manager rows are staged for their flips.
- (no issue) — `@omegajs/config` (private workspace package) defines the single `omega.json5` format for every project type: discovery with brand-monorepo walk-up, one agnostic deep-merge resolution chain, target enablement by key presence, and EM's ported schema validator. Secret-shaped keys and legacy array `targets` hard-fail.
- (no issue) — `packages/backend` consumer `public/*` is now generated, never tracked: `.gitignore` ignores it and one shared generator writes the boilerplate — setup overwrites authoritatively, while emulator, test, and deploy fill it in when missing. The sandbox consumer untracked its copies.
- (no issue) — `packages/backend` adopted the devkit shims for `safe-install` and `attach-log-file`, so all four frameworks now vendor devkit. BEM keeps its own route and console logging; the only behavior delta is the standard `# omega log` file header.
- (no issue) — `packages/backend` adopted `@omegajs/account`: `user.js` became a ~50-line wrapper over the shared engine with BEM injecting the real generators, and no call sites changed. Both drifted copies of the account schema are gone.
- (no issue) — `packages/backend` gained its dist layer: `preparePackage` un-defused, `main` and the bin shim point at `dist/`, `start` runs `prepare:watch`, and `prepublishOnly` prunes the self-test fixture. `src/` still ships. This unblocks the account wrapper and devkit vendoring.
- (no issue) — `packages/client` adopted `@omegajs/account`: `modules/auth.js` dropped its hand-rolled defaults, deep-merge, and subscription resolution for the shared engine, so account docs resolve byte-identically to the backend. `resolveSubscription` gains `everPaid`; published tarballs stay self-contained via the vendor hook.
- (no issue) — The vendor tool generalized beyond devkit: it vendors any private `@omegajs/*` package a host's dist references and rewrites ESM reference forms alongside the existing require forms. The transitive walk and host-runtime-dep guard understand both syntaxes; CI's self-containment grep widened.
- (no issue) — `@omegajs/account` (private workspace package) is the single source of truth for the OMEGA user and account schema, extracted from backend-manager with injectable generators and zero runtime dependencies. A byte-parity golden master gates it. Both web-manager and BEM adopted it.
- (no issue) — The sandbox cross-stack e2e harness boots the real stack with nothing mocked — website build, full Firebase emulator suite, and a real Chromium driving signup, user-doc creation, signout, signin, session persistence, and subscription resolution. Eleven steps green. The `omega e2e` CLI grows from it.
- (no issue) — `apps/sandbox-brand/apps/website` is a minimal web-manager consumer: an esbuild bundle embedding `packages/client` and firebase, pointed at the emulator suite. Deps resolve from the workspace root inside the monorepo. Phase 2 replaces it with an `@omegajs/web` consumer.
- (no issue) — CI gained a `sandbox` job running the full BEM corpus against the sandbox backend plus the cross-stack e2e.
- (no issue) — `apps/sandbox-brand` is the permanent dogfood consumer in the brand-monorepo format, with `apps/backend` a real backend-manager consumer built from the framework's own scaffolding sources and running emulator-only. The full BEM corpus now runs green here against a fresh consumer.
- (no issue) — `@omegajs/devkit` gained the test-runner slice: the shared discovery, suite, filter, and reporting engine plus `assert.js` and an extended-mode-warning factory. Extension adopted it, shrinking its runner to about 90 lines of framework-specific config and layer glue.
- (no issue) — `packages/desktop` adopted the runner core, cutting `runner.js` from 529 to 89 lines of config and glue, with `assert.js` and `extended-mode-warning.js` shimmed. Electron and boot runners are now lazy-loaded so a missing electron does not block build-layer tests.
- (no issue) — The vendor tool gained selective vendoring — only the modules a host's dist actually requires, plus transitive relative requires — and rewriting of `require.resolve()` forms. CI's self-containment grep widened to match those too.
- (no issue) — `@omegajs/devkit` (private workspace package) landed the first slice of shared build-time internals: `logger`, `safe-install`, and `attach-log-file`, each previously duplicated across four frameworks, with the log header normalized to `# omega log`.
- (no issue) — Devkit gained the vendor-on-prepare mechanism: frameworks require devkit modules by name as a workspace-linked devDependency, and each framework's prepare hook copies devkit source into its dist and rewrites the requires, so published tarballs stay self-contained while devkit stays private.
- (no issue) — `packages/extension` adopted devkit via three one-line shims for logger, safe-install, and attach-log-file; the packed tarball is self-contained.
- (no issue) — `packages/desktop` adopted the same three devkit shims, keeping its Electron-specific `logger-lite` desktop-owned. Backend adoption is deferred until BEM gains its dist layer.
- (no issue) — CI gained the devkit suite in the test job, and pack-smoke gained a "no raw `@omegajs` requires in shipped dist" self-containment check as the hard gate, since prepare-package after hooks are non-blocking by design.
- (no issue) — The monorepo skeleton landed: npm workspaces over `packages/*`, `spikes/*`, and `apps/*`, a Node pin, and base docs.
- (no issue) — Changesets (`@changesets/cli`) handles independent package versioning.
- (no issue) — Framework packages were plain-copied from their untouched read-only source repos: backend-manager 5.11.7, web-manager 4.3.4, browser-extension-manager 1.7.3, and electron-manager 1.12.0. Legacy npm names are retained until the gated cutovers.

### Fixed

- (no issue) — The devkit vendor tool died with `ENAMETOOLONG` on backend-manager's dist because `jetpack.find` follows symlinks and recursed through the self-test fixture's circular link. The scan now uses a symlink-safe walker that also skips `node_modules` and the vendor output.
- (no issue) — Sandbox `test:backend` never worked from the brand root: the workspace flag resolved against the monorepo root and found nothing, so the corpus had only ever run from inside `apps/backend`. It now changes directory first.
- (no issue) — `packages/client` had no auth-emulator support — auth never called `connectAuthEmulator`, so signin and signup against an emulated backend silently hit live Firebase Auth. Found by the cross-stack e2e.
- (no issue) — `packages/client` emulator-mode account reads hit live Firestore because the emulator connect lived only in the lazy firestore module while auth reads accounts directly. Both connects now happen at instance creation, and the duplicate block was removed.
- (no issue) — `packages/backend` rules tests ignored the firestore emulator port from firebase.json, so every rules test timed out for consumers on a non-default port. The runner now passes the configured port through.
- (no issue) — `packages/backend` content and post 404 tests hit live GitHub search in normal test mode, failing every token-less consumer; both suites now skip without a token. Logged, not fixed: BEM hardcodes its emulator ports and supports no custom ones.
- (no issue) — The root `.gitignore` comment claimed `packages/*/dist` is tracked; it never was, since each package's own `.gitignore` ignores its dist and prepare-package regenerates it.
- (no issue) — `packages/desktop` added `scripts/` to its package.json `files`: the published electron-manager 1.12.0 declares a postinstall script it never shipped, so every fresh consumer install fails on npm today. Found by the pack-to-scratch-install smoke.
- (no issue) — `packages/desktop` test runners now resolve electron via `require.resolve` with the project root as the search path instead of a hardcoded path, so hoisted npm-workspace installs are found. The desktop suite went from 299 passing with 47 hoisting skips to 751.

---

## Contributors

- [@ianwieds]

[@ianwieds]: https://github.com/ianwieds
