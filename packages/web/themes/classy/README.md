# Classy Theme Customization Guide

Classy is a skin over the base layer: structural markup (layouts, sections, includes, components) lives in `themes/base` with the `omega-*` vocabulary, and this theme styles those selectors (css, fonts, `_theme.js`, `_config.scss`).

## How to Customize in Your Consuming Project

The Classy theme is designed to be fully customizable. All theme variables use `!default` which means you can override them BEFORE the theme is imported.

> **How the import actually resolves:** Your project's `src/assets/css/main.scss`
> does `@use 'omega:main' with (…);`. That entry point `@forward`s the
> theme, and the framework's SASS `loadPaths` resolve the theme to whichever
> `src/assets/themes/<theme.id>/_theme.scss` wins — your project's copy first,
> then the packaged copy. You never import the theme file by path directly.
> See [`docs/shared/theming.md`](../../../../docs/shared/theming.md) for the full mechanism.

### Example: Customizing Colors in Your Project

In your consuming project's `src/assets/css/main.scss`:

```scss
// 1. Import the framework, configuring Classy's !default variables — the
//    theme loads with YOUR values
@use 'omega:main' with (
  $primary: #FF0000,          // Change primary color to red
  $classy-bg-light: #F5F5F5,  // Change light mode background
  $classy-bg-dark: #1A1A1A,   // Change dark mode background
  $font-family-sans-serif: ('Inter', sans-serif),  // Change font
);

// 2. Add your custom styles below
.my-custom-class {
  // Your custom CSS
}
```

To customize beyond variables — change actual component styles or markup —
**shadow the theme**: create `src/assets/themes/classy/` in your project. The
framework's loadPaths resolve your copy before the packaged one. (To build a wholly new
look, author a new theme instead — see `docs/shared/theming.md`.)

## Available Customizable Variables

See `_config.scss` for the full list of variables you can override:

### Bootstrap Colors
- `$primary` - Primary brand color
- `$secondary` - Secondary color
- `$success`, `$info`, `$warning`, `$danger` - Utility colors
- `$light`, `$dark` - Light and dark variants

### Background Colors
- `$classy-bg-light` - Light mode background
- `$classy-bg-dark` - Dark mode background

### Typography
- `$font-family-sans-serif` - Main font family
- `$headings-font-weight` - Heading font weight

### Border Radius
- `$border-radius` - Default border radius
- `$border-radius-sm`, `$border-radius-lg` - Size variants

### Gradients
- `$classy-gradient-primary`, `$classy-gradient-aurora`, etc.

## File Structure

```
classy/
├── _config.scss       ← All customizable variables with !default
├── _theme.scss        ← Main entry point, imports config then Bootstrap
├── css/base/
│   ├── _variables.scss  ← Internal non-customizable values
│   └── _root.scss       ← CSS custom property overrides
└── ...
```

## How It Works

1. **`_config.scss`**: Defines all variables with `!default` (can be overridden)
2. **Your `main.scss`**: Sets custom values BEFORE importing theme
3. **`_theme.scss`**: Imports config (uses your values or defaults), then Bootstrap
4. **`_root.scss`**: Converts SCSS variables to CSS custom properties for runtime

This ensures:
- ✅ You can customize anything
- ✅ Bootstrap gets configured with your colors
- ✅ CSS custom properties update for light/dark mode
- ✅ No need to modify theme files
