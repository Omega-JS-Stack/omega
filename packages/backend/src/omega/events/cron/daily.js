const { run } = require('../../cron.js');

module.exports = async ({ ctx, omega, context }) => run('daily', { ctx, omega, context });
