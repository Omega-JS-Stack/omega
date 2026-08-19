/**
 * stdout-guard wiring pin — every node test-runner suite in this repo preloads
 * the guard ([#356](https://github.com/Omega-JS-Stack/omega/issues/356)).
 *
 * `node --test` spawns one child per file and reads its results as v8 frames on
 * that child's STDOUT; console bytes on the same fd desync node 24's parser and
 * kill a random file ([#321](https://github.com/Omega-JS-Stack/omega/issues/321)).
 * `@omega.js/devkit/test/stdout-guard` reroutes the console side to stderr, and
 * the runner forwards a `--require` to every child — so a suite is protected
 * exactly when its command carries the preload. A new `node --test` script
 * without it is a latent abort, which is what this scan catches.
 *
 * Retires with the guard: when the repo's pinned node reaches >=26.7.0 (the
 * unsigned-length fix), the guard and this pin both go.
 *
 * Run: node --test scripts/stdout-guard-wiring.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const jetpack = require('fs-jetpack');

const ROOT = path.join(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

const REQUIRE = '--require @omega.js/devkit/test/stdout-guard';

// The runner flag itself, not its `--test-timeout`/`--test-concurrency` kin
// (those only ever ride along with the real flag).
const RUNS_NODE_TEST = /(^|\s)--test(\s|$)/;

/** Every script in a manifest that invokes the node test runner directly. */
function runnerScripts(manifestPath) {
  const manifest = JSON.parse(jetpack.read(manifestPath));
  return Object.entries(manifest.scripts || {})
    .filter(([, command]) => RUNS_NODE_TEST.test(command));
}

test('stdout-guard wiring: every packages/* script that runs `node --test` preloads the guard', () => {
  const unguarded = [];

  // A flat listing, never a tree walk: generated dist fixtures under a package
  // can carry self-referencing node_modules symlinks that recurse a walker.
  for (const name of jetpack.list(PACKAGES_DIR)) {
    if (jetpack.exists(path.join(PACKAGES_DIR, name)) !== 'dir') continue;
    const manifestPath = path.join(PACKAGES_DIR, name, 'package.json');
    if (!jetpack.exists(manifestPath)) continue;

    for (const [script, command] of runnerScripts(manifestPath)) {
      // A script can run the runner more than once (web runs its watch suite in
      // a second pass); each invocation needs its own preload.
      const invocations = command.split('&&').filter((part) => RUNS_NODE_TEST.test(part));
      for (const invocation of invocations) {
        if (!invocation.includes(REQUIRE)) {
          unguarded.push(`packages/${name} → ${script}: ${invocation.trim()}`);
        }
      }
    }
  }

  assert.deepEqual(unguarded, [], `these suites run the node test runner without \`${REQUIRE}\`:\n  ${unguarded.join('\n  ')}`);
});

test('stdout-guard wiring: the root scripts lane preloads the guard', () => {
  for (const [script, command] of runnerScripts(path.join(ROOT, 'package.json'))) {
    assert.ok(command.includes(REQUIRE), `root script \`${script}\` runs the node test runner without \`${REQUIRE}\`: ${command}`);
  }
});

test('stdout-guard wiring: devkit\'s own runner preloads the guard', () => {
  // Devkit's test script is a runner script (scripts/run-tests.js), so the scan
  // above cannot see its `node --test` pass — it reaches the guard by path.
  const runner = jetpack.read(path.join(PACKAGES_DIR, 'devkit', 'scripts', 'run-tests.js'));

  assert.match(runner, /'--require', STDOUT_GUARD, '--test'/, 'packages/devkit/scripts/run-tests.js must preload the stdout guard on its `node --test` pass');
});
