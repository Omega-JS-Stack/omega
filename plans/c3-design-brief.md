---
status: draft
created: 2026-07-11
---
# C3 Design Brief — flagship theme redesign

**Status:** OUT FOR IAN'S REVIEW (drafted 2026-07-11, cp99). Systems work proceeds in parallel — nothing below blocks tokens/mechanics.

**Visual boards (look here first):** https://claude.ai/code/artifact/4d8b96d6-a181-47cb-b3c5-9a43143459dd
Three directions rendered as live HTML — hero, pricing card, auth card, dashboard shell per direction, each with palette/type/motion specs and a brand-accent swap demo. The boards share ONE mock markup restyled purely by token swap — the D10 architecture proving itself.

**How to note:** anything, any format — corner tags (`A·hero`, `B·type`, `C·shell`) and decision numbers (D1–D10) just make it faster. Mix-and-match is a valid answer.

## Scope (what the theme must skin)

Four surface families, 45 layouts, inventoried from `packages/web`:

| Family | Surfaces | Layout family today |
|--------|----------|--------------------|
| Marketing | index (5 hero variants), pricing, about, contact, download, careers, feedback, team, alternatives, blog (index/post/cats/tags), updates, legal ×3, status, 404, app, extension pages | `frontend/core/{base,cover,minimal}` |
| Auth | signin, signup, reset, token, oauth2 | `frontend/core/minimal` |
| User app | dashboard, account, payment checkout + confirmation, portal/email-preferences | `backend/core/{base,minimal,minimal-viewport-locked}` |
| Admin | dashboard, users (+new), calendar, firebase, stackblitz, studio | `admin/core/{minimal,minimal-viewport-locked}` |

Plus shared chrome (nav/footer/sidebars/topbars — already isolated as theme `_includes` sections), empty/loading/error states, dark mode, and the brand-accent slot (`brand.color` → tokens) since one theme wears many brands.

## Current state (grounding)

- `classy` is already a custom Sass system (`css/base|components|layout` partials + `_config.scss` + `_theme.scss`); Bootstrap is a SEPARATE theme, not classy's base.
- Backend/admin shells exist but are minimal chrome (sidebar/topbar includes) — the redesign designs them properly for the first time.
- Friction #16 (sass deprecation spam) folds into this work; core css entry is `core/css/main.scss` + `bundles/{theme}.scss`.

## The three directions (summary — boards carry the detail)

- **A · Ledger** — precision instrument. Cool greys w/ blue-ink bias, hairlines, 8px radii, one accent slot, 160ms uniform restraint. Max multi-brand neutrality; craft lives in details (tabular nums, focus rings). Risk: generic if executed lazily.
- **B · Masthead** — editorial confidence. Serif display (Fraunces-class) for marketing voice on barely-warm paper, grotesk for everything functional; app shell stays neutral. 12px radii, 240ms marketing choreography, instant in-app. Most distinctive marketing; risk: serif discipline + 2 font families.
- **C · Console** — terminal grade, dark-first. Near-black, hairline grid, mono labels/data, amber default signal, 3px radii, 90ms stepped. Perfect for omegajs.dev/dev brands; risk: wrong voice for consumer brands.

## Decisions needed (D1–D10)

| # | Question | My lean |
|---|----------|---------|
| D1 | Direction: A / B / C / blend? | A backbone + B's serif display as optional marketing voice |
| D2 | Dark mode first-class day one? | Yes — token-level cost is near-zero, retrofit is always worse |
| D3 | App shell: sidebar vs topbar; admin same shell? | Sidebar both; admin = same shell denser + environment badge |
| D4 | Density: comfortable vs compact? | Comfortable default + compact token preset |
| D5 | Self-hosted webfonts ok? | Yes — subset + swap-safe; type is most of the personality |
| D6 | `brand.color` drives accent everywhere vs CTAs only? | Everywhere via auto-derived ramp (hover/subtle/ink computed from one hex) |
| D7 | Corner personality: 2–4 / 8 / 12–16px? | (pure taste — boards demo all three) |
| D8 | Motion budget: uniform restraint / marketing choreography / instant-only? | (taste; A's restraint is cheapest to keep consistent) |
| D9 | Graphics language: pure type / patterns / gradients / product screenshots? | Pure type + real product UI screenshots |
| D10 | Lands as `classy` in place, or new flagship name? | New name; classy retires (no-backwards-compat rule) |

## Proceeds regardless of direction (systems track, running in parallel)

1. **Core token layer** — CSS custom properties for color/type/space/radius/motion; brand.color → derived accent ramp; light+dark defined at token level. (D10 cross-target: consumable by desktop/extension later.)
2. **Sass modernization** — kill deprecation spam (#16), `@use` migration as needed, clean bundle entries.
3. **Shell mechanics** — proper backend/admin app-shell layout structure (responsive sidebar, topbar slots) independent of skin.
4. **Two-tier theming mechanics** — consumer override at main.css level vs full theme on core; toy second theme proves both tiers.

Ian's notes then land on top as the skin pass — default pages, blueprints, auth/account/payment surfaces, omega-brand showcase.
