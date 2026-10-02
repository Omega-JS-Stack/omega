/**
 * Lane timer: `node scripts/lane.js <label> "<command>" ["<command>" …]`.
 * Runs every command in sequence through a shell whatever each one's result,
 * prints a per-command summary when there is more than one, then ONE closing
 * line with the wall time, and exits with the first failure's code. Root
 * `npm test` is a lane whose commands are the other lanes.
 * Output tees to `.temp/logs/<lane>.log`, so children pipe instead of inherit.
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
  const results = [];

  for (const command of commands) {
    const commandStartedAt = Date.now();
    const code = await run(command);
    results.push({ command, code, time: formatDuration(Date.now() - commandStartedAt) });
  }

  const elapsed = formatDuration(Date.now() - startedAt);
  const failures = results.filter((result) => result.code !== 0);

  if (results.length > 1) {
    console.log(`\nlane ${label} summary:`);
    for (const { command, code, time } of results) {
      console.log(code === 0 ? `  ✓ ${command} (${time})` : `  ✗ ${command} (${time}, exit ${code})`);
    }
  }

  // The closing line sits right under the summary; a lone command's keeps its gap.
  const gap = results.length > 1 ? '' : '\n';

  if (failures.length > 0) {
    const { code } = failures[0];
    console.log(`${gap}✗ lane ${label} failed in ${elapsed} (${failures.length} of ${results.length} failed, exit ${code})\n`);
    process.exit(code);
  }

  console.log(`${gap}✓ lane ${label} done in ${elapsed}\n`);
}

main();
