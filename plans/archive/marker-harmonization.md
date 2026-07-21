---
status: superseded
created: 2026-07-10
---
# Marker-block harmonization — ONE style family (Ian 2026-07-10)

> Status: **IMPLEMENTED (checkpoint 75)** — Ian: "ensure that any marker blocks (think of the
> .gitignore merging, plus any others) should be HARMONIOUS, no more ALL OVER THE PLACE
> DIFFERENT STYLES/FLAVORS." Survey → design → sweep, this doc is the record.

## Survey — every machine-parsed marker in the monorepo (cp75)

| # | Flavor | Syntax | Parsed by | Verdict |
|---|--------|--------|-----------|---------|
| 1 | Two-zone section pair | `# ========== Default Values ==========` / `# ========== Custom Values ==========` | devkit `merge-line-files` (SSOT; backend/desktop shims re-export), desktop `push-secrets`, backend `setup-tests/{gitignore,env-file}.js`, `public-files.js`, devkit `defaults-engine` (`mergeLines`) | **Already uniform** across `_.env` / `_.gitignore` / consumer `CLAUDE.md` in every framework + web scaffold — this IS the family. Two hygiene defects: push-secrets re-declared its own literals; backend gitignore.js imported `DEFAULT_SECTION_MARKER` but inlined the Custom literal. |
| 2 | Rules managed block | `///---omega---///` open · `///---version=X---///` stamp · `///--------tests--------///` + `///------resources------///` inner dividers · `///---------end---------///` close | backend `setup-tests/helpers.js` (`omegaAllRulesRegex`), `setup.js` (`rulesVersionRegex`, core extraction, `=0.0.0-` version substitution) | **The odd flavor out** — FOUR sub-shapes in one block, none matching the section grammar. Re-cut (below). |
| 3 | Insertion placeholder | `# ...` inside the gitignore template's Custom section | backend `setup-tests/gitignore.js` `fix()` | Keep — it's an insertion hint, not a block marker; documented as part of the protocol. |
| 4 | `.omega/` ignore ensure | plain comment + entry lines, presence-checked | manager `lib/gitignore.js` | Not a marker block (idempotence via line presence). Out of scope. |
| 5 | Remote-resource tag | `(managed by OMEGA — do not edit manually)` in webhook descriptions | beehiiv webhook diff | Not a file marker; the wording is already consistent. Out of scope. |

Cosmetic `// ========== x ==========` section comments inside source/SCSS are styling, not
machine-parsed markers — out of scope.

## The family (design)

ONE grammar for every machine-parsed marker:

```
<comment> ========== <Label> ==========
```

- `<comment>` = the host file's line-comment token: `#` (env, gitignore, CLAUDE.md), `//`
  (firestore.rules, database.rules.json, JS-ish). Same words/structure everywhere; only the
  comment token adapts.
- Exactly ten `=` per side, single spaces around the label.

Labels:

| Job | Markers |
|-----|---------|
| Two-zone merge files | `Default Values` / `Custom Values` — **unchanged** (majority rule: the uniform 90% defines the family) |
| Managed rules block | `OMEGA Rules (vX.Y.Z)` open (version folded in — the separate version line dies) · `Tests` / `Resources` inner dividers · `End OMEGA Rules` close |
| Insertion placeholder | `# ...` (inside Custom) |

## Sweep (blast zones)

- backend `setup-tests/helpers.js`: `omegaAllRulesRegex` → the family form (3 capture groups kept).
- backend `setup.js`: `rulesVersionRegex` → matches the open marker's `(vX.Y.Z)`; template
  version substitution `(v0.0.0)` → `(v${version})`.
- Templates `firestore.rules` + `database.rules.json`: all five marker lines re-cut.
- Sandbox consumer rules files ×2: markers re-cut (stale core versions left for `omega setup`
  fix() to converge — live-proven).
- Rules-test error messages + backend `src/defaults/CLAUDE.md` block reference.
- Hygiene: push-secrets imports `DEFAULT_MARKER`/`CUSTOM_MARKER` from the merge-line-files
  shim; backend gitignore.js imports the Custom marker instead of inlining it.
- Migration handoff: `///---omega---///` (the cp72→cp74 interim flavor) joins the pinned
  migration-tooling format list in PROGRESS (with `{{ backend-manager }}`, `# BEM>>>`,
  `///---backend-manager---///`). Evergreen `mgr setup` speaks ONLY the family grammar.
