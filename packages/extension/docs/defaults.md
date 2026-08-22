# Defaults System

`src/defaults/` is the starter template that @omega.js/extension copies into consumer projects on first run (`npx omega setup`). It mirrors a "fresh @omega.js/extension project" — manifest, views, components, config, .nvmrc, .gitignore, .env, etc.

## How it works

1. During @omega.js/extension's own build (`prepare-package`), files in `src/defaults/` are copied to `dist/defaults/`.
2. When a consumer runs `npx omega setup`, the `gulp defaults` task scaffolds files from `dist/defaults/` into the consumer's project root — dispatch runs through the shared devkit defaults engine (`applyDefaults`, vendored into `dist/vendor/devkit/`).
3. File behavior (overwrite, skip, template, rename, merge) is controlled by `FILE_MAP` in [src/gulp/tasks/defaults.js](../src/gulp/tasks/defaults.js) — minimatch patterns, last-match-wins.

## FILE_MAP rules

```js
const FILE_MAP = {
  'src/**/*':            { overwrite: false },      // never overwrite user code
  'hooks/**/*':          { overwrite: false },      // never overwrite hooks
  '_.gitignore':         { mergeLines: true },      // marker-section merge (rename is an engine built-in)
  '_.env':               { mergeLines: true },
  'AGENTS.md':           { mergeLines: true },      // the agent-docs chain; CLAUDE.md is the one-line pointer
  'config/omega.json5':  { overwrite: true, merge: true },  // JSON5 defaults merge
  '.nvmrc':              { template: cleanVersions },       // `{{ versions.node }}` render
};
```

## Rule types

| Rule | Behavior |
|---|---|
| `overwrite: false` | Never replace if the file exists in the project. Default for `src/**`. |
| `overwrite: true` | Always overwrite — for files @omega.js/extension owns (writes are skipped when byte-identical). |
| `skip: bool\|function` | Never process — `(item) => boolean` for dynamic decisions. |
| `template: data` | Render `{{ key.path }}` tokens with `data` (tolerant — unknown keys survive). |
| `merge: true` | JSON5 defaults merge — consumer values and consumer-only keys survive, framework template provides shape. |
| `mergeLines: true` | OMEGA marker-section merge (`Default Values` framework-owned / `Custom Values` consumer-owned). |
| `name`/`path: function` | Rename / re-destination on copy. |

Engine built-ins (no rule needed): `_.foo` → `.foo` renames, `.gitkeep` creates the directory without copying the file, `.DS_Store` never copies, archive dirs (non-final `_x` segments) never ship, and every write is skipped when the content is unchanged. On top of the per-rule handling, the task's site-token pass (`[ site.x ]` brackets) runs on `html/md/liquid/json/yml/yaml` files via the engine's `transform` hook.

## Brand monorepos

When the target sits inside a brand monorepo (`{brand}/targets/{target}` — the `@omega.js/config` seed mode), `scaffoldDefaults` adjusts the map: the local-layer `config/omega.json5` is skipped (the brand root's `targets.*` is the home), per-target docs retire to the brand root, and **`.github/**` never scaffolds**. GitHub executes workflows from the REPO ROOT's `.github/workflows/` only, so a per-target copy is dead on arrival — no CI build, no store publish, silently ([#265](https://github.com/Omega-JS-Stack/omega/issues/265)).

Instead, setup composes the framework's workflow into the brand root as `.github/workflows/<target>-<workflow>.yml` (`extension-publish.yml`) via the shared devkit `ci-workflows` module:

- every `run:` step that follows its job's `actions/checkout` is scoped to the target (a per-step `working-directory: targets/extension`), while `uses:` actions still run at the repo root, which is what checkout wants. Per step, not a workflow-level `defaults.run.working-directory`: that also scopes the steps running BEFORE the checkout (the git config step), where the target dir does not exist yet — the job dies on step 1;
- an action's inputs ignore `working-directory:` entirely, so the path-bearing ones on post-checkout `uses:` steps are rewritten to the target dir from an explicit per-action table (`actions/cache`/`upload-artifact`/`download-artifact` `path`, `peaceiris/actions-gh-pages` `publish_dir`), as are `hashFiles()` patterns, which glob from the workspace root wherever they sit. The extension template uses none of them today — it carries only checkout and setup-node — so its composed file differs from the template by the `working-directory:` lines alone;
- each target gets its own concurrency group, so one target's deploy never cancels another's;
- the file is regenerated from the template on every setup — a rerun updates that one file and can never duplicate a job;
- a target-level copy left by an older setup is deleted when it is still the untouched framework file, and KEPT with a warning when it differs from the current template (your edits, or an older framework version) — the warning names the composed file to compare it against.

Scoping is by working directory, not a `paths:` trigger filter: OMEGA workflows carry no push triggers by design (deliberate deploys), and a path filter on a dispatch-only workflow filters nothing. `omega deploy` dispatches the composed name in a brand, the plain `publish.yml` standalone.

## Why the underscore prefix?

Files like `_.gitignore`, `_.env` are stored with a `_` prefix in `src/defaults/` so they don't interfere with @omega.js/extension's own development (the framework repo doesn't want its `.env` overwritten by the template) and so npm's tarball filter doesn't drop them. The engine strips the leading `_` on copy.

## Adding a new default

1. Drop the file under `src/defaults/<path-where-it-goes-in-the-consumer>`
2. If it needs special handling, add an entry to `FILE_MAP` in [tasks/defaults.js](../src/gulp/tasks/defaults.js)
3. Run `npm run prepare` to refresh @omega.js/extension's `dist/`
4. Verify in a fresh consumer project: `mkdir test-consumer && cd test-consumer && npm i ../@omega.js/extension && npx omega setup`

## Why this exists

Consumers shouldn't have to hand-author boilerplate (manifest, sample views, sample SCSS, sample background.js, .nvmrc, .gitignore). The defaults system seeds a working extension in one command. Same idea as `create-react-app` or `vite create`, just integrated with @omega.js/extension's CLI.

When @omega.js/extension ships a framework improvement (e.g. a better default popup template), bumping @omega.js/extension in a consumer + running `npx omega setup` again pulls the improvements WITHOUT overwriting user changes (because most `src/**` entries are `overwrite: false`).

## See also

- [cli.md](cli.md) — `npx omega setup` invokes the defaults task
- [build-system.md](build-system.md) — gulp tasks pipeline
