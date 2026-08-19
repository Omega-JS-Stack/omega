/**
 * Test-child stdout guard — keeps human output off the test runner's protocol
 * pipe (#321, lifted repo-wide in #356).
 *
 * `node --test` spawns one child per file, and that child reports back over
 * its STDOUT as v8-serialized frames — the same fd every console line the code
 * under test prints goes to. When one read chunk ends a frame and carries
 * console bytes right behind it, node's parser reads those bytes as the next
 * frame's length; a multibyte character there (`─`, `→`, `✓` — the manage
 * walk prints them constantly) makes that SIGNED length negative, so the
 * parser deserializes the console text and the whole file dies with
 * `Unable to deserialize cloned data due to invalid or unsupported version`.
 *
 * So the console side goes to STDERR, which the runner reads as lines and
 * folds into the report — the output still shows, the protocol pipe carries
 * frames alone. Loaded with `--require @omega.js/devkit/test/stdout-guard`
 * from a package's test script, which the runner forwards to every child;
 * outside a runner child it does nothing, and a second load is a no-op.
 *
 * RETIREMENT: upstream reads the length unsigned as of Node 26.7
 * (nodejs/node#64706). When this repo's pinned node (.nvmrc) reaches >=26.7.0,
 * delete this file and every `--require` of it.
 */
const childProcess = require('node:child_process');

// One application per process, whatever path the preload was resolved through
// (a package's `--require`, a vendored copy, a test's own require).
const APPLIED = Symbol.for('@omega.js/devkit:test/stdout-guard');

/**
 * Rewrite a stdio option so a spawned child never gets OUR fd 1 — an inherited
 * stdout writes into the frame pipe from a process no patch here can reach.
 * Pointing its stdout at fd 2 keeps that output in the report as stderr.
 *
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

if (process.env.NODE_TEST_CONTEXT && !globalThis[APPLIED]) {
  globalThis[APPLIED] = true;

  const writeFrame = process.stdout.write.bind(process.stdout);

  // The reporter writes its frames as Buffers, and nothing else writes to this
  // stream at all: console output arrives as a string (console.log formats
  // before it writes).
  process.stdout.write = function write(chunk, ...rest) {
    return typeof chunk === 'string'
      ? process.stderr.write(chunk, ...rest)
      : writeFrame(chunk, ...rest);
  };

  // The spawn pair is where a package hands a child its stdio (the manage
  // walk's service legs, `omega deploy`/`test`/`update` fan-outs, every
  // fixture build a suite shells out for); the exec family pipes stdout unless
  // it is asked for otherwise. Preloading beats every
  // `require('node:child_process')` in src and test, so destructured imports
  // get the guarded functions too.
  for (const name of ['spawn', 'spawnSync']) {
    const original = childProcess[name];

    childProcess[name] = function guarded(...args) {
      const last = args[args.length - 1];
      if (last && typeof last === 'object' && !Array.isArray(last)) {
        args[args.length - 1] = guardStdio(last);
      }
      return original.apply(this, args);
    };
  }
}
