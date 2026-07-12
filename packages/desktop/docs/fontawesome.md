# FontAwesome

@omega.js/desktop serves the **brand's best available Font Awesome set** —
Pro when the brand supplies one (see below), otherwise the **Free set**
(solid + regular + brands, SVG) straight from its
`@fortawesome/fontawesome-free` npm dependency — every consumer gets 2,600+
icons with **zero setup**, fully offline, no icon font, no CDN, and nothing
vendored inside the framework package.

```html
<button class="btn btn-primary">
  <i class="fa-solid fa-rocket me-2"></i>Launch
</button>
```

That's it. Any `<i>` element carrying `fa-*` classes — in static HTML or
inserted dynamically at any time — gets the real SVG injected inline by the
renderer bootstrap. No `initialize()` options, no imports.

## One icon mechanism, every surface (C4 cp108)

Icon SEMANTICS — valid names/styles, candidate lookup order (requested style,
then the brands fallback), the injected root attributes, and alias mapping —
live in **`@omega.js/client/modules/icon-core.js`**, the SAME module
@omega.js/web's build-time `uj_icon` tag uses. Desktop and web can never
drift on how an icon name resolves or what the served SVG looks like.

## How it works

- **Assets** — resolved through the root chain (cp111), best-first:
  `OMEGA_FONTAWESOME_ROOT` download dir → `@fortawesome/fontawesome-pro`
  when the brand installed it → `@fortawesome/fontawesome-free` (a declared
  runtime dependency, always last so a partial brand set never loses icons
  the free set has). Each root holds `svgs/<style>/*.svg` plus
  `metadata/icon-families.json` for aliases (`search` → `magnifying-glass`).
  Declared dependencies ride into packaged apps automatically (fs reads
  through the asar transparently).
- **Main lib** (`lib/fontawesome.js`) — `manager.fontawesome.get(name, style)`
  resolves an icon to its SVG string (`null` for unknown names — never
  throws). Lookups are slug-sanitized via icon-core (the IPC channel can
  never read outside the icon directories) and cached per app run. Serves
  renderers over `desktop:fontawesome:get`.
- **Preload bridge** — `window.em.fontawesome.get(name, style)` →
  `Promise<svg | null>`.
- **Renderer auto-render** (`renderer.js _wireFontAwesome`) — scans for
  `i[class*="fa-"]` at init and watches the DOM via MutationObserver. The style
  comes from `fa-solid` (default) / `fa-brands`; the icon name is the first
  `fa-*` class that isn't a known modifier (`fa-fw`, `fa-2x`, `fa-spin`, …).
  The SVG is injected as a child of the `<i>`, sized `1em`/`currentColor` — it
  inherits text color and scales with font-size (bump it via `font-size` or a
  `fs-*` utility). Served SVGs also carry `overflow="visible"` (FA-kit parity:
  `.svg-inline--fa { overflow: visible }`) — FA 7 glyphs may draw OUTSIDE
  their viewBox (fa-lock's shackle peaks at y=-32 in a `0 0 384 512` box) and
  the SVG-root default of `overflow: hidden` clips them flat.

## Minimal surfaces

The auto-render is wired by `initialize()`. A renderer that deliberately skips
the full init (no @omega.js/client / auth — e.g. a lightweight popover overlay) can
enable JUST the icon pipeline:

```js
new (require('@omega.js/desktop/renderer'))().enableFontAwesome();
```

## Supplying Font Awesome Pro (C4 cp111)

The framework never redistributes Font Awesome Pro (publishing a package
that vendors Pro SVGs violates its license) — a brand that owns a Pro
license brings its own copy, and every surface picks it up automatically.
Two supply routes:

1. **npm (preferred)** — authenticate the `@fortawesome` scope with your FA
   npm token (from fontawesome.com → Account → API Tokens), machine-global,
   never committed:

   ```bash
   npm config set "@fortawesome:registry" "https://npm.fontawesome.com/"
   npm config set "//npm.fontawesome.com/:_authToken" "YOUR-TOKEN"
   ```

   Then install `@fortawesome/fontawesome-pro`. In the Omega monorepo a
   root install covers web + desktop + extension dev at once; a real brand
   desktop app declares it as its own **prod dependency** so it ships
   inside the packaged asar.

2. **Download dir (no token)** — point `OMEGA_FONTAWESOME_ROOT` at a
   fontawesome.com "Pro for Web" download (any dir containing `svgs/` +
   `metadata/`). Wins over the npm sets when set; ignored with a warning
   when the dir has no `svgs/`.

Pro styles (`light`, `thin`, `duotone`, `sharp-*`, …) work as soon as a Pro
set is present — style validation is by path-safe shape, not a whitelist,
so new FA families need no framework change. Without Pro, those lookups
just return `null`/render nothing.

## Notes

- **Unknown names render nothing** — the `<i>` stays empty (marked
  `data-em-fa`). If you need a fallback, resolve through
  `window.em.fontawesome.get()` and swap yourself.
- **Free set = solid + regular + brands.** Pro styles (light/duotone/sharp)
  need a supplied Pro set (above); otherwise
  `manager.fontawesome.get(name, 'duotone')` returns `null`.
- **Updating the set** — bump the `@fortawesome/fontawesome-free` dependency
  (or reinstall/refresh the brand's Pro supply).

## Testing

- `src/test/suites/main/fontawesome.test.js` — resolution, aliases (via the
  metadata map), sanitization (traversal attempts), caching, IPC round-trip,
  the `overflow="visible"` serve attribute, and the cp111 root chain
  (`OMEGA_FONTAWESOME_ROOT` wins, free set falls through for icons and
  metadata the brand set lacks).
- `src/test/suites/renderer/fontawesome.test.js` — the real auto-render
  pipeline: inserted `<i>` elements get SVGs on the live DOM, modifier classes
  are never mistaken for names, unknown names stay empty, injected SVGs compute
  `overflow: visible` (out-of-viewBox glyphs must not clip).
