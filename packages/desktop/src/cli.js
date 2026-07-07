// Libraries
const path = require('path');
const { createCliRouter } = require('@omegajs/devkit/cli-router');

// Load .env file from current working directory (project root)
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

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
    logs:             ['--logs', 'log'],
    'validate-certs': ['certs', '--validate-certs'],
    'sign-windows':   ['--sign-windows'],
    'push-secrets':   ['secrets', '--push-secrets'],
    'finalize-release': ['finalize', '--finalize-release'],
    runner:           ['--runner'],
    launch:           ['open', '--launch'],
  },
});
