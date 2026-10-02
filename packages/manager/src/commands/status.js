/**
 * `omega status [--json]`: what this folder is to OMEGA and the one command
 * that comes next, from anywhere: an empty folder, a template copy, a brand
 * root or a folder inside a target. Reads only (lib/brand-state.js); `--json`
 * prints the report as one JSON object and nothing else on stdout.
 */
const chalk = require('chalk').default;
const { brandState } = require('../lib/brand-state.js');

// A gap list's label in the printed report, in the order a fix takes them
const GAP_LABELS = [
  ['config', 'Config does not load'],
  ['targets', 'Declared targets with no folder'],
  ['files', 'Missing files'],
  ['install', 'Not installed'],
];

module.exports = async (options) => {
  const report = brandState(process.cwd());

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  console.log(`${chalk.bold('OMEGA status')}  ${chalk.cyan(report.state)}`);
  if (report.brandRoot) {
    console.log(`  Brand root  ${report.brandRoot}`);
  }
  if (report.brand) {
    console.log(`  Brand       ${report.brand.name} ${chalk.dim(`(${report.brand.id})`)}`);
  }
  if (report.inTarget) {
    console.log(`  You are in  targets/${report.inTarget}`);
  }
  if (report.targets.length > 0) {
    console.log(`  Targets     ${report.targets.map((entry) => `${entry.name} ${chalk.dim(`(${entry.type})`)}`).join(', ')}`);
  }

  for (const [key, label] of GAP_LABELS) {
    if (report.missing[key].length === 0) continue;
    console.log(`  ${chalk.yellow(label)}:`);
    for (const item of report.missing[key]) {
      console.log(`    ${chalk.dim('•')} ${item}`);
    }
  }

  // Names only, never a value: the keys going live needs, the optional keys on a line of their own
  if (report.missing.env.length > 0) {
    const optional = report.missing.env.filter((entry) => entry.optional);
    const required = report.missing.env.filter((entry) => !entry.optional);
    if (required.length > 0) {
      console.log(`  ${chalk.yellow('Env keys for going live')} ${chalk.dim('(npm run manage asks for them)')}:`);
    }
    for (const { key, service } of required) {
      console.log(`    ${chalk.dim('•')} ${key} ${chalk.dim(`(${service})`)}`);
    }
    if (optional.length > 0) {
      console.log(`    ${chalk.dim('optional, for later:')} ${optional.map(({ key, service }) => `${key} ${chalk.dim(`(${service})`)}`).join(', ')}`);
    }
  }

  console.log('');
  console.log(`${chalk.bold('Next:')} ${chalk.cyan(report.next)}`);
  console.log('');
};
