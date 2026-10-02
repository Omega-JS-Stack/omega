/**
 * The one brand-root `npm install`: npm workspaces cover every target, so a
 * single install at the root brings every target's dependencies. It runs
 * under the directory's own Node (./run-command.js).
 */
const { runCommand } = require('./run-command.js');

/**
 * Install a brand's dependencies at its root.
 *
 * @param {string} dir - The brand root
 * @param {Function} [run] - The command runner, runCommand's shape (a caller's test seam)
 * @returns {Promise<{ success: boolean, error?: string, code?: number }>} runCommand's answer
 */
function npmInstall(dir, run = runCommand) {
  return run('npm', ['install', '--no-audit', '--no-fund'], dir);
}

module.exports = { npmInstall };
