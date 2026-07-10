# OMEGA Core Changes — Ideas Inbox

> **Status: TRIAGE DRAFT — under discussion.** Ian's raw dump (verbatim, bottom half) + organized triage (top half). Nothing is queued until decisions land in [omega-redesign-master-plan.md](omega-redesign-master-plan.md) (amendments) and [PROGRESS.md](../PROGRESS.md) (queue).

---

## Triage — organized (Claude 2026-07-10, pending Ian's calls)

### A. Already exists / direct answers

- **One-command all-framework dev mode** — DONE (cp69): monorepo root `npm start` watches every dist-building package concurrently; `omega dev --local` links a whole brand to the monorepo + starts the watch + serves. Your later bullet ("install local version of each framework all at once + boot the framework's npm start so src→dist compiles") is exactly what shipped.
- **"Update WM → manually reinstall + republish every frontend framework" pain** — solved by the monorepo: client is a workspace package (edits are live everywhere in dev via the watch); in the published world client is a normal runtime dep, so consumers pick up client fixes via semver without framework republishes.
- **Single brand OR company-of-brands** — designed in from day one (COMPANY → BRAND → APPS; one engine, two modes). Onboarding wizard exists (`onboard` cp58 + service flows cp60, tested against fixtures) — but the real-world proof + the cloud-setup walkthrough (API keys, env vars, Google Cloud consoles) is the queued template work (C1). Honest status: architecture yes, first-run product polish not yet.
- **Config: what we decided** — one shape everywhere: `config/omega.json5` at brand root (shared values) + `apps/<app>/config/omega.json5` (target section + any-key overrides). Cascade: `framework defaults ← company ← brand shared ← brand targets.<type> ← app shared ← app targets.<type>` — exactly your defaults > company > brand > target want. Company config lives in the company workspace (your omega-manager instance). **Assets**: brand-root `assets/` as SSOT, manager disperses/derives per target — confirm during dogfood (D11).
- **Shared JS lib across targets** — `@omega.js/client` IS that lib (already the runtime singleton in web/desktop/extension). Theme sharing across targets = C4.
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
- **C3. Classy full redesign** — ground-up rebuild: modern, clean, light/dark, kickass typography, polished UX; freedom to rip apart, no compat. After C2 so it's built once on the new shape; the omega dogfood site becomes the showcase.
- **C4. Cross-target sharing** — analytics integration module, fontawesome, theme sharing across web/desktop/extension ("brand theme once, all three targets" is the acceptance test); revisit `@omega.js/themes` once C3 stabilizes.

### D. Decisions needed (Ian) — with recommendations

1. **Scope `@omega.js`** — confirm (fallback if some tool chokes on the dot: `@omega-js`). GH org `Omega-JS-Stack` confirmed?
2. **Bins** — `omega` + `omg` on every framework, `mgr` kept, context-aware dispatch: ok?
3. **`window.webManager` →** recommend **`window.omega`**.
4. **`apps/` vs `targets/`** — recommend KEEP `apps/`: apps are INSTANCES of target types (a brand can have `website` + `website-docs`, both `targets.web`); config `targets` names the type, the folder names the instance.
5. **New wire names** — propose: route prefix **`/omega`**, function names **`omega_*`**, runtime-config key **`omega`**, env prefix **`OMEGA_*`**.
6. **Zod for route schemas** — recommend YES (universally known, typed, composable; path- and plan-conditional shaping preserved via schema-builder functions). Account schema engine STAYS (golden-mastered, proven); revisit later.
7. **Pricing from config** — YES per your note.
8. **Default pages mechanism** — recommend keep virtual templates (zero files in consumer = zero clutter) + add **`omega eject <page>`** to materialize any default page as a real consumer file when wanted — your "import stub" instinct as an opt-in instead of the default.
9. **Config stays local/git SSOT** — recommend NO Firebase config store; "manage from anywhere" arrives later via the git-backed CMS (L3); avoids the runtime-fetch latency you flagged (pricing page) and config split-brain.
10. **Classy redesign timing** — recommend: dogfood scaffolds on current classy first (proves plumbing), then C2 → C3 land and the dogfood site re-skins into the showcase.
11. **Assets layout** — brand-root `assets/` SSOT, per-target derived outputs (manager dispersal): ok?

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
