/**
 * The @omega.js/web CLI dispatcher — devkit's shared router over
 * src/commands/. `omega` with no command runs setup (OMEGA convention).
 */
const path = require('node:path');

// Resolve the .env cascade from the consumer project before any command runs
// (shell > app .env > brand .env > company .env)
require('@omega.js/config').loadEnv(process.cwd());

const { createCliRouter } = require('@omega.js/devkit/cli-router');

// Command name → positional/flag aliases (UJM alias table, adapted)
const ALIASES = {
  setup: ['-s', '--setup'],
  install: ['-i', 'i', '--install'],
  dev: ['serve', 'start', '--dev'],
  build: ['-b', '--build'],
  deploy: ['-d', '--deploy'],
  migrate: ['-m', '--migrate', 'migration'],
  translate: ['-t', '--translate', 'translation'],
  audit: ['-a', '--audit'],
  purge: ['-cf', '--purge', 'cloudflare-purge'],
  test: ['--test'],
  clean: ['-c', '--clean'],
  version: ['-v', '--version'],
};

module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  aliases: ALIASES,
  defaultCommand: 'setup',
});
