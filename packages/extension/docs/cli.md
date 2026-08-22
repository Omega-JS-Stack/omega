# CLI

`npx omega <command>` — bins `omega`, `omg`, `mgr`, `omega-extension` (all the same context-aware dispatcher; `omega-extension` runs this framework's CLI directly).

## Commands

| Command | Aliases | Purpose |
|---|---|---|
| `setup` | `-s`, `--setup` | Scaffold a consumer project (copy `src/defaults/`, install peer deps, write projectScripts). Default when no command given. |
| `clean` | `-c`, `--clean` | Remove `dist/`, `packaged/`, `.cache/`, `.temp/` |
| `install` | `-i`, `i`, `--install` | Install peer deps (gulp, etc.) |
| `deploy` | `-d`, `--deploy` | Dispatch the extension's CI publish workflow — `publish.yml` standalone, the composed `<target>-publish.yml` inside a brand monorepo ([defaults.md](defaults.md#brand-monorepos); see docs/shared/deploys.md in the Omega repo) |
| `test` | `-t`, `--test` | Run the project's test suites (bare runs are project-only; `mgr:` / `framework:` / `full:` reach the framework suite). Positional target scopes by source + path; `--filter` matches test names; `--extended` enables real-external-API tests. See [test-framework.md](test-framework.md). |
| `update` | `-u`, `--update`, `outdated`, `out` | Dependency freshness report (installed/wanted/latest + patch/minor/major, releases < 7 days old QUARANTINED). `--apply` installs the non-breaking non-quarantined set via `npu install` (plain npm + loud note without npu); `--major` opts into breaking; `--min-age N` / `--force-fresh` tune the quarantine. `file:` specs skipped. Shared devkit implementation — see docs/shared/updates.md in the Omega repo. |
| `version` | `-v`, `--version` | Print @omega.js/extension, Node, peer-dep versions |
| `help` | `-h`, `--help` | Command listing (router built-in, generated from this table's live aliases) |

## Entry point

[bin/omega-extension](../bin/omega-extension) — yargs-based shim that loads [src/cli.js](../src/cli.js).

[src/cli.js](../src/cli.js) owns only the alias table and the commands directory — dispatch (positional/flag alias resolution, command loading, error surfacing) is the shared devkit router (`createCliRouter`, vendored into `dist/vendor/devkit/cli-router.js` at prepare time). The returned Main class exposes the resolved dispatch table as `Main.config` for structure tests.

## Adding a new command

1. Create `src/commands/<name>.js` exporting `async function (options) { /* ... */ }`
2. Add to the `aliases` table in [src/cli.js](../src/cli.js):
   ```js
   aliases: {
     clean:   ['-c', '--clean'],
     setup:   ['-s', '--setup'],
     <name>:  ['-x', '--<name>'],
   },
   ```
3. Optionally add to `projectScripts` in [package.json](../package.json) so consumers get a wrapper npm script on `npx omega setup`.
4. Document under this page.

## Command options

Yargs parses `--foo bar` and `--foo=bar` into `options.foo`. Positional args go into `options._[]`. Each command reads what it needs:

```js
// src/commands/test.js
module.exports = async function (options) {
  const layer    = options.layer    || 'all';
  const target   = (options._ && options._[1]) || null; // positional: `npx omega test <target>`
  const filter   = options.filter   || null;
  const reporter = options.reporter || 'pretty';
  // ...
};
```

## Env var conventions

Commands read BXM-prefixed env vars for behavior switches (one exception: `TEST_EXTENDED_MODE` is deliberately unprefixed — the SAME name across all OMEGA frameworks):

| Env | Used by | Purpose |
|---|---|---|
| `OMEGA_BUILD_MODE=true` | gulp tasks | Production build mode |
| `OMEGA_IS_PUBLISH=true` | gulp/package | Also publish to extension stores after packaging |
| `OMEGA_LOG_FILE` | gulp + test runners | Override the stdout/stderr tee path, or `false` to disable (see [logging.md](logging.md)) |
| `OMEGA_TEST_MODE=true` | test runners | Powers `Manager.isTesting()` (auto-set by `npx omega test`) |
| `TEST_EXTENDED_MODE=true` | test runners | Run tests that hit REAL external services (`--extended` is the CLI shorthand; see [test-framework.md](test-framework.md)) |
| `OMEGA_TEST_BOOT_PROJECT` | test/boot | Override project root for boot tests |
| `OMEGA_TEST_BOOT_DIR` | test/boot | Override extension dir directly |
| `OMEGA_TEST_DEBUG=1` | test runners | Pipe Chromium stderr to console |
| `OMEGA_LIVERELOAD_PORT` | gulp/serve | WebSocket port (default 35729) |

## See also

- [build-system.md](build-system.md) — `gulp` is what most CLI commands ultimately invoke
- [test-framework.md](test-framework.md) — `npx omega test` command surface
- [defaults.md](defaults.md) — `npx omega setup` invokes the defaults task
