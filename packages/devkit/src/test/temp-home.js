/**
 * The machine home, pointed at a temp dir for the length of ONE test process.
 *
 * Every `loadConfig()` records its own brand's line in the machine registry
 * (`$OMEGA_HOME/brands.json`, default `~/.omega`), which is what makes a
 * sibling's `company: { id }` resolvable. A test fixture must never land
 * there: the developer's registry is real machine state, and a fixture root
 * under /tmp is a line about a brand that does not exist.
 *
 * One require at the top of a file that loads a brand fixture (or spawns a verb
 * that does) is the whole contract, and every child it spawns inherits the redirect.
 * The dir lives as long as the process: one file under `--isolation=process`, while
 * under `none` the first require sets it and every file of the run shares it.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.OMEGA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-test-home-'));
const OMEGA_HOME = process.env.OMEGA_HOME;

// Claude Code's config folder is machine state too: a verb that checks the
// omega plugin must never read or change the developer's real one.
process.env.CLAUDE_CONFIG_DIR = path.join(OMEGA_HOME, 'claude');

process.on('exit', () => fs.rmSync(OMEGA_HOME, { recursive: true, force: true }));

module.exports = { OMEGA_HOME };
