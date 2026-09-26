# Contexts: one `omega` per context

Each extension context's module exports ONE ready-made instance, `omega`. The consumer entry imports it and calls `initialize()`; it never writes `new`. The class is exported by name (`Omega`) for tests only.

## Import paths

| Context | Import | Source |
|---|---|---|
| Build-time (Node) | `require('@omega.js/extension/build')` | [src/build.js](../src/build.js) |
| Background SW | `import omega from '@omega.js/extension/background'` | [src/background.js](../src/background.js) |
| Popup | `import omega from '@omega.js/extension/popup'` | [src/popup.js](../src/popup.js) |
| Options | `import omega from '@omega.js/extension/options'` | [src/options.js](../src/options.js) |
| Sidepanel | `import omega from '@omega.js/extension/sidepanel'` | [src/sidepanel.js](../src/sidepanel.js) |
| Pages (custom) | `import omega from '@omega.js/extension/page'` | [src/page.js](../src/page.js) |
| Content script | `import omega from '@omega.js/extension/content'` | [src/content.js](../src/content.js) |
| Offscreen | `import omega from '@omega.js/extension/offscreen'` | [src/offscreen.js](../src/offscreen.js) |

## The consumer entry

Every consumer-side context entry is the same shape:

```js
// src/assets/js/components/popup/index.js
import omega from '@omega.js/extension/popup';

await omega.initialize();

// omega now carries:
//   omega.context     'popup'
//   omega.extension   cross-browser chrome.*/browser.* API wrapper (see docs/extension.md)
//   omega.logger      LoggerLite('popup'); prints [@omega.js/extension:popup] (no timestamp: devtools stamps runtime lines)
//   omega.messenger   the one lane between contexts: send({ destination, command, payload }), onMessage(handler)
//   omega.config      the OMEGA_BUILD_JSON.config snapshot
//   omega.version     the manifest version
//   omega.getApiUrl() / getEnvironment() / isDevelopment() / isProduction() / isTesting()
```

`initialize()` returns the instance, and `omega.ready` is the same promise, so a module that did not call `initialize()` can still `await omega.ready`.

## Three kinds of context

| Kind | Contexts | Class | Adds |
|---|---|---|---|
| Page | popup, options, sidepanel, page | ONE subclass of `@omega.js/client`'s base class ([src/page-context.js](../src/page-context.js)), told apart by the context name | the client's modules as properties (`omega.auth`, `omega.storage`, `omega.bindings`, `omega.firestore`, `omega.analytics`, `omega.utilities`, ...), `omega.auth.openPage()`, the theme module, the auth sync with background |
| Background | background | the extension base ([src/omega.js](../src/omega.js)) plus its own `omega.auth` | the auth source of truth (its own Firebase app, `omega.auth.user`, `.listen()`, `.signOut()`), the worker's `message` event, livereload in development |
| Light | content, offscreen | the extension base | content runs the affiliatizer over the host page; offscreen hosts long-running work. Neither has auth |

The members every context carries (`context`, `extension`, `logger`, `messenger`) come from ONE home, `contextMembers()` in [src/omega.js](../src/omega.js), which both the base class and the page subclass use.

## The build module

`@omega.js/extension/build` is the build-time module: one plain object of functions every gulp task, verb, consumer hook and build test reads. No class and no `new`:

```js
const build = require('@omega.js/extension/build');

build.getConfig();         // → RESOLVED config/omega.json5 (targets.extension overlaid; via @omega.js/config)
build.getManifest();       // → parsed src/manifest.json (JSON5)
build.getPackage('project');   // → cwd's package.json
build.getPackage('main');      // → @omega.js/extension's own package.json
build.getRootPath('project');  // → process.cwd()
build.getRootPath('main');     // → path to @omega.js/extension's dist
build.getEnvironment();    // → the lane's OMEGA_ENVIRONMENT
build.getVersion();        // → cwd's package.json version
build.getLiveReloadPort(); // → 35729 by default
build.isBuildMode();       // → boolean
build.actLikeProduction(); // → buildMode || OMEGA_AUDIT_FORCE
build.logger(name);        // → a named build logger
build.reportBuildError(e); // → notifly + log
```

The environment helpers are the same plain functions the runtime contexts call ([src/utils/mode-helpers.js](../src/utils/mode-helpers.js)). See [environment-detection.md](environment-detection.md).

## Boot flow inside a page context's `initialize()`

1. **Boot the client**: `super.initialize(window.OMEGA_BUILD_JSON?.config)` (the snapshot the one `/build.js` the page template loads first assigns)
2. **Run the theme module**: its default export, called with `{ omega, options }`
3. **Track the launch**: the extension's own launch event, for the launch contexts
4. **Listen to auth**: `omega.auth.listen((state) => { /* { user, denied } */ })`
5. **Sync with background**: `syncWithBackground(omega)` from [src/lib/auth-helpers.js](../src/lib/auth-helpers.js), over `omega.messenger`; see [auth.md](auth.md)
6. **Install the broadcast / sign-out / auth-button listeners**: sign-in from another context, sign-out propagation, the `.omega-signin` / `.omega-account` triggers
7. **Bind verts**: `[data-omega-vert]` elements, house/company lane only
8. **Return the instance**

Background's `initialize()` wires the worker's `message` event, then the auth lane (`omega:syncAuth` and `omega:signOut` from the page contexts, the website token flow, the persisted session), then livereload in development. See [auth.md](auth.md).

## See also

- [components.md](components.md): the seven component contexts
- [extension.md](extension.md): the cross-browser chrome.* API wrapper
- [auth.md](auth.md): how background coordinates auth across contexts
- [environment-detection.md](environment-detection.md): `getEnvironment / isTesting / isDevelopment / isProduction`
