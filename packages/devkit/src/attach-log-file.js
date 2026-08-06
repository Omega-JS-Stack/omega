// attachLogFile(filePath, options) — tee process.stdout + process.stderr to a log file.
//
// Every chunk reaches BOTH sinks: the terminal exactly as written (colors intact) and the
// file with ANSI escapes stripped, so `grep`/`tail -f` reads clean. The file opens
// truncated — a new launch clears the previous run's log (no history kept).
//
// Writes go to an open fd SYNCHRONOUSLY. A stream's buffer dies with the process, which
// dropped exactly the lines describing a crash; the per-write syscall buys the crash tail.
//
// The default export is a process-wide SINGLETON (the common case: one CLI verb tees its
// whole run to one file). `createTee()` returns an INDEPENDENT tee. Tees STACK: an attach
// captures the CURRENT writers — the raw stream, or an outer tee's patched writer — so
// writes fan out through every layer and each detach restores the exact writers it found.
// That is what keeps an inner tee's detach from stealing (and truncating) the outer tee's
// file, the way a shared singleton did.
//
// Skipped in CI: a runner has its own log capture and wants no logs/ left in the workspace.
//
// `createChildLog()` is the sibling sink for output that never passes through this
// process' writers at all — a SPAWNED child's piped stdout/stderr. See below.

// Libraries
const fs = require('fs');
const path = require('path');
const Logger = require('./logger');

// Variables
const logger = new Logger('attach-log-file');
const ANSI_PATTERN = /\x1B\[[0-9;]*[a-zA-Z]/g;
const NOOP_DETACH = function () {};

function stripAnsi(value) {
  return String(value).replace(ANSI_PATTERN, '');
}

// Same predicate the rest of the repo uses for "a runner is driving this".
function isCI(env) {
  return env.GITHUB_ACTIONS === 'true' || env.CI === 'true';
}

// Factory — each call returns an independent tee with its own closure state.
function createTee() {
  let activePath = null;
  let activeDetach = null;
  let warned = false;

  function attach(filePath, options) {
    const env = (options && options.env) || process.env;

    if (!filePath || isCI(env)) { return NOOP_DETACH; }

    const abs = path.resolve(filePath);

    // Already teeing this exact file — do not patch a second time (that would write
    // every line twice).
    if (activePath === abs) { return activeDetach; }
    if (activeDetach) { activeDetach(); }

    let fd;
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fd = fs.openSync(abs, 'w');
      fs.writeSync(fd, `# omega log — ${new Date().toISOString()} — pid=${process.pid}\n`);
    } catch (e) {
      // A log file we cannot open is a lost log, never a lost process — the tee exists to
      // observe the run, so it declines and the run continues untouched.
      if (!warned) {
        warned = true;
        logger.warn(`Could not open log file ${abs} — continuing without one (${e.message})`);
      }
      return NOOP_DETACH;
    }

    // Whatever is installed right now, captured by reference so detach restores it exactly.
    const priorStdoutWrite = process.stdout.write;
    const priorStderrWrite = process.stderr.write;

    function writeToFile(chunk) {
      try {
        fs.writeSync(fd, stripAnsi(chunk));
      } catch (e) {
        // A broken log sink never breaks the writer it wraps.
      }
    }

    process.stdout.write = function (chunk, ...rest) {
      writeToFile(chunk);
      return priorStdoutWrite.call(process.stdout, chunk, ...rest);
    };
    process.stderr.write = function (chunk, ...rest) {
      writeToFile(chunk);
      return priorStderrWrite.call(process.stderr, chunk, ...rest);
    };

    function closeFd() {
      try {
        fs.closeSync(fd);
      } catch (e) {
        // Already closed, or the process is tearing down.
      }
    }

    // The fd outlives a crash otherwise — the writes already landed, this is the handle.
    process.on('exit', closeFd);

    let detached = false;
    function detach() {
      if (detached) { return; }
      detached = true;

      process.stdout.write = priorStdoutWrite;
      process.stderr.write = priorStderrWrite;
      process.off('exit', closeFd);
      closeFd();

      if (activeDetach === detach) {
        activePath = null;
        activeDetach = null;
      }
    }

    activePath = abs;
    activeDetach = detach;

    return detach;
  }

  return {
    attach,
    detach: () => { if (activeDetach) { activeDetach(); } },
  };
}

