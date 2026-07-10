// Libraries
const path = require('path');
const { createCliRouter } = require('@omega.js/devkit/cli-router');

// Resolve the .env cascade from the project root
// (shell > app .env > brand .env > company .env)
require('@omega.js/config').loadEnv(process.cwd());

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
