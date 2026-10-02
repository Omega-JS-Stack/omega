/**
 * Update service: installs dependencies and builds every target in the brand
 * monorepo. Install and build are its whole job; the legacy bump, deploy and
 * sync phases are retired (docs/shared/breaking-changes.md).
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const targets = (context.targets || []).filter((entry) => entry.target);

    if (targets.length === 0) {
      return { skip: true, reason: 'no target-mapped dirs' };
    }

    return {};
  },
});
