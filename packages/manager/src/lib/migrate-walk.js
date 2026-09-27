/**
 * The target half of the brand-root `omega migrate`: every selected target's
 * framework migration, run IN-PROCESS through the `./migrate` subpath each
 * framework exposes (`resolveTargetMigrate`), in the order the caller selected.
 * Every leg answers one shape, `{ due, changed, errors }`, so the walk and its
 * printout never special-case a framework.
 */
const chalk = require('chalk').default;

const { resolveTargetMigrate } = require('./framework-bin.js');

// Each kind of line a block prints: its key on the result, its label, its color
const KINDS = [
  ['due', 'due', chalk.yellow],
  ['changed', 'changed', chalk.green],
  ['errors', 'error', chalk.red],
];

/**
 * Run each selected target's migration.
 *
 * @param {Array<object>} selected - discoverTargets entries, in walk order.
 * @param {{ execute: boolean, brandRoot: string }} options - `execute` converts;
 *   otherwise report only. Each leg learns the brand root and its own folder name.
 * @returns {Array<{ heading: string, skip: string|null, due: string[], changed: string[], errors: string[] }>}
 */
function walkMigrations(selected, { execute, brandRoot }) {
  return selected.map((entry) => {
    const heading = `${entry.name} ${chalk.dim(`(${entry.dir})`)}`;
    const found = resolveTargetMigrate(entry);

    if (found.kind === 'skip') return { heading, skip: found.detail, due: [], changed: [], errors: [] };
    if (found.kind === 'error') return { heading, skip: null, due: [], changed: [], errors: [found.detail] };
    if (typeof found.migrateTarget !== 'function') {
      return { heading, skip: null, due: [], changed: [], errors: [`${found.framework} exposes a migrate entry without migrateTarget (update it)`] };
    }

    // A leg that throws (a malformed legacy file) fails its own target, never the walk
    try {
      const { due, changed, errors } = found.migrateTarget(entry.path, { execute, brandRoot, name: entry.name });
      return { heading, skip: null, due, changed, errors };
    } catch (e) {
      return { heading, skip: null, due: [], changed: [], errors: [`${found.framework} migrate failed: ${String(e.message).split('\n')[0]}`] };
    }
  });
}

/**
 * Print one block: its heading, then every line under its label, or the one
 * line that says there is nothing to do.
 *
 * @param {{ heading: string, skip?: string|null, due: string[], changed: string[], errors: string[] }} block
 * @param {string} clean - What an empty block says.
 */
function printBlock(block, clean) {
  console.log(`\n${chalk.bold(block.heading)}`);

  if (block.skip) {
    console.log(`  ${chalk.dim('skip'.padEnd(8))}${chalk.dim(block.skip)}`);
    return;
  }

  const lines = KINDS.flatMap(([key, label, paint]) => block[key].map((line) => `  ${paint(label.padEnd(8))}${line}`));
  if (lines.length === 0) {
    console.log(`  ${chalk.green('✓')} ${clean}`);
    return;
  }

  for (const line of lines) console.log(line);
}

module.exports = { walkMigrations, printBlock };
