/**
 * The @omega.js/manager CLI dispatcher — devkit's shared router over
 * src/commands/. `omega-manager` with no command runs manage (the whole
 * point of the tool: walk every service and reconcile the brand to its
 * omega.json5).
 */
const path = require('node:path');

const { createCliRouter } = require('@omega.js/devkit/cli-router');

// Command name → positional/flag aliases
const ALIASES = {
  manage: ['-m', 'start', 'run'],
  onboard: ['-o', '--onboard', 'create', 'new'],
  dev: ['--dev', 'serve'], // brand-root local stack (web + backend by default)
  deploy: ['--deploy'], // brand-root deliberate publish fan-out (backend first)
  test: ['--test'],
  version: ['-v', '--version'],
};

module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  aliases: ALIASES,
  defaultCommand: 'manage',
});
