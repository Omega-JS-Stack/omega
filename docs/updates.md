# Dependency updates (`omega update`)

One shared implementation (`@omega.js/devkit/update`) behind every framework's `omega update` verb (aliases: `outdated`, `out` — npu's muscle memory), thin wiring in web/desktop/extension (router commands), backend (colon-style command class), and the manager (brand-root fan-out). Semantics mirror Ian's `npu out` (node-power-user): report first, apply deliberately, and never trust a brand-new release.

## The report (default — no flags)

For each dependency of the app's `package.json` (prod + dev, grouped):

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

## Brand root

`omega update` at a brand root (manager) fans out over the brand's apps — cp251's deploy fan-out shape: same app discovery, same `--only <target|dir>` / `--except` filter, every other flag forwarded verbatim, each app answering through its own framework's `update` verb. Unlike deploy, apps are **independent**: one failing app never blocks the rest (any failure still exits 1). The brand-root shell `package.json` is not scanned — apps own their deps.

## Testing

Registry lookups, the clock, npu detection, and exec are all injectable — the devkit suite (`packages/devkit/test/update.test.js`) runs entirely offline against fixture packuments with a frozen clock; the manager fan-out test spawns fake framework bins; framework structure tests pin the wiring. The live path is the thin defaults (native `fetch` of the full packument — the abbreviated form carries no publish times).
