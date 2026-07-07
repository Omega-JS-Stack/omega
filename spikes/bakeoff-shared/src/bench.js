/**
 * bench.js — minimal benchmark harness for the SSG bake-off.
 *
 * hyperfine-style repeated-run timing without the external dependency
 * (hyperfine is not installed on this machine; install it and this file
 * becomes optional). Runs a shell command N times with optional warmup and
 * reports mean / stddev / min / max wall time.
 *
 * Usage:
 *   node src/bench.js --runs=3 --warmup=1 --label="eleventy cold" -- <command...>
 *
 * Example:
 *   node src/bench.js --runs=3 --warmup=1 -- npx @11ty/eleventy
 */

// Libraries
const { execSync } = require('child_process');

/**
 * Run a command once and return wall time in seconds.
 * @param {string} command
 * @returns {number} seconds
 */
function timeOnce(command) {
  const start = process.hrtime.bigint();
  execSync(command, { stdio: 'ignore', shell: '/bin/zsh' });
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e9;
}

/**
 * Benchmark a command.
 * @param {object} options
 * @param {string} options.command - shell command to run
 * @param {number} [options.runs=3]
 * @param {number} [options.warmup=0]
 * @param {string} [options.label]
 * @param {function} [options.onRun] - called with (runIndex, seconds) after each timed run
 * @returns {object} { label, command, runs, times, mean, stddev, min, max }
 */
function bench(options) {
  const runs = options.runs ?? 3;
  const warmup = options.warmup ?? 0;

  for (let i = 0; i < warmup; i++) {
    timeOnce(options.command);
  }

  const times = [];
  for (let i = 0; i < runs; i++) {
    const seconds = timeOnce(options.command);
    times.push(seconds);
    if (options.onRun) options.onRun(i, seconds);
  }

  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance = times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length;

  return {
    label: options.label || options.command,
    command: options.command,
    runs,
    times: times.map((t) => Number(t.toFixed(3))),
    mean: Number(mean.toFixed(3)),
    stddev: Number(Math.sqrt(variance).toFixed(3)),
    min: Number(Math.min(...times).toFixed(3)),
    max: Number(Math.max(...times).toFixed(3)),
  };
}

// CLI
if (require.main === module) {
  const separator = process.argv.indexOf('--');
  if (separator === -1 || separator === process.argv.length - 1) {
    console.error('Usage: node src/bench.js [--runs=3] [--warmup=1] [--label="name"] -- <command...>');
    process.exit(1);
  }

  const flags = Object.fromEntries(
    process.argv.slice(2, separator)
      .filter((a) => a.startsWith('--'))
      .map((a) => a.replace(/^--/, '').split('='))
  );
  const command = process.argv.slice(separator + 1).join(' ');

  const result = bench({
    command,
    runs: flags.runs ? Number(flags.runs) : 3,
    warmup: flags.warmup ? Number(flags.warmup) : 0,
    label: flags.label,
    onRun: (i, seconds) => console.log(`  [${i + 1}/${flags.runs || 3}] ${seconds.toFixed(3)}s`),
  });

  console.log(JSON.stringify(result, null, 2));
}

module.exports = { bench };
