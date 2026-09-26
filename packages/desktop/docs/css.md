# CSS Architecture

@omega.js/desktop styles are SCSS, compiled by the pipeline's `sass` task into per-window bundles on top of a shared base. Bootstrap 5 (via @omega.js/desktop's classy theme) is the foundation — consumers restyle Bootstrap, they don't replace it.

## Main entry

`<consumer>/src/assets/scss/main.scss` — loaded by EVERY window. It configures the theme via `@use ... with (...)`:

```scss
// Generated from `brand.color` by the sass task (#912).
@use 'brand';

@use 'omega-desktop' as * with (
  $primary: brand.$primary,
  $dark: #1a1a2e,
  $classy-bg-dark: #0f0f1a,
  $classy-bg-dark-secondary: #161628,
  $classy-bg-dark-tertiary: #1e1e38,
);

// The runtime --omega-accent ramp, after the framework import.
@include brand.ramp;

// Custom global styles below
```

Compiles to `dist/assets/css/main.bundle.css` (Bootstrap + classy theme + your globals).

## Per-window styles

`src/assets/scss/pages/<window>.scss` → `dist/assets/css/components/<window>.bundle.css`, loaded ONLY on that window's page. One file per window (`main.scss`, `settings.scss`, …) — page-specific chrome lives here, shared styles live in the main entry.

## Theme integration

The `@use 'omega-desktop'` entry pulls in Bootstrap 5 + @omega.js/desktop's classy theme. Appearance (`system`/`light`/`dark`) defaults from `config.theme.appearance` and is applied + kept live on `<html data-bs-theme>` by `omega.theme` (OS-following, runtime-switchable, persisted override, see [themes.md](themes.md)). Theme variables (`$primary`, `$dark`, `$classy-bg-*`, typography, borders) are overridable via the `with (...)` block, and `$primary` arrives from `brand.color` through the generated `dist/assets/scss/_brand.scss` unless a literal replaces `brand.$primary` ([#912](https://github.com/Omega-JS-Stack/omega/issues/912)). See [themes.md](themes.md) for the full variable reference.

## Icon presentation

Icon CSS is ONE sheet for every omega target, vendored from @omega.js/web at prepare (package.json `omega.vendorAssets` → `dist/assets/css/core/_fontawesome.scss`) and loaded by the `omega-desktop` entry. It ships the square glyph-centered box every rendered `<i>` gets, the `fa-2xs`…`fa-6xl` size scale, and the `fa-spin` / `fa-bounce` / `fa-beat` utilities (each parked under `prefers-reduced-motion`). Nothing to import and nothing to hand-fix. See [shared/icons.md](shared/icons.md).

## App shell

Dashboard/admin windows use the `.omega-shell` layout — a sidebar + topbar + main grid with a collapsible desktop rail and a mobile drawer. Two layers ship, both vendored from @omega.js/web at prepare: the MECHANICS (`dist/assets/css/shell/_index.scss` — the grid, region geometry, states, and the `--omega-shell-*` tokens, loaded by the `omega-desktop` entry before the theme) and the theme's SKIN (`dist/assets/themes/<theme-id>/css/layout/_shell.scss`, layered over it). Nothing to import — `@use 'omega-desktop'` gets both.

Emit this markup in the window's HTML:

```html
<div class="omega-shell" data-omega-shell>
  <aside class="omega-shell__sidebar" id="app-sidebar">
    <!-- pinned head (brand, selector) sits here, outside the scroll region -->
    <div class="omega-shell__sidebar-scroll">
      <!-- nav scrolls HERE (the rail itself clips nothing, so popovers can
           escape); text that should hide in the collapsed rail wears
           .omega-shell__label -->
    </div>
  </aside>

  <header class="omega-shell__topbar">
    <div class="omega-shell__topbar-start">
      <button data-shell-toggle="drawer" aria-expanded="false" aria-controls="app-sidebar">☰</button>
      <button data-shell-toggle="collapse" aria-expanded="true" aria-controls="app-sidebar">⇤</button>
    </div>
    <div class="omega-shell__topbar-end"><!-- account menu, actions --></div>
  </header>

  <main class="omega-shell__main"><!-- page content --></main>

  <div class="omega-shell__scrim" data-shell-dismiss></div>
</div>
```

The renderer instance wires the behavior during `omega.initialize()` (the vendored `__main_assets__/js/core/app-shell.js`, the same module @omega.js/web runs), so a view that renders the markup needs no script of its own. The API is `omega.shell` (`isCollapsed`, `isOpen`, `setCollapsed`, `setOpen`, `toggleCollapsed`, `toggleOpen`).

The module is delegated and declarative: `[data-shell-toggle="collapse"]` toggles the rail, `[data-shell-toggle="drawer"]` toggles the mobile drawer, `[data-shell-dismiss]` (and Escape) closes it. It stamps the state on the container: `data-shell-collapsed="true"` (persisted under the `shell.collapsed` storage key) and `data-shell-open="true"`, which is what the CSS keys off. Add `.omega-shell--locked` when `main` should never scroll (the page manages its own interior scroll).

## Bootstrap-first convention

NEVER create custom classes for things Bootstrap already provides — use `btn`, `card`, `form-*`, `d-flex`, `gap-*`, `rounded-*`, `bg-body-*`, `text-*` natively, and use `bg-body` variants (not `bg-light`/`bg-dark`) so dark mode adapts. Theme SCSS overrides how Bootstrap components LOOK; custom CSS is only for genuinely novel components with no Bootstrap equivalent. Same rule in BXM and UJM.

## See also

- [themes.md](themes.md) — theme variables, appearance modes
- [build-system.md](build-system.md) — where the `sass` task runs in the pipeline
- [templating.md](templating.md) — the page template that loads the bundles
