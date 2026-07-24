# INBOX — omega
> Capture anything, any format. Triage files every entry and empties this (project-state spec v2).

* for web, ensure we have all the boring reauired files like ads.txt, robots.txt, sitemap.xml, feed xml ( thin its /feeds/posts.xml??), and some ones i know we dont have like llms.txt, and any ther new ones

## Web design inspo
https://www.relume.ai/?r=0


## Questions
* should we have omega-managed .claude folder in each monorepo that helps agnents working in onega repos act more determininstically? or should we leave those to skills? remember, i want to have my own workflow optimzied so that workin with omega projects is easier but also anyone who uses omega to be able to take advntage of these thigns too. but also consdier that people will want to customize their own workflows too. so not sure how to do this? maybe some middleground where the .claude fodler has some things always forced/set (like the firebase.josn hosting config with backend-manager/omega rewrites) but then users can set their own? or should they live in the GLOBAL claude so they are always universal??? so basically should this exist at all, and if so should it exist in project .claude, or global .claude? what are the pros and cons of each? should we also register somne omega SKILS the same way? kinda like how right npw we have hooks that deterministicaly load skills, is that even the right approach? condiser how now instead of wokring in seaprate repos were wokring in monorepos for each rband. either way it shoudl be consistent. so if we do decie to have omega setup skills+hooks it should either be GLOBAL or REPO scoped right? same for boht? what are the pros and cons of each? alternatvely, we could guide the user to automatically install it (not sure how that is done?) but ideally we would support NOT JUST CLAUDE but other major ai's too like openai, gemini, curosr, etc however they do it.

## Longterm omega manager optimizations
* help guide the user to making backlinks. we could help them generate all the images they need for htings like producthunt launch, etc, coudl go into the SEO service in omega manager? maybe even automate more baclinks similar to how we autlomate github?


# claude.md + agents.md
* I think I initially... but correct me if I'm wrong. Have you set up these two files? I wanna start removing certain things like this from the omega system and leave that up to the user.
* We can certainly initialize the repo with these two files for the consumer, but I don't wanna edit them any further other than initializing them. claude.md (if it doesnt exist) should initialize wiht a pointer to agnets.md. and agents.md should be the one that we exclusively check for the first line importing the omega entry point which is /Users/ian/Developer/Repositories/Omega/omega/AGENTS.md, i think?

# Web
* cookie polixcy code is missing the sass ignore whatever its called because its styling is BAD
* pricing page chcks not liningup with texts
* checks on homepage shoud be blue, same with signup page (UNIFY THIS EVERYWHER)
* unified loggin (not just in web, but all farmeowrks)
  * i notice ome are tagged like [@omega.js/client:push] Auto-subscription failed: Notification permission denied
  * [Form-manager]
* https://omegajs.dev/status
  * all systems operationsal green is different than the green for hte status bars under. just make it the same, universal acros THE ENTIRE WEBSITE
  * lots of stuff issing from the build manifest. fix and add more shit if its missing
* https://omegajs.dev/download
  * logos for platforms need to be bigger and more prominent
  * white button on deb needs to be bottom OR side by side
  * we only need ONE mobile email form (not one for each ios and android)

# Something?
* Account creation is temporarily restricted. This can happen if you've recently created too many accounts, or your email is on our blocked list. Please try again later or contact support.
  * when i try to signup... so some funciton isnt works (i tried on omegajs)

# Overall framework
  * we have some things liek classes that click triggers, like log out class that triggers logout, etc. UNIFY THEM ACROSS THE FRAMEWORK. so put it in a universal library and it should used in all frameworks and work, and thers definitely more. so chagne the names so they are sensible and unified (no more uj-* or X-* thats not omega-* prefixed right?)

## From cp265 review (fable 2026-07-23)
* checkout `payments/intent` has the same 403-before-verify empty-token pre-check the newsletter route just dropped (pre-existing, behind the payment gate) — align it with verify()'s no-secret leniency when payment work reopens.

## From cp268 review (fable 2026-07-23)
* desktop has NO `@dev-only` strip in its webpack lane (extension has a loader, web got one in cp268) — if desktop production bundles carry @omega.js/client's dev-only blocks, the same live-dev-code class exists there. Also: the strip marker constants now live in two homes (extension webpack loader + web esbuild plugin) — SSOT candidate (devkit).
* `packages/manager/AGENTS.md` tells brand consumers to read `node_modules/@omega.js/web/CLAUDE.md`, but the web package ships neither CLAUDE.md nor AGENTS.md (pre-existing) — fold into the docs+skills revamp.


## From cp269 review (fable 2026-07-24)
* backend HELP_TEXT is hand-maintained ("keep in sync with the process() chain") while the four router frameworks generate help from the live dispatch table — a tiny generator over a backend command table would remove the drift risk the review already caught once (the install-spelling mismatch).

## From cp270 review (fable 2026-07-24)
* `remoteScripts` is not declared in the @omega.js/config schema (pre-existing; the opt-in flip makes it visible since brands now AUTHOR the key) — declare it in TARGET_SCHEMAS.desktop, natural rider on the rekey batch's schema work.
* packages/desktop/CHANGELOG.md carries no per-package entry for the remote-scripts opt-in flip (checkpoint era logs at the ROOT changelog) — needs a package-level entry before the first publish.

## DE-BRAND config + more
* we need to DE-brand the config keys. for example
  * chatsy
  * replyify
  * gcp
  * slapform
  * adsense
  * and anything else.... help me decide the proper de-branded key name and then set these as PROVIDERS (just like weve been doing)

