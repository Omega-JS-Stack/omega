// Entry for the `omega`/`omg` bins — dispatches to the framework that owns the
// cwd's app (this one, or a sibling app's framework in a brand monorepo).
// @omega.js/web serves src/ directly (no dist), so devkit resolves live here.
require('@omega.js/devkit/omega-bin').run({
  hostName: '@omega.js/web',
  hostRun: () => require('./cli-run.js').run(),
});
