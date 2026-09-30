<!-- ========== Default Values ========== -->
# Project tests

`npm test` (= `npx omega test`) runs every suite under `test/` against a **real Firebase emulator**: yours, and the framework's when you ask for them. A custom-server backend boots no emulator and runs the suites directly. While the suites run, a plain run is **socket-free past this machine**: the runner arms a connect trap after the emulator health check and account setup, and a TCP connect or DNS lookup to any host but loopback throws. The emulator on loopback stays reachable; `--extended` and `--lane=` runs stand the trap down, since they exist to reach real services.

## The unit suites (`test/unit/`)

Three skeletons ship with the project and are YOURS to extend. They need no emulator, so they also run on a custom-server backend (`projectType: 'custom'`), where a case whose Firebase file is absent skips:

| File | Pins |
|---|---|
| `unit/registration.test.js` | `src/index.js` boots the framework that is actually installed; every route it dispatches to exists and its imports load (a broken require fails here, not at cold start) |
| `unit/rules-posture.test.js` | Every Firestore/Storage path your rules open is declared in the suite: adding a rule is a deliberate act, not a diff nobody read |
| `unit/socket-free.test.js` | The connect trap is armed and refuses. Leave this one as shipped: it is what turns a run that lost the trap into a red test |

A test that needs a real network client passes a stub, or runs under `--extended`.

## Layout

Name every test file `<concern>.test.js`: the suffix is how the runner finds it, and a plain `.js` file under `test/` is support code that never runs. Match the framework's layout. OMEGA Backend's test runner discovers files by the directory they sit in. Mirror the same per-area split as the framework's own `test/` (see `node_modules/@omega.js/backend/test/`):

| Directory | Use for |
|---|---|
| `test/unit/` | No-emulator suites: registration, rules posture, socket-free (above) |
| `test/routes/` | Custom HTTP route handlers (`src/routes/<path>/<method>.js`) |
| `test/events/` | Pub/Sub / Firestore-trigger handlers |
| `test/helpers/` | Shared test utilities for your project |
| `test/fixtures/` | Static test data (JSON, sample docs) |
| `test/_init/` | Per-suite setup (Firestore seed data, user accounts) |

Tests run inside the Firebase emulator. Use what every test's `run()` receives (the real `omega` instance, a real `ctx`, `firestore`, `http`, `accounts`) instead of mocking: `npx omega emulator` boots the same environment the tests run against.

## Extended mode (real external APIs)

By default, tests skip REAL external services (SendGrid, OpenAI, Stripe webhooks, etc.): the routes/libraries short-circuit in-source when not in extended mode. To exercise those paths for real, pass `--extended`:

```bash
npx omega test --extended            # opt into real external APIs
TEST_EXTENDED_MODE=true npx omega test   # identical, the env-var form
```

`--extended` is the CLI shorthand for the shared, unprefixed `TEST_EXTENDED_MODE` env var standardized across all four OMEGA frameworks. @omega.js/backend propagates it to BOTH the test runner and the running emulator, so a single flag on the test command flips everything, no need to restart the emulator. Anything an extended test creates in an external system MUST be cleaned up by the test (the runner only wipes local Firestore/Auth).

## Coverage

Every feature ships with tests at every surface it exposes: logic (handler suites), wiring (route round-trips over `http.as(...)`), and rules (when Firestore rules change). Skip a surface only when the feature genuinely doesn't have one; "the handler test covers it" does not excuse the route round-trip.

## Quick example

A case file exports its spec through `defineCases`, from the framework's public test API (`@omega.js/backend/test`, one of the package's `exports`; a deep `dist/` path is refused):

```js
// test/routes/hello.test.js
const { defineCases } = require('@omega.js/backend/test');

module.exports = defineCases({
  description: 'GET /hello',
  type: 'group',
  tests: [
    {
      name: 'answers-ok',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.get('omega/hello');
        assert.isSuccess(response);
      },
    },
  ],
});
```

## See also

The framework's own test suites at `node_modules/@omega.js/backend/test/` are the canonical reference for how each layer is structured.

<!-- ========== Custom Values ========== -->
