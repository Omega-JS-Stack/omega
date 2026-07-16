# Theming — the OMEGA design system contract

> classy v2 (the flagship skin) + the shared machinery every theme and, at C4,
> every target rides. Visual spec: [plans/classy-v2/DIRECTION.md](../plans/classy-v2/DIRECTION.md).

## The three layers

1. **Tokens** — `packages/web/core/css/tokens/_index.scss` emits the
   `--omega-*` custom-property contract: neutrals (`ground`, `surface`,
   `surface-2`, `ink`, `ink-muted`, `ink-faint`, `line`, `line-strong`), the
   accent family (`accent`, `-hover`, `-active`, `-subtle`, `-ink`, `-ring`),
   status (`ok`/`warn`/`danger`), charts (`chart-1`/`chart-2`), shadows
   (`shadow-1`/`shadow-2`), shape (`radius-xs/s/m/l/xl`), motion (`speed`,
   `speed-slow`, `ease`), and the type slots (`font-ui`, `font-serif`,
   `font-mono`, plus the pairing slots `font-marketing` and `font-display`).
   Light + dark values ship together: OS preference carries via
   `@media (prefers-color-scheme: dark)`, and the `data-bs-theme` stamp
   (core/js/core/appearance.js) beats it in both directions. **Names are the
   stable API; values are the skin.**
2. **Mechanics** — `core/css/shell/_index.scss` (the `.omega-shell` app
   chrome: 264px sidebar / 68px rail / 60px topbar, drawer under 1200px) and
   `core/css/motion/_index.scss` (below). Both paint exclusively through
   tokens so a skin restyles them without touching structure.
3. **Theme** — `themes/<id>/` (classy is the flagship and the universal
   fallback layer). classy v2's `css/base/_root.scss` bridges Bootstrap's CSS
   variables onto the tokens, so every Bootstrap component follows the theme,
   the brand ramp, and consumer overrides with zero recompilation.

## brand.color → the accent ramps

`omega.json5 → brand.color` drives `composeBrandTokens()`
(`packages/web/src/brand-tokens.js`): a light ramp plus a **dark-mode variant**
(darker brands lift into a legible lightness band for the charcoal ground;
already-light brands pass through). `core/_includes/core/head.html` emits both
as inline `:root` blocks AFTER the css bundles — same three-stamp plumbing as
the token sheet — so the ramp wins the cascade everywhere, including
`.btn-primary`, links, focus rings, `.form-check-input:checked`,
`.progress-bar`, and `.text-primary`/`.bg-primary` (classy re-points those at
the tokens).

## Consumer customization (tier 1 — main.scss)

- **Recolor**: set `brand.color` in omega.json5. No CSS.
- **Sass knobs**: every variable in `themes/classy/_config.scss` is `!default`
  — `@use 'omega:main' with ($primary: …, $font-family-sans-serif: …,
  $border-radius: …)` from the consumer main.scss.
- **Token overrides**: redefine any `--omega-*` property in `:root` /
  `[data-bs-theme='dark']` for surgical re-vibing (grays, radii, speeds,
  shadows, type).
- **Type presets**: stamp `data-omega-type="sans|serif|mono"` on `<html>`
  (via `theme.html.attributes`) or re-point `--omega-font-marketing`
  / `--omega-font-display` directly. Default is the mix pairing — serif
  marketing display over sans UI.
