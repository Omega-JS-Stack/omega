// Entry for the `omega`/`omg`/`mgr` bins — dispatches to the framework that owns
// the cwd's target; a brand root runs the manager's CLI, and so does a fresh clone
// with nothing installed yet (`npx omega onboard`, the bootstrap case).
require('@omega.js/devkit/omega-bin').run({
  hostName: '@omega.js/manager',
  hostRun: () => require('./cli-run.js').run(),
});
