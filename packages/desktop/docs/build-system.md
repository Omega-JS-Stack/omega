# Build System

@omega.js/desktop's pipeline: **prepare-package** (framework only) → **gulp** (consumer) → **webpack** (3 targets) → **electron-builder** (packaging) → **strategy-pluggable signing**.

## prepare-package (framework-side)

Copies @omega.js/desktop's `src/` → `dist/` so consumers `require('@omega.js/desktop/main')` from the built output. Configured in @omega.js/desktop's `package.json`:

```jsonc
"preparePackage": {
  "input":  "./src",
  "output": "./dist",
  "type":   "copy",
  "replace": {},
  "hooks":   {}
}
```

Run with `npm start` (watch) or `npm run prepare` (one-shot).

## Gulp (consumer-side)

Auto-loads tasks from `<@omega.js/desktop>/dist/gulp/tasks/*.js` via `<@omega.js/desktop>/dist/gulp/main.js`. Consumer's `package.json` points there:

```jsonc
"scripts": {
  "gulp": "gulp --cwd ./ --gulpfile ./node_modules/@omega.js/desktop/dist/gulp/main.js"
}
```

### Tasks

| Task | Status | Description |
|---|---|---|
| `defaults` | real | Copy `<@omega.js/desktop>/dist/defaults/*` into the consumer (skips existing files) |
| `distribute` | real | Stage consumer `src/` + @omega.js/desktop `dist/` into `.desktop-build/` |
| `webpack` | real | Three parallel targets — main / preload / renderer |
| `sass` | real | SCSS → `dist/assets/css/*` |
| `html` | real | `src/views/**/index.html` → `dist/views/*` |
| `build-config` | real | Materialize `dist/electron-builder.yml` from source + mode-dependent injections (`LSUIElement` for hidden mode) |
| `package` | real | Run `electron-builder build --config dist/electron-builder.yml` (full DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux) |
| `package-quick` | real | Quick-package for host platform/arch only — `--dir` mode, no DMG/zip/universal/notarize. ~20-30s vs ~3min for full `package`. Output: `release/<platform>-<arch>/<ProductName>.app` (or `.exe`-folder/linux-unpacked) — directly launchable. Used for smoke-testing packaged-mode behavior locally. |
| `release` | real | `electron-builder build --publish always` |
| `audit` | real | Validate consumer config (required keys, valid enums, deep-link scheme format), ensure icon + entrypoints exist; in publish mode also requires `releases.repo` + `electron-builder.yml`. Throws with a numbered list of every problem found |
| `serve` | real | Spawns `electron .` against the build output, websocket on `OMEGA_LIVERELOAD_PORT` |

### Composition

```js
// `build` produces bundles only (dist/main.bundle.js, etc.) — no installer.
exports.build = series(
  exports['hook:build:pre'],
  exports.defaults,
  exports.distribute,
  parallel(exports.sass, exports.webpack, exports.html),
  exports.audit,
  exports['build-config'],
  exports['hook:build:post'],
);

// `packageBuild` = build + electron-builder (full DMG/zip/universal). Slow (~3min on mac).
exports.packageBuild = series(exports.build, exports.package);

// `packageQuick` = build + electron-builder --dir for host platform/arch only.
// Fast (~20-30s) — smoke-testing only.
exports.packageQuick = series(exports.build, exports['package-quick']);

// `publish` = build + sign + notarize + GH Release upload + mirror to download-server.
exports.publish = series(
  exports.build,
  exports['hook:release:pre'],
  exports.release,
  exports['mirror-downloads'],
  exports['hook:release:post'],
);

exports.default = series(exports.build, exports.serve);
```

## Webpack — three targets

All bundled in production for source protection. `app.asar` alone is not obfuscation (anyone can `npx asar extract` it) — webpack mangling is what protects framework + app source.

| Target | Entry | Output | Externals |
|---|---|---|---|
| `main` | `src/main.js` | `dist/main.bundle.js` | electron + node builtins + native modules from consumer's `package.json` |
| `preload` | `src/preload.js` | `dist/preload.bundle.js` | electron only |
| `renderer` | `src/assets/js/components/<view>/index.js` | `dist/assets/js/components/<view>.bundle.js` | none |

`output.module = false` per target so flipping to ESM later is a config switch, not a refactor.

### OMEGA_BUILD_JSON injection

DefinePlugin replaces the bare identifier `OMEGA_BUILD_JSON` with the parsed config. BannerPlugin prepends an IIFE that assigns it to `globalThis` and `window` so renderer code can read `window.OMEGA_BUILD_JSON.config`.

