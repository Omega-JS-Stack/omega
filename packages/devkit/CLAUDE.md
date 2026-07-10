# @omega.js/devkit

Shared build-time internals for the OMEGA frameworks. **Private workspace package — never published to npm.**

## How frameworks consume it

Frameworks require modules by name (`require('@omega.js/devkit/logger')`) and declare `@omega.js/devkit` as a **devDependency** (workspace-linked in the monorepo, absent from consumer installs). At prepare time, each framework's `preparePackage.hooks.after` runs [tools/vendor.js](tools/vendor.js), which copies the referenced modules into the framework's `dist/vendor/devkit/` and rewrites the requires to relative paths — so published tarballs are self-contained with zero **private** `@omega.js` references (enforced by CI's pack-smoke). Published `@omega.js` RUNTIME deps (desktop/extension's `@omega.js/client`) are never vendored — they stay normal package requires and resolve from the consumer install.

Vendored code resolves its deps (chalk, node-powertools) from the HOST framework's dependencies — the vendor tool fails if the host doesn't declare them.

## Modules

| Module | What it is | Extracted from |
|--------|-----------|----------------|
| `src/logger.js` | Build-time console logger (`new Logger(name)`, `.log/.error/.warn/.info`, `.format` = chalk) | Identical ×4 in UJM/BXM/EM/MAM (EM's cleaned copy is canonical) |
| `src/safe-install.js` | `safeInstall(cmd)` — routes `npm install` through Socket Firewall when available | Byte-identical ×4 in UJM/BXM/EM/@omega.js/backend |
| `src/attach-log-file.js` | Tee stdout/stderr to a log file, ANSI-stripped, stackable tees | Functionally identical ×4 (header now `# omega log`) |
| `src/cli-router.js` | `createCliRouter({ commandsDir, aliases, defaultCommand })` — the framework CLI dispatcher (positional/flag alias resolution → `commands/<name>.js`); `Main.config` exposes the dispatch table for structure tests | Drift-identical ×3 in UJM/BXM/EM (@omega.js/backend's CLI is a different design — colon-style stateful commands — and does not use this) |
| `src/prompt.js` | TTY-safe interactive prompts wrapping `@inquirer/prompts` (`input`/`select`/`checkbox`/`confirm` + `isInteractive()` + the `setPromptStreams` test seam): no TTY → input/select/checkbox throw instead of hanging, confirm auto-returns its default unless `{ required: true }`. Hosts that vendor it must declare `@inquirer/prompts` | omega-manager's `src/lib/prompt.js` (its `setParallelMode` global dropped — parallel runs are company-mode child processes with piped stdio, so the TTY check covers them; `isInteractive`/`setPromptStreams` are new) |
| `src/merge-line-files.js` | `mergeLineBasedFiles(existing, incoming, fileName)` — the OMEGA marker-section merge (.env/.gitignore/CLAUDE.md: framework owns `Default Values`, consumer owns `Custom Values`; .env values normalize to double-quoted). Also exports `hasSectionMarkers` for setup validators | EM's evolved copy (quote normalization + order-safe key substitution) + @omega.js/backend's custom-key promotion (a key the framework newly adopts is promoted UP from the consumer's Custom section with their value); BXM/UJM carried older inline variants |
| `src/defaults-engine.js` | `applyDefaults({ defaultsDir, outputDir, fileMap, files, transform })` — the defaults-scaffolding engine: minimatch FILE_MAP (overwrite/skip/name/path/template/merge/mergeLines, last-match-wins) + built-ins (`_.` renames, archive-dir skips, `.gitkeep` dirs, `.DS_Store` skip, write-only-if-changed, binary passthrough). Also exports `mergeJson5Defaults` + the tolerant `renderTemplate` | Normalized superset of BXM's gulp FILE_MAP task (the real impl) + EM's plain-fs `copyDefaults`; UJM carries a third copy of the BXM shape |
| `src/local.js` | Local-dev linking (master plan §8): `resolveMonorepoRoot` (env → self-location walk-up → conventional path), `findBrandRoot`/`discoverApps`, `frameworkPackagesOf` (incl. backend `functions/`), idempotent `linkLocalPackages`, lock-aware `startMonorepoWatch` + the `.omega/dev-watch.lock` protocol. Powers root `npm start` (scripts/watch-all.js), `omega dev --local`, and `omega i local` ×3. See [docs/local-dev.md](../../docs/local-dev.md) | New |
| `src/omega-bin.js` | The context-aware dispatcher behind every framework's `omega`/`omg`/`mgr` bins: `findTargetFramework` (nearest package.json walking up from cwd, incl. the backend `functions/` peek) → runs that framework's CLI via its `./cli` export; host match runs `hostRun` directly; no app context falls back to the HOST CLI (bootstrap case: `omega setup` in a fresh dir). Makes npm's arbitrary bin hoist-winner correct in brand monorepos | New |
| `tools/vendor.js` | The vendoring/rewrite tool (build-side only, never vendored itself) | New |

## Rules

- `src/` holds ONLY vendorable runtime modules — anything in `src/` ships inside every framework's dist. Build-side tooling goes in `tools/`.
- Tests: `npm test` (node:test). Migrates to the shared devkit test runner once that slice is extracted.
