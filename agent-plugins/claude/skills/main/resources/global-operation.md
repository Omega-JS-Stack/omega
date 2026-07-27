# Global Operation Across Repos

Perform the same operation across multiple OMEGA projects — either the **framework repos** themselves or their **consumer brand repos**.

## Scope: Framework vs Consumer

Infer which scope from the task:

| Signal | Scope | Target |
|--------|-------|--------|
| "all frameworks", "every framework", "mirrored change", "CLAUDE.md in all frameworks", mentions UJM+BEM+BXM+EM by name | **Framework** | The 4-5 framework repos directly |
| "all brands", "all projects", "every repo", "all sites", mentions a framework type generically | **Consumer** | Brand repos discovered via `npm run brands` |

**Framework scope** skips the brand-list step — the repos are fixed and known (table below).

## Dual CLAUDE.md Pattern (Framework Scope)

Every framework repo has **TWO** CLAUDE.md files that must stay in sync for doc updates:

| File | Purpose | Audience |
|------|---------|----------|
| `CLAUDE.md` (repo root) | Framework developer docs | Anyone working ON the framework |
| `src/defaults/CLAUDE.md` | Consumer project template | Scaffolded into consumer repos via `npx mgr setup` |

**When updating framework docs**, check if the content belongs in one or both:

- **Framework internals** (webpack config, gulp tasks, lib module API) → root `CLAUDE.md` only
- **Consumer-facing patterns** (how to use the framework, what to import, what NOT to install, dependency resolution, web-manager/Firebase rules) → **BOTH** — root `CLAUDE.md` for framework devs, `src/defaults/CLAUDE.md` for consumer projects
- **Mirrored sections** (same content across all 4 frameworks) → update the SAME section in the SAME position in ALL repos, in BOTH files where relevant

Remember each framework's CLAUDE.md is a table of contents — the meat belongs in `docs/<topic>.md` (mirrored filenames across frameworks where the concept matches).

## Workflow

1. **Select framework types** — ask the user which types to target with a **multiselect** question:

   ```
   AskUserQuestion:
     question: "Which project types should this global operation target?"
     header: "Frameworks"
     multiSelect: true
     options:
       - label: "UJM (Websites)"
         description: "Ultimate Jekyll Manager — frontend static sites"
       - label: "BEM (Backends)"
         description: "Backend Manager — Firebase functions & backend services"
       - label: "BXM (Browser Extensions)"
         description: "Browser Extension Manager — Chrome/Firefox extensions"
       - label: "EM (Desktop Apps)"
         description: "Electron Manager — desktop Electron applications"
       - label: "MAM (Mobile Apps)"
         description: "Mobile App Manager — mobile applications"
   ```

   Map selections to `--path` aliases and framework repo paths:

   | Selection | --path value | Framework repo path |
   |-----------|-------------|---------------------|
   | UJM | `website` | `/Users/ian/Developer/Repositories/ITW-Creative-Works/ultimate-jekyll-manager` |
   | BEM | `backend` | `/Users/ian/Developer/Repositories/ITW-Creative-Works/backend-manager` |
   | BXM | `browser-extension` | `/Users/ian/Developer/Repositories/ITW-Creative-Works/browser-extension-manager` |
   | EM | `desktop` | `/Users/ian/Developer/Repositories/ITW-Creative-Works/electron-manager` |
   | MAM | `mobile` | `/Users/ian/Developer/Repositories/ITW-Creative-Works/mobile-app-manager` |

2. **Get the repo list** —
   - **Consumer scope:** for each selected type, run
     ```bash
     cd /Users/ian/Developer/Repositories/ITW-Creative-Works/omega-manager && npm run brands -- --path={alias}
     ```
     Collect all output paths (one repo path per line).
   - **Framework scope:** use the framework repo paths from the table directly. Mirrored sections must be inserted in the **identical position** across all selected frameworks.

3. **Determine the task** — use the user's stated task. If none was given, ask: **"What operation should be performed on each project?"** Example: a **brand-wide or fleet-wide audit** = each agent runs the repo's framework audit per its `docs/audit.md` (the `omega:<fw>` Audit process — ID'd check catalog + fix loop), and the summary report aggregates findings by check ID.

4. **Confirm scope** — display a summary (repos per framework type, total repos, task description) and ask for confirmation before proceeding.

5. **Prototype on the first repo** — launch a single agent on the first repo, show the user the result (git diff or summary), and **wait for approval** before proceeding. This catches issues before they propagate.

6. **Launch agents in parallel** — after prototype approval, launch a dedicated agent per remaining repo, in parallel batches. Each agent prompt includes the repo path, the exact task, and the safety rules:

   ```
   Agent:
     description: "Global op: {repo-name}"
     prompt: |
       Repo: {repo_path}
       Task: {task_description}

       Rules:
       - Only work within src/ — never touch dist/, node_modules/, or build output
       - NEVER search or operate in these directories (for efficiency): _legacy, _backup, _site, dist, node_modules. Exclude them from all Glob, Grep, and file operations.
       - Do NOT commit or push changes
       - After making changes, run git diff to verify
       - If the task doesn't apply to this repo (missing files, not relevant), skip it and report why
   ```

7. **Summary report** — total repos processed, successful changes (brief description per repo), skipped repos (with reasons), failed repos (with errors).

## Safety Rules

The skill's Hard rules apply to every agent and every repo: never commit/push without explicit request; preserve existing functionality; only work in `src/`; always verify with `git diff`; prototype first — never bulk-apply untested changes; skip `_legacy`/`_backup`/`_site`/`dist`/`node_modules` everywhere.

## See also

- [find-repo.md](find-repo.md) — resolving brand names to repo paths
