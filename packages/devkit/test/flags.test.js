/**
 * Two switches, two names, across all five CLIs' boolean flag tables:
 * `--dry-run` shows the plan on a verb that acts by default, `--execute` does
 * the work on a verb that reports by default. No other spelling of either
 * side is declared. The tables are the CLIs' real exports.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PACKAGES = path.join(__dirname, '..', '..');

const TABLES = {
  '@omega.js/manager': require(path.join(PACKAGES, 'manager', 'src', 'cli-run.js')).BOOLEAN_FLAGS,
  '@omega.js/web': require(path.join(PACKAGES, 'web', 'src', 'cli-run.js')).BOOLEAN_FLAGS,
  '@omega.js/backend': require(path.join(PACKAGES, 'backend', 'src', 'cli', 'flags.js')).BOOLEAN_FLAGS,
  '@omega.js/desktop': require(path.join(PACKAGES, 'desktop', 'src', 'cli-run.js')).BOOLEAN_FLAGS,
  '@omega.js/extension': require(path.join(PACKAGES, 'extension', 'src', 'cli-run.js')).BOOLEAN_FLAGS,
};

// The retired spellings of the two switches
const RETIRED = ['apply', 'write', 'check'];

test('flags: no CLI declares a retired switch spelling', () => {
  for (const [cli, flags] of Object.entries(TABLES)) {
    assert.ok(Array.isArray(flags) && flags.length > 0, `${cli} exports its BOOLEAN_FLAGS`);
    for (const flag of RETIRED) {
      assert.ok(!flags.includes(flag), `${cli} declares --${flag}: the switches are --dry-run and --execute only`);
    }
  }
});

test('flags: --execute is the manager\'s alone (migrate and the --migration lane report by default)', () => {
  const declaring = Object.keys(TABLES).filter((cli) => TABLES[cli].includes('execute'));
  assert.deepEqual(declaring, ['@omega.js/manager']);
});

test('flags: every CLI declares --dry-run (each owns a verb that acts by default and plans under it)', () => {
  // `update` is owned by all five, and each honors --dry-run for it
  for (const [cli, flags] of Object.entries(TABLES)) {
    assert.ok(flags.includes('dry-run'), `${cli} declares --dry-run`);
  }
});
