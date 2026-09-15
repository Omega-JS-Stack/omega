/**
 * The machine home, pointed at a temp dir for the length of ONE test file
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)).
 *
 * Every `loadConfig()` records its own brand's line in the machine registry
 * (`$OMEGA_HOME/brands.json`, default `~/.omega`), which is what makes a
 * sibling's `company: { id }` resolvable. A test fixture must never land
 * there: the developer's registry is real machine state, and a fixture root
 * under /tmp is a line about a brand that does not exist.
 *
 * node:test runs each FILE in its own process, so one require at the top of a
 * file that loads a brand fixture is the whole contract — no per-test setup,
 * nothing to restore.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.OMEGA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-test-home-'));

module.exports = { OMEGA_HOME: process.env.OMEGA_HOME };
