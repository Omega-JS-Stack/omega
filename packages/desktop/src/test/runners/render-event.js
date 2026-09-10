// Harness-event rendering: the ONE home of "what a `__EM_TEST__` envelope looks like on
// screen" and of the counts it folds into.
//
// Both runners parse the same JSON-line protocol (runners/electron.js from the spawned
// harness, runners/boot.js from the booted consumer bundle), and the boot lane now carries
// the full renderer envelope too (suite-start / skip / suite-stopped), so the rendering
// lives here instead of once per runner.

const chalk = require('chalk').default;

/**
 * Render one harness event and fold it into the run's counts.
 * @param {object} evt - A parsed `__EM_TEST__` envelope from a harness.
 * @param {object} counts - `{ passed, failed, skipped }`, mutated in place.
 * @returns {void}
 */
function renderEvent(evt, counts) {
  if (evt.event === 'suite-start') {
    console.log(chalk.cyan(`    ⤷ ${evt.name}`));
  } else if (evt.event === 'result') {
    const indent = evt.suite ? '      ' : '    ';
    if (evt.passed) {
      console.log(chalk.green(`${indent}✓ ${evt.name}`) + chalk.gray(` (${evt.duration}ms)`));
      counts.passed += 1;
    } else {
      console.log(chalk.red(`${indent}✗ ${evt.name}`) + chalk.gray(` (${evt.duration}ms)`));
      if (evt.error) console.log(chalk.red(`${indent}  ${evt.error}`));
      counts.failed += 1;
    }
  } else if (evt.event === 'skip') {
    const indent = evt.name && evt.name.includes(' → ') ? '      ' : '    ';
    const count = evt.count || 1;
    console.log(chalk.yellow(`${indent}○ ${evt.name}`) + chalk.gray(` (skipped: ${evt.reason})`));
    counts.skipped += count;
  } else if (evt.event === 'suite-stopped') {
    console.log(chalk.yellow(`        Skipping ${evt.remaining} remaining test(s) in suite`));
  } else if (evt.event === 'cleanup-warn') {
    console.log(chalk.yellow(`        ⚠ Cleanup warning (${evt.name}): ${evt.message}`));
  } else if (evt.event === 'fatal') {
    console.log(chalk.red(`    ✗ Harness fatal: ${evt.message}`));
    if (evt.stack) console.log(chalk.gray(`      ${evt.stack.split('\n').slice(0, 3).join('\n      ')}`));
    counts.failed += 1;
  }
}

module.exports = { renderEvent };
