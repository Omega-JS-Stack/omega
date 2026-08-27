# Neobrutalism Theme

A bold, high-contrast omega theme built on the neobrutalist design language:
**pure-ink borders, hard offset shadows (no blur), zero border-radius, chunky
grotesk display type, and flat saturated color blocks.** Buttons and cards
"press" into the page on interaction. Full light + dark mode support.

## Skin + bounded forks

Neobrutalism follows the base/skin/fork convention
(`docs/web/sections.md` "Markup convention"): it is a SKIN over the base
theme's shared markup, plus a short list of identity forks. Every surface it
does not fork renders base markup (`omega-*` classes) restyled by this
theme's scss, so the nav, pricing, 404, about, contact, team, blog, and auth
pages are structurally identical to every other skin, and the behavior
contracts that ride base markup (`data-omega-countup`, the pricing JS hooks,
the feature-comparison table) all work here unchanged.

## Forks

Identity forks, all wearing `neo-*` BEM classes. This list is
machine-checked (packages/web/test/theme-convention.test.js): every markup
file in the theme must appear here, and every listed path must exist.

- `themes/neobrutalism/_layouts/frontend/core/base.html`: the smallest
  possible fork: body markup identical to base; the only delta is the head
  block loading the display faces (Archivo / Space Grotesk / Space Mono via
  Google Fonts). When the faces are vendored like newsflash's, this fork
  dies.
- `themes/neobrutalism/_layouts/frontend/pages/index.html`: the neobrutalist
  homepage. Three hand-built bands where the structure is genuinely
  neo-specific: the asymmetric split hero, the alternating offset showcase
  rows, and the numbered step cards, plus the fork vocabulary they share
  (kicker, accent, section-head). The rest of the page delegates to base
  sections: trusted-by (the omega-marquee logo wall, ink-framed by this
  theme), stats (omega-stat cells painted as color blocks), testimonials,
  and the cta band (the omega-cta ink panel).

Everything else falls through to base, including the whole pricing page.
The scss floor for the fallthrough vocabulary comes from classy's token-pure
partials (imported in `_theme.scss`) painted through this theme's
`--omega-*` re-values, with neobrutalist overlays on top
(`css/components/_marketing.scss` for the marketing bands — plan cards
included, since `marketing/pricing-cards` composes them off /pricing too
(#531) — the omega voice rules in `css/base/_utilities.scss`, the ink-bar
re-skin of `.omega-nav` in `css/layout/_navigation.scss`, and the pricing page
css).

## Select the theme

```json5
// config/omega.json5 (consuming brand/app)
theme: {
  id: "neobrutalism",
  appearance: "system", // or "light" / "dark"; dark mode is first-class
},
```

## Customize

Compile-time knobs: every variable in `_config.scss` is `!default`; override
any of them from your project's main.scss:

```scss
// src/assets/css/main.scss (consuming project)
@use 'omega:main' with (
  $primary:           #FF5C00,   // your brand color
  $nb-border-width:   4px,       // chunkier borders
  $nb-shadow-offset:  7px,       // deeper hard shadow
  $nb-accent-yellow:  #D4FF00,   // swap the signature highlight
);
```

### Key tokens (see `_config.scss` for the full list)

| Token | Purpose | Default |
|---|---|---|
| `$primary` … `$danger` | Bootstrap semantic colors | electric blue, hot pink, etc. |
| `$nb-ink` / `$nb-paper` | Border/shadow color + page surface (light) | `#111` / `#FFFEF2` |
| `$nb-ink-dark` / `$nb-paper-dark` | Same, dark mode | `#F5F5F5` / `#16161A` |
| `$nb-border-width` | Standard border thickness | `3px` |
| `$nb-shadow-offset` | Hard shadow distance | `5px` |
| `$nb-accent-*` | Color-block palette | blue/pink/yellow/green/purple/orange |
| `$nb-font-display` | Heading font | `Archivo` |
| `$font-family-sans-serif` | Body font | `Space Grotesk` |

Runtime paint reads the shared `--omega-*` token contract
(`core/css/tokens/_index.scss`), which `css/base/_root.scss` re-values with
the ink/paper sheet: light AND dark, three-stamp plumbing, Bootstrap
bridged. Consumers can override any token per-mode in plain CSS. Genuinely
neobrutalist extras (the accent palette, border/shadow recipes, the press
interaction) keep the `--nb-*` namespace; the `nb-` prefix never appears in
markup.

## Fonts

Archivo + Space Grotesk + Space Mono load via the theme's `head` block in
the core/base fork (Google Fonts). If you change the font tokens, update the
`<link>` accordingly (in your page/layout `theme.head.content`, or by
overriding the base layout).

## Behaviors

None of its own. Bootstrap tooltips come from the shared core-layer
initializer every theme imports; the logo wall rides the shared motion
engine's marquee; nav scroll state is engine-stamped
(`data-omega-scroll-watch` on the base nav include).

## Conventions

- Fork markup wears `neo-<block>__<element>--<modifier>` BEM (`neo-hero`,
  `neo-showcase`, `neo-step-card`, `neo-kicker`, `neo-accent`, ...).
  Bootstrap classes (`.card`, `.btn-*`, `.text-bg-*`), the shared `omega-*`
  vocabulary, `data-*` idioms, and core JS hooks (`amount`, `billing-info`,
  `price-per-unit`, `button-text`) stay untouched.
- The border/shadow/press system lives in `css/base/_mixins.scss`
  (`nb-border` / `nb-shadow` / `nb-press`), the SSOT for the look;
  components include these rather than repeating the recipes.
