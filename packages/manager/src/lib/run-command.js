/**
 * runCommand — spawn a child in a directory, streaming its output, and
 * resolve a { success, error? } result instead of rejecting. Shared by the
 * update service (npm install / npm run build) and the brand-root test
 * fan-out (per-app `omega test`).
 *
 * Every command runs under the APP'S OWN Node (friction #15): the dir's
 * .nvmrc (or functions/.nvmrc) picks the nvm install whose bin is
 * prepended to PATH — one brand can span Node majors (web 24, backend 22)
 * without a single nvm switch. A pinned-but-missing major fails fast with
 * the `nvm install` to run. If a command rewrites the .nvmrc and THEN
 * fails (EM setup bumps the pin when Electron's bundled Node moved), it is
 * re-resolved and retried once — one run self-heals instead of two.
 */
const { spawn } = require('node:child_process');
const chalk = require('chalk').default;
const { resolveAppNode, nodeEnvFor } = require('./node-version.js');

function spawnOnce(command, args, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'inherit', env });

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

/**
 * Run a command in a directory under that directory's own Node, streaming
 * output. Resolves { success, error?, code? }.
 *
 * @param {string} command - Executable (no shell)
 * @param {string[]} args - Arguments
 * @param {string} cwd - Working directory (its .nvmrc picks the Node)
 * @returns {Promise<{ success: boolean, error?: string, code?: number }>}
 */
async function runCommand(command, args, cwd) {
  let resolved = resolveAppNode(cwd);
  if (resolved?.error) {
    console.log(`      ${chalk.red('✗')} ${resolved.error}`);
    return { success: false, error: resolved.error };
  }
  if (resolved?.binDir) {
    console.log(`      ${chalk.dim(`↪ Node ${resolved.version} (.nvmrc ${resolved.spec})`)}`);
  }

  const specBefore = resolved?.spec || null;
  const result = await spawnOnce(command, args, cwd, { ...process.env, ...nodeEnvFor(resolved) });
  if (result.success) {
    return result;
  }

  // Self-heal: the command may have rewritten the .nvmrc mid-run (EM setup
  // writes the pin BEFORE its own Node check). Re-resolve; a changed pin
  // gets one retry under the newly pinned Node.
  resolved = resolveAppNode(cwd);
  if (!resolved || resolved.error || (resolved.spec || null) === specBefore) {
    return result;
  }

  console.log(`      ${chalk.dim(`↪ .nvmrc changed to ${resolved.spec} — retrying under Node ${resolved.version || `v${resolved.major}`}`)}`);
  return spawnOnce(command, args, cwd, { ...process.env, ...nodeEnvFor(resolved) });
}

module.exports = { runCommand };
