/**
 * "Is this tool installed?" — the ONE cross-platform PATH probe.
 *
 * Every framework asks it of an external CLI it shells out to (mkcert,
 * nodemon, the Stripe CLI) and the answer decides whether a lane runs or
 * degrades. The probe itself is platform-specific: Unix has `which`, Windows
 * has `where`, and each host has only its own — a bare `which` on Windows is
 * not "not installed", it's a crash the caller reads as "not installed".
 */
const { execSync } = require('child_process');

/**
 * Is a command installed? An EXISTENCE probe.
 *
 * **Never spawn what this returns.** The path is for REPORTING — a log line, a
 * diagnostic, a "which one did we find". Running the tool means naming it BARE
 * and letting the host resolve it (`spawnOnPath` in @omega.js/backend does
 * exactly that), because on Windows `where` prints the extensionless shell shim
 * FIRST, and neither that shim nor the `.cmd` beside it is something Node's
 * CreateProcess can execute — only a shell can, and only a shell applies
 * PATHEXT. Truthiness is the answer this exists to give.
 *
 * @param {string} name - Command name, e.g. 'mkcert'
 * @param {object} [options]
 * @param {string} [options.platform] - Host platform (test seam)
 * @param {function} [options.exec] - execSync (test seam)
 * @returns {string|null} The first path the probe reported, or null when it is not installed
 */
function commandOnPath(name, { platform = process.platform, exec = execSync } = {}) {
  const probe = platform === 'win32' ? 'where' : 'which';

  try {
    const found = exec(`${probe} ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

    // `where` prints EVERY match, one per line (`which` prints one); the first
    // is the one the shell would pick — on Windows that is the extensionless
    // shim, which is why this answer is reported and not spawned.
    return String(found).split(/\r?\n/)[0].trim() || null;
  } catch (e) {
    // Both probes exit nonzero when the name isn't found — the expected answer,
    // not a failure.
    return null;
  }
}

module.exports = { commandOnPath };
