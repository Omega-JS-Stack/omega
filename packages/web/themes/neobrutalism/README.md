# Neobrutalism Theme

A bold, high-contrast UJM theme built on the neobrutalist design language:
**pure-ink borders, hard offset shadows (no blur), zero border-radius, chunky
grotesk display type, and flat saturated color blocks.** Buttons and cards
"press" into the page on interaction. Full light + dark mode support.

> See [`docs/themes.md`](../../../../docs/themes.md) for how the theme system
> works and how to author your own theme (inside UJM or in a consumer project).

## Use it

In your consuming project's `src/_config.yml`:

```yaml
theme:
  id: "neobrutalism"
  appearance: "light"   # or "dark" / "system"
```

That's it — every layout, nav, footer, and page is inherited from the shared
defaults (via the Classy layout fallback) and restyled in neobrutalist form.

## Customize it (without editing the theme)

All design tokens are `!default` variables. Override them **before** the theme
is imported — in your project's `src/assets/css/main.scss`, set the variables,
then `@use 'ultimate-jekyll-manager' as *;`:

```scss
// Change the accent + structure, then import the framework (which loads the theme)
$primary:           #FF5C00;   // your brand color
$nb-border-width:   4px;       // chunkier borders
$nb-shadow-offset:  7px;       // deeper hard shadow
$nb-accent-yellow:  #D4FF00;   // swap the signature highlight

@use 'ultimate-jekyll-manager' as *;
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

> Fonts are loaded via the theme's `head` block in the base layout. If you
> change the font tokens, update the Google Fonts `<link>` accordingly (in your
> page/layout `theme.head.content`, or by overriding the base layout).

## No theme-prefixed classes

This theme deliberately uses **NO `nb-` prefixed classes in markup** — so the same
HTML is swappable across themes (change `theme.id`, done). It styles:

- **Standard Bootstrap classes** wherever they fit: `.card` (the canonical container —
  gets the ink frame + hard shadow), `.btn` / `.btn-primary` / `.btn-warning` (yellow
  accent), `.text-bg-{primary,secondary,success,warning,…}` (the color-block fills),
  `.border`, `.shadow`, `.accordion`, `.badge`.
- **Universal semantic layout classes** for structures with no Bootstrap equivalent:
  `.section-hero`, `.hero-title`, `.action-block`, `.logo-strip`, `.showcase-row`,
  `.step-card`, `.stat-block`, `.cta-panel`, `.pricing-plan`, `.billing-toggle`,
  `.kicker`, `.highlight`. Any theme can style these same names. See
  [docs/themes.md → Universal layout classes](../../../../docs/themes.md).

The `nb-` prefix survives ONLY on SCSS internals (the `$nb-*` config tokens, `--nb-*`
CSS variables, and `@mixin nb-border/nb-shadow/nb-press`) — these never appear in HTML.

## Structure

```
neobrutalism/
├── _config.scss          ← all customizable tokens (!default) + Bootstrap forward
├── _theme.scss           ← entry point (config → mixins → root → base → layout → components → bootstrap overrides)
├── _theme.js             ← JS entry (Bootstrap UMD + behaviors on DOM ready)
├── css/
│   ├── base/
│   │   ├── _mixins.scss   ← nb-border / nb-shadow / nb-press (the SSOT for the look)
│   │   ├── _root.scss     ← SCSS → CSS-variable bridge (light/dark)
│   │   ├── _typography.scss
│   │   └── _utilities.scss
│   ├── layout/
│   │   ├── _general.scss  ← sections, hero, footer, gradient/accent overrides
│   │   └── _navigation.scss
│   └── components/
│       ├── _buttons.scss
│       ├── _cards.scss
│       └── _forms.scss
└── js/
    ├── navbar-scroll.js
    └── initialize-tooltips.js
```
