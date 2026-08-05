# Theme Template

A minimal, copy-paste starting point for a **brand-new @omega.js/web theme** —
whether you're adding one inside this package (`themes/<id>/`) or creating one
in your own consumer project (`<project>/themes/<id>/` — the consumer-local
copy beats the packaged one with the same id).

> The design-system contract (tokens, motion, brand ramps, the classy
> vocabulary): [`docs/shared/theming.md`](../../../../docs/shared/theming.md).

## Create a theme from this template

1. **Copy this folder** to your theme id (the `_` prefix excludes this template
   from selection, so rename it):
   - Inside the package: `themes/my-theme/`
   - In a consumer: `<project>/themes/my-theme/`
2. **Select it** in `omega.json5`:
   ```json5
   theme: {
     id: "my-theme",
   }
   ```
3. **Customize** `_config.scss` (tokens), `css/` (styles), and `_theme.js`
   (behaviors). Restyle Bootstrap's own classes (`.btn`, `.card`, `.navbar`,
   `.form-control`) so the shared layouts pick up your look with no HTML edits.
4. **Layouts, includes, and section JSON are inherited automatically — zero
   copies.** The engine resolves every file through a layered union
   (consumer → your theme → classy → core), so all ~40 page layouts render
   without you owning a single one. Override a layout only when its *markup*
   (not just CSS) must differ — create the same path inside your theme
   (`themes/my-theme/_layouts/frontend/pages/<page>.html`) and yours wins.

## The CSS boundary (read this before shipping a partial theme)

Unlike layouts/includes, the MAIN stylesheet does **not** fall through:
exactly one `_theme.scss` loads — yours. The shared layouts you inherit emit
classy's `omega-*` content vocabulary (nav, footer, marketing sections,
auth/form panels — see `docs/shared/theming.md`), so a theme that doesn't restyle
that vocabulary renders those pages structurally intact but unstyled beyond
Bootstrap + core tokens/shell/motion. Budget for it: restyle the vocabulary
namespaces you keep, or override the layouts whose markup you replace.

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

## Principles (the contract lives in docs/shared/theming.md)

- **Tokens are `!default`** so consumers can override without forking your theme.
- **Bridge to CSS variables** in `_root.scss` — the `--omega-*` token names are
  the stable API; light + dark ship together.
- **Don't duplicate the shared layers** — core tokens/shell/motion CSS and
  `bootstrap/overrides` are in every build already.
- **Namespace your own components** (`.mytheme-*`) to avoid collisions;
  runtime-stamped classes must live in the `omega-` namespace (PurgeCSS
  safelist).
