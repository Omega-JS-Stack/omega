# Themes

@omega.js/desktop ships the **classy** theme (built on Bootstrap 5) so consumer apps look polished out of the box. Variables are fully customizable via `@use 'omega-desktop' as * with (...)` — same pattern as UJM and BXM.

## How it works

@omega.js/desktop carries @omega.js/web's FULL theme tree in `<em>/dist/assets/themes/` — vendored from the resolved `@omega.js/web` devDependency at every prepare via the declared-assets channel (C4 cp104/cp109), never hand-copied:

| Theme | Base | Use case |
|---|---|---|
| `classy` (default) | Bootstrap 5.3 + OMEGA design system | Polished, modern app shell |
| `bootstrap` | Plain Bootstrap 5.3 | Minimal, vanilla Bootstrap |
| `neobrutalism` / `newsflash` | Bootstrap 5.3 | Alternate skins (universal `theme.id`) |

The active theme is selected via `config.theme.id` (default `'classy'`). The `gulp/sass` task adds `<em>/dist/assets/themes/<theme>` to its sass `loadPaths` so the bare `@use 'theme'` import inside `@omega.js/desktop.scss` resolves to the active theme.

## Consumer setup

Your `src/assets/scss/main.scss` becomes:

```scss
@use 'omega-desktop' as * with (
  $primary: #5B47FB,
  // $secondary: #6C757D,
  // $border-radius: 0.5rem,
);

// Custom global styles below...
main {
  padding: 2rem;
}
```

That single import gives you:
- Full Bootstrap 5 (utilities, components, grid, etc.)
- Classy theme overlays (typography, animations, refined spacing)
- @omega.js/desktop's `_initialize.scss` (desktop-specific defaults — full-window body, app-region drag classes)

## Per-page CSS

@omega.js/desktop compiles per-page bundles in addition to the shared `main.bundle.css`:

```
src/assets/scss/main.scss          → dist/assets/css/main.bundle.css            (every page)
src/assets/scss/pages/main.scss    → dist/assets/css/components/main.bundle.css       (main window only)
src/assets/scss/pages/settings.scss → dist/assets/css/components/settings.bundle.css   (settings window only)
src/assets/scss/pages/about.scss   → dist/assets/css/components/about.bundle.css      (about window only)
```

The page template auto-loads both: `main.bundle.css` is on every HTML page, and `components/<page.name>.bundle.css` is loaded only on its specific page. To add styles for a new page, drop a new file at `src/assets/scss/pages/<view>.scss` — it'll auto-compile and auto-inject.

Per-page bundles can themselves `@use 'omega-desktop' as *;` if they need access to theme variables. Just be aware this means re-emitting some shared CSS — for very small per-page tweaks, prefer plain selectors that ride on the shared `main.bundle.css`.

## Customizable variables

The full classy variable list lives at `<em>/dist/assets/themes/classy/_config.scss`. ~60 variables you can override via the `@use ... with ()` form:

**Colors:** `$primary`, `$secondary`, `$success`, `$info`, `$warning`, `$danger`, `$light`, `$dark`
**Backgrounds (light mode):** `$classy-bg-light`, `$classy-bg-light-secondary`, `$classy-bg-light-tertiary`
**Backgrounds (dark mode):** `$classy-bg-dark`, `$classy-bg-dark-secondary`, `$classy-bg-dark-tertiary`
**Typography:** `$font-family-sans-serif`, `$font-family-base`, `$headings-font-weight`, `$classy-font-mono`, `$classy-font-accent`
**Border radius:** `$border-radius`, `$border-radius-sm/lg/xl/2xl/pill`
**Spacing, transitions, shadows** — see `_config.scss`

## Switching themes

Set `config.theme.id` in `config/omega.json5`:

```jsonc
theme: {
  id:         'bootstrap',     // 'classy' (default) | 'bootstrap'
  appearance: 'system',        // 'system' (default) | 'light' | 'dark'
}
```

## Appearance (light / dark / system) — `manager.theme`

