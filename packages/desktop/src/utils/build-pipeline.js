// The build-mode pipeline shared by the `build`, `package`, and `publish` verbs.
//
// The CLI verbs are canonical and the synced projectScripts are thin
// `npx omega <verb>` aliases, so a verb must run the pipeline ITSELF and never
// shell back to `npm run build` / `npm run publish` — that would recurse. Each
// verb declares its plan as data (env flags + ordered steps) and this runner
// executes it; `npm run gulp -- <task>` is the one safe shell-out (the consumer's
// `gulp` script is bare `gulp`, so there's no alias to recurse through).

// Libraries
const { execute } = require('node-powertools');

function gulpCommand(task) {
  return `npm run gulp -- ${task}`;
}

// Default step implementations — required lazily so requiring a plan never
// loads the whole command surface.
//
// There is no `setup` step any more (#675): the local half runs inside the gulp
// `defaults` task, which is the first step of every gulp build. What the plans
// still need before signing is the Apple artifacts (#678) — `certs`.
const RUNNERS = {
  clean: (options) => require('../commands/clean.js')(options),
  certs: () => {
    const Manager = new (require('../build.js'));
    require('./deliver-certs.js').deliverTargetCerts({
      projectDir: Manager.getRootPath('project'),
      logger: Manager.logger('certs'),
    });
  },
  'validate-certs': (options) => require('../commands/validate-certs.js')(options),
  gulp: (options, step) => execute(gulpCommand(step.task), { log: true }),
};

async function runPipeline(plan, options, runners) {
  options = options || {};
  runners = runners || RUNNERS;

  // Set in-process so every child (gulp → webpack → electron-builder) inherits them.
  Object.entries(plan.env || {}).forEach(([key, value]) => {
    process.env[key] = value;
  });

  for (const step of plan.steps) {
    const runner = runners[step.type];

    // Plans are authored in this package alongside the runner table — an
    // unknown type is a programmer error, never consumer input.
    if (!runner) {
      throw new Error(`Unknown pipeline step type: ${step.type}`);
    }

    await runner(options, step);
  }
}

module.exports = { runPipeline, gulpCommand, RUNNERS };
