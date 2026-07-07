# @omegajs/devkit

Shared build-time internals for the OMEGA frameworks. **Private workspace package — never published to npm.**

## How frameworks consume it

Frameworks require modules by name (`require('@omegajs/devkit/logger')`) and declare `@omegajs/devkit` as a **devDependency** (workspace-linked in the monorepo, absent from consumer installs). At prepare time, each framework's `preparePackage.hooks.after` runs [tools/vendor.js](tools/vendor.js), which copies `src/` into the framework's `dist/vendor/devkit/` and rewrites the requires to relative paths — so published tarballs are self-contained with zero `@omegajs` references (enforced by CI's pack-smoke).

Vendored code resolves its deps (chalk, node-powertools) from the HOST framework's dependencies — the vendor tool fails if the host doesn't declare them.

## Modules

| Module | What it is | Extracted from |
|--------|-----------|----------------|
| `src/logger.js` | Build-time console logger (`new Logger(name)`, `.log/.error/.warn/.info`, `.format` = chalk) | Identical ×4 in UJM/BXM/EM/MAM (EM's cleaned copy is canonical) |
| `src/safe-install.js` | `safeInstall(cmd)` — routes `npm install` through Socket Firewall when available | Byte-identical ×4 in UJM/BXM/EM/BEM |
| `src/attach-log-file.js` | Tee stdout/stderr to a log file, ANSI-stripped, stackable tees | Functionally identical ×4 (header now `# omega log`) |
| `src/cli-router.js` | `createCliRouter({ commandsDir, aliases, defaultCommand })` — the framework CLI dispatcher (positional/flag alias resolution → `commands/<name>.js`); `Main.config` exposes the dispatch table for structure tests | Drift-identical ×3 in UJM/BXM/EM (BEM's CLI is a different design — colon-style stateful commands — and does not use this) |
| `tools/vendor.js` | The vendoring/rewrite tool (build-side only, never vendored itself) | New |

## Rules

- `src/` holds ONLY vendorable runtime modules — anything in `src/` ships inside every framework's dist. Build-side tooling goes in `tools/`.
- Tests: `npm test` (node:test). Migrates to the shared devkit test runner once that slice is extracted.
