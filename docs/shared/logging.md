# Logging — the one tag contract

Every log line in the ecosystem carries ONE identity tag: `[@omega.js/<package>:<module>]`.
The module segment is the file's identity (`push`, `watcher`, `auth:sync` — sub-modules
join with `:`). Ratified 2026-07-29 ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)).

## The two surfaces

- **Build-time** (CLI, gulp, tests, the manager's services): the devkit logger prints a
  timestamp bracket first — `[HH:MM:SS] [@omega.js/web:watcher] message`. Construction
  stays `new Logger('watcher')`; the package segment derives at construction from the
  constructing file's nearest `package.json` (stack-based, cached, non-throwing —
  fallback `@omega.js/devkit`). Home: `packages/devkit/src/logger.js`.
- **Runtime** (browser, electron renderer/main, extension): NO timestamp — devtools
  stamps lines. Each runtime surface has its own logger emitting its own package
  segment: client `createLogger()` (`packages/client/src/modules/logger.js`), web
  core/js `createLogger()` (`packages/web/core/js/libs/logger.js`), and the
  desktop/extension `logger-lite` lineage.

## Markers and exemptions

- `[DRY RUN]` survives as a MARKER after the tag, never as an identity tag (casing
  unified; the lowercase form is retired).
- The manager's reconciliation report is product output, not logging — it stays
  untagged by design (ruling 2026-07-29). That covers ALL its rows: the indented
  `✓ / ~ / +` lines AND the `[DRY RUN]` rows printed through the same report
  (there the marker may open the line, since the report carries no tags at all).
- `packages/backend`'s `ctx.log` lineage has no tag yet —
  [#121](https://github.com/Omega-JS-Stack/omega/issues/121) tracks it; the guard
  test exempts the package with the reason stated.
- Test harnesses and fixtures are exempt; web's `core/js/pages/test/` demo pages are
  NOT (they ship).

## Enforcement

`scripts/log-tags.test.js` (runs in root `test:packages`) scans `packages/*/src` and
`packages/web/core/js` for any log call whose message starts with a static bracket tag
that is not `@omega.js/…` or the dry-run marker. It self-tests its own red path. New
code uses the surface's shared logger — never a hand-written bracket prefix.
