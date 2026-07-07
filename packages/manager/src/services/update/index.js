/**
 * Update service — installs dependencies and builds every app in the brand
 * monorepo. The monorepo cousin of omega-manager's update service (which
 * walks separate per-target repos); phases beyond install/build (bump,
 * deploy, sync) port over with their flags as the cutover advances.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const apps = (context.apps || []).filter((app) => app.target);

    if (apps.length === 0) {
      return { skip: true, reason: 'no target-mapped apps' };
    }

    return {};
  },
});
