# Dependency updates (`omega update`)

One shared implementation (`@omega.js/devkit/update`) behind every framework's `omega update` verb, thin wiring in web/desktop/extension (router commands), backend (colon-style command class), and the manager (brand-root fan-out). Semantics mirror Ian's `npu out` (node-power-user): report every dependency, install the safe set, and never trust a brand-new release.

`omega update` acts by default, like `omega deploy`: a bare run prints the report, then installs. `omega update --dry-run` prints the same report and installs nothing.

## The report (every run)

For each dependency of the target's `package.json` (prod + dev, grouped):

| Column | Meaning |
|---|---|
| Current | the base version in `package.json` (`^1.2.3` → `1.2.3`) |
| Installed | the physical `node_modules` copy (nearest, climbing — npm hoists in brand monorepos) |
| Wanted | highest published version satisfying the range (npm-outdated semantics) |
| Latest | the registry `dist-tags.latest` |
| Bump | `patch` / `minor` / `major` — Current → Latest classification |
| Released | Latest's publish date + age in days |
| Status | `QUARANTINED` when Latest is younger than `--min-age` days (default **7**), not already installed, and not on the allowlist |

Only rows needing attention print; a fully-current tree reports one line. Rows sort prod-first.

**Quarantine (supply-chain caution, npu's `--min-age` semantics):** a release published < 7 days ago may be a compromised publish, so it is flagged and **excluded from the install**. `--min-age N` changes the window; `--min-age 0` or `--force-fresh` disables it for every package in the run.

**The allowlist:** one list names the packages the quarantine never holds, `QUARANTINE_EXEMPT` in `packages/devkit/src/update.js`, and it is the only place a package is named as exempt. An entry is an exact package name or a `<scope>/*` pattern; today it holds `@omega.js/*`. An exempt package is never `QUARANTINED` in the report and never held at install, whatever its age, while every other package keeps the hold in the same run. One helper, `isHeld`, is the age rule: the report row and the install selection both call it. The report's legend names the exempt set. Unpublished packages (the pre-publish `@omega.js/*` set) report `not on the registry (unpublished?)` instead of a version row.

**`file:`/`link:`/git specs are SKIPPED** with a dim note — they have no registry story. In the local era every brand's `@omega.js/*` dep is a `file:` spec, so the verb never touches the linked frameworks.

## Installing (a bare run)

- Default tier is **non-breaking**: each dep rides to its highest same-major version (npu's minor tier) — quarantined targets are held and listed.
- **Majors are never auto-applied**: breaking jumps are listed as held; `--major` opts in explicitly.
- Installs run through **`npu install`** when npu is on the machine (Socket supply-chain firewall); otherwise plain `npm install` with a loud warning. Dev deps install with `--save-dev` in their own pass.

## The @omega.js family is pinned, and `omega update` is its ONE mover ([#794](https://github.com/Omega-JS-Stack/omega/issues/794))

Every `@omega.js/*` spec the manager writes into a brand is an EXACT pin, never a
caret: `"@omega.js/manager": "0.50.0"` at the brand root, `"@omega.js/<framework>":
"0.50.0"` in each target, all at the manager's own version (the family ships
lockstep — [publishing.md](publishing.md)). A caret would let one target float
ahead alone on somebody's `npm update`, which is how a brand ends up serving two
copies of `@omega.js/client` and validating one omega.json5 with two validators.

Pinned, the only thing that moves a brand is `omega update` at the brand
ROOT (`--dry-run` reports and installs nothing), and it moves every target — and
the root's own manager pin — together. The install writes an `@omega.js/*` dep with
`--save-exact`, in its own command per dep group, so the mover never un-pins
what it just moved (npm's default save-prefix would write `^<version>` back);
every other dependency keeps npm's default prefix, because the pin is the
FAMILY's rule and not a rule for the whole tree.

The family is on the quarantine allowlist (`QUARANTINE_EXEMPT`, above), so a
brand moves to a family release the day it ships, without `--force-fresh`, and
a third-party dependency in the same run stays held until it has aged.

The manager's boot check enforces the other half: a brand whose installed
versions have drifted is refused before any service or dev leg runs
([../manager/brand.md](../manager/brand.md)). The local era is untouched — a
`file:` spec has no registry story, so the verb skips it and the boot check
exempts it. `omega i live` (the publish-day flip back off `file:` specs) writes
the same exact pin ([local-dev.md](local-dev.md) § API surface).

## Brand root

`omega update` at a brand root (manager) fans out over the brand's targets, cp251's deploy fan-out shape: same target discovery, same `--target=<name>[,<name>]` picker ([#780](https://github.com/Omega-JS-Stack/omega/issues/780)), every other flag forwarded verbatim, each target answering through its own framework's `update` verb. Unlike deploy, targets are **independent**: one failing target never blocks the rest (any failure still exits 1). The brand-root shell `package.json` rides the walk as its LAST leg ([#794](https://github.com/Omega-JS-Stack/omega/issues/794)), scoped to the one `@omega.js/*` dependency it carries (`@omega.js/manager`) and run in-process through the same devkit implementation (there is no framework bin at the root to spawn; it would dispatch straight back into this command). A brand's own root tooling is never touched, and a picked run (`--target=`) skips the root, because the picker names targets. Without that leg a manager-behind brand could never heal itself: the boot check would refuse every verb, and the fix it names would move every target except the one that was wrong.

**The by-hand steps.** After the "Update summary", a real install that moved the root's `@omega.js/manager` pin names the entries of the breaking-changes register ([breaking-changes.md](breaking-changes.md)) the brand crossed. An entry is due when its heading date is on or after the day the version the brand moved FROM was published, read from the registry `time` map the report already holds; the same day counts, since naming an entry already applied costs one line. The block reads the register from disk after the install, so it is the new version's copy:

```
By-hand steps since 0.54.1 (2):
  <date>: <title>
  <date>: <title>
Each entry's step is in: <brandRoot>/node_modules/@omega.js/manager/docs/shared/breaking-changes.md
```

Entries print newest first, each title without its issue link. When the old version's publish day is unknown, the block is one line, `By-hand steps for every shape OMEGA changed since <from>: <file>`. A dry run, a run that did not move the manager pin, or a move with no due entry prints no block. The parse, the block and the register path `omega migrate` also ends on live in the manager's `src/lib/breaking-changes.js`.

## Testing

Registry lookups, the clock, npu detection, and exec are all injectable — the devkit suite (`packages/devkit/test/update.test.js`) runs entirely offline against fixture packuments with a frozen clock; the manager fan-out test spawns fake framework bins; framework structure tests pin the wiring. The live path is the thin defaults (native `fetch` of the full packument — the abbreviated form carries no publish times).
