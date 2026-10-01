/**
 * The runner's entry for a package no framework owns (a library, `scripts/`,
 * the root lanes):
 *
 *   node packages/devkit/src/test/cli.js [targets] [--root=<dir>] [--log=<path>]
 *     [--filter=<text>] [--layer=<name>] [--lane=<name>] [--extended] [--reporter=pretty|json]
 *
 * `--root` defaults to `test` and `--log` to `logs/test.log`, both under the cwd.
 * Exits 1 on a failed case, a target that matches nothing, or a broken init hook.
 */

const fs = require('fs');
const path = require('path');

const { parseArgv } = require('../argv.js');
const { createRunner } = require('./runner.js');

function flag(args, name) {
  return typeof args[name] === 'string' ? args[name] : undefined;
}

function packageName(dir) {
  const manifest = path.join(dir, 'package.json');
  return fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')).name : path.basename(dir);
}

/**
 * Run the suites under the cwd's test root once.
 * @param {string[]} argv - The arguments after the script.
 * @returns {Promise<number>} The exit code.
 */
async function main(argv) {
  const args = parseArgv(argv, { booleans: ['extended'] });
  const cwd = process.cwd();

  const runner = createRunner({
    framework: 'node',
    title: `${packageName(cwd)} tests`,
    projectRoot: cwd,
    roots: [{ source: 'project', dir: path.resolve(cwd, flag(args, 'root') || 'test') }],
    log: path.resolve(cwd, flag(args, 'log') || path.join('logs', 'test.log')),
  });

  const results = await runner.run({
    targets: args._.map(String),
    filter: flag(args, 'filter'),
    layer: flag(args, 'layer'),
    lane: flag(args, 'lane'),
    extended: args.extended === true,
    reporter: flag(args, 'reporter') || 'pretty',
  });

  return results.failed > 0 || results.noMatch ? 1 : 0;
}

let reported = false;

// The process ends itself once both streams flush, so a handle a suite left open cannot hold it.
function exit(code) {
  reported = true;
  process.exitCode = code;
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
}

// A case that ends the process (process.exit) before the report is written never passes.
function guardEarlyExit() {
  process.on('exit', () => {
    if (reported) return;
    fs.writeSync(2, 'The test run ended before its report was written.\n');
    process.exitCode = 1;
  });
}

if (require.main === module) {
  guardEarlyExit();
  main(process.argv.slice(2)).then(exit, (e) => {
    console.error(e && e.stack ? e.stack : e);
    exit(1);
  });
}

module.exports = { main };
