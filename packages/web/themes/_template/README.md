# Theme Template

A minimal, copy-paste starting point for a **brand-new UJM theme** — whether
you're adding one inside UJM (`src/assets/themes/<id>/`) or creating one in your
own consumer project (`<project>/src/assets/themes/<id>/`).

> Full guide: [`docs/themes.md`](../../../../docs/themes.md).

## Create a theme from this template

1. **Copy this folder** to your theme id (the `_` prefix excludes this template
   from selection, so rename it):
   - Inside UJM: `src/assets/themes/my-theme/`
   - In a consumer: `<project>/src/assets/themes/my-theme/`
2. **Select it** in your consumer's `src/_config.yml`:
   ```yaml
   theme:
     id: "my-theme"
   ```
3. **Customize** `_config.scss` (tokens), `css/` (styles), and `_theme.js`
   (behaviors). Restyle Bootstrap's own classes (`.btn`, `.card`, `.navbar`,
   `.form-control`) so the shared layouts pick up your look with no HTML edits.
4. **Layouts/includes are inherited automatically.** You do NOT need to copy the
   ~40 page layouts — UJM's build copies any missing layout/include from the
   `classy` theme and rewrites the paths to your theme id. Override a layout only
   when its *markup* (not just CSS) must differ — create
   `src/defaults/dist/_layouts/themes/my-theme/<path>` (in UJM) or
   `src/_layouts/themes/my-theme/<path>` (in a consumer) for just that file.
   A common one: override `frontend/core/base.html` to load your theme's fonts.

## What's here

```
_template/
├── _config.scss              ← design tokens (!default) + Bootstrap forward
├── _theme.scss               ← SCSS entry (config → root → styles → bootstrap overrides)
├── _theme.js                 ← JS entry (Bootstrap UMD + DOM-ready behaviors)
├── README.md                 ← this file
└── css/
    ├── base/_root.scss        ← SCSS → CSS-variable bridge (light/dark)
    └── components/_components.scss  ← restyle Bootstrap classes here
```

## Principles (see docs/themes.md for the full list)

- **Tokens are `!default`** so consumers can override without forking your theme.
- **Bridge to CSS variables** in `_root.scss` for free dark-mode switching.
- **Don't duplicate the shared layers** — `core/` CSS (animations, alerts, lazy
  loading) and `bootstrap/overrides` are injected for every theme already.
- **Namespace your own components** (`.mytheme-*`) to avoid collisions.
