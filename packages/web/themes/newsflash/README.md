# Newsflash Theme

An editorial news theme: warm paper surfaces, ink text and hairline frames,
vermilion accents with volt highlights, optical-sized serif headlines
(Fraunces) over a clean grotesk (Schibsted Grotesk). Signature elements: the
live news ticker above the masthead, framed editorial images, kickers,
section rules, drop caps, and pill controls that lift off small hard shadows.

## Skin + bounded forks

Newsflash follows the base/skin/fork convention
(`docs/web/sections.md` "Markup convention"): it is a SKIN over the base
theme's shared markup, plus a short list of identity forks. Every surface it
does not fork renders base markup (`omega-*` classes) restyled by this
theme's scss, so the nav, 404, about, contact, pricing, team, and blog
taxonomy pages are structurally identical to every other skin, and the
behavior contracts that ride base markup (`data-omega-countup`, the pricing
JS hooks, the feature-comparison table) all work here unchanged.

## Forks

Identity forks, all wearing `newsflash-*` BEM classes. This list is
machine-checked (packages/web/test/theme-convention.test.js): every markup
file in the theme must appear here, and every listed path must exist.

- `themes/newsflash/_layouts/frontend/core/base.html`: the news ticker band
  above the masthead (shell otherwise aligned with base).
- `themes/newsflash/_layouts/frontend/pages/index.html`: the newspaper
  homepage (cover-story hero, top-story tiles, editorial feed with the
  sticky rail, more-to-chew-on band).
- `themes/newsflash/_layouts/frontend/pages/blog/index.html`: the lead-story
  front page built on story cards.
- `themes/newsflash/_layouts/frontend/pages/blog/post.html`: the article
  treatment (reading progress, centered article head, framed article hero,
  drop-cap body).
- `themes/newsflash/_components/news/story-card/component.html`: the
  editorial tile.
- `themes/newsflash/_components/news/byline/component.html`: the byline
  strip beside the tiles.
- `themes/newsflash/_components/heading/lede/component.html`: the band-head
  lede.
- `themes/newsflash/_components/heading/rule-head/component.html`: the ruled
  band head.
- `themes/newsflash/_sections/marketing/desks/section.html`: the desks band,
  a newsflash-unique section.
- `themes/newsflash/_sections/marketing/rundown/section.html`: the rundown
  band, a newsflash-unique section.
- `themes/newsflash/_sections/marketing/newsletter-cta/section.html`: kept
  for its "rail" variant (the homepage sidebar signup card), an arg-contract
  extension the base band lacks; behavior stays inherited (the js lane).

Everything else falls through to base. The scss floor for the fallthrough
vocabulary comes from classy's token-pure partials (imported in
`_theme.scss`) painted through this theme's `--omega-*` re-values, with
editorial overlays on top (`css/components/_panels.scss` — the marketing set
pieces, plan cards included, since `marketing/pricing-cards` composes them
off /pricing too (#531) — the omega voice rules in `css/base/_utilities.scss`,
the masthead re-skin of `.omega-nav` in `css/layout/_navigation.scss`, and the
404/pricing page css).

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

## Behaviors

None of its own beyond the reading-progress page module
(`js/pages/blog/[slug].js`). Bootstrap tooltips come from the shared
core-layer initializer every theme imports; the ticker rides the shared
motion engine's marquee; masthead scroll state is engine-stamped.

## Conventions

- Fork markup wears `newsflash-<block>__<element>--<modifier>` BEM
  (`newsflash-ticker`, `newsflash-story-card`, `newsflash-kicker`,
  `newsflash-frame`, `newsflash-rule-head`, ...). Bootstrap classes, the
  shared `omega-*` vocabulary, `data-*` idioms, and core JS hooks
  (`amount`, `billing-info`, `button-text`, `blog-post-content`) stay
  untouched.
- Components read `var(--omega-*)` for everything the contract names; the
  `--nf-*` namespace is reserved for concepts that only exist in this theme.