// createChildLog(options) — the sink for a SPAWNED process' output.
//
// The tee above patches this process' writers; a child's stdout/stderr never
// pass through them — they arrive as buffers on a pipe. The caller mirrors each
// buffer to the terminal untouched and hands it here, where it lands
// ANSI-stripped in a file that opens truncated, same as the tee's.
//
// The roll is what the tee has no need for: a child that stays up for days (a
// Firebase emulator) has to be truncatable MID-RUN, so a sibling process asks
// for a fresh log by touching `resetPath` and the poll below honors it within
// `pollMs`. Ported from BEM's emulator/serve commands, which carried a copy each.
//
// Writes go to an open fd synchronously, for the same reason the tee's do: the
// lines describing a crash are the ones a buffered stream drops.
//
// Every operation is best-effort — a broken log sink must never break the
// process it observes. It does say so ONCE though: a file that would not open
// warns on the first write it drops, so a silently empty log is never a
// surprise, and stays quiet after that.
//
// @param {object} options
// @param {string} options.logPath - File the child's output lands in (truncated on open)
// @param {string} [options.resetPath] - Sentinel another process touches to request a fresh log
// @param {number} [options.pollMs=500] - Sentinel poll interval
// @returns {{ path: string, write: Function, roll: Function, close: Function }}
function createChildLog(options) {
  const logPath = path.resolve(options.logPath);
  const resetPath = options.resetPath ? path.resolve(options.resetPath) : null;
  const pollMs = options.pollMs || 500;

  let fd = null;
  let openError = null;
  let warned = false;

  function removeSentinel() {
    if (!resetPath) { return; }
    try {
      fs.unlinkSync(resetPath);
    } catch (e) {
      // Not there — the normal case.
    }
  }

  function closeFd() {
    if (fd === null) { return; }
    try {
      fs.closeSync(fd);
    } catch (e) {
      // Already closed, or the process is tearing down.
    }
    fd = null;
  }

  // Reopen with 'w' rather than truncating in place: an external truncate leaves
  // the writer's offset where it was, so the file comes back sparse.
  function roll() {
    closeFd();
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fd = fs.openSync(logPath, 'w');
      openError = null;
    } catch (e) {
      // A log we cannot open is a lost log, never a lost process — but a
      // SILENT one is a run whose output nobody knows went nowhere, so the
      // first dropped write says so (once), same as the tee's own warn.
      fd = null;
      openError = e;
    }
  }

  function write(chunk) {
    if (fd === null) {
      if (openError && !warned) {
        warned = true;
        logger.warn(`Could not open log file ${logPath} — child output is not being recorded (${openError.message})`);
      }
      return;
    }
    try {
      fs.writeSync(fd, stripAnsi(chunk));
    } catch (e) {
      // A broken log sink never breaks the stream it mirrors.
    }
  }

  roll();

  // A sentinel a crashed run left behind would roll the fresh log on the first poll.
  removeSentinel();

  const timer = resetPath ? setInterval(() => {
    if (!fs.existsSync(resetPath)) { return; }
    roll();
    removeSentinel();
  }, pollMs) : null;

  function close() {
    if (timer) { clearInterval(timer); }
    closeFd();
    removeSentinel();
  }

  return { path: logPath, write, roll, close };
}

// Process-wide singleton — the production entry point.
const singleton = createTee();

function attachLogFile(filePath, options) {
  return singleton.attach(filePath, options);
}

module.exports = attachLogFile;
module.exports.detach         = singleton.detach;
module.exports.stripAnsi      = stripAnsi;
module.exports.createTee      = createTee;
module.exports.createChildLog = createChildLog;
