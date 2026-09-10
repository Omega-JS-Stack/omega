// Libraries
const path = require('path');
const { createCliRouter } = require('@omega.js/devkit/cli-router');

// Resolve the .env cascade from the project root
// (shell > local .env > brand .env > company .env). The target name delivers
// the schema's `deliverAs` renames into process.env (#678) — the brand's
// GOOGLE_ANALYTICS_SECRET_EXTENSION arrives as GOOGLE_ANALYTICS_SECRET.
require('@omega.js/config').loadEnv(process.cwd(), { target: 'extension' });

// Main class — dispatch (positional/flag alias resolution, command loading,
// error surfacing) is the shared devkit router; this file owns only the alias
// table and the commands directory.
//
// A bare `omega` prints help: setup is retired and every verb runs the local
// scaffold itself ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  defaultCommand: 'help',
  aliases: {
    build: ['-b', '--build'],
    clean: ['-c', '--clean'],
    deploy: ['-d', '--deploy'],
    install: ['-i', 'i', '--install'],
    migrate: ['-m', '--migrate', 'migration'],
    test: ['-t', '--test'],
    update: ['-u', '--update', 'outdated', 'out'],
    version: ['-v', '--version'],
  },
});
