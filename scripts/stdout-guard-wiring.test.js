/**
 * Test-script wiring pin: every package's `test` script, and the root
 * `test:packages` lane's `scripts/` command, runs the one case runner
 * (`packages/devkit/src/test/cli.js`) and never spells `node --test` itself.
 *
 * `node --test` reads each child file's results as v8 frames on that child's
 * STDOUT, and console bytes on the same fd desync node 24's parser and kill a
 * random file. The runner carries the stdout guard itself, so a script is
 * protected exactly when it runs the runner. The four frameworks are own
 * entries, listed by name: their `test` script runs the package's own CLI file
 * (its `omega test`), never devkit's cli.js, and spells no `--test`.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const jetpack = require('fs-jetpack');

const ROOT = path.join(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const CLI = path.join(PACKAGES_DIR, 'devkit', 'src', 'test', 'cli.js');

// The packages whose `test` script is their own CLI file's `omega test`.
const OWN_ENTRY = ['web', 'backend', 'desktop', 'extension'];

// The runner flag itself, not its `--test-timeout`/`--test-concurrency` kin.
const RUNS_NODE_TEST = /(^|\s)--test(\s|$)/;

/** Every package dir name with a manifest, from a flat listing (a tree walk can hit dist symlink loops). */
function packageNames() {
  return jetpack.list(PACKAGES_DIR)
    .filter((name) => jetpack.exists(path.join(PACKAGES_DIR, name)) === 'dir')
    .filter((name) => jetpack.exists(path.join(PACKAGES_DIR, name, 'package.json')) === 'file')
    .sort();
}

/** A package's manifest. */
function manifest(name) {
  return JSON.parse(jetpack.read(path.join(PACKAGES_DIR, name, 'package.json')));
}

/** A package's `test` script, or undefined. */
function testScript(name) {
  return manifest(name).scripts?.test;
}

/** Whether a package's command runs its own CLI file: a token that resolves, from its dir, to its `./cli` export. */
function runsOwnCli(name, command) {
  const dir = path.join(PACKAGES_DIR, name);
  const cli = manifest(name).exports?.['./cli'];
  return Boolean(cli) && command.split(/\s+/).some((token) => path.resolve(dir, token) === path.resolve(dir, cli));
}

/** Whether a command runs the devkit runner: a token that resolves, from `dir`, to its cli. */
function runsCli(dir, command) {
  return command.split(/\s+/).some((token) => path.resolve(dir, token) === CLI);
}

module.exports = defineCases({
  type: 'group',
  description: 'stdout-guard-wiring',
  tests: [
    {
      name: 'every package test script runs the devkit runner and spells no --test, apart from the listed own entries',
      run: (ctx) => {
        const offenders = [];
        for (const name of packageNames().filter((entry) => !OWN_ENTRY.includes(entry))) {
          const command = testScript(name);
          if (!command) offenders.push(`packages/${name}: no test script`);
          else if (!runsCli(path.join(PACKAGES_DIR, name), command) || RUNS_NODE_TEST.test(command)) offenders.push(`packages/${name}: ${command}`);
        }

        ctx.expect(offenders, `these test scripts do not run packages/devkit/src/test/cli.js alone:\n  ${offenders.join('\n  ')}`).toEqual([]);
      },
    },

    {
      name: 'every own entry\'s test script runs its own CLI file, never the devkit cli, and spells no --test',
      run: (ctx) => {
        const names = packageNames();
        const offenders = [];
        for (const name of OWN_ENTRY) {
          const command = names.includes(name) ? testScript(name) : undefined;
          if (!command) offenders.push(`packages/${name}: no package, or no test script`);
          else if (!runsOwnCli(name, command) || runsCli(path.join(PACKAGES_DIR, name), command) || RUNS_NODE_TEST.test(command)) offenders.push(`packages/${name}: ${command}`);
        }

        ctx.expect(offenders, `these own entries do not run their own CLI file alone:\n  ${offenders.join('\n  ')}`).toEqual([]);
      },
    },

    {
      name: 'the root test:packages lane runs scripts/ through the devkit runner and spells no --test',
      run: (ctx) => {
        const lane = JSON.parse(jetpack.read(path.join(ROOT, 'package.json'))).scripts['test:packages'];
        // `node scripts/lane.js <label> "<command>" ...`: the first quoted command is the scripts/ run
        const command = (lane.match(/"([^"]*)"/) || [])[1] || '';

        ctx.expect(runsCli(ROOT, command), `test:packages does not open on packages/devkit/src/test/cli.js: ${command}`).toBe(true);
        ctx.expect(command.split(/\s+/), `test:packages does not run --root=scripts: ${command}`).toContain('--root=scripts');
        ctx.expect(RUNS_NODE_TEST.test(command), `test:packages spells --test: ${command}`).toBe(false);
      },
    },
  ],
});
