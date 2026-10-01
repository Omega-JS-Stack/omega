/**
 * Devkit test entry, three passes: the full suite in one `node --test` pass;
 * then e2e-harness.test.js alone, executed directly (no runner child, so no
 * result pipe to corrupt under load), with one retry that saves the output
 * of a first failure; then the runner's own suites (`test/runner/`) through
 * the runner itself, `src/test/cli.js`. A real regression fails twice.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const TEST_DIR = path.join(PKG, 'test');
const ISOLATED = 'e2e-harness.test.js';

// The stdout guard every package's test script preloads (#356). Devkit reaches
// its own copy by path — the runner pass is where the frame pipe exists, so the
// direct pass below takes it as inert weight it doesn't need.
const STDOUT_GUARD = path.join(PKG, 'src', 'test', 'stdout-guard.js');

// Sweep dead-pid .temp dirs from prior runs (fixtures are per-pid, e.g.
// defaults-engine-<pid>) so passing runs don't accumulate junk forever.
// Files (flake-evidence logs) are kept — they're the point of .temp.
const TEMP_DIR = path.join(PKG, '.temp');
if (fs.existsSync(TEMP_DIR)) {
  for (const entry of fs.readdirSync(TEMP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/-(\d+)$/);
    if (!match) continue;
    let alive = true;
    try {
      process.kill(parseInt(match[1], 10), 0);
    } catch (e) {
      alive = false;
    }
    if (!alive) {
      fs.rmSync(path.join(TEMP_DIR, entry.name), { recursive: true, force: true });
    }
  }
}

// Forward any extra args (e.g. --test-name-pattern) to every pass
const extraArgs = process.argv.slice(2);

// A pass whose child ended on a signal has no exit status: that is a failure, never a 0.
function exitCodeOf(result) {
  return result.status === null ? 1 : result.status;
}

function runPass(files, { capture = false, inProcess = false } = {}) {
  return spawnSync(process.execPath, [...(inProcess ? [] : ['--require', STDOUT_GUARD, '--test']), ...extraArgs, ...files], {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    cwd: PKG,
  });
}

const mainFiles = fs.readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.js') && name !== ISOLATED)
  .map((name) => path.join(TEST_DIR, name));

// Captured so a failure leaves evidence — main-pass failures under the
// commit gate's own npm test historically vanished without a trace (the
// gate only echoes the workspace summary), which kept the flake mechanism
// uncaptured. Output is re-emitted verbatim either way.
const main = runPass(mainFiles, { capture: true });
process.stdout.write(main.stdout || '');
process.stderr.write(main.stderr || '');
if (exitCodeOf(main) !== 0) {
  const mainEvidence = path.join(PKG, '.temp', `main-pass-fail-${Date.now()}.log`);
  fs.mkdirSync(path.dirname(mainEvidence), { recursive: true });
  fs.writeFileSync(mainEvidence, `${main.stdout || ''}\n${main.stderr || ''}`);
  console.warn(`\n⚠ main pass failed — output saved to ${mainEvidence}`);
  process.exit(exitCodeOf(main));
}

// Isolated pass, run directly (see header) and captured so a flake leaves evidence
const isolatedFile = path.join(TEST_DIR, ISOLATED);
const first = runPass([isolatedFile], { capture: true, inProcess: true });
process.stdout.write(first.stdout || '');
process.stderr.write(first.stderr || '');

let isolatedStatus = exitCodeOf(first);
if (isolatedStatus !== 0) {
  const evidence = path.join(PKG, '.temp', `e2e-harness-flake-${Date.now()}.log`);
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, `${first.stdout || ''}\n${first.stderr || ''}`);
  console.warn(`\n⚠ ${ISOLATED} failed once, output saved to ${evidence}; retrying (a real regression fails twice)…\n`);
  isolatedStatus = exitCodeOf(runPass([isolatedFile], { inProcess: true }));
}

// The runner's own suites, through the runner. `runner/` with the slash: the
// scope's substring match would also pull in the plain runner-core.test.js.
const runner = spawnSync(process.execPath, [path.join(PKG, 'src', 'test', 'cli.js'), 'runner/'], {
  stdio: 'inherit',
  cwd: PKG,
});

process.exit(isolatedStatus || exitCodeOf(runner));