- **Fonts (D5, shipped)**: classy vendors **Inter** (UI grotesk) and
  **Newsreader** (marketing serif) — variable woff2, latin + latin-ext, OFL —
  in `themes/classy/fonts/`; the asset pipeline copies every layer's `fonts/`
  dir to `/assets/fonts` (first layer wins), `css/base/_fonts.scss` carries
  the `@font-face` blocks (`font-display: swap`), and `css/base/_root.scss`
  re-points `--omega-font-ui` / `--omega-font-serif` at them. The core token
  sheet keeps system stacks as the framework default AND the fallback tail —
  swapping faces stays a values-only change (two custom properties + the
  files). Ordering note: core main.scss MUST load the token sheet before the
  theme `@forward` (Sass emits a module's CSS at its first load), or theme
  token overrides lose the cascade.

Tier 2 stays: fork `themes/_template` for a full theme; classy remains the
fall-through layer for anything the theme doesn't cover.

## Motion library

CSS: `core/css/motion/_index.scss`. Engine: `@omega.js/client/modules/motion.js`
(`createMotion()`), booted by `core/js/core/motion.js` — shared with
desktop/extension at C4 exactly like icon-renderer.

| Surface | Use |
|---|---|
| `data-omega-reveal="up\|fade\|left\|right\|scale"` | reveal once on scroll-in |
| `data-omega-reveal-stagger="60"` (parent) | staggers child reveals (ms step) |
| `data-omega-countup` | counts to the number already in the markup |
| `data-omega-rotate="2600"` | children cycle (hero word rotator, quotes) |
| `data-omega-marquee` + `.omega-marquee__track/__item` | seamless loop (track duplicated once) |
| `data-omega-scroll-watch="24"` | stamps `data-omega-scrolled` (glassy nav) |
| `.omega-hover-lift/-raise/-dim`, `.omega-pressable`, `.omega-hover-nudge .omega-nudge` | pure-CSS hover/press effects |
| `.omega-float`, `.omega-caret` | ambient float, terminal caret |

Resilience rules (load-bearing):

- Reveal styles only hide content under the inline `html[data-omega-motion]`
  stamp (head.html) — **no JS means a fully visible page**.
- `prefers-reduced-motion` renders final states: reveals resolve instantly,
  count-ups show their target, rotators hold the first word, marquees park.
- The PurgeCSS safelist keeps every `omega-`-namespaced selector
  (`src/assets.js`) because motion/shell state is runtime-stamped and never
  visible to the content scan. **New runtime-stamped classes must live in the
  `omega-` namespace** (or join the safelist explicitly).

## classy v2 (the flagship skin)

Warm-paper light / de-blued charcoal dark; zero gradients (the only permitted
fades are alpha masks and monotone chart fills); ink primary buttons
(`.btn-adaptive` — built from `$dark`/`$light` by the shared overrides layer);
accent reserved for links, active states, focus, meters, chart series-1, and
small signals. Marketing display voice is the serif `--omega-font-marketing`
(`.classy-display`); app surfaces stay on the grotesk. The app chrome rides
`.omega-shell` with the content area drawn as one big rounded surface card
(matching margins/radii on topbar + main — the markup contract is untouched).

Structure: `_config.scss` (consumer knobs + Bootstrap forward) → `css/base`
(root bridge, typography, utilities) → `css/components`
(buttons/cards/forms/badges/dropdowns) → `css/layout`
(general/nav/footer/shell) → `css/marketing` (hero/bento/sections) →
`css/pages` (auth) → shared `../bootstrap/overrides`.

Section chrome is data-driven: `_includes/frontend/sections/{nav,footer}.html`
and the shared app chrome `_includes/global/sections/{app-sidebar,app-topbar,
page-header}.html` render JSON section data (`core/_includes/**.json`,
consumer-overridable per file). The sidebar supports an optional project
selector module (`selector:`), nested collapsible groups, badges, an ad slot
(`bottom.ad.enabled`), and the auth-bound user row; the topbar carries the
drawer/rail toggles, the breadcrumb trail (from `theme.header.breadcrumbs`),
the ⌘K search pill (`search:`), custom actions, and the account dropdown.

## Stable-API line (don't churn once consumers exist)

Token NAMES · `_config.scss` variable names · `.omega-shell` markup contract ·
`_includes` section names + their JSON data shapes · the motion attribute
contract. Everything behind that line — values, partial internals, page
markup — iterates freely with the skin arc.
