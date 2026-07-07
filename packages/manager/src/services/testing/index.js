/**
 * Testing service — health checks after every other service ran. Same role
 * as omega-manager's testing service (target checks grouped per target),
 * scoped to what a brand monorepo can verify locally; live checks (homepage,
 * API health, GitHub Actions) port with their services.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({ serviceDir: __dirname });
