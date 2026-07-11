/**
 * runCommand — spawn a child in a directory, streaming its output, and
 * resolve a { success, error? } result instead of rejecting. Shared by the
 * update service (npm install / npm run build) and the brand-root test
 * fan-out (per-app `omega test`).
 */
const { spawn } = require('node:child_process');

/**
 * Run a command in a directory, streaming output. Resolves { success, error? }.
 *
 * @param {string} command - Executable (no shell)
 * @param {string[]} args - Arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<{ success: boolean, error?: string, code?: number }>}
 */
function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'inherit' });

    child.on('close', (code) => {
      resolve(code === 0
        ? { success: true, code }
        : { success: false, code, error: `exit code ${code}` });
    });

    child.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

module.exports = { runCommand };
