// Run a shell command with a hard time limit. node-powertools' `execute` is the
// runner every sign call already uses (shell, piped stdio, rejects with stderr),
// and it settles only on the child's `close` event. So the limit lives on a
// timer of its own: when it fires the attempt is rejected THEN, whatever the
// termination below manages, instead of holding the job until GitHub's six-hour
// default does it ([#864](https://github.com/Omega-JS-Stack/omega/issues/864)).
//
// `execute` spawns through a shell, so the program is the shell's child. On
// Windows `taskkill /T` takes the tree, the same call `runner.js` makes on a
// listener. Elsewhere the child is spawned detached, which puts the shell at
// the head of its own process group, and the negative pid signals the group.

const { spawnSync } = require('child_process');
const { execute } = require('node-powertools');

const logger = new (require('../../build.js'))().logger('exec-with-limit');

// A kill that failed is exactly the state the operator needs to see, so every
// failure is said, never swallowed.
function terminateTree(child, platform) {
  if (platform === 'win32') {
    const k = spawnSync('taskkill', ['/F', '/PID', String(child.pid), '/T'], { encoding: 'utf8' });
    if (k.status !== 0) logger.warn(`taskkill /PID ${child.pid} /T exited ${k.status}: ${String(k.stderr || k.stdout || '').trim()}`);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (e) {
    logger.warn(`kill of process group ${child.pid} failed: ${e.message}`);
  }
}

// Resolves with the command's stdout; rejects with the command's own error, or
// with one naming the limit when the limit fired first.
function execWithLimit(cmd, options) {
  options = options || {};
  const { limitMs, label = 'command' } = options;
  if (!(limitMs > 0)) throw new Error(`execWithLimit needs a positive limitMs (got ${limitMs})`);

  const platform = process.platform;
  let child;
  let timedOut = false;

  // `detached` on Windows would open a console window for the child; on POSIX
  // it is the process group the kill above needs. `execute` runs the setup
  // callback synchronously, so `child` is set before this returns.
  const run = execute(cmd, { log: false, config: { detached: platform !== 'win32' } }, (c) => { child = c; });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`${label} produced no verdict within ${Math.round(limitMs / 1000)}s and was terminated`));
      terminateTree(child, platform);
    }, limitMs);

    run.then(
      (output) => { clearTimeout(timer); resolve(output); },
      (e) => {
        clearTimeout(timer);
        // After the limit fired, the child's own verdict is the termination we
        // asked for; the rejection above already said what happened.
        if (!timedOut) reject(e);
      },
    );
  });
}

module.exports = { execWithLimit };
