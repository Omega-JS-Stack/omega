/**
 * The stdout guard's functions; requiring this file patches nothing. The
 * `stdout-guard.js` preload applies the plain form inside a `node --test` child;
 * the runner applies the strict form for its json report.
 */

const childProcess = require('node:child_process');

// The preload's set (its behavior is fixed); strict mode adds the rest of the family.
const PLAIN_SPAWNERS = ['spawn', 'spawnSync'];
const STRICT_SPAWNERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];

/**
 * Rewrite a stdio option so a spawned child never gets OUR fd 1: an inherited
 * stdout would write past every patch here. Its stdout goes to fd 2 instead.
 * @param {object} options - Spawn options, possibly carrying `stdio`.
 * @returns {object} The options to spawn with.
 */
function guardStdio(options) {
  const { stdio } = options;

  if (stdio === 'inherit') {
    return { ...options, stdio: ['inherit', 2, 'inherit'] };
  }
  if (Array.isArray(stdio) && (stdio[1] === 'inherit' || stdio[1] === 1 || stdio[1] === process.stdout)) {
    const guarded = [...stdio];
    guarded[1] = 2;
    return { ...options, stdio: guarded };
  }
  return options;
}

// fork inherits the parent's stdio unless told otherwise, and its stdio must keep an ipc slot.
function guardForkStdio(options) {
  if (options.silent) return options;
  if (options.stdio === undefined || options.stdio === 'inherit') {
    return { ...options, stdio: ['inherit', 2, 'inherit', 'ipc'] };
  }
  return guardStdio(options);
}

function isOptions(arg) {
  return Boolean(arg) && typeof arg === 'object' && !Array.isArray(arg);
}

// Plain form: the last argument, when it is an options object (the preload's own rule).
function guardPlainArgs(args) {
  const last = args[args.length - 1];
  if (isOptions(last)) args[args.length - 1] = guardStdio(last);
  return args;
}

// Strict form: the options object wherever it sits (exec takes a callback after it).
function guardStrictArgs(name, args) {
  let index = -1;
  args.forEach((arg, position) => { if (isOptions(arg)) index = position; });
  const guard = name === 'fork' ? guardForkStdio : guardStdio;
  if (index !== -1) args[index] = guard(args[index]);
  else if (name === 'fork') args.push(guardForkStdio({}));
  return args;
}

/**
 * Keep stdout for one owner until the returned restore runs. Plain: string
 * writes go to stderr, Buffers (node:test frames) pass, `spawn`/`spawnSync`
 * children write stdout to fd 2. Strict: every write and every spawner's child.
 * @param {{strict?: boolean}} [options]
 * @returns {Function} Restores the writer and the spawners.
 */
function guardStdout({ strict = false } = {}) {
  const originalWrite = process.stdout.write;
  const writeFrame = originalWrite.bind(process.stdout);

  // console output arrives as a string (console.log formats before it writes);
  // the node:test reporter writes its frames as Buffers.
  process.stdout.write = function write(chunk, ...rest) {
    return strict || typeof chunk === 'string'
      ? process.stderr.write(chunk, ...rest)
      : writeFrame(chunk, ...rest);
  };

  const originals = {};
  for (const name of strict ? STRICT_SPAWNERS : PLAIN_SPAWNERS) {
    const original = childProcess[name];
    originals[name] = original;

    childProcess[name] = function guarded(...args) {
      return original.apply(this, strict ? guardStrictArgs(name, args) : guardPlainArgs(args));
    };
  }

  return function restore() {
    process.stdout.write = originalWrite;
    Object.assign(childProcess, originals);
  };
}

module.exports = { guardStdio, guardStdout };
