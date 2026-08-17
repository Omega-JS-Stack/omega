# Theme Template

A minimal, copy-paste starting point for a **brand-new @omega.js/web theme** —
whether you're adding one inside this package (`themes/<id>/`) or creating one
in your own consumer project (`src/themes/<id>/`, under the Eleventy INPUT dir
— the consumer-local copy beats the packaged one with the same id). A copy
works as-is in either place; "Consumer themes" below has the one caveat and
the lighter alternative.

> The design-system contract (tokens, motion, brand ramps, the classy
> vocabulary): [`docs/shared/theming.md`](../../../../docs/shared/theming.md).

## Create a theme from this template

1. **Copy this folder** to your theme id (the `_` prefix excludes this template
   from selection, so rename it):
   - Inside the package: `themes/my-theme/`
   - In a consumer: `src/themes/my-theme/`
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
   (`<your-theme>/_layouts/frontend/pages/<page>.html`) and yours wins.

## The CSS boundary (read this before shipping a partial theme)

Unlike layouts/includes, the MAIN stylesheet does **not** fall through:
exactly one `_theme.scss` loads — yours. The shared layouts you inherit emit
classy's `omega-*` content vocabulary (nav, footer, marketing sections,
auth/form panels — see `docs/shared/theming.md`), so a theme that doesn't restyle
that vocabulary renders those pages structurally intact but unstyled beyond
Bootstrap + core tokens/shell/motion. Budget for it: restyle the vocabulary
namespaces you keep, or override the layouts whose markup you replace.

## Consumer themes: sibling resolution, and the lighter partial route

This template is a **full sibling theme** — its `_config.scss` forwards
`../bootstrap/scss/bootstrap.scss` (its own Bootstrap) and its `_theme.scss`
imports classy's token-pure floor partials and `../bootstrap/overrides`. Copied
verbatim into `src/themes/my-theme/`, **it compiles**. A relative `@use`/
`@import` is tried against the importing file first — `src/themes/bootstrap/`,
`src/themes/classy/`, which don't exist — and then against the build's sass
`loadPaths`, which include every LAYER root. The last theme layer is always
`themes/base`, base normally resolves to the PACKAGED one, and packaged base
sits *inside* the packaged themes root — so `themes/base/../bootstrap/…` and
`themes/base/../classy/…` land on the real files. Your copy builds with its own
Bootstrap, the classy floor, and your own rules last.

**The one thing that breaks it: shipping your own `src/themes/base/`.** The
theme chain resolves consumer-local-first for *every* id, base included — so
your base shadows the packaged one, the packaged themes root drops out of the
loadPaths, and every `../bootstrap/…` / `../classy/…` import fails the build
("Can't find stylesheet to import"). Own the base layer only if nothing in
your theme reaches a packaged sibling through `../`.

The **partial theme** is the smaller route, and the one to prefer unless you
genuinely need your own Bootstrap config: it rides the packaged chain through
the inheritance hatch instead of shipping a second Bootstrap. After copying,
make it one —

1. Put the hatch on the FIRST line of `_theme.scss`, and pass your tokens
   through it (`themes/classy/_config.scss` names every `!default` knob):
   ```scss
   @forward 'omega:theme' with ($primary: #d6336c, $border-radius: .75rem);
   ```
2. Drop the `@forward '../bootstrap/scss/bootstrap.scss' with (…)` clause from
   `_config.scss` (keep the file for your own sass variables), and drop the
   `../classy/*` and `../bootstrap/overrides` imports from `_theme.scss` — the
   hatch emits that whole configured chain, and your rules land after it so
   they win the cascade.
3. Drop `@forward 'config';` from `_theme.scss` too — keep the
   `@use 'config' as *;` beneath it. The hatch already re-exports `$primary`,
   `$font-family-sans-serif` and friends; re-forwarding your own `!default`
   copies of those names is the
   sass error *"Two forwarded modules both define a variable named $primary"*.
   `_config.scss` stays a plain sass-variable module for your own partials
   (`_root.scss` reads it); anything you want **Bootstrap** to see goes in the
   hatch's `with (…)` clause instead.

Both lanes, and which one a theme is on: `docs/shared/theming.md`
§ "CSS fall-through — the two lanes".

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
