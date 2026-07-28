# Newsflash Theme

An editorial news theme: warm paper surfaces, ink text and hairline frames,
vermilion accents with volt highlights, optical-sized serif headlines
(Fraunces) over a clean grotesk (Schibsted Grotesk). Signature elements: the
live news ticker above the masthead, framed editorial images, kickers,
section rules, drop caps, and pill controls that lift off small hard shadows.

## Select the theme

```json5
// config/omega.json5 (consuming brand/app)
theme: {
  id: "newsflash",
  appearance: "system", // or "light" / "dark" — dark mode is first-class
},
```

## Customize

Compile-time knobs: every variable in `_config.scss` is `!default` — override
any of them from your project's main.scss:

```scss
// src/assets/css/main.scss (consuming project)
@use 'omega:main' with (
  $primary: #0E7C3A,                  // swap vermilion for forest green
  $nf-volt: #FFD966,                  // warmer highlighter
  $nf-radius: 12px,                   // tighter frames
  $nf-font-display: ('Lora', serif),  // different serif voice
);
```

Runtime paint reads the shared `--omega-*` token contract
(`core/css/tokens/_index.scss`), which `css/base/_root.scss` re-values with
the editorial sheet — light AND dark, three-stamp plumbing, Bootstrap bridged
per classy's pattern. Consumers can override any token per-mode in plain CSS,
and `brand.color` in omega.json5 recolors the whole accent family via the
head-emitted ramps. Genuinely-editorial extras (volt, ink panels, hard-offset
shadow recipes, grain) keep the `--nf-*` namespace.

## Fonts

Fraunces + Schibsted Grotesk are VENDORED (`fonts/` + `css/base/_fonts.scss`,
both OFL, variable, latin + latin-ext) — no CDN requests. The runtime reads
`--omega-font-ui` / `--omega-font-serif`, so re-pointing families is a
two-property override.

## What ships custom (current tree)

- **Chrome** (`_includes/frontend/sections/`): the MASTHEAD nav — a sticky
  blurred-paper bar with a hairline ink rule, serif brand, uppercase pill
  links; same `nav.json` data contract as classy, scroll state via the
  shared motion engine (`data-omega-scroll-watch`). The footer deliberately
  rides classy's include restyled as the editorial ink slab
  (`css/layout/_general.scss`).
- **Layouts** (`_layouts/frontend/`): base (ticker), homepage, blog
  index/post/categories/tags, pricing, about, contact, team, 404. Everything
  else falls through to Classy markup restyled by this theme's CSS.
- **Page assets** (`css/pages/`, `js/pages/`): homepage rails/big-read band,
  blog index splash, blog post reading-progress + drop cap, pricing/about/404
  accents.
- **Behaviors**: none of its own. Bootstrap tooltips come from the shared
  core-layer initializer every theme imports; the ticker rides the shared
  motion engine's marquee; masthead scroll state is engine-stamped — no
  bespoke theme JS.

## Conventions

- Markup uses standard Bootstrap classes + universal semantic names
  (`.kicker`, `.ticker`, `.section-head`, `.art-frame`) — never `nf-*`
  prefixes. `nf-*` survives only on SCSS internals (`$nf-*`, the editorial
  `--nf-*` extras, mixins).
- Components read `var(--omega-*)` for everything the contract names; the
  `--nf-*` namespace is reserved for concepts that only exist in this theme.