@omega.js/desktop owns appearance at runtime. `config.theme.appearance` is only the **app default**; the resolved appearance is applied and kept live by the theme lib:

- **`'system'` (default)** follows the OS preference **live** — when the OS flips, every page updates without a reload or restart.
- **`'light'` / `'dark'`** are explicit overrides.
- A user's runtime choice (`manager.theme.set(...)`) is **persisted in `manager.storage`** (`theme.appearance`) and wins over the config default on every boot.

### How it propagates

Everything rides on Electron's `nativeTheme.themeSource` (same three values). Setting it flips `prefers-color-scheme` in **every renderer of the app — BrowserWindows AND embedded WebContentsViews** — and @omega.js/desktop's preload applier listens via `matchMedia` and rewrites `<html data-bs-theme>` to the **resolved** value (`'light'`/`'dark'`) live. No IPC fan-out, no per-window wiring; native UI (menus, dialogs) follows too.

The applier is **opt-in by presence**: it only manages pages whose `<html>` already carries `data-bs-theme` (stamped by the page template at build). External sites loaded in a consumer's embedded web views get the same preload but are never touched.

### API

```js
// Main
manager.theme.get();          // 'system' | 'light' | 'dark'  (the chosen source)
manager.theme.resolved();     // 'light' | 'dark'             (what's showing)
manager.theme.set('dark');    // apply + persist (throws on invalid values)
const unsub = manager.theme.onChange(({ source, resolved }) => { ... });

// Renderer (any page with the @omega.js/desktop preload)
await window.em.theme.get();        // { source, resolved }
await window.em.theme.set('dark');  // → { source, resolved }
const unsub = window.em.theme.onChange(({ resolved }) => { ... }); // matchMedia-powered
```

Main also broadcasts `desktop:theme:changed { source, resolved }` to BrowserWindows as a courtesy — but renderers should rely on `onChange`/matchMedia, which works in every context.

### Declarative controls

Any element with `data-em-theme-set` becomes a theme switch (wired by the renderer Manager's initialize — event-delegated, so late-rendered controls work):

```html
<button data-em-theme-set="light">Day</button>
<button data-em-theme-set="dark">Dusk</button>
<button data-em-theme-set="system">Auto</button>
```

### Build-time stamp

`data-bs-theme="{{ theme.appearance }}"` is still stamped into every page at build. For `'light'`/`'dark'` the stamp is already correct; `'system'` stamps an inert value that the preload applier replaces with the resolved appearance at `DOMContentLoaded` (Bootstrap treats unknown values as light for the instant before that).

## Where the themes live

The SSOT is **`@omega.js/web/themes/`** — one theme tree for web, desktop, and extension (C4 cp109: the classy triplication is dead). @omega.js/desktop declares `omega.vendorAssets` in its package.json, and every `prepare-package` run copies the resolved web package's `themes/` into `<em>/dist/assets/themes/`. Consumers import via the sass `loadPaths` mechanism — **nothing is ever copied into the consumer's tree**. Desktop-specific theme bits (the `.em-titlebar` component, the `$min-contrast-ratio` knob) were upstreamed INTO the shared classy rather than kept as a fork.

## Updating themes

A theme change lands once in `packages/web/themes/` and rides into desktop + extension on their next prepare. There is no sync step and no version skew — dist is rebuilt from the resolved web package every time. (A standalone `@omega.js/themes` package was considered and rejected for now: the vendor channel gives one-source semantics without another publishable surface.)

## Gotchas

### Sass `@import` deprecation warnings
Classy's `_theme.scss` uses `@import` (Sass's legacy module system) for its own internal layout. You'll see a deprecation warning during compile. UJM has the same warning. Functional today; will be migrated when classy upgrades to fully-modular `@use`/`@forward`.

### Per-page CSS bundles are 0 bytes by default
Empty `pages/<name>.scss` produces empty bundles. That's fine — the page template still loads them, the browser just gets a 200 with no rules. Adding any selector populates it.
