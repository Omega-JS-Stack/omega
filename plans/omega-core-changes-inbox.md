# OMEGA Core Changes — Ideas Inbox

> **Status: DECIDED 10/10 (2026-07-10) — BINDING.** All decisions resolved; graduated into [omega-redesign-master-plan.md](omega-redesign-master-plan.md) amendment (3) + the [PROGRESS.md](../PROGRESS.md) queue. This file is now the spec of record for the pre-dogfood core-changes window (Ian's raw dump preserved verbatim at the bottom).

---

## Triage — organized (Claude 2026-07-10, pending Ian's calls)

### A. Already exists / direct answers

- **One-command all-framework dev mode** — DONE (cp69): monorepo root `npm start` watches every dist-building package concurrently; `omega dev --local` links a whole brand to the monorepo + starts the watch + serves. Your later bullet ("install local version of each framework all at once + boot the framework's npm start so src→dist compiles") is exactly what shipped.
- **"Update WM → manually reinstall + republish every frontend framework" pain** — solved by the monorepo: client is a workspace package (edits are live everywhere in dev via the watch); in the published world client is a normal runtime dep, so consumers pick up client fixes via semver without framework republishes.
- **Single brand OR company-of-brands** — designed in from day one (COMPANY → BRAND → APPS; one engine, two modes). Onboarding wizard exists (`onboard` cp58 + service flows cp60, tested against fixtures) — but the real-world proof + the cloud-setup walkthrough (API keys, env vars, Google Cloud consoles) is the queued template work (C1). Honest status: architecture yes, first-run product polish not yet.
- **Config: what we decided** — one shape everywhere: `config/omega.json5` at brand root (shared values) + `apps/<app>/config/omega.json5` (target section + any-key overrides). Cascade: `framework defaults ← company ← brand shared ← brand targets.<type> ← app shared ← app targets.<type>` — exactly your defaults > company > brand > target want. Company config lives in the company workspace (your omega-manager instance). **Assets**: brand-root `assets/` as SSOT, manager disperses/derives per target — confirm during dogfood (D11).
- **Shared JS lib across targets** — `@omega.js/client` IS that lib (already the runtime singleton in web/desktop/extension). Theme sharing across targets = C4.
- **Per-target config values (sentry, analytics, …)** — ✅ confirmed exists (your `# more` question): the cascade overlays `targets.<type>` onto the shared namespace at both the brand and app layers — "a per-surface sentry.dsn or analytics id is just `targets.<type>.sentry.dsn`" ([packages/config/src/load.js](../packages/config/src/load.js)).
- **Token signin for manual testing** — exists (web auth signin-with-token); N6 formalizes it into personas.
- **Tests today** — framework suites are real (devkit 120, manager 564, web 52, client 77, extension 93, desktop 758, backend corpus ~1,252 + cross-stack signup/signin/subscription e2e in CI). Your gaps are real gaps: lifecycle flows (cancel/refund/export/delete), persona accounts, consumer-authorable brand tests → N6.
- **Sandbox brand vs dogfood for global e2e** — both: sandbox = CI-grade harness (already boots emulator + built site together and waits); dogfood adds desktop+extension to the matrix. Harness only tests targets present in the brand (app discovery drives it).

### B. NOW — the breaking window (pre-dogfood; nothing published, no real consumers)

- **N1. Upstream re-sync sweep** — review omega-manager's uncommitted changes (~45 dirty files: seo service, migrations, payment webhooks, api-check, devlog, video-editor brand, docs) + recent commits in every framework repo + jekyll-uj-powertools since the cp65/cutover baselines (other agents kept editing). Read-only → port list → port what matters. Do FIRST so fixes ride into everything after.
- **N2. The Great Rename** — `@omegajs/*` → `@omega.js/*` (dot-in-scope is valid: @socket.io precedent; sanity-test locally during the checkpoint); bins: every framework ships `omega` + `omg`, docs flip to `npx omega`, `mgr` kept as supported legacy alias; context-aware bin dispatch so `npx omega` in a brand monorepo resolves the framework owning the cwd's app; `window.webManager` → `window.omega` (D3); GH org `Omega-JS-Stack` noted for remotes (Ian creates). **Still ZERO npm publishes — versions not finalized.**
- **N3. Wire-format + env harmonization** (parked findings 64/67, now licensed): `/backend-manager` route prefix, `bm_*` function names, `backend_manager` runtime-config key, rules markers; env prefixes `BXM_*`/`EM_*`/`BACKEND_MANAGER_*` → unified `OMEGA_*` (exact names = D5). Free today; a breaking deployed-surface migration the day any brand ships.
- **N4. Migrated-code architecture sweep** — the "full sweep / now is the time to mess it up" ask: holistic DRY/SSOT/sensibility review of packages/* (manager especially — it landed via ~28 incremental checkpoints and deserves a whole-system look), keep routes/middleware semantics; produce a refactor list, agree it, execute. Includes the zod route-schema upgrade (D6).
- **N5. Emulator-first frontend dev** — dev mode auto-connects the REAL SDKs (Auth + Firestore emulator connect — not just localhost HTTP calls) with zero env flags, so dev can fuck up data, test rules instantly, seed data for the frontend. Verify what client/web actually do today, close the gap. Dogfood gate.
- **N6. Personas + lifecycle e2e** — seeded emulator persona accounts (unauthed / free / paid / cancelled / refunded / …) usable by BEM-style tests AND manual frontend signin (token mechanism); global flows: signup, delete account, cancel subscription, refund, data export, data deletion; boot-all-targets-and-wait harness generalized from sandbox e2e; consumers can author their own brand-level tests; **remove /account's mocked subscription fixtures — replaced by signing into real personas.**
- **N7. Port auto-allocation** (your "IDK" idea — endorsed): default ports, bump when taken, brand-level port map that every url getter (getApiUrl/getWebsiteUrl/…) reads → multiple brands in dev simultaneously without conflicts; also fixes BEM's hardcoded 5001/5002 (parked 1.2a). Can slide into the dogfood arc if NOW gets crowded.

### C. WITH the dogfood arc (Next #1; order within the arc)

- **C1. Template + onboarding product polish** — the shipfa.st-grade first-run: scaffold + walk the user through exactly which API keys, env vars, and cloud settings to set up; template repo lives in the new GH org.
- **C2. Blueprint/pricing rethink** — pricing/plans read from omega.json5 (`payment.products`) at build; kill the pricing-frontmatter dispersal entirely; slim theme-layout frontmatter (theme logic moves into templates; frontmatter reserved for consumers); KEEP: 3-layer default/theme/consumer JS+CSS hierarchy (you like it, it stays), legal append/addendum pattern, zero-config default pages (D8 for the mechanism).
- **C3. Classy full redesign** — ground-up rebuild: modern, clean, light/dark, kickass typography, polished UX; freedom to rip apart, no compat. After C2 so it's built once on the new shape; the omega dogfood site becomes the showcase. **Designed cross-target from day one (D10)** — core omega css/js consumable by desktop/extension too, brand layers on top.
- **C4. Cross-target sharing** — analytics integration module, fontawesome, theme sharing across web/desktop/extension ("brand theme once, all three targets" is the acceptance test); revisit `@omega.js/themes` once C3 stabilizes.

### D. Decisions — Ian's calls (2026-07-10; D4 still open)

1. ✅ **Scope = `@omega.js`**; GH org `Omega-JS-Stack` (from the dump). Zero npm publishes still standing — versions not finalized.
2. ✅ **Bins**: every framework ships `omega` + `omg` (docs flip to `npx omega`), `mgr` kept as supported alias; context-aware dispatch so the bin resolves the framework owning the cwd's app in brand monorepos.
3. ✅ **`window.webManager` → `window.omega`**.
4. ✅ **`apps/` stays** (Ian 2026-07-10: "yes!"). Rationale kept for the record: config `targets.web` names a TYPE (fixed vocabulary of five); `apps/website-docs/` names an INSTANCE (arbitrary). Naming the folder `targets/` would make one word mean both — and `targets/website/`'s config is `targets.web`, not `targets.website`, a permanent false friend. "Apps are instances of targets"; matches the ecosystem-standard `apps/*` layout.
5. ✅ **Wire names**: route prefix `/omega`, function names `omega_*`, runtime-config key `omega`, env prefix `OMEGA_*`.
6. ✅ **Zod for route schemas** (path- and plan-conditional shaping via schema-builder functions); account schema engine stays as-is (golden-mastered).
7. ✅ **Pricing/plans read from omega.json5** (`payment.products`); the pricing-frontmatter dispersal dies.
8. ✅ **Default pages stay virtual — NO eject command** (Ian: "we dont need a command for this"): taking over a page = create the same-URL file in the consumer; the existing override mechanism is the whole story. Docs point at the default-page sources for copy-paste.
9. ✅ **No Firebase config store — git stays the config SSOT — BUT designed for two future clients** (standing design principle):
   - a **hosted company omega** — the company instance running on a server, not a laptop;
   - a **layperson CMS** — no files on a hard drive: website editor + config editor served from the site's `/admin`.
   Both ride the SAME plumbing rather than a second store: all reads through `@omega.js/config` loadConfig (single choke point), all writes through the comment-preserving writeback editor (cp59), storage = git commits, rebuild = CI/server on push. Nothing in the architecture may assume a human with a local checkout.
   **Addendum (Ian 2026-07-10) — multi-surface build/deploy triggers:** builds + deploys must be launchable from (a) the local CLI, (b) the CMS UI, and (c) a plain HTTP command — all three converging on ONE executor (CI runs the same build the CLI runs; triggered by git push from CMS commits, or a workflow-dispatch-style HTTP call). Outputs: auto-deploy wherever possible (website hosting, backend deploy); everything that can't auto-publish (desktop installers, extension store packages) surfaces as **downloadable artifacts** — so a layperson can edit plans in the CMS, rebuild the website AND the desktop/extension/backend, and download what needs manual store upload.
   **Addendum 2 (Ian 2026-07-10):** artifact storage = **GitHub releases** (desktop already distributes/autoupdates from GH releases — same channel serves the CMS's download links). No additional servers.
10. ✅ **Classy redesign timing**: dogfood scaffolds on current classy → blueprint/pricing rethink (C2) → redesign (C3). **Merged requirement (Ian): the redesigned theme system is CROSS-TARGET from day one** — core omega css/js shared by web/desktop/extension, brand-specific layers on top; universal `theme.id` in shared config (already there — stays); consumer themes must be SUPER easy to make, and default pages (/account, /signin, …) automatically match the theme's look. (This absorbs C4's theme bullet.)
11. ✅ **Assets root-first**: brand-root `assets/` = SSOT (logos, icons, og images, fonts); manager derives per-target outputs into each app; app-local assets only for genuinely app-specific extras. Principle: shared-by-default at root, local only when truly local. **Addendum (Ian 2026-07-10):** the assets are SCAFFOLDED at onboarding (placeholders/templates at brand root) and stay MANAGED by the omega system — the manager's assets service re-derives per-target outputs idempotently on every run, not a one-time copy.

12. ✅ **Provider-discriminated config keys** (added post-decide — Ian 2026-07-10, `# more`): keys that name a ROLE with a `provider` discriminator instead of provider-named top-levels — e.g. `firebaseConfig` becomes `<role>: { provider: 'firebase', … }` — so a consumer could someday switch (supabase etc.) without a config-shape break. NO alternative providers actually built now; shape-only future-proofing. Exact key names land in N4's config review (cheap pre-dogfood, expensive after brands migrate).
    **D5 addendum (Ian 2026-07-10):** the legacy `/backend-manager` route prefix stays accepted as an ALIAS to the new `omega_api` function (hosting-rewrite glob + router strip) so migrating brands' in-the-wild clients keep working; everything else (docs, callers, function names, env) speaks `/omega` only. Shipped in cp72.
    **D5 addendum 2 (Ian 2026-07-10):** the Cloudflare `omega-api-proxy` worker is DEPRECATED — Firebase Hosting rewrites are sufficient for the api domain. Marked now (worker header + live warning when a brand still configures it), removed eventually; new brands never get it.
13. ✅ **Deliberate deploys — commits never auto-publish** (Ian 2026-07-10): the old UJM autopublish-on-push dies. Save = commit; publish = an explicit deploy action — from the CLI, an HTTP command, or the CMS — all converging on the ONE executor from D9's addendum, and uniform across every target. Subtle consequences to implement with it: content-publish actions imply deploy (the admin post route gains a `deploy` option defaulting TRUE — posting an article means publishing it), while code/config commits deploy nothing. Lands with C1 (template workflows) + the D9 executor; the admin-post tweak rides the backend work then.
14. ✅ **Crypto-strong key provisioning at setup** (Ian 2026-07-10): omega-owned secrets are GENERATED, never left blank — `OMEGA_ADMIN_KEY`/`OMEGA_WEBHOOK_KEY` = `randomBytes(32)` base64url, `OMEGA_NAMESPACE` = `randomUUID()` (uuidv5 namespace must be UUID-shaped). Shipped in cp72: the onboarding .env stub provisions them; external API keys stay user-filled placeholders.
15. ✅ **.env cascade mirrors the config cascade** (Ian 2026-07-10): `framework defaults (≈ empty) ← company .env ← brand .env ← app .env`, with the SHELL environment always winning over files — defined at the source files, resolved at runtime/build by a shared devkit env module (one mental model with omega.json5). The manager already proves company←brand precedence (company.test.js); formalize into devkit, adopt across manager + framework dev/test boots. Materialized app `.env` files remain ONLY where a deploy target physically requires one (firebase functions deploy uploads `functions/.env`) and are COMPOSED from the same cascade at build/deploy time (disperse becomes a composer, not a hand-maintained copy). Lands with N4 (cp73).

### E. LATER (post-dogfood backlog, roughly ordered)

- **L1. /admin + /dashboard overhaul** — admin = manage the business (firestore data, subscriber counts, revenue; plan editing = admin edits config → git → CI redeploy for now; a real-time remote-config layer only if genuinely needed later); dashboard = kickass layout shell, minimal default content (every app differs).
- **L2. Payment system review** — upgrades/downgrades, post-purchase upsell/add-ons, one-time purchases (known gap), cart, invoice list in /account.
- **L3. CMS** — git-backed architecture (CMS edits → commits → CI rebuild; evaluate Decap/Sveltia vs building into /admin); whitelabel per-site and/or company-level; live-preview story TBD; goal = non-dev handoff (pages, blog posts — not code).
- **L4. Terms/privacy rewrite** from scratch — organized, deduped, proper legal structure, keeps the addendum/append pattern.
- **L5. Weekly Sentry digest** across consumers + optional automated fixer (manager service).
- **L6. Ghostii/newsletter upgrades** — Claude SDK, generated charts/graphics for data-driven articles, beehiiv-native HTML blocks.
- **L7. BEM current-usage endpoint** so usage is always displayable (studymonkey-style).
- **L8. Workspace setup service** — emails, filters, aliases, pfp, signatures.
- **L9. Per-consumer migration guides** — Phase 4 material (pinned with it).
- **L10. Monetization** — shipfa.st-style "launch a business" positioning; possibly private distribution instead of public npm → publishes stay gated (already standing); decide before first publish, no architectural blocker either way.
- **L11. Churn retention / cancel-flow save offers** (Ian 2026-07-10, `# more`) — cancelling during a free trial warns "your trial will be cancelled"; cancel attempts get a stay-and-continue offer (e.g. 50% off next month, coupon-backed). Lands with L2's payment review + C3's account/billing UI.

---

## Raw dump (Ian, verbatim)

ok im just goign to dump my ideas. please organize them and lets talk through them.  i feel like were at a good point to make some major changes because we are right at the point where we havent worked on a brand yet...

# Core changes

* Unfortunately, "omegajs" is not available, but "omega.js" is on NPM. so we need to use that.
* also, lets ditch our "npx mgr" prefxes and (still support them, but change all documentation to use "npx omega" or "npx omg" rather since its shortr but support both. and GH is "https://github.com/organizations/Omega-JS-Stack" where we can start building the new "template" repo, plus the new frameowrk itself. I still dont want you to publuish anything on npm yet because these version nuebrs are not finalized!
* also, im not sure how i want to monetize this... i want to basically make something like "https://shipfa.st/", where it helps people quickly build and deploy a business. so im not 100% it will go in a public npm repo.? but idk we will see. thats not super important right now.

* check all uncomitted or recently comitted changes to both omega-manager and all fameworks and asses if they need to be added/merged into the new omega system
  * any uncomitted shit in the old omega-manager lib needs to be reviewed (because i added it recently).
  * check all recent git logs in each framework.. see if they need to be implmented or considered forthe new OMEGA
  * check the uj-powertools /Users/ian/Developer/Repositories/ITW-Creative-Works/jekyll-uj-powertools plugin
  * other agents have continued to edit oemga-manager + the frameworks so any bugfixes and improvements are worth considering. if they are already added or irrelevant now, you can skip! review the git messages as well as the individual files to asses

* are there or will there be extensive tests? for both the oemga manager part as well as the frameworks?

* is it made so that consumers can use omega manager on one single brand OR a collection of brands (under parent company)? for exmaple, currently the omega-manager repo is built to house MANY brands. consumers will likely get started with omegajs on one brand but want to expand to more later. that being said, how does a new consumer initialize a monorepo project? is there a nice onboarding system like oemga manager currently has? to set everythig up? is that onboarding system thoruhgly tested and easy to use and expandable to manage multiple brands? also will it help walk new users thru how to setup everything on the cloud? like google cloud etc

* is the omega-manger good? is it DRY, SSOT, and sensible? anything messy or inconsistent?

* is there a way we can easily run a command that will make every framework run in dev mode? so that changes to any framework automatically build so the consumer app can test the changes?

* what about config files? what did we decide?
  * is there going to be one brand ocnfig at the band monorepo toplevel? or will there be target-specific configs inside each target? what about company/parent config files?
  * i defintiey, want a cascading hierarchy where theres: defaults > company > brand > target... right? just not sure where they shoudl live
  * simiular thing for assets. wil there just be a toplevel assets folder? or will there be one on eaach target?
  * i just dont want to keep looking around for things all the time.

* more things to abstract bc all frameworks use it:
  * analytics?
  * fotnawesome
  * themes (bootstrap, animations, certain functionality)
* we need a way to share resources between targets for a brand.
  * so like if a brand wants to have a theme for the website, desktop and browser extension, that should be an easy thing to do without writing the same thing 3 times.
  * or maybe a JS lib/function that can be imported into each target?

* IDK ABOUT THIS JUST AN IDEA
  * make it so we have the default ports for everything but then bump if they are taken and distribute the ports in a way that every framework’s url getter (local version) is aware. like getWebsiteUrl or whatever getApiUrl, etc. is aware. this will allow multiple brands to be worked on at the same time without conflicting ports

* when a webite is in devmode, it should use the local firebase sytstems, not the live cloud one. i THINK UJM HAS this already but we need to make sure it does and so that it happens automatically wihtout any additional env flags ro athing
  * and i dont just mean http calls to localhost:5002 or whtever, i mean the acutal FIRESTORE should use the emulator, right? so that in dev we can play around, fuck things up, test firestore rules instantly, insert data to see how it looks on the fronend, etc

* for @omegajs/manager, it needs to be designed so that someone downloading it for the first time can use it to scafoold their project and it will walk them thru exactly what api keys, env vars and google cloud settings etc that they need to setup

* Some omega-wide e2e tests
  * global e2e (using multiple frameworks togehter)
    * create an email and password user, perform some actions that require https requests and firestore things
    * delete a user account
    * cancel their subscription
    * request a refund
    * request data-export
    * request data-deletion
  * just like any other frameowkr test, we need the consumer to be able to write their own global tests
  * need a way to bootup all frameworks and test them (and ideally wait, like maybe fire all of them at once and then wait for website, backend, etc to be ready)
  * probably only test e2e targets that are in the brand?
  * the sandbox brand could do this too? or no?
  * stated before i think, but we need a way to easily install the local version of each framework all at once to each target, and vice versa (change to live). bonus would be that in local/dev mode, we woould probably want to bootup the "npm start" command in the omega framework repo itself so that changes are compield from src --> dist...? right?
  * just like how in backend there are a bunch of different accounts for different purposes liek an account that JUST goes thru a cancellation, etc... i think we need more of those that can be manually used on the frontend for boht e2e testing and manual testing... like during development, we should SUPER EASILY be able to signin to a specific account and try something so that theres NEVER mocked data (im thinking specifically of the /acocunt page whihc has a bunch of subscirption fixtures liek active, cancelle, etc... FUCKING REMOVE THOSE AND REPLACE WITH THIS NEW SYSTEM)

* Renames
  window.webManager -- > something else? webManager is kind of dated now due to our refactor?
  "apps" folder in consumer and framework.. shouldnt it be "targets"??? or no?

Next, lets be sure we do a full sweep of the code you migrated to our new omega framework... how does it look asa whole? now is the time to refactor, reorganize, and mess it up. theres definitely some things i want to keep, like the routes system in the backend, the middleware, etc. but the exact imports can change, or we could try using a new backend schema? maybe zod or something more universally known? i sitll want to be able to splut the shcema based on inputs like the path the requerst took or the user's plan, but maybe its time to upgrade it?


Overall, i think you understand the GIST of waht i am trying to explain. my notes are messy and all over th place but i thnk you understand what im trying to get at right? please take what i am saying and evaulate what we have done + what our plan is set to do and lets decide what we need to do now vs later.

at this ppint, i dont really care if we have to break backwards compatibility. again, i dont WANT TO IF WE DONT HAVE TO, but if you think something is just NOT GOING TO WORK, then we shoudl do it. or if you thnk something is built weird, we mgiht as well just fix it now and iterate through all of it during our refactor via testing.

Basically, we want ALL OF THE BS PARTS OF A SAAS PLATFORM TO BE HABDLED BY OMEGA. like auth, database, security, payments, emails, notifications, analytics, attrribution for ads, ets, http routes/schema... etc.. so the consumer can focus on the actual product.

# Enhancing
* Payment system upgrades: listing invoices in account?

* web "/admin" pages overhaul + "/dashboard" overhaul.. Make thm look AMAZING and provide AMAZING reporting, features, and functionality.
  * for ADMIN: we should be able to manage the business from these pages.
    * i know some htings wil be easier than others. liek reading and writing firestore data is easy, firestore analytics liek subscriber count, revenue shoul dbe easy.
    * harder (would require refactor): also,see plans?, edit them?, add features, etc (they should reflect in website and apps ideally in real time but i understand that currently it works only on hardcoded config and requires a redeploy.. right? whats the best move?)
  * for dashboard: these are fort signed in users. the default dashboard pages dont need to really exist since it wilbe different for every app, but the dashboard layoout itself should be KICKASS

* should we migrate the central config of each brand to be stored in firebase? so that it can be manged from anywhere? idk?

* for UJM, i sort of think the frontmatter system for blueprints.default layout liek calssy is pointless.
  * we should get rid of it maybe and jsut build the theme in html. frontmatter can be reserved for the consuming project
  * same thing like pricing.html/pricing.md... that should just come from the new omega.json5  and we should ditch the whoel disperse the pricing into the frontmatter entirely. right?
  * i just want a nice theme system where we can get a site up and running quickly with ZERO config, but then can EASILY CUSTOMIZE IT further without reinventing the wheel (like im pretyt much NEVER going to manaulyl create/edit auth pages like signin/signup/account, and the pricing pages will be msotly boilerplate minus the config object carrying the actual pricing/plans. anoter example is a page like /terms.. we will likely eithe rnot touch it at all, or want to add a small section at the end like an addendum
  * would it be easier to make it so the boilerplate pages are created in the consumer but then defaulted with a "import" of the boilerplate shit? so pages like /signin and /signup ARE actually included int he consumer but then just have a 'IMPORT' funciton to the default? idk?
  * also, how do we handle it with the various layers of css/js? crrently we have it so theres base js lie the pricing page, and then we support the THEME to ahve its own js, and finally the CONSUEMR to have their own js. i really like this hierarchy so as long as you think its good id liek to preserve that

* are we doing the themes the best way? waht abut the default/blueprint pages? jsut want to make it so a new site
  * can be up and running with zero actual work done and have basic things like a homepage, pricing, auth, account etc
  * can be customized further with a theme and still have the basic pages work like an auth pages, account pages, etc
  * consider the fact that our css and js system exists where we hacve it load both default css/js and theme js/css and even maebe the customer css/js? on a per page basis? i like this system but it need to be reviewd and flexible
* CMS for our websites? how tf would we do that lol. maybe each web could server its own CMS so it could be compeltely whitelabeled (like how we have "/admin" pages? and/or it could be available in the PARENT COMPANY "/admin"?)
  * so users can add pages, add blog posts, etc
  * we ideally need a way for the person using the cms to see the changes live?
  * im not sure how we would implement this live preview feature, but it seems crucial for a good CMS experience.
  * also not sure how MUCH they should be able to edit? the idea of the cms is so that someone who develops a site using omega can hand it off to a NON DEV to manage the site. so they should be able to add pages, blog posts, etc, but they dont necessarily need to be abke to edit the actual code. they could though? just dont know how to do that considering it requires some processing to build the site and we plan to host it on GH pages. mayeb somehting where the admin/cms has the GH token and it builds the site in their browser or something? idk? or maybe when they edit something it just pushes the changes to GH and no local build is necessary?
  * i realize this sort of conflicts the whole idea of the loca config files so i ahve no idea what to do about that. i also sort of think it would be bad UX to have the config be loaded on demand for hte end user, for example the pricing page would ahve some significant load delay if it had to fetch the prices dynamically... so what do we do? and how does this affect the overall architecture of the current JSON config design? idk... im really lost.
  * or is CMS + cloud editable config too ahrd and just focus on the local config? or what if the config snce its in a monorepo is editable in the cms and then it hjsut goes directly into git? so that a local editor can just pull the changes? idk?

* classy theme/layout
  * I WANT TO COMPLTELY REDESIGN THIS SHIT. think of the curernt classy css/layout/js as a BLIND ATTEMPT AT MAKING A GOOD SITE. I LAUGH AT HOW BAD IT IS. I WANT YOU TO COMPLETELY REDESIGN IT. I WANT IT TO BE A KICKASS, MODERN, CLEAN, BEAUTIFUL, AND FUNCTIONAL LAYOUT. DONT JUST MOVE SHIT AROUND. I GIVE YOU FREEDOM TO RIP IT APART, MAKE NEW THINGS, AND I DONT CARE IF ITS NOT BACKWARDS COMPATIBLE. I WANT A CLEAN LIGHT/DARK THEME, kickass typography, and an overall user experience that feels polished, intuitive, and delightful.

* its annoying eveyrtime we update WM that we have to manualyl install it in each frontend framework and then publish those too just to get the changes... does our new ssytem get arounf this?

* be able to easily test e2e and also just manually signin with accounts, usualyl porobably just the local emulator accounts. we already have a mechanism in the auth.js on web that allows us to signin with a token so we can easily use that to test things like auth-gated shit, account things,

* come up with tests for EVERYTHING like in the sample projects (inside omega) part of the tests should audit the whoel setup process to make sure it scaffolds it correctly and other things lke if the claude.md is edited it shouldyes

* make other tests match BEM's account/auth.. so that we can have different levels of users trying various things like a unauthed user, a free user, and a paid user, etc... some framewokr level tests should exist like logging in, creating an account, canccelling sub, refunding, etc. then each site will make their own tests for their own unique features not provided in omega. this will be a MAJOR upgrade


# LAter
* automated sentry summary every week for all consumers with a summary of all errors and optional automated fixer?

* review the payment system, is it good? are there any falws or holes or papercuts? are there any things missing that could be useful? for example, plan upgrades/downgrades, upselling after a purchase (or adding on right before, like selling an ebook or a course during a subscription sale to complement the subscirption), etc. i know for a fact we dont currently fully support one time purchases so that would be nice. maybe a cart system so user can buy multiple items at once?

* rewrite terms and privacy. theres a loit in there that is disorganized and messy and sometimes said mulitple times, sometime ssai d in non legal terms , etc... so just remake it from scratch but just more well thought out. include things i didnt thin of, remove duplicaates/bad things, etc.

* write a migration guide for each consumer

* newsletter + article generator (ghsotii) need to use claude code sdk maybe? better results and can maybe generate charts + other graphics for the articles? bar charts, comaprisons, etc. make it sow ecan make HUGE DATA DRIVEN ARTICLES!
* maybe if we generate html fo rht enewsletter that is already using beehiiv classes/styles, we can actually use html blocks? we could just generate each block? idk?
* BEM call to get current usage so it can always be displayed (like on studymonkey)
* setup workspace + filters, aliases, emails, pfp, signatures, etc


# more
> (triaged 2026-07-10 → per-target answer in A, provider keys = D12, churn retention = L11; second batch: route alias = D5 addendum, deliberate deploys = D13, key provisioning = D14; third batch: proxy worker deprecated = D5 addendum 2, .env cascade = D15)

better churn retention
* popup if cancelling during free trial (trial will be canceld)
* stay and continue for 50% off your next month

options
* maybe have options for providers for things in case the consuemr wants to switch?
  * instaed of things lie firebaseConfig being toplevel, maybe have "something".provider = 'firebase'? "something" is the name for whatever firebase is (alternatives would be supabase, etc, but we would nto support that yet at all, just leaving the otpion open for later?)
  * also did we make it so tht we can have different config values per target like sentry, analytics, etc? i think we did but just checking.

on the renames.. yes lets move towards getting rid of "backend-manager", BACKEND_MANAGER, bem* etc... for routes we should do {domain}/omega/* andthat incldues hosting rewrites + the setup task that fixes that. mayeb for backwards compat we can also still allow {domain}/backend-manager for the new omega_api function?

just an idea,.. in old omega, the website repo would autopublish on commits.. i feel liek htis is bad design esp since its a monorepo now... what do you rthink about switching it to deliberate deploy commands? which can be done in cli, https, or cms? so like save-->commit, publiush-->deploy? then evey target is the same. only deliberate deploy/publish does something, not just simpel commits. we will ahe to change some subtle things such as the admin post route which now needs to probably have an option to deploy it, defaulting to true??

other small things... thge omega setup prcesss should use uuid or a more secure random string to provision the keys like OMEGA_MANAGER_KEY, etc.

we dont need the cloudflare proxy, just hosting rewrites in firebase is fine for nopw, you can makr it to be deprecated now and removed eventually.

and for the .env, it should ahve a similar hierarchy as thhe config. in that there are defaults (basically nothing though), then company, then brand, then target. defined at the soruce, resovled at runtime/build right?

