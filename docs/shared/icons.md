# Icons — one Font Awesome mechanism, every surface

Authoring is plain Font Awesome markup, everywhere, with **zero setup** and
nothing to learn ([#619](https://github.com/Omega-JS-Stack/omega/issues/619)):

```html
<i class="fa-solid fa-rocket"></i>
<i class="fa-brands fa-github"></i>
<i class="fa-sharp fa-light fa-bolt"></i>   <!-- Pro, when the brand supplies it -->
<i class="omega-flag omega-flag-us"></i>    <!-- the flags namespace -->
```

```js
el.className = 'fa-solid fa-play';   // set OR CHANGED via JS, any time —
el.className = 'fa-solid fa-stop';   // the icon re-renders in place
```

There is no icon TAG, no `prerender_icons` list, no icon font, no CDN and no
sprite system. SVGs land inline, sized `1em`/`currentColor` (they scale with
font-size and inherit text color), `overflow="visible"` (FA 7 glyphs may
overdraw their viewBox).

**Emojis are text**, not icons: type the character. Nothing to build.

## The two halves

| Half | When | What happens |
|------|------|--------------|
| **Build inlining** | every icon present in the RENDERED HTML | The SVG is inlined into the `<i>`. Tiny payload, no flash, no runtime fetch, purge-safe. |
| **Runtime upgrading** | every icon JS creates afterwards, and every class change | A MutationObserver fetches that ONE icon from the site's own set. Zero cost until an icon is actually requested. |

Both halves emit exactly the same markup — the `<i>` carries
`data-omega-fa="<style>/<name>"` and holds the SVG — so nothing can render one
icon two ways, and the build's stamp is what tells the watcher to leave the
element alone.

## The pieces

| Piece | Home | What it owns |
|-------|------|--------------|
| `icon-core` | `@omega.js/client/modules/icon-core.js` | Pure semantics: name/style validation, `parseIconClasses` (FA's family × weight class model, plus the `omega-flag-*` namespace), candidate lookup order (style dir → brands fallback), SVG root attributes, alias mapping, the package preference order (`PACKAGES`), the emitted dir name (`ICONS_DIR` — `icons`) |
| `icon-renderer` | `@omega.js/client/modules/icon-renderer.js` | The ONE browser auto-render: scan + MutationObserver (insertions AND class changes), render/re-render/clear, caching. Transport-injected — callers pass one `resolve(name, style) → Promise<svg\|null>` |
| Build-side reads | `@omega.js/devkit/icons` | `resolveFontAwesomeRoots()` (the root chain), `createIconLoader()` (read one icon out of it, aliases and brands fallback included), `emitIcons()` (ship the merged set into a build output), `ICONS_DIR` (icon-core's, re-exported so the build side has one import) |
| Web's build pass | `@omega.js/web` `src/inline-icons.js` | The post-render transform over every rendered page (registered in `src/engine.js` beside the cache-breaker) |
| Web's runtime | `@omega.js/web` `runtime/icons.js` | The transport + the watcher, started by `runtime/boot.js` on EVERY page, main bundle or not |

The emitted set is `assets/icons/<style>/<name>.svg`, with the country flags
one namespace over at `assets/icons/flags/<country>.svg`. It carries every
style the brand's chain supplies: the free floor plus whatever Pro set the
brand brought. Hosting deploys diff by hash and browsers fetch only the icons
a page actually asks for.

## Per-target transport (the only non-shared line)

| Target | Resolver | Wired in |
|--------|----------|----------|
| Web pages | `fetch('/assets/icons/<style>/<name>.svg')` from the site's own origin — `omega dev` emits the set at boot too, so runtime icons resolve in dev | `runtime/icons.js`, started by `runtime/boot.js` `initialize()` |
| Desktop renderers | IPC `desktop:fontawesome:get` → main's icon server (fs, works packaged/offline) | `renderer.js` `_wireFontAwesome` |
| Extension pages | `fetch(chrome.runtime.getURL('assets/icons/…'))` — the packaged set (gulp `fontawesome` task emits it to `dist/assets/icons` at every brand build), fully offline | `src/lib/icons.js` (self-starting side-effect import) in popup/options/sidepanel/page |
| Extension content scripts | NOT auto-wired on purpose — watching a HOST page's DOM would collide with sites using FA themselves. Injected UI imports `createIconRenderer` and `scan()`s its own container; `assets/icons/*` is in `web_accessible_resources` for exactly this | manual, per injected surface |

**Build-time inlining is WEB's** — it is the only target that renders HTML at
build. Desktop and extension pages ship their markup as authored and let the
shared watcher fill it on first paint, out of the same emitted set.

Web's `src/language-flags.js` additionally writes language-named copies into
their own namespace (`assets/icons/flags/lang/en.svg` = the us flag — language
and country codes collide, so `ar` is Arabic there and Argentina one level up),
so the client-side footer language switcher fetches a flag by the row's own
hreflang code with no map in the browser; a language the set has no flag for
drops its `<img>` rather than showing a broken glyph.

## Missing icons

A name the icon set has no file for leaves the element **empty** — a missing
icon is a content problem, never a crash and never a wrong-style fallback —
and says so, loudly, where a human will see it:

- **At build**, web's pass marks the element `data-omega-icon-missing="<style>/<name>"`
  and warns once per name. The dev-only browser audit
  (`core/js/core/dev-icon-audit.js`) turns each marker into a console error.
- **At runtime**, a 404 is a `console.error` naming the icon **in development**
  and a silent skip in production, where a missing icon must never be worse
  than a missing icon.

## Supplying Font Awesome Pro (brand-owned, never redistributed)

Pro is NO omega package's dependency — publishing a package that vendors Pro
SVGs violates the FA license. A brand that owns Pro brings its own copy; every
surface picks it up automatically. Two routes:

1. **npm** — authenticate the `@fortawesome` scope with your FA token
   (fontawesome.com → Account → API Tokens), machine-global, never
   committed:

   ```bash
   npm config set "@fortawesome:registry" "https://npm.fontawesome.com/"
   npm config set "//npm.fontawesome.com/:_authToken" "YOUR-TOKEN"
   ```

   Then install `@fortawesome/fontawesome-pro` (monorepo root for dev; a
   brand desktop app declares it as a **prod dependency** so it ships in
   the packaged asar).

2. **Download dir (no token)** — set `OMEGA_FONTAWESOME_ROOT` to a dir
   containing `svgs/` (+ optionally `metadata/`): a fontawesome.com "Pro
   for Web" download, or any style-shaped SVG tree. Lives in the brand
   `.env` (the config env cascade delivers it to manager runs, web
   builds, and desktop dev) or the shell profile for machine-global.

Both can coexist — the chain is `[env dir, pro npm, free]`; missing files
fall through per icon, so a solid-only download plus the npm package plus
free compose seamlessly.

## Styles

Free floor: `solid` (default), `regular`, `brands`. Pro adds `light`,
`thin`, and the `duotone` / `sharp` / `sharp-duotone` families, which
compose with weights exactly like FA markup: `fa-sharp fa-light fa-play`
→ `sharp-light/play` (bare `fa-duotone` → the `duotone` dir =
duotone-solid). Style validation is by path-safe shape, not a whitelist —
future FA families work with zero framework changes.

A name the requested style has no file for falls back to `brands/`, so
`<i class="fa-solid fa-github">` resolves without the author knowing which
side of the set the mark lives on.

## The sheet (one home, every surface)

Icon PRESENTATION is one sheet:
`packages/web/core/css/core/_custom-font-awesome.scss`. It owns the box, the
size scale and the animation utilities, and it is deliberately self-contained
(plain css, its own `$fa-sizes` map, its own keyframes) so the other targets
take it verbatim instead of hand-writing a second copy that drifts.

Desktop and extension VENDOR it at prepare through their package.json
`omega.vendorAssets`, the same channel that carries the `--omega-*` tokens and
the shell mechanics: it lands at `dist/assets/css/core/_fontawesome.scss` and
the `omega-desktop` / `omega-extension` entries `@use` it. Nothing to import in
a consumer project, and no second sheet to keep in sync (#183).

## Animation

`.fa-spin` turns an icon one full rotation a second, linear, forever;
`.fa-bounce` hops it; `.fa-beat` swells it. All three are Font Awesome's own
class names, so the muscle memory carries over, and each rides either half of
the mechanism:

```html
<i class="fa-solid fa-spinner fa-spin"></i>
```

The keyframes are ours, not FA's: FA's own are built on a stack of
custom-property knobs the sheet does not ship, so each utility gets a minimal
implementation under FA's name.

Under `prefers-reduced-motion: reduce` every one of them is dropped and the
icon parks, the same deal every looping effect in the motion library
makes.

The rendered icon `<i>` is a square `1em` box with the glyph centered in
it, so a spin (or any other transform) turns about the glyph's own center
instead of a point down on the text baseline. Nothing to hand-fix, and no
class to remember: the box keys on the `data-omega-fa` stamp the renderers
leave themselves.

The 12 size classes (`fa-2xs` … `fa-6xl`) are the sheet's `$fa-sizes` map, and
`icon-core`'s modifier list carries the same roster, so a size class never
reads as an icon name.

## The rule for packaged markup

**Framework markup names FREE icons only** (#3). Pro is brand-owned and never a
package dependency, so a Pro-only name in a packaged theme, core layout, or
default page renders nothing in every consumer that does not own Pro — and the
consumer cannot fix it (the chain has no consumer-local icon dir). Stock chrome
must build with zero missing-icon markers; a brand's OWN pages are free to use
whatever its set resolves.

## Testing

- `packages/client/test/icon-core.test.js` — parsing/validation, the flags
  namespace, plus the 12-size roster the modifier list must carry.
- `packages/client/test/icon-renderer.test.js` — the shared watcher on a real
  class list: insert, re-class, clear, flags.
- `packages/devkit/test/{fontawesome-roots,icons}.test.js` — chain resolution,
  the build-side loader, and the emission merge.
- `packages/web/test/icons-inline.test.js` — the build pass (native markup,
  modifiers, brands fallback, aliases, flags, misses), one real mini-site
  build, and the grep guard that the retired mechanisms are gone.
- `packages/web/test/icons-runtime.test.js` — the transport and the watcher:
  a JS-created icon upgrading, a flag upgrading, dev loudness vs production
  silence, and zero fetches for what the build already inlined.
- `packages/desktop/src/test/suites/{main,renderer}/fontawesome.test.js` —
  the real-DOM proof of the SHARED renderer + main's root chain and IPC
  sanitization.
- `packages/web/test/icons.test.js` — the compiled icon sheet: the square
  box, `.fa-spin` / `.fa-bounce` / `.fa-beat`, their reduced-motion branch,
  and the size roster derived from `$fa-sizes`.
- `packages/{desktop,extension}/src/test/suites/build/icon-sheet.test.js`:
  the vendored copy lands, and the entry compiles the box + the park.
