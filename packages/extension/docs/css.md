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
