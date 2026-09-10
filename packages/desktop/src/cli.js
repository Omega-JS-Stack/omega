// Libraries
const path = require('path');
const { createCliRouter } = require('@omega.js/devkit/cli-router');
const { isBoxVerbArgv } = require('@omega.js/devkit/omega-bin');

// Resolve the .env cascade from the project root
// (shell > local .env > brand .env > company .env). The target name delivers
// the schema's `deliverAs` renames into process.env (#678) — the brand's
// GOOGLE_ANALYTICS_SECRET_DESKTOP arrives as GOOGLE_ANALYTICS_SECRET.
//
// …for every verb but the signing box's. `runner` and `sign-windows` belong to
// a MACHINE, not a project: they read the shell and `<runner home>\.env` and
// nothing else, so a brand's GH_TOKEN can never register the box's runners or
// hand its release token to a config walk ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)).
// Which invocations those are is the dispatcher's own answer, imported: one
// reading of it, covering the bare verb and its `--` flag spelling alike.
if (!isBoxVerbArgv(process.argv.slice(2))) {
  require('@omega.js/config').loadEnv(process.cwd(), { target: 'desktop' });
}

// Main class — dispatch (positional/flag alias resolution, command loading,
// error surfacing) is the shared devkit router; this file owns only the alias
// table and the commands directory. (ELECTRON_RUN_AS_NODE stripping stays in
// the bin — it must happen before anything Electron-adjacent loads.)
//
// A bare `omega` prints help: setup is retired and every verb runs the local
// scaffold itself ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  defaultCommand: 'help',
  aliases: {
    clean:            ['-c', '--clean'],
    install:          ['-i', 'i', '--install'],
    version:          ['-v', '--version'],
    build:            ['-b', '--build'],
    deploy:           ['-d', '--deploy'],
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
