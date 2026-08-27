/**
 * Test: the documented cron job actually RUNS
 * ([#495](https://github.com/Omega-JS-Stack/omega/issues/495)).
 *
 * `docs/routes.md` § "New Cron Job (Consumer Project)" documented a
 * `Job.prototype.main` constructor shape, but the runner does
 * `await handler({ Manager, ctx, context, libraries })` — a job written to the
 * doc was called as a plain function, its body never ran, and nothing errored.
 * That is the defect class that made legacy playlisteer's clear-promotions
 * route 500 for years (a pre-BEM export shape meeting a newer middleware).
 *
 * So the doc's example is not read here, it is EXECUTED: lifted out of the
 * markdown verbatim, dropped into a jobs directory, and run through the
 * runner's own `loadAndExecuteJobs`. A doc that drifts from the call shape goes
 * red the day it drifts.
 *
 * Run: npx omega test backend:events/cron-job-doc-shape
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const { loadAndExecuteJobs } = require('../../src/manager/events/cron/runner.js');

const ROUTES_DOC = path.join(__dirname, '..', '..', 'docs', 'routes.md');
const HEADING = '## New Cron Job (Consumer Project)';

// The line the documented job logs when its body runs.
const JOB_MARKER = 'Running daily job...';

/** The first fenced javascript block under the cron-job heading, verbatim. */
function documentedCronJob() {
  const doc = jetpack.read(ROUTES_DOC);
  const heading = doc.indexOf(HEADING);

  if (heading === -1) {
    throw new Error(`docs/routes.md no longer carries "${HEADING}" — the consumer cron recipe must stay documented`);
  }

  const fence = doc.indexOf('```javascript', heading);
  const start = doc.indexOf('\n', fence) + 1;
  const end = doc.indexOf('```', start);

  return doc.slice(start, end);
}

/** Run `fn` with console.log captured. */
async function capturingLogs(fn) {
  const lines = [];
  const original = console.log;

  console.log = (...args) => lines.push(args.map((a) => String(a)).join(' '));

  try {
    await fn();
  } finally {
    console.log = original;
  }

  return lines.join('\n');
}

module.exports = {
  description: 'the documented consumer cron job runs under the real runner',
  type: 'group',

  tests: [
    {
      name: 'the-documented-job-body-executes',
      auth: 'none',

      async run({ assert, Manager }) {
        const jobsDir = jetpack.tmpDir({ prefix: 'omega-cron-doc-' }).path();
        jetpack.write(path.join(jobsDir, 'documented-job.js'), documentedCronJob());

        const output = await capturingLogs(() => loadAndExecuteJobs('daily', jobsDir, Manager, {}));

        assert.ok(output.includes(JOB_MARKER), 'the documented job must RUN when the runner calls it — a job the runner cannot call fails silently, exactly as this one did');
        assert.equal(output.includes('Error executing:'), false, `the documented job must not throw: ${output}`);
        assert.ok(output.includes('Completed!'), 'the runner must report the documented job complete');

        jetpack.remove(jobsDir);
      },
    },

    {
      name: 'the-documented-job-is-authored-under-src',
      auth: 'none',

      async run({ assert }) {
        // Consumers are src-first: `dist/` is staged output, so a doc naming
        // the runtime path teaches an edit that the next build wipes.
        const doc = jetpack.read(ROUTES_DOC);
        const heading = doc.indexOf(HEADING);
        const recipe = doc.slice(heading, doc.indexOf('```', doc.indexOf('```javascript', heading) + 3));

        assert.match(recipe, /src\/hooks\/cron\/daily\//, 'the cron recipe must name the AUTHORED path (src/hooks/cron/daily/)');
      },
    },
  ],
};
