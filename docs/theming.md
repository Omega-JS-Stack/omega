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

## Content-page vocabulary (default pages + blueprints)

Every classy frontend default page composes from one shared set
(`themes/classy/css/marketing/_content.scss` + the existing section/bento
vocab): `classy-page-hero` (+ `classy-display--page`) opener, `classy-prose`
long-form (blog posts, legal md, bios), `classy-timeline`, `classy-post-card`
(the ONE blog card — `_includes/frontend/components/post-card.html`, shared
by index/related/category/tag grids), `classy-person`, `classy-facts`
(hairline-divided columns; `__value--num` serif numerals, `__sub` footnote),
`classy-chip-cloud`, `classy-blog-search`, and token-driven `.pagination`.
Consumer frontmatter keys are unchanged — pages re-rendered, data contracts
kept.

**Compositional set (cp147 — pages are COMPOSED, not centered)**:
`classy-hero-split` (asymmetric opener: statement + side rail),
`classy-duo` (label/head column + body column, sticky aside; column split
overridable via `--classy-duo-cols`), `classy-statement` (editorial letter
text — big serif with italic `<em>`), `classy-numbered` (principles list
with serif italic indices), `classy-channel` (contact/support rows),
`classy-band` (one wide hairline row — enterprise, platform strips),
`classy-form-panel` (the hairline container every long form sits in), and
the `.classy-quiet` fine-print voice.

**Post media + author contracts** (post-card AND the post page honor them):
`post.image: false` → designed no-media panel (serif italic category
monogram on dotgrid), never a 404 `<img>`; `post.image: "<path>"` → that
image lazy-loaded; absent → the legacy `/assets/images/blog/post-<id>/`
convention. An author that resolves to no team member renders a neutral
pen-nib mark + the brand name (no broken avatar rows).

**Footer pattern** (`frontend/sections/footer.html` + `css/layout/_footer.scss`,
draft-2): brand block (lockup + one-liner + social icon row) beside auto-fit
link columns; ONE hairline base row where copyright, legal links, the
language dropup pill, and the segmented appearance control all share the
same 1.75rem scale. The appearance segments are plain `data-appearance-set`
buttons — core appearance.js stamps `.active`/`aria-pressed`. The brand
lockup class (`.classy-nav__brand`) is root-scoped and shared by nav +
footer.

**Per-page theme css override slot**: `themes/<theme>/css/pages/<page>/index.scss`
compiles into the manifest's `themePages` bucket and loads LAST on its page —
after main css AND core page css. That's where a theme outranks core page
rules; classy's `status` and `feedback` entries repaint the JS-toggled `bg-*`
state classes (a class contract — never rename them) into the hairline
language there.

## App panels (App DNA — dashboard/admin content)

`themes/classy/css/app/_panels.scss`: `classy-statgrid` (the DIRECTION
merged stat card — ONE card, hairline column dividers, micro-label +
tabular value + delta chip per cell; `--classy-statgrid-cols` sets the
lg column count), `classy-panel-title` (the 14/650 card-title voice), and
`classy-activity` (hairline-divided feed rows with neutral icon chips).
The backend dashboard layout and the admin dashboard/users blueprints
render on these; every JS-populated id (`stat-*`, tables, charts) is a
contract and stays.

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
| `data-omega-marquee` + `.omega-marquee__track/__item` | seamless loop — the set is cloned until half the track covers the container (never runs dry), constant px/s (attr value overrides) |
| `data-omega-scroll-watch="24"` | stamps `data-omega-scrolled` (glassy nav) |
| `data-omega-segmented` | gliding-thumb segmented control: engine injects `.omega-segmented__thumb` and tracks the checked/`.active` segment (billing toggle, platform rails, footer appearance) |
| `data-omega-dotfield="22"` | canvas dot grid (value = px spacing): slow traveling wave, dots tint along ONE drifting rainbow gradient, pointer glow (tracked window-level so the fixed nav can't blind it); static CSS dots remain for no-JS/reduced-motion |
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
