// Structured signing event log — appends JSONL lines to `<runner-dir>/omega-signing.log`
// (or another path via `OMEGA_SIGN_LOG`) so a separate `mgr runner monitor` process can
// tail + pretty-print them in real time on the Windows box.
//
// Why JSONL not plain text: lets the monitor pretty-print durations, color the failure
// events distinctively, and group sign-start / sign-done pairs without parsing English.
//
// Where the file lands (resolved in this priority order):
//   1. `OMEGA_SIGN_LOG` env var (explicit override) — wins if set
//   2. `<OMEGA_RUNNER_HOME>/omega-signing.log` — when caller has set the runner home
//   3. `<defaultRunnerHome()>/omega-signing.log` on Windows — the runner home the
//      install actually uses (`%LOCALAPPDATA%\omega-runner`), read from
//      src/commands/runner.js so the two can never drift again. This is the
//      machine-wide default, so EVERY signing job from every org/repo writes to
//      the same file and `npx omega runner monitor` with no args picks it up.
//   4. `<RUNNER_TOOLSDIRECTORY>/omega-signing.log` — fallback if someone runs
//      sign-windows outside the runner-installed path
//   5. `<process.cwd()>/logs/signing.log` — local dev fallback (matches dev.log, build.log, etc.)

const os      = require('os');
const path    = require('path');
const jetpack = require('fs-jetpack');

const logger = new (require('../../build.js'))().logger('sign-events');

function resolveLogPath(env, platform) {
  env      = env || process.env;
  platform = platform || process.platform;

  if (env.OMEGA_SIGN_LOG) return env.OMEGA_SIGN_LOG;
  if (env.OMEGA_RUNNER_HOME) {
    return path.join(env.OMEGA_RUNNER_HOME, 'omega-signing.log');
  }
  if (platform === 'win32') {
    // Required lazily: runner.js pulls sign-events in from `monitor`, and a
    // top-level require here would make that a cycle.
    const { defaultRunnerHome } = require('../../commands/runner.js');
    return path.join(defaultRunnerHome(platform, env), 'omega-signing.log');
  }
  const ciRoot = env.RUNNER_TOOLSDIRECTORY
    || env.RUNNER_WORKSPACE
    || env.RUNNER_ROOT;
  if (ciRoot) {
    return path.join(ciRoot, 'omega-signing.log');
  }
  return path.join(process.cwd(), 'logs', 'signing.log');
}

const logPath = resolveLogPath();

function emit(event, data) {
  const line = `${JSON.stringify({
    ts:    new Date().toISOString(),
    pid:   process.pid,
    host:  os.hostname(),
    event,
    ...data,
  })}\n`;
  try {
    // jetpack.append creates the parent directory when it is missing. The first
    // event of a job is often the first thing to touch the runner home, and a
    // dropped first line is a whole signing run with no trail.
    jetpack.append(logPath, line);
  } catch (e) {
    // If we can't write the event file, don't crash the sign — warn on the
    // framework logger so the GH Actions runner log still has the trace.
    logger.warn(`write failed: ${e.message}`);
  }
}

module.exports = {
  getLogPath: () => logPath,
  emit,
  resolveLogPath,
};
