/**
 * runCommand — spawn a child in a directory, streaming its output, and
 * resolve a { success, error? } result instead of rejecting. Shared by the
 * update service (npm install / npm run build) and the brand-root test
 * fan-out (per-target `omega test`).
 *
 * Every command runs under the TARGET'S OWN Node (friction #15): the target
 * root's .nvmrc picks the nvm install whose bin is prepended to PATH — one
 * brand can span Node majors (web 24, backend 22) without a single nvm
 * switch. A pinned-but-missing major fails fast with
 * the `nvm install` to run. If a command rewrites the .nvmrc and THEN
 * fails (the desktop target's ensure step bumps the pin when Electron's bundled Node moved), it is
 * re-resolved and retried once — one run self-heals instead of two.
 *
 * A `prefix` turns on the PREFIXED mode the deploy fan-out's parallel group
 * runs in ([#901](https://github.com/Omega-JS-Stack/omega/issues/901)):
 * stdout and stderr are piped and re-emitted line by line behind
 * `[<target>] `, so concurrent children read as one log (the brand's
 * `logs/deploy.log` tee sees exactly those lines, and each target's own
 * `logs/deploy.log` keeps its clean copy). Its stdin is /dev/null on purpose:
 * a child of a parallel group has no terminal to ask in, so a step that would
 * prompt must refuse instead of stalling the whole group.
 */
const { spawn } = require('node:child_process');
const chalk = require('chalk').default;
const { resolveTargetNode, nodeEnvFor } = require('./node-version.js');

/**
 * Re-emit a child stream's output line by line behind a prefix. Returns the
 * flush for whatever the child printed without a trailing newline, which is
 * every progress line a tool ends with a bare `\r` or nothing at all.
 *
 * @param {object} source - The child's piped stream.
 * @param {object} sink - The parent stream it lands on.
 * @param {string} prefix - What goes in front of every line.
 * @returns {Function} the partial-line flush, called once the child is done
 */
function prefixStream(source, sink, prefix) {
  let pending = '';

  source.setEncoding('utf8');
  source.on('data', (chunk) => {
    const lines = `${pending}${chunk}`.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      sink.write(`${prefix}${line}\n`);
    }
  });

  return () => {
    if (pending) {
      sink.write(`${prefix}${pending}\n`);
      pending = '';
    }
  };
}

function spawnOnce(command, args, cwd, env, prefix) {
  return new Promise((resolve) => {
    const child = prefix
      ? spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env })
      : spawn(command, args, { cwd, shell: false, stdio: 'inherit', env });

    const flush = prefix
      ? [
        prefixStream(child.stdout, process.stdout, `[${prefix}] `),
        prefixStream(child.stderr, process.stderr, `[${prefix}] `),
      ]
      : [];

    child.on('close', (code) => {
      for (const flushOne of flush) flushOne();
      resolve(code === 0
        ? { success: true, code }
        : { success: false, code, error: `exit code ${code}` });
    });

    child.on('error', (error) => {
      for (const flushOne of flush) flushOne();
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
 * @param {object} [extraEnv] - Env this run carries on top of the caller's own
 *   (the test fan-out's OMEGA_TEST_FANOUT signal, #814)
 * @param {object} [options] - Run options
 * @param {string} [options.prefix] - Label every line of the child's output
 *   carries, which also pipes its streams instead of inheriting them (#901)
 * @returns {Promise<{ success: boolean, error?: string, code?: number }>}
 */
async function runCommand(command, args, cwd, extraEnv, options = {}) {
  let resolved = resolveTargetNode(cwd);
  if (resolved?.error) {
    console.log(`      ${chalk.red('✗')} ${resolved.error}`);
    return { success: false, error: resolved.error };
  }
  if (resolved?.binDir) {
    console.log(`      ${chalk.dim(`↪ Node ${resolved.version} (.nvmrc ${resolved.spec})`)}`);
  }

  const specBefore = resolved?.spec || null;
  const result = await spawnOnce(command, args, cwd, { ...process.env, ...nodeEnvFor(resolved), ...extraEnv }, options.prefix);
  if (result.success) {
    return result;
  }

  // Self-heal: the command may have rewritten the .nvmrc mid-run (the desktop
  // target writes the pin BEFORE its own Node check). Re-resolve; a changed pin
  // gets one retry under the newly pinned Node.
  resolved = resolveTargetNode(cwd);
  if (!resolved || resolved.error || (resolved.spec || null) === specBefore) {
    return result;
  }

  console.log(`      ${chalk.dim(`↪ .nvmrc changed to ${resolved.spec} — retrying under Node ${resolved.version || `v${resolved.major}`}`)}`);
  return spawnOnce(command, args, cwd, { ...process.env, ...nodeEnvFor(resolved), ...extraEnv }, options.prefix);
}

module.exports = { runCommand };
