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

ONE builder writes every project-root `AGENTS.md`: devkit's `agents-md` (`packages/devkit/src/agents-md.js`), the lowest package the manager and all four frameworks already depend on. It has two callers. The manage cycle's `workspace` service (`agents` op: `packages/manager/src/services/workspace/ensure/agents.js`) owns a brand root's `AGENTS.md` and the retired link. Each framework's scaffold, which every verb runs through its ensure-target, gives a standalone project root the same file and keeps a brand target free of one. Devkit's `docs-sync` boot prelude (`packages/devkit/src/preludes/docs-sync.js`) runs before every verb on all five CLIs and owns a linked manager's docs:

| State found | Action |
|---|---|
| No `AGENTS.md` at a project root | Created: the import under Default, an empty Custom section |
| The marked file, import at the right depth | No-op |
| The marked file, a stale-depth or retired import in the Default section, or lines above the Default marker | Healed through the marker engine: the Default section rewritten, the Custom section verbatim, any lines above the Default marker moved to the top of Custom |
| Any unmarked `AGENTS.md`: the import-on-line-1 shape (with its generated `# <name>: project notes` or `# <name>: brand notes` heading), a hand-written file (one quoting the markers inline included: a marker counts only as a whole line), or the retired per-framework template (the `#` `Default Values` / `Custom Values` markers) | Converged on the next verb, loudly: every import line, the generated heading, the retired template's framework section and its shipped boilerplate go; every other line lands under the Custom marker, in order |
| An `AGENTS.md` in a brand target | Removed, loudly, when it holds nothing the consumer wrote (the builder's skeleton or an old template's boilerplate); kept with a move-it-to-the-brand-root warning when it carries notes |
| The retired `node_modules/@omega.js/AGENTS.md` symlink in the scope | Removed |
| A locally linked manager (its real path is `packages/manager` in a monorepo checkout) | Before every verb: its `docs/` synced from the monorepo's `docs/`, writing only the files that changed, so a linked brand reads the live map |
| A published manager | Left alone: it ships the docs of its own version |

Pinned by `packages/devkit/test/agents-md.test.js` (path resolution, the retired link and import, the marked shape, create/heal/converge from every older shape/idempotence, content preservation, the brand-target sweep, the scaffold step), `packages/manager/test/agents-md.test.js` (the manager's one-line AGENTS.md and its files entry, the workspace op, the two-import chain (three files) on a linked fixture brand, no `CLAUDE.md` written or read), each framework's scaffold suite (backend `test/boot/defaults-scaffold.test.js`, desktop and extension `src/test/suites/build/defaults-scaffold.test.js`, web `packages/web/test/cli.test.js`: a standalone scaffold writes the builder's file, an old template converges, a brand target gets none; web's `test/ensure-target.test.js` sees the builder's warning reach the verb), and `packages/devkit/test/prelude-docs-sync.test.js` (the local docs sync).

## The manager ships the docs

A brand has no monorepo to point at, so the prepare lane ships the knowledge INSIDE `@omega.js/manager`, the one package every brand installs. No other publishable ships docs. The devkit vendor hook every framework already runs (`packages/devkit/tools/vendor-docs.js`, called from `tools/vendor.js`) copies:

| Monorepo source | Shipped as | Notes |
|---|---|---|
| `docs/` (the whole tree) | `manager/docs/` | Same shape, so every link inside the tree keeps working |
| `agent-plugins/claude/` | `manager/claude-plugin/` + `manager/.claude-plugin/marketplace.json` | The plugin every brand enables (see below). `.mcp.json` ships WITH it: it launches `mcp-router-launch.js` inside the plugin, which node-resolves `@omega.js/mcp-router` from the install around it |

The manager's own `AGENTS.md` is tracked, not generated: one line importing `docs/omega.md`.

Links that leave `docs/` are retargeted on the way in (`rewriteDocLinks`): a `packages/<pkg>/...` link points at the sibling package in the installed `@omega.js` scope, an `agent-plugins/claude/...` link at the plugin copy inside the manager, and anything else (`brands/...`, root files) keeps its words and loses the link. A sibling that never publishes (`devkit`) or isn't installed leaves a dead relative link. A locally linked manager sits in `packages/`, so the same links land on the live sources.

Everything written is GENERATED: gitignored, and `syncDocs` writes only a file whose content changed and removes any file the source no longer has. Pinned by `packages/devkit/test/vendor-docs.test.js` (fixture monorepo) plus `scripts/vendor-docs.test.js`, which packs every publishable for real and reads the tarball listings.

Version-matched by construction: the docs in `node_modules/@omega.js/manager/docs/` are the docs of the version installed there.

## Brands enable the plugin from their installed manager ([#62](https://github.com/Omega-JS-Stack/omega/issues/62))

The plugin rides in `@omega.js/manager` because that is the package every brand installs. The workspace service's `claude-settings` op writes/heals the brand's committed `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": { "omega": { "source": { "source": "directory", "path": "./node_modules/@omega.js/manager" } } },
  "enabledPlugins": { "omega@omega": true }
}
```

Committed, so every collaborator's session in that brand loads the omega skills and hooks — a directory marketplace is read LIVE from that path, so `npm update` moves the plugin with the package. The op only fires on a PUBLISHED install: `node_modules/@omega.js/manager` must carry the vendored `.claude-plugin/marketplace.json` **and** be a real directory. A locally linked brand's manager is a SYMLINK into the monorepo — whose `packages/manager` grows that same generated marketplace on every prepare — so the link itself is the local-era signal and the step skips; the developer's own user-scope install covers those sessions. The brand file NEVER points at a monorepo path — it would be machine-specific.

Once loaded, the plugin's hooks make the chain BINDING in that brand: the inject hook discovers every target the brand declares and asks for each one's skill plus this map as required reading, and the gate hook refuses a write under `targets/<t>/` or to `config/omega.json5` until the skill owning that surface has been invoked. Mechanics and the surface table: [the plugin README](../../agent-plugins/claude/README.md).

The gate reads the same way for a human's chat and for an agent that has no Skill tool, through two lanes and no others ([#760](https://github.com/Omega-JS-Stack/omega/issues/760)). In the main chat, invoking the skill IS the record. A subagent that writes its files through Bash reads the guide its brief names and then runs the one sanctioned command, `agent-plugins/claude/hooks/gate/mark.sh <skill>` here (in a brand: `node_modules/@omega.js/manager/claude-plugin/hooks/gate/mark.sh`), which writes the marker the hook would have written. A hand-written marker is a process breach, not a shortcut. Both lanes, and the flags: [the plugin README](../../agent-plugins/claude/README.md).

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

A doc a framework scaffolds into a project has ONE source, the framework's `src/defaults/`, and every copy is output of the scaffold walk: edited only at the source, never in a target. A doc the framework owns whole (desktop's `config/certs/README.md`) takes `overwrite: true`. A doc a project adds its own notes to takes `mergeLines`: every verb rewrites its `Default Values` section from the source and keeps its `Custom Values` section, where the project's notes (a list of its suites, say) live verbatim. That is `test/README.md` on backend, desktop and extension (web scaffolds none); an unmarked copy converges once, its lines the source carries going and the rest landing under Custom. Pinned by `scripts/scaffold-copies.test.js`, which runs the walk's merge over every tracked brand-target copy and fails when the result differs from the file (a hand edit above the Custom marker), and by each framework's defaults-scaffold suite (a stale framework section heals, the Custom section stays).
