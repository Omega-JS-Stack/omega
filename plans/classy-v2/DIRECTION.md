# classy v2 — Direction (LOCKED, build contract)

**Status:** GO from Ian 2026-07-16 ("just go ahead and build classy"). Direction converged over two interactive comp rounds against Ian's theme notes (2026-07-15) + 14 Mobbin inspo screens + ElevenLabs/Manus references (his second-round attachments).

**The visual spec is the comps** (self-contained HTML, open in any browser — the bottom dock switches view/theme/brand/type/density):

- [draft-1.html](draft-1.html) — first round (violet/cyan gradients — REJECTED palette, kept for the record) · artifact: https://claude.ai/code/artifact/e26826cf-b6c2-4afb-9db7-d5bae486818a
- [draft-2.html](draft-2.html) — **the approved direction** · artifact: https://claude.ai/code/artifact/f58ba1ef-4841-45f3-b046-77d7d75ef060

Where this file and a comp disagree, this file wins (it encodes Ian's latest word). Comps are throwaway single-file mockups — the real theme ships proper SCSS partials + JS modules per repo conventions.

## Identity decisions

- **The name stays `classy`** — full gut renovation in place ("remake classy FROM SCRATCH"); D10's new-name lean is overridden. No meridian anything.
- **Bootstrap 5 stays the base** — classy's existing `_config.scss → @forward '../bootstrap/scss/bootstrap.scss' with (…)` pattern is preserved architecture ("build upon Bootstrap's core, don't reinvent the wheel").
- **Built ON the shared OMEGA theming system** (C3 systems slice): paints via the `--omega-*` token contract (`core/css/tokens/_index.scss`), rides `.omega-shell` mechanics (`core/css/shell/_index.scss`), brand accent flows from `brand.color` → `composeBrandTokens` inline ramp. C4 later hands the same token sheet to desktop/extension — this is what keeps every target harmonious.

## Binding constraints (Ian, 2026-07-15 feedback round)

1. **ZERO gradients** — chrome, buttons, borders, logos, text: none. The ONLY permitted fade is a monotone single-hue opacity gradient under chart lines/sparklines.
2. **Dark mode is generic charcoal** — no blue/purple cast (ElevenLabs reference). Neutral grays only; color enters through the accent slot.
3. **Search lives in the TOPBAR** (⌘K pill), never the sidebar.
4. **Sidebar supports nested groups** (parent + chevron + tree-hairline children; open and closed states both first-class).
5. **Active nav state must not shift geometry** — every item carries a transparent border at rest.
6. **Consumers customize colors/vibe/typography EASILY in their main.scss** — this is the product; see Consumer contract below.

## Token sheet (values from draft-2; token NAMES are the stable contract)

Light (warm paper):
`ground #f5f5f4 · surface #ffffff · surface-2 #f6f6f5 · ink #1a1a19 · muted #6d6d6c · faint #a1a19e · line #e8e8e6 · line-strong #d8d8d5`

Dark (neutral charcoal, de-blued):
`ground #0d0d0e · surface #151516 · surface-2 #1d1d1f · ink #ebebea · muted #9f9fa0 · faint #6c6c6e · line #262628 · line-strong #333336`

Accent (single hue, from `brand.color`; light/dark variants; derived hover/subtle/ring via color-mix in the comps — production derives via composeBrandTokens):
default (playground) `#5b47fb` light / `#8577ff` dark · `accent-ink` = white on light, near-black on dark.

Status (semantic, reserved): `ok #12925c/#3ecf8e · warn #c47206/#f5a524 · danger #d92d20/#f0574d` (light/dark).

Charts: series-1 = accent; series-2 (comparison, dashed) = teal `#0f8fa9` light / `#1f9fb4` dark — **passed the dataviz CVD validator in both modes** (dark tritan 7.1 sits in the legal-with-secondary-encoding band; dashing + legend + direct labels satisfy it).

Geometry: radii `6/8/10/14/20` · shell `sidebar 264 / rail 68 / topbar 60` · motion `160ms cubic-bezier(.25,.5,.35,1)` · density preset `compact` tightens `fs 13.5→12.5, control 34→29, card pad 20→14, nav item 34→29, topbar 60→52`.

## Typography

- **Default = the Manus split ("Mix")**: marketing display serif (`New York/ui-serif/Georgia` class), app + UI grotesk (system stack). Consumer presets: `sans` (grotesk everywhere — ElevenLabs mode), `editorial` (serif display everywhere), `terminal` (mono display).
- **D5 (vendored webfonts) is OPEN** — comps deliberately use system stacks; Ian picks the real faces (Inter-class UI + a serif display) before or during the build; the token layer makes the swap trivial.
- Manus-calibrated scale: page title 22/650/-0.02em; tile numbers 24/650 tabular; panel heads 14/650; uppercase 11px micro-labels (tables, stat labels, tp-heads).

## Accent usage rules

- **Primary buttons are INK** (black on light, white on dark) — Manus/ElevenLabs pattern.
- Accent is for: links, active nav icon/state, focus rings, meters/progress, chart series-1, small signal chips, the brand dot. Never large surface fills; never text-gradient anything.
- Status colors stay reserved for status (pills always dot+label, never color-alone).

## App DNA (dashboard/backend/admin surfaces)

Gray-canvas sidebar (on `ground`) + **content in ONE big rounded card** (`surface`, r-20, hairline) — the GitBook/Laravel-Cloud pattern. Sidebar top→bottom: ink Ω brandmark + wordmark (lockup) → project **selector module** (optional; solid accent tile + name/env) → nav sections with muted uppercase labels, count/`New` chips, **nested groups** → footer: optional **ad slot** (hairline card, SPONSORED tag, dismissable, "Pro removes ads") → user row. Collapse → 68px icon rail (brandmark only, nested groups hidden; drawer+scrim under 1200px). Topbar: drawer/collapse toggles, breadcrumb + env status pill, centered ⌘K search, docs/bell buttons, account selector dropdown (avatar = neutral chip). Content: merged stat card (hairline column dividers, sparklines, delta pills), chart card w/ legend + segmented metric tabs + crosshair tooltip + top-pages meters, usage meters (warn state at threshold), checklist card, activity feed, promo banner (plain hairline card), data table (uppercase heads, project dots = flat per-project colors, target chips, status pills, mono durations, pagination footer).

## Marketing DNA (frontend surfaces)

Ink on paper. Glassy nav (transparent until scroll → blur + hairline; ink CTA). Hero: subtle dotted grid (masked), serif display headline w/ **rotating italic second line** (motion = the life, not color), neutral badge pill w/ status dot, ink primary + mono-command ghost CTAs, **floating product frame** (gentle y-drift + perspective hover, real mini-dashboard inside). Word-logo marquee (masked edges, pause on hover). Hairline bento grid (neutral icon tiles; one 2×2 with omega.json5 codebox on ink panel; brand-dot demo tile; light/dark split tile; deploy terminal row w/ caret). Stats band: paper, hairline block borders, big serif ink numbers, count-up on reveal. Pricing: 3 cards, popular = ink border + inverted chip + ink button. Serif quote w/ italic emphasis. CTA band: neutral ink panel (`#161616`-class), serif white headline, paper button. Scroll-reveals via IntersectionObserver; `prefers-reduced-motion` kills all of it.

## Consumer contract (THE product surface — every OMEGA consumer starts on classy)

- **Tier 1 — customize classy from your app's `main.scss`** (most consumers stay here):
  - `omega.json5 → brand.color` recolors every accent surface at build time (zero CSS).
  - Sass knobs: `@use 'omega:theme' with ($primary: …, $font-family-sans-serif: …, $border-radius: …)` — every `_config.scss` var ships `!default`.
  - Token overrides: redefine any `--omega-*` custom property in `:root` / `[data-bs-theme=dark]` for surgical re-vibing (grays, radii, speed, type presets, density).
- **Tier 2 — build your own theme**: fork `themes/_template`, same layer chain; classy remains the fall-through reference.
- **Stable API line (don't churn once consumers exist):** token NAMES, `_config.scss` variable names, shell markup contract, `_includes` section names. Everything behind that line (partial internals, exact values) stays freely iterable.

## Iteration safety (Ian: "I don't want to get locked into a hole")

- Comps in this folder are the frozen visual reference; the theme itself iterates by checkpoint commits — every step revertable, nothing sacred.
- Until first publish, playground is the ONLY consumer → zero breakage risk while we iterate hard.
- After publish, iteration discipline = respect the stable-API line above; values/partials/pages remain fair game forever.

## Build order (the arc, per PROGRESS)

1. **DRAFT 1 in-repo (next):** classy gut renovation sufficient for home/pricing/signin + chrome (nav/footer) + app-shell restyle on playground; light+dark; local screenshots; suites green; commit; ONE named playground deploy for Ian's reaction.
2. Default pages + blueprints skinned.
3. Auth/account/payment surfaces + dashboard/admin remake (this doc's App DNA).
4. Showcase pass; FOUC critical-CSS/font QA rides this arc.
5. C4 cross-target sharing (tokens → desktop/extension).
6. Arc close: template repo cut OUTSIDE the monorepo; playground source → `Omega-JS-Stack/omega-playground` main + CI (`omega deploy` dispatch replaces direct gh-pages push); omegajs.dev wiring.
