/**
 * Lane timer — the thin wrapper every root test lane runs through so a lane
 * always says how long it took (Ian 2026-07-31: "make our tests/pipeline
 * mark the length of time it took to run").
 *
 *   node scripts/lane.js <label> "<command>" ["<command>" …]
 *
 * Runs each command in sequence (shell — globs and `-w` flags behave exactly
 * as they did in package.json), stops at the first failure, and prints ONE
 * line at the end with the lane's wall time. Root `npm test` is itself a lane
 * whose commands are the other lanes, so its closing line IS the pipeline
 * total, under each lane's own line.
 *
 * The lane's FULL output — its own lines plus every child command's stdout and
 * stderr — also tees to `.temp/logs/<lane>.log` (#197): the terminal is
 * untouched, the file is ANSI-stripped, and each run truncates the last. That
 * is why the children pipe instead of inheriting; FORCE_COLOR keeps their
 * colors alive across the pipe, and the tee strips them back out of the file.
 */
const { spawn } = require('node:child_process');
const { teeLog } = require('./tee-log');

const [label, ...commands] = process.argv.slice(2);

// Watch-deadline scale (#211): a lane runs its children against every other
// suite on the machine, and the rebuild-watching web tests time out on LOAD,
// not on breakage (eight sightings, always green standalone). Every child
// inherits the multiplier — 30s solo becomes 90s in a lane — unless the caller
// (or an outer lane) already set one. Solo `node --test <file>` never comes
// through here, so it keeps the tight deadline that surfaces a real
// regression fast.
const DEADLINE_SCALE = '3';

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

/**
 * Run one command, forwarding its output through this process (so the lane's
 * tee sees it) and resolving with its exit code.
 * @param {string} command - the shell command
 * @returns {Promise<number>} exit code (a signalled death counts as 1)
 */
function run(command) {
  return new Promise((resolve) => {
    const env = {
      ...(process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}),
      ...process.env,
      OMEGA_TEST_DEADLINE_SCALE: process.env.OMEGA_TEST_DEADLINE_SCALE || DEADLINE_SCALE,
    };

    const child = spawn(command, {
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'],
      env,
    });

    // setEncoding decodes across chunk boundaries — a multi-byte char split by
    // the pipe would otherwise land mangled in both sinks.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));

    child.on('error', (error) => {
      console.error(`${error.message}\n`);
      resolve(1);
    });
    // 'close' (not 'exit'): the lane waits for stream EOF, so every byte the
    // command produced is teed before the next one starts. The cost is that a
    // GRANDCHILD which INHERITED this stdout holds the pipe — and the lane —
    // open after its parent exits, so runners must spawn their own children
    // with piped or ignored stdio, never inherit.
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  teeLog(label);

  const startedAt = Date.now();
  let failure = null;

  for (const command of commands) {
    const code = await run(command);
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
}

main();
