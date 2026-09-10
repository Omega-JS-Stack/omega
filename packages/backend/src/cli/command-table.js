// The dispatchable surface of `omega` (backend), as DATA.
//
// One table, read by both halves of the CLI: Main.process() dispatches down it
// in order, and `omega help` renders it. Help can no longer drift from what
// actually dispatches (issue #20 — a review already caught the install-spelling
// mismatch when the listing was hand-maintained).
//
// The router frameworks get this for free from devkit's cli-router, which
// generates help from its alias table + commands directory. Backend's CLI is a
// different design (colon-style utility commands dispatching stateful command
// classes, resolved in a deliberate order) — same guarantee, its own table.
//
// Entry shape:
//   name        — the primary token, and the label help prints
//   aliases     — other argv tokens that select this command
//   args        — optional positional-argument map: `{ <arg>: [<arg aliases>] }`
//   description — the help line
//   default     — the command a bare `omega` runs (no entry claims it since
//                 #675 retired setup: a bare `omega` prints help)
//   match       — optional custom resolver; returns a truthy value passed to run()
//   run         — (self, matched) => the command's execute()
//
// ORDER IS DISPATCH ORDER. Entries are matched top to bottom, first hit wins.

const VersionCommand = require('./commands/version');
const ClearCommand = require('./commands/clear');
const CwdCommand = require('./commands/cwd');
const BuildCommand = require('./commands/build');
const InstallCommand = require('./commands/install');
const ServeCommand = require('./commands/serve');
const DeployCommand = require('./commands/deploy');
const TestCommand = require('./commands/test');
const EmulatorCommand = require('./commands/emulator');
const CleanCommand = require('./commands/clean');
const IndexesCommand = require('./commands/indexes');
const WatchCommand = require('./commands/watch');
const StripeCommand = require('./commands/stripe');
const FirestoreCommand = require('./commands/firestore');
const AuthCommand = require('./commands/auth');
const LogsCommand = require('./commands/logs');
const UpdateCommand = require('./commands/update');
const McpCommand = require('./commands/mcp');
const MigrateCommand = require('./commands/migrate');
const MigrateRulesCommand = require('./commands/migrate-rules');
const MigrateMarkersCommand = require('./commands/migrate-markers');

// Returned by an args-taking command's match() when the command was named but no
// argument was given — the branch that must name the real spellings instead of
// falling through to the unknown-command tail (which would misreport a listed command).
const MISSING_ARG = Symbol('missing-arg');

// Every argv token that selects a command.
function tokensOf(command) {
  return [command.name, ...(command.aliases || [])];
}

// `local|live` — the argument names, in resolution order.
function argsLabel(command) {
  return Object.keys(command.args).join('|');
}

// `local: dev, development · live: prod, production` — the accepted argument spellings.
function argsNote(command) {
  return Object.entries(command.args)
    .filter(([, aliases]) => aliases.length > 0)
    .map(([arg, aliases]) => `${arg}: ${aliases.join(', ')}`)
    .join(' · ');
}

// Default matcher: any of the command's tokens present in the parsed options.
// A command with `args` also resolves WHICH argument was given, and reports
// MISSING_ARG when it was named bare.
function matchCommand(command, options) {
  const named = tokensOf(command).some((token) => options[token]);

  if (!command.args) {
    return named;
  }

  for (const [arg, aliases] of Object.entries(command.args)) {
    if ((named && aliases.some((alias) => options[alias])) || options[arg]) {
      return arg;
    }
  }

  return named ? MISSING_ARG : false;
}

