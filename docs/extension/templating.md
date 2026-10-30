# Templating

HTML views go through a two-step `{{ }}` token replacement during the `gulp/html` task, rendered by the extension's one token renderer ([src/gulp/lib/tokens.js](../../packages/extension/src/gulp/lib/tokens.js)), the same one the package task renders the manifest and the store descriptions with.

`src/manifest.json` speaks the same `{{ }}` syntax, resolved against the whole `config/omega.json5` when the package task compiles it (`matches: ['{{ brand.url }}/*']`), and an unresolved one fails the build: [build-system.md](build-system.md#manifest-compilation-rules).

## How it works

1. Your view file (`src/views/<component>/index.html`) is templated first — `{{ brand.name }}` etc. resolve against the page-vars object.
2. The result is injected into [src/config/page-template.html](../../packages/extension/src/config/page-template.html) (the framework's outer HTML shell).
3. The outer template is processed again with the same vars.
4. Output written to `dist/views/<component>/index.html`.

A token nothing resolves (a typo, a variable the table below does not carry) fails the build instead of shipping literally: the html task stops naming the file and the token, `Cannot build src/views/popup/index.html: unresolved token(s) {{ missing }}`.

## Available variables

| Token | Source | Example |
|---|---|---|
| `{{ brand.name }}` | `config/omega.json5` → `brand.name` | `Tabblar` |
| `{{ brand.url }}` | `config/omega.json5` → `brand.url` | `https://tabblar.com` |
| `{{ brand.id }}` | `config/omega.json5` → `brand.id` | `tabblar` |
| `{{ page.name }}` | Component name (e.g. `popup`, `pages/dashboard`) | `popup` |
| `{{ page.path }}` | The view's path under `src/views/`, without `.html` | `popup/index` |
| `{{ page.title }}` | Page title: the brand name, `Extension` without one | `Tabblar` |
| `{{ theme.appearance }}` | `config/omega.json5` → `theme.appearance`, `dark` by default | `dark` |
| `{{ cacheBust }}` | Cache-busting timestamp (build time, ms) | `1715568000000` |

Every key of `brand` resolves the same way (`{{ brand.<key> }}`). Nothing else is in scope: the package version and the environment are not page variables.

## Example usage

```html
<!-- src/views/popup/index.html: body content, wrapped by the page template -->
<h1>Welcome to {{ brand.name }}</h1>
<a href="{{ brand.url }}/pricing?ref=ext">Upgrade to Premium</a>
```

## Page template

[src/config/page-template.html](../../packages/extension/src/config/page-template.html) is the outer shell that wraps every view. It contains:
- `<!doctype html>` + `<html>` boilerplate
- `<meta>` tags (viewport, charset)
- A `{{ content }}` slot where the per-component HTML is injected
- `<link rel="stylesheet">` for the component's `.bundle.css`
- `<script>` for the component's `.bundle.js`
- Cache-busting query params via `{{ cacheBust }}`

Consumers don't author this: @omega.js/extension owns it, and every view is wrapped in it. A view file is the body content only.

## Customizing page vars

The page-vars object is built inline in `processHtml()` in [src/gulp/tasks/html.js](../../packages/extension/src/gulp/tasks/html.js). A variable added there is available in BOTH the view file AND the outer page-template.html.

## Why two passes?

Pass 1 lets a view interpolate something into the outer template. For example, a view can do `<!-- omega:page-title --> Custom Title <!-- /omega:page-title -->` (a future feature) and have the value flow into `{{ page.title }}` for the outer template's `<title>`. The pattern keeps simple cases simple (`{{ brand.name }}` Just Works) while leaving room for view → shell metadata flow.

## See also

- [build-system.md](build-system.md) — gulp pipeline including the html task
- [css.md](css.md) — how the page template references compiled CSS bundles
- [themes.md](themes.md) — `{{ theme.appearance }}` derivation
