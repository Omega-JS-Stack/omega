# Dependency updates (`omega update`)

One shared implementation (`@omega.js/devkit/update`) behind every framework's `omega update` verb (aliases: `outdated`, `out` — npu's muscle memory), thin wiring in web/desktop/extension (router commands), backend (colon-style command class), and the manager (brand-root fan-out). Semantics mirror Ian's `npu out` (node-power-user): report first, apply deliberately, and never trust a brand-new release.

## The report (default — no flags)

For each dependency of the target's `package.json` (prod + dev, grouped):

| Column | Meaning |
|---|---|
| Current | the base version in `package.json` (`^1.2.3` → `1.2.3`) |
| Installed | the physical `node_modules` copy (nearest, climbing — npm hoists in brand monorepos) |
| Wanted | highest published version satisfying the range (npm-outdated semantics) |
| Latest | the registry `dist-tags.latest` |
| Bump | `patch` / `minor` / `major` — Current → Latest classification |
| Released | Latest's publish date + age in days |
| Status | `QUARANTINED` when Latest is younger than `--min-age` days (default **7**) and not already installed |

Only rows needing attention print; a fully-current tree reports one line. Rows sort prod-first.

**Quarantine (supply-chain caution, npu's `--min-age` semantics):** a release published < 7 days ago may be a compromised publish — it is flagged and **excluded from `--apply`**. `--min-age N` changes the window; `--min-age 0` or `--force-fresh` disables it. Unpublished packages (the pre-publish `@omega.js/*` set) report `not on the registry (unpublished?)` instead of a version row.

**`file:`/`link:`/git specs are SKIPPED** with a dim note — they have no registry story. In the local era every brand's `@omega.js/*` dep is a `file:` spec, so the verb never touches the linked frameworks.

## Applying (`--apply`)

- Default tier is **non-breaking**: each dep rides to its highest same-major version (npu's minor tier) — quarantined targets are held and listed.
- **Majors are never auto-applied**: breaking jumps are listed as held; `--apply --major` opts in explicitly.
- Installs run through **`npu install`** when npu is on the machine (Socket supply-chain firewall); otherwise plain `npm install` with a loud warning. Dev deps install with `--save-dev` in their own pass.

## The @omega.js family is pinned, and `omega update` is its ONE mover ([#794](https://github.com/Omega-JS-Stack/omega/issues/794))

Every `@omega.js/*` spec the manager writes into a brand is an EXACT pin, never a
caret: `"@omega.js/manager": "0.50.0"` at the brand root, `"@omega.js/<framework>":
"0.50.0"` in each target, all at the manager's own version (the family ships
lockstep — [publishing.md](publishing.md)). A caret would let one target float
ahead alone on somebody's `npm update`, which is how a brand ends up serving two
copies of `@omega.js/client` and validating one omega.json5 with two validators.

Pinned, the only thing that moves a brand is `omega update --apply` at the brand
ROOT (a bare run reports and installs nothing), and it moves every target — and
the root's own manager pin — together. `--apply` installs an `@omega.js/*` dep with
`--save-exact`, in its own command per dep group, so the mover never un-pins
what it just moved (npm's default save-prefix would write `^<version>` back);
every other dependency keeps npm's default prefix, because the pin is the
FAMILY's rule and not a rule for the whole tree.

The manager's boot check enforces the other half: a brand whose installed
versions have drifted is refused before any service or dev leg runs
([../manager/brand.md](../manager/brand.md)). The local era is untouched — a
`file:` spec has no registry story, so the verb skips it and the boot check
exempts it. `omega i live` (the publish-day flip back off `file:` specs) writes
the same exact pin ([local-dev.md](local-dev.md) § API surface).

## Brand root

`omega update` at a brand root (manager) fans out over the brand's targets — cp251's deploy fan-out shape: same target discovery, same `--target=<target|dir>` picker ([#780](https://github.com/Omega-JS-Stack/omega/issues/780)), every other flag forwarded verbatim, each target answering through its own framework's `update` verb. Unlike deploy, targets are **independent**: one failing target never blocks the rest (any failure still exits 1). The brand-root shell `package.json` rides the walk as its LAST leg ([#794](https://github.com/Omega-JS-Stack/omega/issues/794)), scoped to the one `@omega.js/*` dependency it carries — `@omega.js/manager` — and run in-process through the same devkit implementation (there is no framework bin at the root to spawn; it would dispatch straight back into this command). A brand's own root tooling is never touched, and a picked run (`--target=`) skips the root, because the picker names targets. Without that leg a manager-behind brand could never heal itself: the boot check would refuse every verb, and the fix it names would move every target except the one that was wrong.

## Testing

Registry lookups, the clock, npu detection, and exec are all injectable — the devkit suite (`packages/devkit/test/update.test.js`) runs entirely offline against fixture packuments with a frozen clock; the manager fan-out test spawns fake framework bins; framework structure tests pin the wiring. The live path is the thin defaults (native `fetch` of the full packument — the abbreviated form carries no publish times).
