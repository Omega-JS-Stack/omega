# CSS Architecture

SCSS-based, theme-pluggable, with a load-path system that lets consumer SCSS reference framework + theme styles via short names (`@use 'omega-extension'`, `@use 'theme'`).

## Main entry

[src/assets/css/@omega.js/extension.scss](../src/assets/css/@omega.js/extension.scss) is the framework's CSS entry point. Consumers `@use` it to get framework defaults + utilities + theme.

## Core modules

| Module | Source |
|---|---|
| `core/_initialize.scss` | Base resets (box-sizing, body defaults) |
| `core/_utilities.scss` | Utility classes (`.shadow-lg`, `.text-truncate`, spacing, color, etc.) |
| `core/_animations.scss` | Keyframe animations + transition mixins |
| `core/_fontawesome.scss` | Icon presentation: the square glyph-centered box, the `fa-2xs`…`fa-6xl` size scale, `fa-spin`/`fa-bounce`/`fa-beat`. Vendored VERBATIM from @omega.js/web at prepare (package.json `omega.vendorAssets`), never hand-edited here. See [shared/icons.md](shared/icons.md) |

## Per-component styles

Each component can have framework defaults in `src/assets/css/components/<name>/index.scss`. These define the FRAMEWORK'S default look — e.g. `src/assets/css/components/popup/index.scss` defines popup-specific layout that ALL @omega.js/extension extensions inherit unless they override.

Consumer extensions add their OWN per-component overrides in `src/assets/css/components/<name>/index.scss` (in the consumer project, not the framework).

## Load-path resolution

The SCSS load path is set up by [src/gulp/tasks/sass.js](../src/gulp/tasks/sass.js) with this search order:

1. **Framework CSS** — `node_modules/@omega.js/extension/dist/assets/css`
2. **Active theme** — `node_modules/@omega.js/extension/dist/assets/themes/<theme-id>`
3. **Project dist** — `<consumer>/dist/assets/css`
4. **node_modules** — for npm-installed SCSS packages

So this just works in a consumer's `src/assets/css/main.scss`:

```scss
// 1. Resolves to @omega.js/extension's main entry — sets up Bootstrap, utilities, etc.
@use 'omega-extension' as * with (
  $primary: #2563EB,
);

// 2. Resolves to the active theme's _theme.scss
@use 'theme' as *;

// 3. Resolves to @omega.js/extension's bundled popup defaults
@use 'components/popup' as *;

// 4. Resolves to npm-installed CSS package
@use 'pkg:bootstrap-icons' as *;

// Consumer-authored overrides come last
.my-custom-rule { color: $primary; }
```

## Component bundle output

Each component context gets a CSS bundle:

- `src/assets/css/components/<component>/index.scss` → `dist/assets/css/components/<component>.bundle.css`

The HTML pipeline auto-injects `<link rel="stylesheet" href="../assets/css/components/<component>.bundle.css">` into each view via the page template.

## Theme integration

Theme SCSS is vendored from @omega.js/web's `themes/` tree into `dist/assets/themes/<theme-id>/` at prepare (C4 cp109 — one theme tree for web/desktop/extension). The load path resolves `@use 'theme'` to the active theme — flip `config.theme.id` to switch themes without code changes. See [themes.md](themes.md).

## App shell

Dashboard-style views (options, side panel, extension pages) use the `.omega-shell` layout — a sidebar + topbar + main grid with a collapsible desktop rail and a mobile drawer. Two layers ship, both vendored from @omega.js/web at prepare: the MECHANICS (`dist/assets/css/shell/_index.scss` — the grid, region geometry, states, and the `--omega-shell-*` tokens, loaded by the `omega-extension` entry before the theme) and the theme's SKIN (`dist/assets/themes/<theme-id>/css/layout/_shell.scss`, layered over it). Nothing to import — `@use 'omega-extension'` gets both.

Emit this markup in the view's HTML:

```html
<div class="omega-shell" data-omega-shell>
  <aside class="omega-shell__sidebar" id="app-sidebar">
    <!-- nav; text that should hide in the collapsed rail wears .omega-shell__label -->
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

Wire the behavior from the view's script (`src/assets/js/components/<component>/index.js`) — `__main_assets__` is the build alias for @omega.js/extension's vendored core assets:

```js
import appShell from '__main_assets__/js/core/app-shell.js';

appShell();
```

The module is delegated and declarative: `[data-shell-toggle="collapse"]` toggles the rail, `[data-shell-toggle="drawer"]` toggles the mobile drawer, `[data-shell-dismiss]` (and Escape) closes it. It stamps the state on the container — `data-shell-collapsed="true"` (persisted under the `shell.collapsed` storage key) and `data-shell-open="true"` — which is what the CSS keys off; the API is also registered at `omega._library.appShell`. Add `.omega-shell--locked` when `main` should never scroll (the view manages its own interior scroll).

## Adding a utility class

[src/assets/css/core/_utilities.scss](../src/assets/css/core/_utilities.scss):

```scss
.shadow-lg {
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}
```

After adding, run `npm run prepare` in @omega.js/extension (or `npm start` in the consumer) and the new utility is available framework-wide.

## Why this load-path system

Without it, every consumer SCSS file would need:

```scss
@use '../../../../node_modules/@omega.js/extension/dist/assets/css/@omega.js/extension' as *;
```

Brittle, ugly, breaks with hoisted/non-hoisted npm installs. The load-path lets `@use 'omega-extension'` work regardless of where @omega.js/extension is installed. Same pattern UJM uses for Jekyll themes.

## See also

- [themes.md](themes.md) — theme system that the load path resolves
- [components.md](components.md) — three-part component structure (view + styles + script)
- [build-system.md](build-system.md) — gulp/sass task details
