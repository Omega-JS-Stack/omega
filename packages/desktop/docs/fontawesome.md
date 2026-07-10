# FontAwesome

@omega.js/desktop ships the **Font Awesome Pro icon library** (solid + brands, SVG) inside the
framework — every consumer gets the full icon set with **zero setup**, fully
offline, no icon font, no CDN.

```html
<button class="btn btn-primary">
  <i class="fa-solid fa-rocket me-2"></i>Launch
</button>
```

That's it. Any `<i>` element carrying `fa-*` classes — in static HTML or
inserted dynamically at any time — gets the real SVG injected inline by the
renderer bootstrap. No `initialize()` options, no imports.

## How it works

- **Assets** — `assets/icons/font-awesome/{solid,brands}/*.svg` ship inside the
  @omega.js/desktop package (Font Awesome Pro 7.x — 4,700+ solid, 600+ brand icons, including
  the classic alias filenames like `search.svg` → `magnifying-glass`). They ride
  into packaged apps automatically (@omega.js/desktop's `dist/` lives in the consumer's asar).
- **Main lib** (`lib/fontawesome.js`) — `manager.fontawesome.get(name, style)`
  resolves an icon to its SVG string (`null` for unknown names — never throws).
  Lookups are slug-sanitized (the IPC channel can never read outside the icon
  directories) and cached per app run. Serves renderers over
  `desktop:fontawesome:get`.
- **Preload bridge** — `window.em.fontawesome.get(name, style)` →
  `Promise<svg | null>`.
- **Renderer auto-render** (`renderer.js _wireFontAwesome`) — scans for
  `i[class*="fa-"]` at init and watches the DOM via MutationObserver. The style
  comes from `fa-solid` (default) / `fa-brands`; the icon name is the first
  `fa-*` class that isn't a known modifier (`fa-fw`, `fa-2x`, `fa-spin`, …).
  The SVG is injected as a child of the `<i>`, sized `1em`/`currentColor` — it
  inherits text color and scales with font-size (bump it via `font-size` or a
  `fs-*` utility). Served SVGs also carry `overflow="visible"` (FA-kit parity:
  `.svg-inline--fa { overflow: visible }`) — FA Pro 7 glyphs may draw OUTSIDE
  their viewBox (fa-lock's shackle peaks at y=-32 in a `0 0 384 512` box) and
  the SVG-root default of `overflow: hidden` clips them flat.

## Minimal surfaces

The auto-render is wired by `initialize()`. A renderer that deliberately skips
the full init (no @omega.js/client / auth — e.g. a lightweight popover overlay) can
enable JUST the icon pipeline:

```js
new (require('@omega.js/desktop/renderer'))().enableFontAwesome();
```

## Notes

- **Unknown names render nothing** — the `<i>` stays empty (marked
  `data-em-fa`). If you need a fallback, resolve through
  `window.em.fontawesome.get()` and swap yourself.
- **Solid + brands only.** Other Pro styles (light/duotone/sharp) are not
  bundled; `manager.fontawesome.get(name, 'duotone')` returns `null`.
- **License** — Font Awesome Pro is commercially licensed
  (https://fontawesome.com/license); the bundled assets are for apps built by
  the license holder.
- **Updating the set** — mirrors ultimate-jekyll-manager `docs/icons.md`:
  download the Pro web release from https://fontawesome.com/download, replace
  `src/assets/icons/font-awesome/solid/` and `brands/` with the release's
  `svgs/` folders.

## Testing

- `src/test/suites/main/fontawesome.test.js` — resolution, aliases, sanitization
  (traversal attempts), caching, IPC round-trip, the `overflow="visible"` serve
  attribute.
- `src/test/suites/renderer/fontawesome.test.js` — the real auto-render
  pipeline: inserted `<i>` elements get SVGs on the live DOM, modifier classes
  are never mistaken for names, unknown names stay empty, injected SVGs compute
  `overflow: visible` (out-of-viewBox glyphs must not clip).
