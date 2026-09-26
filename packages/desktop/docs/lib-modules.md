# Lib Modules

`src/lib/*.js`: every Electron concern is its own module. Each exports one object with `initialize(omega)`; the main-process instance hangs each on itself by name and initializes them in a fixed order at boot (see [boot-sequence.md](boot-sequence.md)). Each module's deep reference lives at `docs/<lib-name>.md`; the module list is in the framework guide's Architecture section ([docs/desktop/index.md](../../../docs/desktop/index.md)).

## Lib initialization contract

Each lib exposes the same skeleton:

```js
const myLib = {
  _initialized: false,
  _omega: null,

  initialize(omega) {
    myLib._omega = omega;
    // wire IPC handlers, app event listeners, etc.
    myLib._initialized = true;
  },

  // Public API
  doThing() { ... },

  // Disable at runtime (idempotent)
  disable() {
    // tear down listeners; safe to call multiple times
  },
};

module.exports = myLib;
```

Don't use `EventEmitter` unless the lib genuinely emits multiple event types. For "fires once when ready" use a promise; for "broadcasts changes" use IPC with renderer subscriptions.

## Adding a new lib

1. Create `src/lib/<name>.js` exporting one object with `initialize(omega)`.
2. Wire it into the boot order in `src/main.js` (or the renderer/preload class if it's a per-context lib): check [boot-sequence.md](boot-sequence.md) for where it belongs and what it may depend on.
3. Set it on the instance in the `Omega` constructor as `this.<camelCaseName>`, so consumers reach it at runtime as `omega.<camelCaseName>`.
4. Write tests at every layer the lib has a surface in (see [test-framework.md](test-framework.md)) — at minimum `src/test/suites/main/<name>.test.js`.
5. Add a `docs/<name>.md` deep reference, add the module's row to the Lib modules table in the framework guide (`docs/desktop/index.md`), and link it from the Documentation index.

## Flat file vs directory split

- **Default to flat `src/lib/<name>.js`.**
- **Split into a directory** (`src/lib/<name>/{index,core,main,renderer,preload}.js`) ONLY when each Electron context has materially different logic that would force ugly runtime branching inside one file. `index.js` becomes a thin context detector that delegates.
- `lib/sentry/` was that split (the SDK has separate main/renderer/preload entry points) until it moved WHOLE into `@omega.js/monitoring` (#380) — the backend and the client needed the same policy, so the shape it proved now lives in the shared package. `lib/restart-manager/` is split for a different, also-valid reason — a **shared-SSOT split**: its `protocol.js` (the wire contract) must be importable by the Restart Manager app via the `exports` map with zero Electron/@omega.js/desktop baggage, so the contract lives in its own pure-Node file next to the main-only `index.js` + `install.js`. `sign-helpers/` is a helpers directory, not a lib.
- Don't split prophylactically; convert when the branching gets ugly.

## See also

- [boot-sequence.md](boot-sequence.md): the fixed `omega.initialize()` order + rationale
- [environment-detection.md](environment-detection.md): cross-context helpers shared by the three processes and the build module
- [test-framework.md](test-framework.md) — the four-layer harness new libs must ship tests in
