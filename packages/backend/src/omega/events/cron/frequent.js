const { run } = require('../../cron.js');

module.exports = async ({ ctx, omega, context }) => run('frequent', { ctx, omega, context });
