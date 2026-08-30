# CLI Output Styling (`src/cli/utils/ui.js`)

@omega.js/backend's CLI shares a single styling module so every command renders with the same
look as the **OMEGA Manager** (`omega-manager`): `🚀` banner, 70-char `━`
dividers, indented tree output, dimmed labels, timestamps, and a consistent set
of status symbols. This is the **SSOT for console output** — commands should pull
helpers from here instead of hand-rolling `chalk` + `console.log`.

The module is exposed on every command as `this.ui` (wired in
[`src/cli/commands/base-command.js`](../src/cli/commands/base-command.js)) and can
also be `require('../utils/ui')`'d directly (e.g. from setup-test files).

## Conventions

| Aspect | Value |
|---|---|
| Divider | `━` × 70 (`ui.RULE_WIDTH`, `ui.RULE_CHAR`) |
| Indentation | 2 spaces per level (`ui.indent(level)`) |
| Section label | `[UPPERCASE]` in bold magenta, at indent level 1 |
| Section items | one level deeper than the label (level 2) |
| Timestamp | `new Date().toLocaleTimeString()` (e.g. `7:47:12 PM`) |
| Banner | bold cyan, prefixed with `🚀` |

### Status symbols (`ui.SYMBOLS`)

| Key | Symbol | Color | Meaning |
|---|---|---|---|
| `running` | `→` | dim | step in progress / hint |
| `pass` | `✓` | green | success |
| `fail` | `✗` | red | failure |
| `skip` | `⊘` | dim | skipped / no-op |
| `warn` | `⚠` | yellow | warning |
| `done` | `✅` | green | final success (summary) |
| `add` | `+` | green | created a file/record |
| `change` | `↻` | yellow | modified a file/record |

## API

```js
const ui = require('../utils/ui'); // or this.ui inside a command

ui.banner('OMEGA Backend v5.2.18');          // 🚀 bold-cyan banner + blank lines
ui.header('Somiibo', { subtitle: url });        // ━ divider / title @ time / ━ divider
ui.section('Checks');                            // blank line + bold-magenta [CHECKS]
ui.field('Project', 'somiibo-91d13', { pad: 9 });// dimmed "Label:" + value (pad aligns columns)
ui.status('pass', 'Stats fetched', { level: 2 });// <symbol> <text> at an indent level
ui.note('All defaults up to date', 2);           // dimmed line at a level
ui.blank();                                      // blank line
ui.rule();                                       // a bare 70-char rule string (cyan)
```

`ui.header(title, opts)`:
- `opts.subtitle` — text after the title (default cyan), e.g. a URL.
- `opts.subtitleColor` — chalk fn for the subtitle.
- `opts.time` — append `@ <time>` (default `true`).
- `opts.color` — chalk fn for the rules (default cyan).

`ui.field(label, value, opts)`:
- `opts.level` — indent level (default 1).
- `opts.pad` — pad the label (incl. colon) to this width for column alignment.
- `opts.valueColor` — chalk fn for the value.

`ui.status(kind, text, opts)`:
- `kind` — one of `running|pass|fail|skip|warn|add|change` (picks symbol + color).
- `opts.level` — indent level (default 1).
- `opts.detail` — dimmed trailing detail string.

### `ui.Summary`

Collects pass/warn/fail outcomes and prints an OMEGA-style summary block (green `✅`
when all passed, yellow `⚠` otherwise).

```js
const summary = new ui.Summary().start();
summary.pass();                        // record a pass
summary.warn('check name', detailsArr);// record a warning (non-blocking)
summary.fail('check name', detailsArr);// record a fail with pre-formatted detail lines
summary.print({ hint: 'Fix the above, then run npx omega test again.' });
```

Results line: `36 passed, 1 warned, 0 failed` (the warned segment only appears
when > 0). Warnings are listed before failures in the summary block — yellow `⚠`
lines with their detail arrays indented beneath.

## How the target checks use it

The AUDIT half of the retired `omega setup` — [`src/cli/utils/target-checks.js`](../src/cli/utils/target-checks.js),
the lane `omega test` runs before it boots anything — builds its whole run from
these helpers:

1. `ui.section('Target checks')` (printed by the test command) opens the lane.
2. the per-check status lines (printed by the check runner — see below), with
   `✓ fixed` / `✗ Could not fix` sub-lines.
3. `main.setupSummary.print()` when the lane finishes.

### Test runner (`Main.prototype.test` in `src/cli/index.js`)

Each target check prints `    [N] <symbol> <name>`. A check's `run()` can return:

| Return value | Behavior |
|---|---|
| `true` | `✓` pass (recorded via `setupSummary.pass()`) |
| `false` | Attempt `fix()` → `✓ fixed` on success, `✗ Could not fix` + halt on throw |
| `Error` | `✗` hard halt, no fix attempted |
| `'warn'` | `⚠` non-blocking warning — reported in summary, does **not** halt |

**`'warn'` return type:** When `run()` returns `'warn'`, the runner prints the
check as `⚠`, calls `getWarning()` on the test instance for detail lines (array
of strings), and records it via `setupSummary.warn()`. The lane continues. The
summary shows `36 passed, 1 warned, 0 failed` with the warning details listed
at the bottom. Use this for environment prerequisites that don't block dev/deploy
(e.g. Java, optional CLIs). `BaseTest` provides a default `getWarning()` returning
`[]`; override it with your detail lines.

A failing check's `fix()` may attach `error.summaryDetails` (an array of styled
lines) to surface a compact version in the summary block — see
[`setup-tests/bem-config.js`](../src/cli/commands/setup-tests/bem-config.js),
which lists the missing `config/omega.json5` keys.

`--continue` records the failure but keeps going instead of halting.

`--offline` makes the run READ-ONLY against the brand's cloud project
([#284](https://github.com/Omega-JS-Stack/omega/issues/284)): no mutation runs,
but live READS still do (it is a no-mutation flag, not a no-network flag — an
actually-offline machine still fails on the reads). The mutating checks
downgrade to a `'warn'` naming the flag, so a scaffold run in CI, a sandbox, or
a migration never rewrites production as a side effect: `firestore-indexes-synced`
still fetches and prints the drift but skips `firebase deploy --only
firestore:indexes` (its `fix()` is inert too, for direct callers),
`storage-lifecycle-policy` — whose check *is* the mutation — returns before any
`gsutil lifecycle set`, and `--seed-campaigns` is ignored (seeding writes real
Firestore docs, so the opt-in loses to `--offline`). Read-only checks are
unaffected. `BaseTest.isOffline` is the one reader of the flag.

> **No more `UnhandledPromiseRejection`.** Hard failures exit cleanly via
> `haltSetup()` / `process.exit(1)`, and `bin/omega-backend` wraps the run in a
> `try/catch` that prints a one-line `✗ <message>` instead of Node's raw rejection
> dump.

## Adopting it in other commands

`serve`, `deploy`, `test`, `emulator`, etc. can migrate to the same look
incrementally: replace ad-hoc `console.log(chalk...)` with `this.ui.section(...)`,
`this.ui.status(...)`, and `this.ui.field(...)`. The legacy
`log/logError/logSuccess/logWarning` helpers on `BaseCommand` still work for
simple one-off lines.
