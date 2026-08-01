/**
 * Lane timer — the thin wrapper every root test lane runs through so a lane
 * always says how long it took (Ian 2026-07-31: "make our tests/pipeline
 * mark the length of time it took to run").
 *
 *   node scripts/lane.js <label> "<command>" ["<command>" …]
 *
 * Runs each command in sequence (shell, stdio inherited — globs and `-w`
 * flags behave exactly as they did in package.json), stops at the first
 * failure, and prints ONE line at the end with the lane's wall time. Root
 * `npm test` is itself a lane whose commands are the other lanes, so its
 * closing line IS the pipeline total, under each lane's own line.
 */
const { spawnSync } = require('node:child_process');

const [label, ...commands] = process.argv.slice(2);

if (!label || commands.length === 0) {
  console.error('Usage: node scripts/lane.js <label> "<command>" ["<command>" …]');
  process.exit(1);
}

/** Format elapsed milliseconds for humans: 42s, 3m 7s, 1h 4m 9s. */
function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainingSeconds}s`;
}

const startedAt = Date.now();
let failure = null;

for (const command of commands) {
  const run = spawnSync(command, { stdio: 'inherit', shell: true });
  const code = run.status ?? 1;
  if (code !== 0) {
    failure = { command, code };
    break;
  }
}

const elapsed = formatDuration(Date.now() - startedAt);

if (failure) {
  console.log(`\n✗ lane ${label} failed in ${elapsed} (exit ${failure.code}: ${failure.command})\n`);
  process.exit(failure.code);
}

console.log(`\n✓ lane ${label} done in ${elapsed}\n`);
