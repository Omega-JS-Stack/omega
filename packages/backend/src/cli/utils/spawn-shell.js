/**
 * Starting a child on a host whose shell you do not know.
 *
 * Two shapes, because the CLI has two kinds of child, and ONE rule underneath
 * both: the binary is never named by an absolute path we resolved ourselves —
 * the host's own resolver finds it.
 *
 *   spawnShell(command)        a command LINE the caller composed
 *                              (`firebase emulators:start --only …`)
 *   spawnOnPath(name, args)    a bare command NAME plus an argv
 *                              (`nodemon`, ['--watch', dir])
 *
 * The platform-specific part is the shell, and it is what this module owns:
 *   - Unix: `sh -c <command>` for a line; a bare name spawns directly, since
 *     execvp already searches PATH and skipping the shell keeps the returned
 *     child the REAL process (callers pipe its stdout and kill it by pid).
 *   - Windows: `cmd.exe /c …` for both. There is no `sh`, and an npm-installed
 *     bin is a `.cmd` shim that Node's CreateProcess cannot execute directly —
 *     only a shell can, and only the shell applies PATHEXT to a bare name.
 *
 * Explicit `cmd.exe /c` rather than `shell: true`: an ARRAY of args under
 * `shell: true` trips Node 24's DEP0190 deprecation warning, and the explicit
 * form is the supported warning-free path. Node quotes each argv entry it hands
 * to CreateProcess, so a path with spaces survives with nothing to escape here.
 * Same call shape as `@omega.js/desktop`'s `omega runner`, which hit the trap
 * first (`packages/desktop/src/commands/runner.js` ~313).
 */
// The module OBJECT, never a destructured `spawn`: the binding is read at CALL
// time, so `child_process.spawn` stays a live seam a test can stand in for
// ([#769](https://github.com/Omega-JS-Stack/omega/issues/769)). Destructuring
// here would freeze whatever `spawn` was at this module's first require —
// which, for a module every CLI command loads, is before any test can reach it.
const childProcess = require('child_process');

/**
 * What actually runs, for a composed command LINE. Pure — the test seam.
 *
 * @param {string} command - The command line
 * @param {string} [platform] - Host platform
 * @returns {[string, string[]]} [binary, args]
 */
function shellInvocation(command, platform = process.platform) {
  return platform === 'win32'
    ? ['cmd.exe', ['/c', command]]
    : ['sh', ['-c', command]];
}

/**
 * What actually runs, for a bare command NAME plus an argv. Pure — the test seam.
 *
 * @param {string} name - Bare command name, never a resolved path
 * @param {string[]} [args] - Its arguments, unquoted
 * @param {string} [platform] - Host platform
 * @returns {[string, string[]]} [binary, args]
 */
function pathInvocation(name, args = [], platform = process.platform) {
  return platform === 'win32'
    ? ['cmd.exe', ['/c', name, ...args]]
    : [name, args];
}

/**
 * Spawn a composed command LINE through the host's shell.
 *
 * @param {string} command - The command line to run
 * @param {object} [options] - Passed to child_process.spawn verbatim
 * @returns {import('child_process').ChildProcess}
 */
function spawnShell(command, options = {}) {
  const [bin, args] = shellInvocation(command);

  return childProcess.spawn(bin, args, options);
}

/**
 * Spawn a command by BARE NAME, letting the host resolve it off PATH.
 *
 * This is the counterpart to `commandOnPath()`: that probe answers whether a
 * tool is installed, and this runs it. The probe's answer is never what gets
 * spawned — on Windows `where` prints the extensionless shell shim first, and
 * neither that shim nor the `.cmd` beside it is executable by CreateProcess.
 *
 * @param {string} name - Bare command name, e.g. 'nodemon'
 * @param {string[]} [args] - Its arguments
 * @param {object} [options] - Passed to child_process.spawn verbatim
 * @returns {import('child_process').ChildProcess}
 */
function spawnOnPath(name, args = [], options = {}) {
  const [bin, spawnArgs] = pathInvocation(name, args);

  return childProcess.spawn(bin, spawnArgs, options);
}

module.exports = { spawnShell, spawnOnPath, shellInvocation, pathInvocation };
