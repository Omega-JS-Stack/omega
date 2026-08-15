/**
 * The @omega.js/manager CLI dispatcher — devkit's shared router over
 * src/commands/. Every verb is NAMED (#229): `omega manage` walks every
 * service and reconciles the brand to its omega.json5, `omega dev` boots the
 * local stack, and a bare `omega` prints help and touches nothing — a CLI
 * that silently rewrites a brand because it was called with no arguments is
 * the wrong default. `manage` has no alias: one walk, one name.
 */
const path = require('node:path');

const { createCliRouter } = require('@omega.js/devkit/cli-router');

// Command name → positional/flag aliases
const ALIASES = {
  onboard: ['-o', '--onboard', 'create', 'new'],
  dev: ['--dev', 'serve'], // brand-root local stack (web + backend by default)
  deploy: ['--deploy'], // brand-root deliberate publish fan-out (backend first)
  update: ['--update', 'outdated', 'out'], // brand-root dependency-freshness fan-out (devkit update per app)
  test: ['--test'],
  version: ['-v', '--version'],
};

module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  aliases: ALIASES,
  defaultCommand: 'help',
});
