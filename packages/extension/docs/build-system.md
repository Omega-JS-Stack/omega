# Build System

@omega.js/extension uses **gulp + esbuild + sass + custom HTML templating + an electron-builder-style packaging step** to compile extension source into a Chrome-loadable, multi-browser-ready build.

## Pipeline overview

`src/` (consumer authored) → `dist/` (intermediate) → `packaged/<browser>/raw/` (Chrome-loadable) → `packaged/<browser>/<name>.zip` (store upload).

```
src/
├── manifest.json                            # JSON5 source — comments, single quotes OK
├── views/<component>/index.html             # HTML templates
├── _locales/en/messages.json                # i18n catalog source
├── assets/
│   ├── js/components/<component>/index.js   # entry points (esbuild bundles these)
│   ├── css/main.scss + components/          # SCSS
│   └── images/icon.png                      # source icon (1024×1024)
└── ...
        ↓ gulp build (OMEGA_BUILD_MODE=true)
dist/
├── manifest.json                            # still JSON5 — used by serve, not Chrome
├── views/<component>/index.html             # templated
├── assets/
│   ├── js/components/<component>.bundle.js  # esbuild output
│   ├── css/components/<component>.bundle.css # sass output
│   └── images/                              # icons (multiple sizes)
└── _locales/<lang>/messages.json            # auto-translated (see docs/translations.md)
        ↓ packaging step
packaged/
├── chromium/
│   ├── raw/                                 # strict-JSON manifest, Chrome-loadable
│   │   ├── manifest.json                    # comments stripped, valid JSON
│   │   └── ...                              # everything from dist/
│   └── <ExtensionName>.zip                  # store upload
├── firefox/raw/ + .zip
└── opera/raw/ + .zip
```

## Gulp tasks

Auto-loaded from [src/gulp/tasks/](../src/gulp/tasks/) via [src/gulp/main.js](../src/gulp/main.js).

| Task | Source | Purpose |
|---|---|---|
| `defaults` | [tasks/defaults.js](../src/gulp/tasks/defaults.js) | Copy framework defaults from `dist/defaults/` to consumer project on first run / setup. See [defaults.md](defaults.md). |
| `distribute` | [tasks/distribute.js](../src/gulp/tasks/distribute.js) | Copy consumer's `src/` files (HTML, manifest, locales, **static images**, etc.) to `dist/` |
| `sass` | [tasks/sass.js](../src/gulp/tasks/sass.js) | Compile SCSS → CSS bundles with the load-path system (see [css.md](css.md)) |
| `bundle` | [tasks/bundle.js](../src/gulp/tasks/bundle.js) | Bundle JS per component entry point with esbuild |
| `html` | [tasks/html.js](../src/gulp/tasks/html.js) | Run views through the two-step templating system (see [templating.md](templating.md)) |
| `icons` | [tasks/icons.js](../src/gulp/tasks/icons.js) | Generate icon variants from `src/assets/images/icon.png` |
| `translate` | [tasks/translate.js](../src/gulp/tasks/translate.js) | Auto-translate `config/messages.json` to the configured `translation.languages` (see [translations.md](translations.md)) |
| `package` | [tasks/package.js](../src/gulp/tasks/package.js) | Bundle dist/ into packaged/<browser>/raw + zip; runs `build:pre` / `build:post` hooks ([hooks.md](hooks.md)) |
| `serve` | [tasks/serve.js](../src/gulp/tasks/serve.js) | Dev server: WebSocket-based live reload, watches `src/` |
| `audit` | [tasks/audit.js](../src/gulp/tasks/audit.js) | Build-pipeline-specific checks (icons exist, manifest is valid, etc.) |

### Static assets

