/**
 * Devkit test entry: the full suite in one runner pass, EXCEPT
 * e2e-harness.test.js, which runs in its own isolated pass afterward —
 * with one retry that preserves the failure output as evidence.
 *
 * Why: e2e-harness.test.js flakes rarely (~1-in-15) and scheduling-
 * sensitively — under a shared `node --test` run it historically corrupted
 * the runner's result stream ("Unable to deserialize cloned data"), and
 * even isolated it can lose a subtest right after the main pass (94a; the
 * exact mechanism is uncaptured — hence the evidence file). A real
 * regression fails BOTH attempts and still fails the suite; the flake
 * costs one retry and leaves a log instead of a mystery.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const TEST_DIR = path.join(PKG, 'test');
const ISOLATED = 'e2e-harness.test.js';

// Forward any extra args (e.g. --test-name-pattern) to every pass
const extraArgs = process.argv.slice(2);

function runPass(files, { capture = false } = {}) {
  return spawnSync(process.execPath, ['--test', ...extraArgs, ...files], {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    cwd: PKG,
  });
}

const mainFiles = fs.readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.js') && name !== ISOLATED)
  .map((name) => path.join(TEST_DIR, name));

const main = runPass(mainFiles);
if (main.status !== 0) {
  process.exit(main.status || 1);
}

// Isolated pass, captured so a flake leaves evidence
const isolatedFile = path.join(TEST_DIR, ISOLATED);
const first = runPass([isolatedFile], { capture: true });
process.stdout.write(first.stdout || '');
process.stderr.write(first.stderr || '');

if (first.status === 0) {
  process.exit(0);
}

const evidence = path.join(PKG, '.temp', `e2e-harness-flake-${Date.now()}.log`);
fs.mkdirSync(path.dirname(evidence), { recursive: true });
fs.writeFileSync(evidence, `${first.stdout || ''}\n${first.stderr || ''}`);
console.warn(`\n⚠ ${ISOLATED} failed once — output saved to ${evidence}; retrying (a real regression fails twice)…\n`);

const second = runPass([isolatedFile]);
process.exit(second.status || 0);
