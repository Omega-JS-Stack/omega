/**
 * The @omega.js/web CLI dispatcher — devkit's shared router over
 * src/commands/. `omega` with no command prints help: setup is retired and
 * every verb runs the local scaffold itself ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 */
const path = require('node:path');

// Resolve the .env cascade from the consumer project before any command runs
// (shell > local .env > brand .env > company .env). The target name delivers
// the schema's `deliverAs` renames into process.env (#678) — the brand's
// GOOGLE_ANALYTICS_SECRET_WEB arrives as GOOGLE_ANALYTICS_SECRET.
require('@omega.js/config').loadEnv(process.cwd(), { target: 'web' });

const { createCliRouter } = require('@omega.js/devkit/cli-router');

// Command name → positional/flag aliases (UJM alias table, adapted)
const ALIASES = {
  install: ['-i', 'i', '--install'],
  dev: ['serve', 'start', '--dev'],
  build: ['-b', '--build'],
  deploy: ['-d', '--deploy'],
  update: ['-u', '--update', 'outdated', 'out'],
  migrate: ['-m', '--migrate', 'migration'],
  customize: ['-cz', '--customize'],
  translate: ['--translate', 'translation'],
  audit: ['-a', '--audit'],
  purge: ['-cf', '--purge', 'cloudflare-purge'],
  // -t = test on EVERY framework (mirrored-implementation rule) — translate
  // deliberately has no single-letter alias so the muscle-memory flag is safe
  test: ['-t', '--test'],
  clean: ['-c', '--clean'],
  version: ['-v', '--version'],
};

const Main = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  aliases: ALIASES,
  defaultCommand: 'help',
});

// The environment surface (#717) — web's Manager equivalent is this CLI class,
// the object every bin instantiates, so `Main.getEnvironment()` /
// `isDevelopment()` / `isProduction()` / `isTesting()` are reachable the same
// way @omega.js/desktop's and @omega.js/extension's Managers reach theirs.
require('./mode-helpers.js').attachTo(Main);

module.exports = Main;
