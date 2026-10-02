# The agent-docs chain (AGENTS.md)

**The problem**: every project needs current framework guidance for AI agents, but copying it into each project drifts. **The design**: every agent entry imports ONE map, `docs/omega.md`, and the map's pointers (plus the omega plugin's hooks) route to the rest of `docs/`. Every project root, a brand monorepo or one framework used alone, carries the same `AGENTS.md`: that one import under the framework's Default marker, then the project's own notes under the Custom marker. The brand-root knowledge itself lives in `docs/manager/brand.md`; no AGENTS.md anywhere carries framework content of its own.

## Supported shape

- **The supported shape is a brand monorepo with a `targets/` folder**, as in `brands/playground-omega`. All framework work is aimed at it.
- **One framework used alone in a repo works, but is not fully supported.** Its root gets the same `AGENTS.md` a brand root does. The framework docs ship in `@omega.js/manager`: a brand installs it already, and a project using one framework alone adds `@omega.js/manager` as a dev dependency to get them. Until it does, the import line still names the path the docs land at.

## The chain

```
<project>/AGENTS.md                           Default section: @node_modules/@omega.js/manager/AGENTS.md
                                              Custom section:  the project's own notes, NEVER touched by the framework
node_modules/@omega.js/manager/AGENTS.md      the one line: @docs/omega.md
node_modules/@omega.js/manager/docs/omega.md  the map (the whole docs tree ships beside it)
```

The file speaks the markdown flavor of the one marker grammar ([docs/devkit/index.md](../devkit/index.md), `merge-line-files.js`), so a fresh one is exactly:

```
<!-- ========== Default Values ========== -->
@node_modules/@omega.js/manager/AGENTS.md

<!-- ========== Custom Values ========== -->
```

The Custom section is just its marker line: no generated heading, no boilerplate, so nothing below it can drift from the brand. The project is a brand root or the root of one framework used alone. A brand target carries none: Claude Code walks parent directories, so the brand root's chain covers a session inside a target.

In the monorepo the root `AGENTS.md` opens with the same `docs/omega.md` import, then adds only the rules for working on omega itself. So a monorepo agent and a brand agent read the same map, and no sentence of it lives twice.

`AGENTS.md` is the entry for every agent: Claude Code reads it natively, so the framework writes no `CLAUDE.md` anywhere, and one a brand keeps for itself is the brand's own file, never read or touched by the manage cycle or a scaffold.

- An import path resolves relative to the file that holds it, so the manager's one line works the same in the monorepo and inside a brand's `node_modules`.
- The import path is **relative** (portable to any machine). For hoisted installs (the in-repo test brands are npm workspaces of this monorepo) the ensure step walks up and writes the correct depth, e.g. `@../../node_modules/@omega.js/manager/AGENTS.md`.
- Non-Claude agents read `AGENTS.md` but don't follow `@` imports; the import line itself names the target path for them.

## Maintenance

ONE builder writes every project-root `AGENTS.md`: devkit's `agents-md` (`packages/devkit/src/agents-md.js`), the lowest package the manager and all four frameworks already depend on. It has two callers. The manage cycle's `workspace` service (`agents` op: `packages/manager/src/services/workspace/ensure/agents.js`) owns a brand root's `AGENTS.md` and the retired link. Each framework's scaffold, which every verb runs through its ensure-target, gives a standalone project root the same file and keeps a brand target free of one. Devkit's `docs-sync` boot prelude (`packages/devkit/src/preludes/docs-sync.js`) runs before every omega verb but a read-only one on all five CLIs and owns a linked manager's docs:

| State found | Action |
|---|---|
| No `AGENTS.md` at a project root | Created: the import under Default, an empty Custom section |
| The marked file, import at the right depth | No-op |
| The marked file, a stale-depth or retired import in the Default section, or lines above the Default marker | Healed through the marker engine: the Default section rewritten, the Custom section verbatim, any lines above the Default marker moved to the top of Custom |
| Any unmarked `AGENTS.md`: the import-on-line-1 shape (with its generated `# <name>: project notes` or `# <name>: brand notes` heading), a hand-written file (one quoting the markers inline included: a marker counts only as a whole line), or the retired per-framework template (the `#` `Default Values` / `Custom Values` markers) | Converged on the next verb, loudly: every import line, the generated heading, the retired template's framework section and its shipped boilerplate go; every other line lands under the Custom marker, in order |
| An `AGENTS.md` in a brand target | Removed, loudly, when it holds nothing the consumer wrote (the builder's skeleton or an old template's boilerplate); kept with a move-it-to-the-brand-root warning when it carries notes |
| The retired `node_modules/@omega.js/AGENTS.md` symlink in the scope | Removed |
| A locally linked manager (its real path is `packages/manager` in a monorepo checkout) | Before every omega verb but a read-only one: its `docs/` synced from the monorepo's `docs/`, writing only the files that changed, so a linked brand reads the live map |
| A published manager | Left alone: it ships the docs of its own version |

