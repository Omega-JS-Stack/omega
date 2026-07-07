# Newsflash Theme

An editorial news theme: warm paper surfaces, ink text and hairline frames,
vermilion accents with volt highlights, optical-sized serif headlines
(Fraunces) over a clean grotesk (Schibsted Grotesk). Signature elements: the
live news ticker above the masthead, framed editorial images, kickers,
section rules, drop caps, and pill controls that lift off small hard shadows.

## Select the theme

```yaml
# src/_config.yml (consuming project)
theme:
  id: "newsflash"
  target: "frontend"
  appearance: "light" # or "dark" / "system" — dark mode is first-class
```

## Customize tokens

Every variable in `_config.scss` is `!default` — override any of them in your
project BEFORE the theme import:

```scss
// src/assets/css/main.scss (consuming project)
@use 'ultimate-jekyll-manager' with (
  $primary: #0E7C3A,                  // swap vermilion for forest green
  $nf-volt: #FFD966,                  // warmer highlighter
  $nf-radius: 12px,                   // tighter frames
  $nf-font-display: ('Lora', serif),  // different serif voice
);
```

Runtime tokens live in `css/base/_root.scss` as `--nf-*` CSS custom
properties; dark mode is a single `[data-bs-theme="dark"]` remap block.

## What ships custom

- **Layouts** (`_layouts/themes/newsflash/`): base (ticker + fonts), homepage,
  blog index, blog post, pricing, about, contact, 404. Everything else
  inherits Classy markup restyled by this theme's CSS.
- **Chrome** (`_includes/themes/newsflash/frontend/sections/`): the serif
  masthead nav + the editorial ink-slab footer (volt column heads, language +
  appearance pickers in the bottom rail). Same `nav.json`/`footer.json` data
  contract as classy.
- **Page assets** (`pages/`): homepage rails/big-read band, blog index splash,
  blog post reading-progress + drop cap, pricing/about/404 accents.
- **Behaviors** (`js/`): masthead scroll shadow, Bootstrap tooltips. The
  ticker and marquees are pure CSS.

## Conventions

- Markup uses standard Bootstrap classes + universal semantic names
  (`.kicker`, `.ticker`, `.section-head`, `.art-frame`) — never `nf-*`
  prefixes. `nf-*` survives only on SCSS internals (`$nf-*`, `--nf-*`,
  mixins).
- Fonts load via the `theme.head.content` block in
  `_layouts/themes/newsflash/frontend/core/base.html`, never SCSS `@import`.
