/**
 * Workspace service — the brand monorepo itself is the first thing the
 * manager reconciles: root workspaces wiring, omega.json5 health, and the
 * .omega/ gitignore entry. Everything downstream assumes a sane workspace.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({ serviceDir: __dirname });
