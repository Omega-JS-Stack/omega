/**
 * Devkit test entry: the full suite in one runner pass, EXCEPT
 * e2e-harness.test.js, which runs afterward in its own isolated pass,
 * executed directly (no `node --test`), with one retry that preserves the
 * failure output as evidence.
 *
 * Why isolated: under a shared `node --test` run, e2e-harness.test.js
 * historically corrupted the runner's result stream ("Unable to deserialize
 * cloned data").
 *
 * Why executed directly: isolation alone kept flaking with that same
 * signature (~6 per 1000 runs at idle, far worse under load), and the fault
 * lives entirely in the test runner's own IPC. `node --test <file>` spawns a
 * child and streams results back over a serialized pipe; under load the
 * parent corrupts a message and marks the FILE failed while every subtest
 * passed. No runner child means no pipe, so the mechanism is gone (#36).
 * A node:test file executed directly still exits non-zero when a test fails,
 * so pass/fail semantics are unchanged.
 *
 * The retry stays as belt and suspenders for genuinely unknown flakes: a real
 * regression fails BOTH attempts and still fails the suite, while anything
 * left leaves a log instead of a mystery.
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
if (main.status !== 0) {
  const mainEvidence = path.join(PKG, '.temp', `main-pass-fail-${Date.now()}.log`);
  fs.mkdirSync(path.dirname(mainEvidence), { recursive: true });
  fs.writeFileSync(mainEvidence, `${main.stdout || ''}\n${main.stderr || ''}`);
  console.warn(`\n⚠ main pass failed — output saved to ${mainEvidence}`);
  process.exit(main.status || 1);
}

// Isolated pass, run directly (see header) and captured so a flake leaves evidence
const isolatedFile = path.join(TEST_DIR, ISOLATED);
const first = runPass([isolatedFile], { capture: true, inProcess: true });
process.stdout.write(first.stdout || '');
process.stderr.write(first.stderr || '');

if (first.status === 0) {
  process.exit(0);
}

const evidence = path.join(PKG, '.temp', `e2e-harness-flake-${Date.now()}.log`);
fs.mkdirSync(path.dirname(evidence), { recursive: true });
fs.writeFileSync(evidence, `${first.stdout || ''}\n${first.stderr || ''}`);
console.warn(`\n⚠ ${ISOLATED} failed once — output saved to ${evidence}; retrying (a real regression fails twice)…\n`);

const second = runPass([isolatedFile], { inProcess: true });
process.exit(second.status || 0);
