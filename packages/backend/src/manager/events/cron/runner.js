const jetpack = require('fs-jetpack');

/**
 * Shared cron job runner
 *
 * Discovers and executes all .js job files from:
 * 1. @omega.js/backend core jobs directory
 * 2. Custom project hooks directory
 *
 * @param {string} name - Cron schedule name (e.g., 'daily', 'frequent')
 * @param {object} options
 * @param {object} options.Manager - Manager instance
 * @param {object} options.ctx - Assistant instance
 * @param {object} options.context - Cloud Function context
 */
module.exports = async function run(name, { Manager, ctx, context }) {
  // Set log prefix
  ctx.setLogPrefix(`cron/${name}()`);

  // Log
  ctx.log('Starting...');

  // Load @omega.js/backend jobs
  await loadAndExecuteJobs(name, `${__dirname}/${name}`, Manager, context);

  // Load custom jobs
  await loadAndExecuteJobs(name, `${Manager.cwd}/hooks/cron/${name}`, Manager, context);
};

async function loadAndExecuteJobs(name, jobsPath, Manager, context) {
  const jobs = jetpack.list(jobsPath) || [];

  // Log
  Manager.ctx.log(`Located ${jobs.length} jobs @ ${jobsPath}...`);

  for (const job of jobs) {
    // Create new ctx for each job
    const ctx = Manager.RouteContext();

    // Load job
    const jobName = job.replace('.js', '');

    // Set log prefix
    ctx.setLogPrefix(`cron/${name}/${jobName}()`);

    // Log
    ctx.log('Starting...');

    try {
      // Load and execute job
      const handler = require(`${jobsPath}/${job}`);
      await handler({ Manager, ctx, context, libraries: Manager.libraries });

      ctx.log('Completed!');
    } catch (e) {
      ctx.report(`Error executing: ${e}`, { code: 500 });
    }
  }
}