## electron-builder

@omega.js/desktop **generates** `dist/electron-builder.yml` from `config/omega.json5` + @omega.js/desktop defaults — the consumer never ships an `electron-builder.yml`. `gulp/build-config` does the materialization, applying:

- App metadata: `appId`, `productName`, `copyright` (with `{YEAR}` token expansion to the current year)
- App-level cross-platform fields: `category` mapping, `languages`, `darkModeSupport`
- Per-target (per-platform) installer config from `targets.{mac,win,linux}`:
  - **mac**: arch (default `universal`), MAS stubs (not implemented)
  - **win**: arch (default `x64`+`ia32`), NSIS oneClick + shortcuts
  - **linux**: arch, optional snap publishing
- Mode-dependent injections like `mac.extendInfo.LSUIElement: true` when `startup.mode === 'hidden'` (zero-bounce production launches — see [startup.md](startup.md))
- `electronVersion` pinned from the INSTALLED electron (resolved via the framework's module context — electron-builder refuses semver ranges and can't see a workspace-hoisted electron from the target dir)
- Generated entitlements + resolved icons + materialized publish + afterSign hook. The publish owner resolves config-first: `releases.owner` → the brand's `repo.providers.github.org` → git-remote discovery (a brand-monorepo target has no git remote of its own; electron-builder's update-info step crashes on a null publish config, so this isn't cosmetic)
- Optional passthrough: `fileAssociations`, `protocols`

The full per-target reference (every config knob, default value, and what it produces in YAML) lives in **[installer-options.md](installer-options.md)**.

`gulp/package` and `gulp/package-quick` both point electron-builder at the generated `dist/electron-builder.yml`. Consumer overrides via `config.electronBuilder.*` are merged on top of the generated config — see [installer-options.md § Raw `electronBuilder` overrides](installer-options.md#raw-electronbuilder-overrides-escape-hatch) for the escape hatch.

## Build modes

Environment variables (set in-process by the `omega build` / `omega package` / `omega publish` verbs — the consumer's npm scripts are thin `npx omega` aliases):

| Var | Effect |
|---|---|
| `OMEGA_BUILD_MODE=true` | Production webpack (minified, name-mangled, no sourcemaps) |
| `OMEGA_BUILD_OUTPUT=<path>` | The boot-test seam: redirect the gulp BUILD output away from `<project>/dist` (absolute, or relative to the project root). Resolved by [src/utils/dist-root.js](../src/utils/dist-root.js), which every build task's output path goes through — but `omega clean` and the generated `electron-builder.yml` stay project-relative, so this is NOT a general relocation switch; packaging under it is unsupported. Used by the boot-test runner so a test build never collides with the `npm start` watcher's `dist/` ([test-boot-layer.md](test-boot-layer.md#isolated-build-output)) |
| `OMEGA_IS_PUBLISH=true` | electron-builder runs with `--publish always` |
| `OMEGA_IS_SERVER=true` | Running in CI |

## Windows code signing

Strategy-pluggable via `platforms.win.signing.strategy` in `config/omega.json5`:

| Strategy | Where signing runs | When to use |
|---|---|---|
| `self-hosted` | Self-hosted GH Actions runner with USB EV token plugged in | Default for @omega.js/desktop v1 — physical EV token desktop |
| `cloud` | `windows-latest` runner shells out to a cloud signing CLI (Azure Trusted Signing / SSL.com / DigiCert KeyLocker) | Future migration target |
| `local` | Developer's Windows machine after CI uploads unsigned artifact | Fallback when no runner is available |

The `gulp/build-config` task and `electron-builder.yml`'s `win.sign` hook both honor `platforms.win.signing.strategy` so the same code path drives all three. Provider modules live in `src/lib/sign-providers/{ev,azure,sslcom,digicert}.js` (Pass 3).

## GitHub Actions

`.github/workflows/build.yml` (in `src/defaults/`) runs a 3-OS matrix: macOS / Linux / Windows. Windows job uploads unsigned; a separate `windows-sign` job runs on the strategy-appropriate runner and attaches signed artifacts to the release.

Env vars set globally:

```yaml
NODE_VERSION:  '22'
OMEGA_BUILD_MODE: 'true'
OMEGA_IS_PUBLISH: 'true'
OMEGA_IS_SERVER:  'true'
GH_TOKEN:      ${{ secrets.GITHUB_TOKEN }}
```

Concurrency group: `${{ github.ref }}` with `cancel-in-progress`.
