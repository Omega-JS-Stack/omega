// Libraries
const path = require('path');
const { createCliRouter } = require('@omegajs/devkit/cli-router');

// Load .env file from current working directory (project root)
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

// Main class — dispatch (positional/flag alias resolution, command loading,
// error surfacing) is the shared devkit router; this file owns only the alias
// table and the commands directory.
module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  defaultCommand: 'setup',
  aliases: {
    clean: ['-c', '--clean'],
    install: ['-i', 'i', '--install'],
    setup: ['-s', '--setup'],
    test: ['-t', '--test'],
    version: ['-v', '--version'],
  },
});
