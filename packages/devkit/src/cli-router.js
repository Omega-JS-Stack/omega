// createCliRouter(config) — the shared OMEGA framework CLI dispatcher.
//
// Every framework bin parses argv (yargs) and hands the result to a Main class
// whose process() resolves a command name and runs commands/<name>.js from the
// framework's dist. That router was copy-pasted per framework (UJM/BXM/EM,
// drift-identical); this is the single implementation. @omega.js/backend's CLI is a different
// design (colon-style utility commands dispatching stateful command classes)
// and does not use this.
//
// Resolution order (unchanged from the framework copies):
//   1. Positional command (`mgr build`) — matched against command names and
//      their aliases; unknown names pass through as-is (missing file = error).
//   2. Flag-style alias (`mgr --build`, `mgr -b`) — first alias-table hit wins.
//   3. The default command (OMEGA convention: setup).
//
// dotenv loading and any process-env fixups (e.g. EM's ELECTRON_RUN_AS_NODE
// strip) stay in the framework's cli.js/bin — they're framework concerns, not
// dispatch.

const path = require('path');
const jetpack = require('fs-jetpack');

/**
 * Build a framework CLI Main class.
 *
 * @param {object} config
 * @param {string} config.commandsDir - Absolute directory of command modules — <name>.js exporting `async (options) => {}`
 * @param {Object<string, string[]>} [config.aliases] - Command name → positional/flag aliases (e.g. `{ install: ['-i', 'i', '--install'] }`)
 * @param {string} [config.defaultCommand='setup'] - Command used when no positional or flag alias matches
 * @returns {Function} Main class — bins do `new Main(argv)` then `await main.process(argv)`
 */
function createCliRouter(config) {
  config = config || {};

  const commandsDir = config.commandsDir;
  const aliases = config.aliases || {};
  const defaultCommand = config.defaultCommand || 'setup';

  if (!commandsDir) {
    throw new Error('[devkit cli-router] commandsDir is required');
  }

  // Resolve command name from positional args or flag-style aliases
  function resolveCommand(options) {
    // Check if a command was explicitly passed via positional argument
    if (options._.length > 0) {
      const command = options._[0];
      for (const [key, names] of Object.entries(aliases)) {
        if (command === key || names.includes(command)) {
          return key;
        }
      }
      return command; // If not found in aliases, return as-is
    }

    // Check if any alias was passed as a flag (e.g., -v)
    for (const [key, names] of Object.entries(aliases)) {
      for (const alias of names) {
        if (options[alias.replace(/^-+/, '')]) { // Remove leading `-`
          return key;
        }
      }
    }

    return defaultCommand; // Fallback to default if no match is found
  }

  // Main Function
  function Main() {}

  // Expose the resolved dispatch table for introspection — framework structure
  // tests verify every aliased command has a command file without scraping
  // the cli.js source.
  Main.config = { commandsDir, aliases, defaultCommand };

  Main.prototype.process = async function (options) {
    // Fix options
    options = options || {};
    options._ = options._ || [];

    // Determine the command (use default if not provided)
    const command = resolveCommand(options);

    try {
      // Get the command file path
      const commandFile = path.join(commandsDir, `${command}.js`);

      // Check if the command file exists
      if (!jetpack.exists(commandFile)) {
        throw new Error(`Error: Command "${command}" not found.`);
      }

      // Execute the command
      const Command = require(commandFile);
      await Command(options);
    } catch (e) {
      console.error(`Error executing command "${command}": ${e.message}`);

      // Exit with error
      throw e;
    }
  };

  return Main;
}

module.exports = { createCliRouter };
