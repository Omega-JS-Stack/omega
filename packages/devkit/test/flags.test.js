/**
 * Two switches, two names, across all five CLIs' boolean flag tables:
 * `--dry-run` shows the plan on a verb that acts by default, `--execute` does
 * the work on a verb that reports by default. No other spelling of either
 * side is declared. The tables are the CLIs' real exports.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'flags',
  tests: [
    {
      name: 'flags: no CLI declares a retired switch spelling',
      run: (ctx) => {
        for (const [cli, flags] of Object.entries(TABLES)) {
          ctx.expect(Array.isArray(flags) && flags.length > 0, `${cli} exports its BOOLEAN_FLAGS`).toBeTruthy();
          for (const flag of RETIRED) {
            ctx.expect(!flags.includes(flag), `${cli} declares --${flag}: the switches are --dry-run and --execute only`).toBeTruthy();
          }
        }
      },
    },

    {
      name: 'flags: --execute is the manager\'s alone (migrate and the --migration lane report by default)',
      run: (ctx) => {
        const declaring = Object.keys(TABLES).filter((cli) => TABLES[cli].includes('execute'));
        ctx.expect(declaring).toEqual(['@omega.js/manager']);
      },
    },

    {
      name: 'flags: every CLI declares --dry-run (each owns a verb that acts by default and plans under it)',
      run: (ctx) => {
        // `update` is owned by all five, and each honors --dry-run for it
        for (const [cli, flags] of Object.entries(TABLES)) {
          ctx.expect(flags.includes('dry-run'), `${cli} declares --dry-run`).toBeTruthy();
        }
      },
    },
  ],
});
