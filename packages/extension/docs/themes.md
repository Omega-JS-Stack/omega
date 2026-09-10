# Themes

@omega.js/extension ships two themes plus a template for new ones. Themes vendor their own SCSS + JS + Bootstrap-compatible variable system.

## Available themes

| Theme | Source | What it provides |
|---|---|---|
| `bootstrap` | `dist/assets/themes/bootstrap/` (vendored from @omega.js/web) | Pure Bootstrap 5.3+. Use when you want unopinionated Bootstrap. |
| `classy` | `dist/assets/themes/classy/` (vendored from @omega.js/web) | Bootstrap 5 + custom design system (colors, typography, components). The "branded" theme. |
| `_template` | `dist/assets/themes/_template/` (vendored from @omega.js/web) | Template for creating new themes. Underscore prefix excludes it from production builds. |

## Activating a theme

Set in `config/omega.json5`:

```jsonc
{
  theme: {
    id: 'classy',         // 'bootstrap' | 'classy' | '<your-theme>'
    appearance: 'dark',   // 'dark' | 'light' (optional — drives {{ theme.appearance }})
  },
}
```

The bundler's `__theme__` alias resolves to the package's `dist/assets/themes/<id>/` so consumer JS can do `import '__theme__/_theme.js'` and get the right theme's entry point. SCSS gets the same via the `theme` load-path entry (see [css.md](css.md)).

### theme.id is shared; the theme SET is per-framework

`theme.id` is a shared omega.json5 key, but each framework ships its own themes — a brand whose WEBSITE theme is a consumer-local id has nothing under the extension's `dist/assets/themes/<id>/`. Both resolve sites (the sass load path and the bundler's `__theme__`) go through [src/lib/theme.js](../src/lib/theme.js): an id this framework doesn't ship falls back to `classy` with ONE warning naming `theme.id`, the unknown value, and the extension's valid themes — never a raw sass `Can't find stylesheet to import` ([#261](https://github.com/Omega-JS-Stack/omega/issues/261)). Give the extension its own theme without touching the brand's:

```jsonc
{
  targets: {
    extension: { theme: { id: 'classy' } },
  },
}
```

## Theme structure

```
dist/assets/themes/<theme-id>/   (vendored — the SSOT is @omega.js/web/themes/)
├── _config.scss      # Theme variables (with !default so consumers can override)
├── _theme.scss       # Theme entry — @forward + @use
├── scss/             # Theme-specific SCSS (components, utilities)
└── js/               # Theme-specific JS (e.g. Bootstrap's modal/popper init)
└── _theme.js         # Theme JS entry (exposes Bootstrap globals to window.bootstrap)
```

## Creating a new theme

1. Copy `_template/` into your CONSUMER project's theme dir (or add the theme to @omega.js/web's `themes/` — the one tree every target vendors)
2. Rename the directory (remove the `_` prefix — that's only for the template).
3. Customize `_config.scss` — variables like `$primary`, `$font-family-base`, etc.
4. Add theme-specific styles under `scss/`.
5. Update `_theme.scss` to forward your overrides.
6. Activate via `config/omega.json5` → `theme.id: 'my-theme'`.

## Overriding theme variables

In a consumer's `src/assets/css/main.scss`:

```scss
// Override before @use to take effect
@use 'omega-extension' as * with (
  $primary: #2563EB,
  $secondary: #FFA500,
);
@use 'theme' as *;
```

`!default` flags on theme variables let `with (...)` overrides win.

## `{{ theme.appearance }}`

If `config.theme.appearance === 'dark'`, the HTML page template adds `class="dark"` (or `data-bs-theme="dark"`, depending on theme) to `<html>`. Theme SCSS can then key off `:root.dark` / `[data-bs-theme="dark"]` for dark-mode variants.

Consumer views can use `{{ theme.appearance }}` in their HTML to apply per-page tweaks. See [templating.md](templating.md).

## Why not Tailwind?

Themes are SCSS-first because @omega.js/extension's roots are Bootstrap-based and most @omega.js/extension consumers already use Bootstrap-style class names (`.btn`, `.card`, `.modal`). Tailwind requires a build step (PostCSS + content scanning) that would complicate the lean gulp pipeline. If a future theme wants Tailwind, add it to @omega.js/web's `themes/` and wire its own build hook.

## See also

- [css.md](css.md) — SCSS load paths and component overrides
- [components.md](components.md) — component view + styles + script structure
- [build-system.md](build-system.md) — sass/esbuild pipeline
