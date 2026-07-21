---
status: queued
created: 2026-07-21
---
# Website polish backlog — Ian's INBOX dump (2026-07-21, verbatim-preserved)

> Ian filed these "for after the review". Grouped for execution; wording preserved where it carries intent. Source: INBOX 2026-07-21 (triaged same day). Items marked **[PROPOSE-FIRST]** need a design pitch before building.

## Bugs (live site / dev)

1. https://omegajs.dev/contact "completely broken (component/section isue)".
2. Top-of-page spacing inconsistent: /about vs /pricing before the content starts — "give pricing more spave to UNIFY them".
3. Redirect module 404s (`/assets/js/modules/redirect.bundle.js` not in the bundle lanes) — AND Ian: "our redirect system was weird and ugly. please REBUILD IT TO BE BETTER AND MORE SENSIBLE."
4. Auth flow: on auth-required pages a sign-out (possibly on dev-server restart) does NOT kick the user out at `auth.listen()` time; it must navigate away the moment auth resolves unauthenticated (the old WM `auth.listen()` behavior). Also wanted: a documented URL-only way to auth in dev (no dev-pill clicking).
5. Cookie-policy page broken in BOTH themes (content pushed left); privacy + terms fine.
6. Newsflash: account dropdown (and possibly others) had an invisible BG at one point — verify fixed.
7. Brandmark: Ian updated `apps/omega-playground/assets/logo/brandmark.svg` but the site shows the old one — root-cause the asset-redistribution story (see Questions #Q4) and fix whatever lane is stale.

## Design / copy (classy + site content)

8. Pricing: Enterprise gets its own line/card below the others; add a second paid plan so the layout is provable.
9. Pricing: Ian likes the pasted rainbow on the pricing card + buttons — if it's not the same gradient formula as the omega dots, make it so.
10. More space before the "Everything in Basic, and more:" lines; more space between the money-back-guarantee line and the cards.
11. Light-mode monthly/yearly toggle blends into the page BG (dark is good) — Ian: "a global design issue with cards, colors, and bgs."
12. Copyright line links the parent company when set: `© 2026 {brand} by {parent}. All rights reserved.`
13. Download modals (tutorial things) were NOT redesigned — do them; shorten the download-page intro copy to ~1 line.
14. About page: big hero image up top, images/colors spread out, less text in the top half.
15. Status page: add package versions, repo, anything else sensible.
16. Kill copy like "All 4 of us — real people, no stock photos" — no icon there, never mention stock photos.
17. Auth pages: Google sign-in logo can be full-color (drop the B/W filter).
18. Checkout page (`/payment/checkout`) still looks unredesigned — actually redesign it.
19. **EM-DASH PURGE (ruling)**: Ian 2026-07-21: "PLEASE REMOVE '—' from EVERYWHERE… DO NOT USE EM DASHES. REWRITE EVERYTHING TO MAKE SENSE WITHUT IT" — site copy: find all, manually rewrite each.
20. Contact page: remove the animated live-support widget demo.
21. "Join 10k+ happy subscribers!" gets its customer images back.
22. Blog search: make it work (or at least look good) without the ugly Google CSE widget if possible.

## Features

23. `uj_`/`uj-` prefix retirement: rename to an omega prefix — Ian floats `omega_` or `omg_`, wants a recommendation.
24. Ads placement: bring back auto-insertion into blog posts + dashboard sidebar slots. Note the fallback inventory question is ALREADY the ratified company model (plans/ads-system.md): the consumer's PARENT brand defines the ads.
25. Ads visual-test page (old UJM had one): sizes/layouts side by side. (Ads in plain HTML already work: `{% section "ads/unit" %}` build-time, or any `<div data-omega-ad>` in markup — the client auto-binds.)
26. Download/extension pages auto-populate from config `targets` (no hand-supplied links).
27. OS detection on download/extension pages MUST use the shared framework logic (legacy web-manager's — find where it migrated: web or client) — same for extension pages.
28. **[PROPOSE-FIRST]** Font Awesome PRO dependency: 99% of consumers won't have Pro. Ian: "id liek to hear your solution before you implement this one because it needs to be elegant and not hacky or messy."

## Questions answered (chat 2026-07-21) — verify in docs

- Q1 ads in HTML: yes — section call or `data-omega-ad` markup; no JS insertion required.
- Q2 theme system: there is no separate shared base — resolution is consumer → active theme → classy; classy IS the base skin newsflash falls through to. Ian leans "both import a shared base" — revisit as a design question if he wants a true neutral base extracted.
- Q3 animations: yes — one place, the shared motion engine in @omega.js/client (`data-omega-*` attributes), theme-agnostic.
- Q4 top-level change redistribution (assets/config/.env/SHARED): needs a documented contract — what triggers redistribution + rebuild, and what the correct verb is after editing brand-level assets. Fold the answer into docs and fix the brandmark staleness (Bug #7).