`distribute` copies everything under `src/` EXCEPT what another task owns: `.js` (bundle), `.css/.scss/.sass` (sass), and `src/views/**/*.html` (the html task). Static images (`.png`, `.jpg`, `.svg`, `.webp`, …) copy as-is, byte-for-byte — this framework ships no imagemin task, so nothing else would carry them to `dist/` ([#259](https://github.com/Omega-JS-Stack/omega/issues/259)). Consumers never need a `hooks/build/pre.js` copy step for images.

## Bundling

[src/gulp/tasks/bundle.js](../src/gulp/tasks/bundle.js) discovers component entry points (`src/assets/js/components/<name>/index.js`) and bundles each to `dist/assets/js/components/<name>.bundle.js`.

The bundler is esbuild through @omega.js/devkit's ONE `bundle()` wrapper ([#738](https://github.com/Omega-JS-Stack/omega/issues/738) — webpack, `babel-loader` and `@babel/preset-env` left with it, and the gulp task, the file and the log tag were renamed off `webpack` at the same time). The wrapper supplies what every framework shares: the framework-deps resolve hook ([#87](https://github.com/Omega-JS-Stack/omega/issues/87)), the production `@dev-only` strip ([#18](https://github.com/Omega-JS-Stack/omega/issues/18)), the minify/sourcemap rules by mode, and one timing line per build.

### One call, every lane

Background service worker, content scripts, popup / options / sidepanel / pages all take the same options: `format: 'iife'`, `platform: 'browser'`, no code splitting. webpack needed three configs precisely to switch splitting OFF per lane (MV3's CSP lets neither a service worker nor a content script fetch a chunk); esbuild's iife format has no splitting at all, so each bundle is one self-contained file. Every bundle carries its own `OMEGA_BUILD_JSON` snapshot, content scripts included: in the default isolated world that is invisible to the host page, but a consumer that registers a content script with `world: 'MAIN'` publishes the whole config object onto the page's `window`, readable by any script there. Keep MAIN-world scripts free of anything you would not put in page source.

### Syntax floor — the manifest answers it

esbuild's `target` replaces preset-env's browserslist guess, and it is READ from the manifest rather than hardcoded: `minimum_chrome_version` and `browser_specific_settings.gecko.strict_min_version` are where a project already declares which browsers it supports, so raising either moves the bundler with it. Undeclared, each side falls back to its MV3 minimum — Chrome 88 (where MV3 shipped) and Firefox 91 (the `strict_min_version` the framework's default manifest ships) — which is the `chrome88, firefox91` a scaffolded project compiles to. esbuild compiles SYNTAX to that floor and never polyfills a runtime API.

### Node built-ins

Browser bundles answer `fs` / `path` / `crypto` / `os` / `util` / `assert` / `stream` / `buffer` / `process` with an empty module (@omega.js/devkit's `emptyModulesPlugin`, the esbuild answer to webpack's `resolve.fallback`): libraries bundled through @omega.js/client import them on code paths their browser builds never take.

### The build snapshot — `OMEGA_BUILD_JSON`, baked into every bundle

Every emitted bundle carries its own copy of the build snapshot. It is not a file: `bundle.js` composes it once per build (`composeBuildJson()`) and esbuild bakes it in two ways, which is the same shape @omega.js/desktop uses ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)):

- **`define`** replaces the bare identifier `OMEGA_BUILD_JSON` with the literal at compile time, so framework and consumer code can read the snapshot without reaching for a global.
- **`banner`** prepends a one-line IIFE that assigns the same value onto `globalThis`, `self` and `window`. That is what `background.js` reads as `self.OMEGA_BUILD_JSON` and what every page context reads as `window.OMEGA_BUILD_JSON`, and it lands ahead of the bundle's own code so the snapshot is always already there.

What it holds: `timestamp`, `repo`, `environment`, `license` (the build's verdict — a fact about the BUILD, never inside `config`), `packages`, and `config` — the blob the contexts hand @omega.js/client (brand, cloud, theme, analytics with the baked `GOOGLE_ANALYTICS_SECRET`, advertising, and in non-production builds the resolved `dev.ports` / `dev.origin` map, the only channel a browser context has to a bumped local stack).

Before #743 the same blob was written as `packaged/<browser>/raw/build.js` — a JSONP file the service worker loaded with `importScripts('/build.js')` and every page loaded with its own `<script src="/build.js">` tag — plus a `build.json` sidecar nothing read. **Neither file is written any more.** Inspecting a built artifact means reading the bake back out of a bundle (`src/gulp/tasks/utils/build-json.js` `readBakedBuildJson()` runs the banner the way a browser would).

### Template replacement

A post-emit pass over the bundles replaces these markers at build time:
- `%%% version %%%` → `package.json#version`
- `%%% brand.name %%%` → config brand name
- `%%% brand.url %%%` → config brand URL
- `%%% environment %%%` → `'production'` or `'development'`
- `%%% liveReloadPort %%%` → WebSocket port (35729 default)

A key nothing answers is left INTACT rather than emptied, so unrelated `%%%` text in consumer code survives. The pass runs over the EMITTED files (not the sources) because the tokens reach the bundle from vendored and `@omega.js/client` code too, which a source-level hook would never see; the one cost is that in a DEV build a line carrying a replaced token has shifted source-map columns after the token — production builds ship no maps at all.

### Dev-only blocks

Production bundles drop everything between `/* @dev-only:start */` and `/* @dev-only:end */`. The markers and the cut live in ONE home (`@omega.js/devkit/strip-dev-blocks`) and the wrapper registers the esbuild plugin for production builds only; dev builds keep the blocks. "Production" here is `Manager.actLikeProduction()`, so an `OMEGA_AUDIT_FORCE=true` audit run strips too — it inspects the artifact a release would ship.

### Aliases

esbuild `alias` in bundle.js:
```js
alias: {
  '__main_assets__':    '<framework>/dist/assets',
  '__project_assets__': '<project>/src/assets',
  '__theme__':          '<framework>/dist/assets/themes/<active-theme>',
}
```

## Sass

[src/gulp/tasks/sass.js](../src/gulp/tasks/sass.js) compiles per-component SCSS bundles. Load-path resolution lets consumer SCSS `@use 'omega-extension'`, `@use 'theme'`, and `@use 'components/popup'` resolve through a search chain. Full details in [css.md](css.md).

## HTML templating

Views in `src/views/<component>/index.html` go through two passes of `{{ }}` token replacement. See [templating.md](templating.md).

## Packaging

[tasks/package.js](../src/gulp/tasks/package.js):

1. **Pre-hook** — runs `hooks/build/pre.js` if present (the flat `hooks/build:pre.js` still resolves as a transition fallback)
2. **Per-browser manifest normalization** — converts JSON5 → strict JSON for Chrome/Edge/Opera (Firefox tolerates JSON5 but normalized anyway)
3. **Per-browser asset copy** to `packaged/<browser>/raw/` — the bundles arrive with the snapshot already baked in, so the package lane writes no `build.js` / `build.json` of its own ([#743](https://github.com/Omega-JS-Stack/omega/issues/743))
4. **Zip** to `packaged/<browser>/<name>.zip`
5. **Post-hook** — runs `hooks/build/post.js`
6. **Auto-publish** (if `OMEGA_IS_PUBLISH=true`) — uploads to Chrome Web Store / Firefox Add-ons / Edge Add-ons stores. See [publishing.md](publishing.md).

### Manifest compilation rules

The compiled manifest is the source manifest merged with the framework defaults ([src/config/manifest.json](../src/config/manifest.json)), then adjusted per target:

- **Declared beats default.** The defaults only fill keys your `src/manifest.json` never wrote — including arrays. An array you declare REPLACES the default (an empty array ships nothing), which is the only way to drop a framework default such as `externally_connectable`'s dev origin from a production build ([#260](https://github.com/Omega-JS-Stack/omega/issues/260)).
- **`externally_connectable` defaults to your BRAND origin.** The default `matches` is `<brand.url origin>/*`, plus the resolved dev-website origin in a dev build only. A packaged build used to ship the localhost dev origin alone, so the live brand site could not message the published extension ([#583](https://github.com/Omega-JS-Stack/omega/issues/583)). With no `brand.url`, a build-mode build declares no origin and says so. The scaffolded boot test `test/boot/externally-connectable.test.js` asserts the brand origin against the real packaged manifest.
- **`homepage_url` is baked from `brand.url`** on every target — the store listing's developer-site link, which nothing emitted before ([#576](https://github.com/Omega-JS-Stack/omega/issues/576)). A value you declare wins; with no `brand.url` the key ships absent.
- **Icons are pruned to what the build minted** — a manifest pointing at an icon that isn't there is an extension Chrome refuses to load.
- **chromium / opera** — `background.scripts` dropped (MV3 service worker).
- **firefox** — `background.service_worker` becomes `background.scripts`; `side_panel` becomes `sidebar_action` (Firefox has no side panel key) and the `sidePanel` permission is dropped; `browser_specific_settings.gecko.id` is DERIVED when you declare none — `extension@<brand.url host>`, or `extension@<brand.id>.extension` with no url, and packaging fails only when there are no brand facts at all to derive from ([#264](https://github.com/Omega-JS-Stack/omega/issues/264)). Firefox cannot identify, sign, or update an add-on without an id, so a fresh scaffold builds out of the box — but **declare your own id before the first publish** ([#574](https://github.com/Omega-JS-Stack/omega/issues/574)): it must stay stable across every release, and `brand.url` can change.

## Build modes

Env vars that drive the pipeline:

- `OMEGA_BUILD_MODE=true` — production build (minified, no sourcemaps, dev-blocks stripped)
- `OMEGA_IS_PUBLISH=true` — also publish to extension stores after packaging
- `OMEGA_LIVERELOAD_PORT=35729` — WebSocket port for `serve` task (override if 35729 collides)
- `OMEGA_TEST_MODE=true` — running in @omega.js/extension's test framework. Powers `Manager.isTesting()` (see [test-framework.md](test-framework.md)).
- `OMEGA_LOG_FILE` — override the stdout/stderr tee path, or set to `false` to disable it (see [Log files](#log-files)).

## Live reload

`npm start` (= `gulp` with no args, by default invokes `serve`) watches `src/` and recompiles on change. A WebSocket server on `OMEGA_LIVERELOAD_PORT` (35729) notifies the extension's contexts. Background SW reloads itself via `chrome.runtime.reload()`; other contexts reload via `window.location.reload()`.

## Log files

The gulp pipeline tees all output to `logs/dev.log` (`npm start`) / `logs/build.log` (`npm run build`), and `npx omega test` tees to `logs/test.log`. Full reference — file table, capture behavior, `OMEGA_LOG_FILE` controls: [logging.md](logging.md).

## Output for Chrome's "Load unpacked"

Point Chrome at `packaged/chromium/raw/` — that's the strict-JSON, fully-assembled Chrome-loadable build. NOT `dist/` (which has JSON5 manifest mid-pipeline). The test framework's boot layer auto-targets `packaged/chromium/raw/` for the same reason — see [test-boot-layer.md](test-boot-layer.md).

## See also

- [components.md](components.md) — the seven component contexts
- [templating.md](templating.md) — `{{ }}` token replacement
- [css.md](css.md) — SCSS load paths
- [defaults.md](defaults.md) — `src/defaults/` template system
- [hooks.md](hooks.md) — `build:pre` / `build:post`
- [translations.md](translations.md) — auto-translate `_locales/`
- [publishing.md](publishing.md) — store auto-publishing
- [test-boot-layer.md](test-boot-layer.md) — verify the packaged extension actually boots in Chromium
