// Entry for the `omega`/`omg` bins — dispatches to the framework that owns the
// cwd's target (this one, or a sibling target's framework in a brand monorepo).
require('@omega.js/devkit/omega-bin').run({
  hostName: '@omega.js/backend',
  hostRun: () => require('./cli/run.js').run(),
});
