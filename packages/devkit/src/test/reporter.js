/**
 * The runner's two reporters. `pretty` prints the run as it goes: a heading
 * per suite, one line per case (✓ pass, ✗ fail, ○ skip), a failure's message
 * and stack under its line, then ONE Results block. `json` prints nothing but
 * the object `run()` resolves to, as one document on stdout; its notes go to
 * stderr.
 */

const chalk = require('chalk').default;

const REPORTERS = ['pretty', 'json'];

function stackLines(error) {
  if (!error.stack) return [];
  const lines = String(error.stack).split('\n');
  // A V8 stack opens with `<name>: <message>`, which the line above it already printed.
  const body = lines[0].includes(error.message) ? lines.slice(1) : lines;
  return body.map((line) => line.trim()).filter(Boolean);
}

function createPretty({ title }) {
  const out = (line) => console.log(line);

  return {
    start() {
      out('');
      out(chalk.bold(`  ${title}`));
      out('');
    },
    note(line) {
      out(chalk.yellow(`  ${line}`));
    },
    suite(label) {
      out(chalk.cyan(`    ⤷ ${label}`));
    },
    result(test) {
      const indent = test.suite ? '      ' : '    ';
      if (test.status === 'pass') {
        out(`${chalk.green(`${indent}✓ ${test.name}`)}${chalk.gray(` (${test.durationMs}ms)`)}`);
        return;
      }
      if (test.status === 'skip') {
        const why = test.reason ? `: ${test.reason}` : '';
        out(`${chalk.yellow(`${indent}○ ${test.name}`)}${chalk.gray(` (skipped${why})`)}`);
        return;
      }
      out(`${chalk.red(`${indent}✗ ${test.name}`)}${chalk.gray(` (${test.durationMs}ms)`)}`);
      out(chalk.red(`${indent}  ${test.error.message}`));
      for (const line of stackLines(test.error)) out(chalk.gray(`${indent}    ${line}`));
    },
    finish(results) {
      const total = results.passed + results.failed + results.skipped;
      out('');
      out(`  ${chalk.bold('Results')}`);
      out(`    ${chalk.green(`${results.passed} passing`)}`);
      if (results.failed > 0) out(`    ${chalk.red(`${results.failed} failing`)}`);
      if (results.skipped > 0) out(`    ${chalk.yellow(`${results.skipped} skipped`)}`);
      out(chalk.gray(`\n    Total: ${total} tests in ${results.durationMs}ms\n`));
    },
  };
}

function createJson() {
  return {
    start() {},
    note(line) {
      process.stderr.write(`${line}\n`);
    },
    suite() {},
    result() {},
    finish(results) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    },
  };
}

/**
 * Build a reporter by name.
 * @param {string} kind - `pretty` or `json`.
 * @param {{title: string}} options - The run's heading.
 * @returns {{start: Function, note: Function, suite: Function, result: Function, finish: Function}} The reporter.
 */
function createReporter(kind, { title }) {
  if (kind === 'pretty') return createPretty({ title });
  if (kind === 'json') return createJson();
  throw new Error(`Unknown reporter "${kind}" (known: ${REPORTERS.join(', ')})`);
}

module.exports = { createReporter, REPORTERS };
