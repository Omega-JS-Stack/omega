# Project tests

This project has **two test lanes**, both scaffolded by the OMEGA verbs.

| Lane | Command | What it is |
|---|---|---|
| Static | `npm test` (= `npm run test:static`) | Plain `node --test` over `test/_unit/**/*.test.js`. **Socket-free**: `test/_helpers/connect-trap.js` is preloaded into every test process and turns any TCP connect or DNS lookup into a throw. No emulator, no network, no credentials — seconds to run. |
| Emulator | `npm run test:emulator` (= `npx omega test`) | Everything below: your suites, and the framework's, against a **real Firebase emulator**. |

## The static lane (`test/_unit/`)

The `_` prefix is load-bearing: the framework's test discovery skips `_`-prefixed paths, so these suites never run inside the emulator lane. Three skeletons ship with the project and are YOURS to extend:

| File | Pins |
|---|---|
| `_unit/registration.test.js` | `src/index.js` boots the framework that is actually installed; every route it dispatches to exists and its imports load (a broken require fails here, not at cold start) |
| `_unit/rules-posture.test.js` | Every Firestore/Storage path your rules open is declared in the suite — adding a rule is a deliberate act, not a diff nobody read |
| `_unit/socket-free.test.js` | The connect trap is loaded and refuses. Leave this one as shipped: without it, a lane that lost the `--require` flag would pass while reaching live Firebase |

A test that needs a real network client belongs in the emulator lane, which boots the environment it talks to. In the static lane, pass a stub.

## Layout (emulator lane)

Name every test file `<concern>.test.js` — the suffix is how the runner finds it, and a plain `.js` file under `test/` is support code that never runs. Match the framework's layout — OMEGA Backend's test runner discovers files by the directory they sit in. Mirror the same per-area split as the framework's own `test/` (see `node_modules/@omega.js/backend/test/`):

| Directory | Use for |
|---|---|
| `test/routes/` | Custom HTTP route handlers (`functions/routes/<verb>/<path>.js`) |
| `test/events/` | Pub/Sub / Firestore-trigger handlers |
| `test/helpers/` | Shared test utilities for your project |
| `test/fixtures/` | Static test data (JSON, sample docs) |
| `test/_init/` | Per-suite setup (Firestore seed data, user accounts) |

Tests run inside the Firebase emulator. Use the @omega.js/backend helpers (`ctx`, admin SDK, fixture loaders) instead of mocking — `npx omega emulator` boots the same environment the tests run against.

## Extended mode (real external APIs)

By default, tests skip REAL external services (SendGrid, OpenAI, Stripe webhooks, etc.) — the routes/libraries short-circuit in-source when not in extended mode. To exercise those paths for real, pass `--extended`:

```bash
npx omega test --extended            # opt into real external APIs
TEST_EXTENDED_MODE=true npx omega test   # identical — the env-var form
```

`--extended` is the CLI shorthand for the shared, unprefixed `TEST_EXTENDED_MODE` env var standardized across @omega.js/backend/BXM/UJM/EM. @omega.js/backend propagates it to BOTH the test runner and the running emulator, so a single flag on the test command flips everything — no need to restart the emulator. Anything an extended test creates in an external system MUST be cleaned up by the test (the runner only wipes local Firestore/Auth).

## Coverage

Every feature ships with tests at every surface it exposes — logic (handler suites), wiring (route round-trips over `http.as(...)`), and rules (when Firestore rules change). Skip a surface only when the feature genuinely doesn't have one; "the handler test covers it" does not excuse the route round-trip.

## Quick example

```js
// test/routes/hello.test.js
module.exports = {
  'GET /hello returns ok': async ({ http }) => {
    const res = await http.get('hello');
    if (res.status !== 200) throw new Error('expected 200');
  },
};
```

## See also

The framework's own test suites at `node_modules/@omega.js/backend/test/` are the canonical reference for how each layer is structured.