const COMMANDS = [
  {
    name: 'version',
    aliases: ['v', '-v', '--version'],
    description: 'print the framework version',
    run: (self) => new VersionCommand(self).execute(),
  },
  {
    // Help never falls through to another command.
    name: 'help',
    aliases: ['--help', 'h', '-h'],
    description: 'this listing',
    run: () => console.log(buildHelpText()),
  },
  {
    name: 'clear',
    description: 'clear caches',
    run: (self) => new ClearCommand(self).execute(),
  },
  {
    name: 'cwd',
    description: 'print the resolved target root',
    run: (self) => new CwdCommand(self).execute(),
  },
  {
    name: 'build',
    description: 'stage src/ into dist/',
    run: (self) => new BuildCommand(self).execute(),
  },
  {
    name: 'install',
    aliases: ['-i', 'i', '--install'],
    args: { local: ['dev', 'development'], live: ['prod', 'production'] },
    description: 'switch the installed framework copy',
    run: (self, mode, command) => {
      if (mode === MISSING_ARG) {
        const spellings = Object.keys(command.args).map((arg) => `\`omega ${command.name} ${arg}\``).join(' or ');
        console.error(`${command.name} needs a mode: ${spellings}. Aliases: ${argsNote(command)}.`);
        process.exitCode = 1;
        return;
      }

      return new InstallCommand(self).execute(mode);
    },
  },
  {
    name: 'serve',
    description: 'run the local Firebase emulator suite',
    run: (self) => new ServeCommand(self).execute(),
  },
  {
    // `indexes` accepted bare — the documented sync verb.
    name: 'indexes',
    aliases: ['indexes:get', 'firestore:indexes', 'firestore:indexes:get'],
    description: 'sync deployed Firestore indexes into firestore.indexes.json',
    run: (self) => new IndexesCommand(self).get(undefined, true),
  },
  {
    name: 'deploy',
    description: 'deploy to Firebase',
    run: (self) => new DeployCommand(self).execute(),
  },
  {
    name: 'test',
    description: 'run the test suites',
    run: (self) => new TestCommand(self).execute(),
  },
  {
    name: 'emulator',
    aliases: ['emulators'],
    description: 'emulator keep-alive mode',
    run: (self) => new EmulatorCommand(self).execute(),
  },
  {
    // `clean` accepted bare — every router framework answers it.
    name: 'clean',
    aliases: ['clean:npm'],
    description: 'remove node_modules + lockfile and reinstall',
    run: (self) => new CleanCommand(self).execute(),
  },
  {
    name: 'watch',
    description: 'hot-reload on framework source changes',
    run: (self) => new WatchCommand(self).execute(),
  },
  {
    name: 'stripe',
    aliases: ['stripe:listen'],
    description: 'forward Stripe webhooks locally',
    run: (self) => new StripeCommand(self).execute(),
  },
  {
    name: 'firestore:get',
    aliases: ['firestore:set', 'firestore:query', 'firestore:delete'],
    description: 'Firestore utilities',
    run: (self) => new FirestoreCommand(self).execute(),
  },
  {
    name: 'auth:get',
    aliases: ['auth:list', 'auth:delete', 'auth:set-claims', 'auth:token'],
    description: 'Auth utilities',
    run: (self) => new AuthCommand(self).execute(),
  },
  {
    // `logs` is an alias for `logs:read`.
    name: 'logs',
    aliases: ['logs:read', 'logs:tail', 'logs:stream'],
    description: 'Cloud Logging utilities',
    run: (self) => new LogsCommand(self).execute(),
  },
  {
    name: 'update',
    aliases: ['-u', '--update', 'outdated', 'out'],
    description: 'dependency freshness report',
    run: (self) => new UpdateCommand(self).execute(),
  },
  {
    name: 'mcp',
    description: 'run the MCP server',
    run: (self) => new McpCommand(self).execute(),
  },
  {
    // The ported-project REPORT: today the dependency-resolution scan (#600),
    // shared with @omega.js/web's own migrate through devkit. It changes
    // nothing, which is what separates it from the two conversions below.
    name: 'migrate',
    description: 'report what a ported backend still owes: bare requires of packages it never declared',
    run: (self) => new MigrateCommand(self).execute(),
  },
  {
    // The one-time move onto the compiled rules model — run ALONE and
    // deliberately, because it changes what the live project enforces. Setup
    // defers to it instead of healing the tree on the way to a deploy (#522).
    name: 'migrate:rules',
    aliases: ['migrate:firestore-rules'],
    description: 'migrate legacy firestore.rules onto the compiled model (changes live posture)',
    run: (self) => new MigrateRulesCommand(self).execute(),
  },
  {
    // The one-time conversion of the PRE-FAMILY marker formats a tree carried
    // over from BEM still holds. Evergreen verbs speak only the family grammar,
    // so they detect those shapes and point here instead of converting
    // ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
    name: 'migrate:markers',
    description: 'convert pre-family marker formats ({{ backend-manager }}, # BEM>>>, ///---…---///) to the family grammar',
    run: (self) => new MigrateMarkersCommand(self).execute(),
  },
];

// The command a bare `omega` runs — undefined when nothing claims the slot,
// which is the state since `setup` was retired (#675). The dispatcher falls
// back to the help listing.
function defaultCommand() {
  return COMMANDS.find((command) => command.default);
}

// Width of the label column. Labels wider than this put their description on the
// next line rather than shoving every other description right.
const LABEL_COLUMN = 33;

// `omega help` — rendered from COMMANDS, never hand-written.
function buildHelpText() {
  const lines = COMMANDS.map((command) => {
    const tokens = tokensOf(command).join(' | ');
    const label = command.args ? `${tokens} <${argsLabel(command)}>` : tokens;

    const notes = [];
    if (command.args) { notes.push(argsNote(command)); }
    if (command.default) { notes.push('default'); }
    const description = notes.length > 0 ? `${command.description} [${notes.join(' — ')}]` : command.description;

    return label.length > LABEL_COLUMN - 3
      ? `  ${label}\n${' '.repeat(LABEL_COLUMN)}${description}`
      : `  ${label.padEnd(LABEL_COLUMN - 2)}${description}`;
  });

  return `Usage: omega <command> [options]\n\nCommands:\n${lines.join('\n')}`;
}

module.exports = { COMMANDS, MISSING_ARG, tokensOf, matchCommand, defaultCommand, buildHelpText };
