# Icons — one Font Awesome mechanism, every surface

Authoring is plain Font Awesome, everywhere, with **zero setup**:

```html
<i class="fa-solid fa-rocket"></i>
<i class="fa-brands fa-github"></i>
<i class="fa-sharp fa-light fa-bolt"></i>   <!-- Pro, when the brand supplies it -->
```

```js
el.className = 'fa-solid fa-play';   // set OR CHANGED via JS, any time —
el.className = 'fa-solid fa-stop';   // the icon re-renders in place
```

No icon font, no CDN, no prerendered sprite system. SVGs inject inline,
sized `1em`/`currentColor` (they scale with font-size and inherit text
color), `overflow="visible"` (FA 7 glyphs may overdraw their viewBox).

## The pieces (C4 cp108/111/112)

| Piece | Home | What it owns |
|-------|------|--------------|
| `icon-core` | `@omega.js/client/modules/icon-core.js` | Pure semantics: name/style validation, `parseIconClasses` (FA's family × weight class model), candidate lookup order (style dir → brands fallback), SVG root attributes, alias mapping, the package preference order (`PACKAGES`) |
| `icon-renderer` | `@omega.js/client/modules/icon-renderer.js` | The ONE browser auto-render: scan + MutationObserver (insertions AND class changes), render/re-render/clear, caching. Transport-injected — callers pass one `resolve(name, style) → Promise<svg\|null>` |
| Build-time inlining | `@omega.js/template-kit` `uj_icon` | Static template icons inlined into the HTML at build (zero runtime cost); same icon-core semantics |
| Asset chain + emission | `@omega.js/devkit/icons` (build-side, ONE impl for web + extension) + desktop `lib/fontawesome.js` `_resolveRoots()` (runtime) | Best-first roots: `OMEGA_FONTAWESOME_ROOT` → brand's `@fortawesome/fontawesome-pro` → `@fortawesome/fontawesome-free` floor (always last — a partial brand set never loses icons/aliases a lower rung has). `emitIcons` ships the merged set to a build output's `assets/fa/<style>/<name>.svg` (~25MB with Pro; hosting deploys diff by hash, browsers fetch only icons actually used) |

## Per-target transport (the only non-shared line)

| Target | Resolver | Wired in |
|--------|----------|----------|
| Web pages | `fetch('/assets/fa/<style>/<name>.svg')` from the site's own origin — `omega dev` emits the set at boot too (cp192; before that only production builds ran `emitIcons`, so runtime icons 404'd in dev) | `runtime/boot.js` `initialize()` — every page, main bundle or not |
| Desktop renderers | IPC `desktop:fontawesome:get` → main's icon server (fs, works packaged/offline) | `renderer.js` `_wireFontAwesome` |
| Extension pages | `fetch(chrome.runtime.getURL('assets/fa/…'))` — the packaged set (gulp `fontawesome` task emits it to `dist/assets/fa` at every brand build), fully offline | `src/lib/icons.js` (self-starting side-effect import) in popup/options/sidepanel/page |
| Extension content scripts | NOT auto-wired on purpose — watching a HOST page's DOM would collide with sites using FA themselves. Injected UI imports `createIconRenderer` and `scan()`s its own container; `assets/fa/*` is in `web_accessible_resources` for exactly this | manual, per injected surface |

Rendered elements carry `data-omega-fa="<style>/<name>"`. Unknown icons /
Pro styles without a Pro set leave the element **empty** (marked) — a
missing icon is a content problem, never a crash and never a wrong-style
fallback.

## Supplying Font Awesome Pro (brand-owned, never redistributed)

Pro is NO omega package's dependency — publishing a package that vendors
Pro SVGs violates the FA license. A brand that owns Pro brings its own
copy; every surface picks it up automatically. Two routes:

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

## When to use what (web)

- **`{% uj_icon rocket %}`** — static template content: inlined at build,
  zero runtime fetch, purge-safe. Prefer for chrome/layout icons.
- **`<i class="fa-solid fa-rocket">`** — anything dynamic, JS-driven, or
  authored in markdown/HTML fragments: rendered by the shared watcher.
- **Framework markup names FREE icons only** (#3). Pro is brand-owned and
  never a package dependency, so a Pro-only name in a packaged theme, core
  layout, or default page renders the tagged fallback in every consumer that
  does not own Pro — and the consumer cannot fix it (the chain has no
  consumer-local icon dir). Stock chrome must build with zero `uj_icon`
  warnings; a brand's OWN pages are free to use whatever its set resolves.

## Testing

- `packages/client/test/icon-core.test.js` — parsing/validation.
- `packages/desktop/src/test/suites/{main,renderer}/fontawesome.test.js` —
  the real-DOM proof of the SHARED renderer (insert, re-class, clear,
  Pro-adaptive assertions) + main's root chain and IPC sanitization.
- `packages/devkit/test/fontawesome-roots.test.js` + `test/icons.test.js` —
  chain resolution + emission merge (the shared build-side impl).
- Live consumer proof: the playground extension build emits the full
  merged set (Pro included via the brand `.env`) and compiles the watcher
  into all four page bundles.
