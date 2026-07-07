/**
 * The @omegajs/web CLI dispatcher — devkit's shared router over
 * src/commands/. `omega` with no command runs setup (OMEGA convention).
 */
const path = require('node:path');

// Load .env from the consumer project root before any command runs
require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true });

const { createCliRouter } = require('@omegajs/devkit/cli-router');

// Command name → positional/flag aliases (UJM alias table, adapted)
const ALIASES = {
  setup: ['-s', '--setup'],
  dev: ['serve', 'start', '--dev'],
  build: ['-b', '--build'],
  deploy: ['-d', '--deploy'],
  migrate: ['-m', '--migrate', 'migration'],
  translate: ['-t', '--translate', 'translation'],
  audit: ['-a', '--audit'],
  test: ['--test'],
  clean: ['-c', '--clean'],
  version: ['-v', '--version'],
};

module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  aliases: ALIASES,
  defaultCommand: 'setup',
});
