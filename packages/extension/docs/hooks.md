# Build Hooks

Two lifecycle hooks let consumers run custom logic during the build pipeline.

## Hook files

| Hook | Source | When |
|---|---|---|
| `build:pre` | `hooks/build/pre.js` (in consumer project) | Before packaging — after `dist/` is built but before `packaged/` is assembled |
| `build:post` | `hooks/build/post.js` | After packaging — `packaged/<browser>/raw/` and `.zip` exist |

Hooks are optional — `gulp/tasks/package.js` checks for the file's presence and runs it if present.

The NESTED path above is authoritative: it is what `src/defaults/hooks/build/` scaffolds and what setup's migration moves a flat `hooks/build:pre.js` to. The task resolves it first and falls back to the flat pre-migration path during the transition, so an unmigrated project keeps building ([#571](https://github.com/Omega-JS-Stack/omega/issues/571)).

## Hook shape

```js
// hooks/build/pre.js
module.exports = async function ({ manager, projectRoot, mode }) {
  console.log('Pre-build hook running for', manager.getConfig().brand.name);

  // Mutate files, generate assets, validate, anything you want.
  // Return a Promise (or use async fn) to make the build wait.
};
```

## The `ctx` argument

Hooks take the ONE hook-argument shape every OMEGA framework passes — the same `ctx` @omega.js/desktop hands its lifecycle hooks:

- `ctx.manager` — the build `Manager` instance (`@omega.js/extension/build`)
- `ctx.projectRoot` — the consumer project root, absolute
- `ctx.mode` — `'production'` when `OMEGA_BUILD_MODE=true`, else `'development'`

Everything else a build hook needs comes off `ctx.manager`:

| What you want | Where it is |
|---|---|
| Parsed `package.json` | `manager.getPackage('project')` |
| Parsed `src/manifest.json` (JSON5) | `manager.getManifest()` |
| Resolved `config/omega.json5` (targets.extension overlaid onto the top level) | `manager.getConfig()` |
| The brand block | `manager.getConfig().brand` |
| The project / framework roots | `manager.getRootPath('project')` / `manager.getRootPath('main')` |

Until [#591](https://github.com/Omega-JS-Stack/omega/issues/591) this page described an `index` build-info object nothing ever built — the task passed its internal watch counter, so a hook written from these docs read `undefined` at its first property.

## Common uses

### Sync a CHANGELOG version into the manifest

```js
// hooks/build/pre.js
const fs = require('fs');
const path = require('path');

module.exports = async function ({ manager, projectRoot }) {
  const manifest = manager.getManifest();
  const changelog = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
  const latestVersion = changelog.match(/## \[([\d.]+)\]/)?.[1];
  if (latestVersion && latestVersion !== manifest.version) {
    console.warn(`Manifest version (${manifest.version}) doesn't match CHANGELOG latest (${latestVersion})`);
  }
};
```

### Inject a build timestamp

```js
// hooks/build/pre.js
const fs = require('fs');
const path = require('path');

module.exports = async function ({ projectRoot }) {
  const buildInfo = {
    builtAt: new Date().toISOString(),
    gitSha: require('child_process').execSync('git rev-parse HEAD').toString().trim(),
  };
  fs.writeFileSync(path.join(projectRoot, 'dist', 'build-info.json'), JSON.stringify(buildInfo, null, 2));
};
```

### Trigger a post-publish webhook

```js
// hooks/build/post.js
module.exports = async function ({ manager }) {
  if (process.env.OMEGA_IS_PUBLISH !== 'true') return;   // only after real publish
  await fetch('https://api.myservice.com/extension-released', {
    method: 'POST',
    body: JSON.stringify({ version: manager.getManifest().version }),
  });
};
```

## Async by default

Hooks are awaited — the build waits for them to resolve before continuing. Throw or reject to fail the build (and abort packaging / publishing).

## Where hooks are invoked

[src/gulp/tasks/package.js](../src/gulp/tasks/package.js) loads and runs them. Search for `hook(` in that file to see the exact wiring.

## Why not just edit gulp tasks?

You COULD fork @omega.js/extension's gulp tasks for any custom build behavior. Hooks exist so consumers don't need to. Hooks are stable contract (the `ctx` shape is the same one every OMEGA framework passes), survive @omega.js/extension upgrades, and live in the consumer's repo (where build-specific concerns belong).

## See also

- [build-system.md](build-system.md) — gulp pipeline details
- [publishing.md](publishing.md) — store auto-publishing happens AFTER `build:post`
