// Libraries
const path = require('path');
const { createCliRouter } = require('@omega.js/devkit/cli-router');

// Resolve the .env cascade from the project root
// (shell > app .env > brand .env > company .env)
require('@omega.js/config').loadEnv(process.cwd());

// Main class — dispatch (positional/flag alias resolution, command loading,
// error surfacing) is the shared devkit router; this file owns only the alias
// table and the commands directory. (ELECTRON_RUN_AS_NODE stripping stays in
// the bin — it must happen before anything Electron-adjacent loads.)
module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  defaultCommand: 'setup',
  aliases: {
    setup:            ['-s', '--setup'],
    clean:            ['-c', '--clean'],
    install:          ['-i', 'i', '--install'],
    version:          ['-v', '--version'],
    build:            ['-b', '--build'],
    publish:          ['-p', '--publish'],
    release:          ['-r', '--release'],
    test:             ['-t', '--test'],
    update:           ['-u', '--update', 'outdated', 'out'],
    logs:             ['--logs', 'log'],
    'validate-certs': ['certs', '--validate-certs'],
    'sign-windows':   ['--sign-windows'],
    'push-secrets':   ['secrets', '--push-secrets'],
    'finalize-release': ['finalize', '--finalize-release'],
    runner:           ['--runner'],
    launch:           ['open', '--launch'],
  },
});