Pinned by `packages/devkit/test/agents-md.test.js` (path resolution, the retired link and import, the marked shape, create/heal/converge from every older shape/idempotence, content preservation, the brand-target sweep, the scaffold step), `packages/manager/test/agents-md.test.js` (the manager's one-line AGENTS.md and its files entry, the workspace op, the two-import chain (three files) on a linked fixture brand, no `CLAUDE.md` written or read), each framework's scaffold suite (backend `test/boot/defaults-scaffold.test.js`, desktop and extension `src/test/suites/build/defaults-scaffold.test.js`, web `packages/web/test/cli.test.js`: a standalone scaffold writes the builder's file, an old template converges, a brand target gets none; web's `test/ensure-target.test.js` sees the builder's warning reach the verb), and `packages/devkit/test/prelude-docs-sync.test.js` (the local docs sync).

## The manager ships the docs

A brand has no monorepo to point at, so the prepare lane ships the knowledge INSIDE `@omega.js/manager`, the one package every brand installs. No other publishable ships docs. The devkit vendor hook every framework already runs (`packages/devkit/tools/vendor-docs.js`, called from `tools/vendor.js`) copies:

| Monorepo source | Shipped as | Notes |
|---|---|---|
| `docs/` (the whole tree) | `manager/docs/` | Same shape, so every link inside the tree keeps working |

The Claude plugin does not ride in any package: a machine fetches it from GitHub ([below](#the-omega-plugin-reaches-every-machine-from-the-right-place)).

The manager's own `AGENTS.md` is tracked, not generated: one line importing `docs/omega.md`.

Links that leave `docs/` are retargeted on the way in (`rewriteDocLinks`): a `packages/<pkg>/...` link points at the sibling package in the installed `@omega.js` scope, and anything else (`agent-plugins/...`, `brands/...`, root files) keeps its words and loses the link. A sibling that never publishes (`devkit`) or isn't installed leaves a dead relative link. A locally linked manager sits in `packages/`, so the same links land on the live sources.

Everything written is GENERATED: gitignored, and `syncDocs` writes only a file whose content changed and removes any file the source no longer has. Pinned by `packages/devkit/test/vendor-docs.test.js` (fixture monorepo) plus `scripts/vendor-docs.test.js`, which packs every publishable for real and reads the tarball listings.

Version-matched by construction: the docs in `node_modules/@omega.js/manager/docs/` are the docs of the version installed there. The plugin is not: it follows releases on its own, below.

## The omega plugin reaches every machine from the right place

Claude Code keeps ONE source record per marketplace name for the whole machine, and a session starts on whatever record the last project left. So the plugin has two names that never share a record:

| Name | Plugin id | Source | Who loads it |
|---|---|---|---|
| `omega` | `omega@omega` | GitHub `Omega-JS-Stack/omega`, a sparse checkout of `.claude-plugin` and `agent-plugins/claude` | every consumer, every live brand |
| `omega-local` | `omega@omega-local` | a monorepo checkout's second manifest, `.claude-plugin/marketplace.local.json`, read in place | this monorepo, every linked brand, and an omega developer's empty folder |

**Every settings file that turns one copy on turns the other off.** With both on, a session loads either copy from run to run.

- **A brand's committed `.claude/settings.json` names the published copy**, the same for every brand and every clone. The workspace service's `claude-settings` op writes and heals it on every manage and every `npm start`, a linked brand included:

  ```json
  {
    "extraKnownMarketplaces": {
      "omega": {
        "source": { "source": "github", "repo": "Omega-JS-Stack/omega", "sparsePaths": [".claude-plugin", "agent-plugins/claude"] },
        "autoUpdate": true
      }
    },
    "enabledPlugins": { "omega@omega": true, "omega@omega-local": false }
  }
  ```

- **A linked brand gets a private file.** While the brand is linked to a monorepo checkout (devkit's `resolveLinkedMonorepo`, the one answer to that question), the same op puts the local name into the gitignored `.claude/settings.local.json`: `omega-local` as a `file` source at that checkout's `.claude-plugin/marketplace.local.json`, local on, published off. When the brand is not linked, those keys leave the file, and a file left empty is removed. `omega i local` and `omega i live` run the op too, so the swap needs no other step.
- **This monorepo's committed settings name `omega-local`** by a relative path, local on and published off, so the monorepo never fights a live brand for the `omega` record.
- **The published copy is installed machine-wide.** A brand's settings alone do not load it at session start, so one helper (`packages/manager/src/lib/claude-machine.js`) registers `omega` from GitHub (moving a record that points anywhere else) and installs `omega@omega` for the user. Onboarding offers it in a terminal, default yes; a run with no terminal skips the offer, and declining changes nothing else. `omega manage` prints one line while it is not installed: `Claude plugin not installed on this machine. Run: claude plugin marketplace add Omega-JS-Stack/omega && claude plugin install omega@omega`.
- **An omega developer's machine defaults to the local copy.** `omega i local` first moves an `omega` record that points anywhere but GitHub (a folder, from before the two names) onto GitHub, the same move the workspace op makes, so one name never has two sources. It then registers `omega-local` through the CLI (`claude plugin marketplace add <checkout>/.claude-plugin/marketplace.local.json`, skipped when the record already points there), since a session does not load a `file` source the settings alone declare. Last it writes the user settings file (`settings.json` in `CLAUDE_CONFIG_DIR`, else `~/.claude`) in the same shape a linked brand's private file carries: `omega-local` on, `omega@omega` off. Every other key in that file is kept, a file that does not parse is never overwritten, and a failing `claude` is a warning, never a failed verb. An empty folder then loads the local copy, and a live brand still loads the published one, because its committed settings say so.
- **The plugin follows releases, not commits.** `agent-plugins/claude/.claude-plugin/plugin.json` carries the family version, and the release check holds the two together ([publishing.md](publishing.md)). Claude Code ignores a new commit under the same version, so a machine moves at the next ship. `omega manage` runs `claude plugin marketplace update omega` and `claude plugin update omega@omega` when the installed copy is older than the brand's OMEGA; interactive sessions also update in the background through `autoUpdate`.
- **Every call into Claude Code goes through the `claude` CLI**, and with no `claude` on the machine the helper does nothing, writes nothing, and reports no error.
- **The plugin keeps working with older brands.** A brand on an older OMEGA loads the newest published plugin, so a hook that reads a framework's installed layout fails open when the layout is not there ([the plugin README](../../agent-plugins/claude/README.md)).

Every step that reaches Claude Code takes its runner injected (`claudeExec` in the workspace op's context, in `runOnboard`'s and the install verb's options), the real `claude` by default, and the journey and corpus lanes point `CLAUDE_CONFIG_DIR` at a throwaway folder, so no test reaches the developer's own config.

Pinned by `packages/manager/test/claude-settings.test.js` (both files, every verdict), `packages/manager/test/claude-machine.test.js` (the machine helper on an injected `exec`), and the `npm run test:plugin` lane, which runs real Claude Code in a throwaway config folder and checks which copy each session loads ([testing.md](testing.md)).

Once loaded, the plugin's hooks make the chain BINDING in that brand: the inject hook discovers every target the brand declares and asks for each one's skill plus this map as required reading, and the gate hook refuses a write under `targets/<t>/` or to `config/omega.json5` until the skill owning that surface has been invoked. Mechanics and the surface table: [the plugin README](../../agent-plugins/claude/README.md).

The gate reads the same way for a human's chat and for an agent that has no Skill tool, through two lanes and no others ([#760](https://github.com/Omega-JS-Stack/omega/issues/760)). In the main chat, invoking the skill IS the record. A subagent that writes its files through Bash reads the guide its brief names and then runs the one sanctioned command, `agent-plugins/claude/hooks/gate/mark.sh <skill>` here (in a brand: the same script under the loaded plugin's root, the full path the inject hook prints), which writes the marker the hook would have written. A hand-written marker is a process breach, not a shortcut. Both lanes, and the flags: [the plugin README](../../agent-plugins/claude/README.md).

Reading the chain is one half; acting on it is the other. The guard hook holds the other half in the same brand: a `Write|Edit` to a framework-owned file is refused with the upstream-first message ([#452](https://github.com/Omega-JS-Stack/omega/issues/452)). Generated and vendored files — `node_modules/`, any `dist/`, a generated header, the OMEGA-managed `database.rules.json` — are hard-refused and name the real source to edit; a SHADOW COPY, a brand file whose path mirrors a file the installed framework ships through its override layer (read from `node_modules/@omega.js/<framework>/`, never a hardcoded list), is refused with the two exits: file the framework issue, or declare the override with `omega:consumer-override: <reason>` in the file's first five lines (`omega customize` writes that marker itself, so a materialized file passes as it lands). Only the override MECHANISM is guarded: a brand's pages are content and its documented entry files are its own, so neither is ever refused. The monorepo is exempt and everything unrecognized fails open. The lookup-root table and the class rules: [the plugin README](../../agent-plugins/claude/README.md).

## One AGENTS.md per entry, none per package

No package keeps docs or an agent doc of its own, with one exception: the manager's tracked one-line `AGENTS.md`, the hop every project root's import lands on. Monorepo sessions get the map from the root `AGENTS.md`; brands get it through the manager; a framework used alone gets it the same way once it adds the manager as a dev dependency ([Supported shape](#supported-shape)).

## The one deliberate gap

- **`brands/sandbox-brand` carries NO agent-docs chain.** It is a synthetic fixture the automated corpus/e2e runs mangle and reset — nothing durable lives there, so nothing agent-facing is written there.

## Editing the guide

The brand-root guide is [docs/manager/brand.md](../manager/brand.md) — framework-owned, brand-agnostic (structure, verbs, per-target required-reading pointers, hard rules). Brand-specific knowledge belongs below the import in that brand's own `AGENTS.md`.

## Per-target docs — RETIRED in brand context (cp246)

Per-target `AGENTS.md`/`CHANGELOG.md`/`docs/` scaffolds predate the brand-monorepo era; Claude Code walks parent directories, so the brand-root chain covers target-dir sessions. The shared defaults engine has a `retire` fileMap rule (devkit `defaults-engine.js`), wired mirrored in all four frameworks' brand branches for `CHANGELOG.md` and `docs/` (detection = the existing `@omega.js/config` brand-root resolution): in a brand target those files NEVER scaffold; an existing framework-owned-only copy (Custom section empty/whitespace or byte-equal to the shipped boilerplate; marker-less files must equal the rendered template) is deleted once, loudly; a copy carrying real consumer content is preserved with a move-it-to-the-brand-root warning. No framework ships an `AGENTS.md` template, so the builder applies the same rule to a target's `AGENTS.md` ([Maintenance](#maintenance)). Standalone projects keep their `CHANGELOG.md` and `docs/` scaffolds, their root `AGENTS.md` is the builder's one shape, the same file a brand root carries, and no scaffold writes a `CLAUDE.md`. Test-pinned both ways. That scaffold never reaches a workspace root: every framework's ensure-target runs devkit's `assertScaffoldable` before its first write, which refuses a directory whose nearest package.json declares `workspaces`, so this monorepo's own `AGENTS.md` and `.gitignore` and a brand root's are never written over ([docs/devkit/index.md](../devkit/index.md)).

**Prior-generation files ([#101](https://github.com/Omega-JS-Stack/omega/issues/101)).** A destination carrying the OMEGA section markers when the current template no longer does is a file an EARLIER generation of the same framework generated. Its markers are the framework's own signature, so the engine treats it as framework-owned on both paths: the brand branch retires it (instead of keeping it behind a false "carries consumer content" warning), and on the standalone upgrade path `overwrite: false` still heals it to the current template (instead of leaving a stale doc beside the new `AGENTS.md`). A file with no markers is judged as before: consumer-authored unless it equals the rendered template.

## Scaffolded docs are generated output

A doc a framework scaffolds into a project has ONE source, the framework's defaults tree (`src/defaults/`, web's `scaffold/`), and every copy is output of the scaffold walk: edited only at the source, never in a target. A doc the framework owns whole (desktop's `config/certs/README.md`) takes `overwrite: true`. A doc a project adds its own notes to takes `mergeLines`: every verb rewrites its `Default Values` section from the source and keeps its `Custom Values` section, where the project's notes (a list of its suites, say) live verbatim. That is `test/README.md` on backend, desktop, extension and web; an unmarked copy converges once, its lines the source carries going and the rest landing under Custom. Pinned by `scripts/scaffold-copies.test.js`, which runs the walk's merge over every tracked brand-target copy and fails when the result differs from the file (a hand edit above the Custom marker), and by each framework's defaults-scaffold suite (a stale framework section heals, the Custom section stays).
