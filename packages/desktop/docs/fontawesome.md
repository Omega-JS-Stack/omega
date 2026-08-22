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
@omega.js/web's build-time `omega_icon` tag uses. Desktop and web can never
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
- **Preload bridge** — `window.desktop.fontawesome.get(name, style)` →
  `Promise<svg | null>`.
- **Renderer auto-render** (`renderer.js _wireFontAwesome`) — a thin
  wrapper over **@omega.js/client's shared `icon-renderer`** (C4 cp112, the
  same module web pages run): scan + MutationObserver for insertions AND
  class changes (`el.className = 'fa-solid fa-stop'` re-renders in place;
  dropping the classes clears the SVG), FA's family × weight class parsing
  (`fa-sharp fa-light` → `sharp-light`; Pro markup without a Pro set stays
  empty — never a wrong-style fallback), caching, and the
  `data-omega-fa="<style>/<name>"` marker. Desktop supplies only the
  transport: IPC to main's icon server.
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

Pro is brand-supplied, never redistributed by the framework. The two
routes (FA npm token, or an `OMEGA_FONTAWESOME_ROOT` download dir), the
chain semantics, and the style/family model are documented once at the
repo hub: **[docs/shared/icons.md](../../../docs/shared/icons.md)**. Desktop-specific
note: a packaged brand target declares `@fortawesome/fontawesome-pro` as its
own **prod dependency** so the set ships inside the asar.

## Notes

- **The icon CSS is not desktop's.** The box, the size scale and the
  `fa-spin`/`fa-bounce`/`fa-beat` utilities ride ONE sheet vendored from
  @omega.js/web at prepare (see [css.md](css.md#icon-presentation)). Fix icon
  presentation there, never here.
- **Unknown names render nothing** — the `<i>` stays empty (marked
  `data-omega-fa`). If you need a fallback, resolve through
  `window.desktop.fontawesome.get()` and swap yourself.
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
- `src/test/suites/renderer/fontawesome.test.js` — the real-DOM proof of
  the SHARED icon-renderer: inserted `<i>` elements get SVGs on the live
  DOM, class changes re-render in place and class removal clears (cp112),
  modifier classes are never mistaken for names, Pro family/weight classes
  compose (Pro-adaptive assertions), unknown names stay empty, injected
  SVGs compute `overflow: visible` (out-of-viewBox glyphs must not clip).
