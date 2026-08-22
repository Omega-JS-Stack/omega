/**
 * Testing service — health checks after every other service ran. Same role
 * as omega-manager's testing service: per-target local checks (build output,
 * backend scaffolding, framework version vs npm latest) plus live checks
 * against the deployed brand (homepage, API health + deployed version,
 * GitHub Actions). Live checks skip under --dry-run — a dry run never
 * touches the network.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({ serviceDir: __dirname });
