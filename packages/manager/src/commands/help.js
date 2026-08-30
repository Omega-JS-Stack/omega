/**
 * `omega help` — and what a bare `omega` prints (#229). The manager's own
 * help, not devkit's generated listing: a brand root is where a stranger
 * lands, so the three verbs that matter come first, in the order a brand
 * actually needs them, and every line says what the verb DOES.
 */
const chalk = require('chalk').default;

// verb → what it does. Order is the story: reconcile, run, publish, then the
// rest of the surface.
const VERBS = [
  ['omega manage', 'reconcile every service to config/omega.json5 — safe to rerun (`npm run manage`)'],
  ['omega dev', 'boot the local stack: website + backend emulator (`npm start`)'],
  ['omega deploy', 'publish each target, backend first — deliberate, never automatic (`npm run deploy`)'],
  ['omega onboard', 'create a NEW brand monorepo from scratch (the wizard)'],
  ['omega company', 'the company workspace: `init` scaffolds one, `adopt <brand>` stamps a brand into it'],
  ['omega test', "run every target's test suites"],
  ['omega update', 'dependency-freshness fan-out over the targets'],
  ['omega migrate', 'delete retired keys from config/omega.json5 (comments preserved)'],
  ['omega pipeline', 'the live full-cycle test: manage → deploy → verify'],
  ['omega devlog', "the manager's own development log"],
  ['omega version', 'print the installed version'],
];

module.exports = async () => {
  const pad = Math.max(...VERBS.map(([verb]) => verb.length));

  console.log('');
  console.log(chalk.bold('OMEGA — brand orchestration'));
  console.log(chalk.dim('Usage: omega <command> [options]   (`omg` and `mgr` are the same bin)'));
  console.log('');
  for (const [verb, what] of VERBS) {
    console.log(`  ${chalk.cyan(verb.padEnd(pad))}  ${what}`);
  }
  console.log('');
  console.log(chalk.dim('  Common options: --service=<name>, --dry-run, --continue-on-error, --strict'));
  console.log('');
  console.log(chalk.bold('New here?'));
  console.log(`  ${chalk.dim('1.')} ${chalk.cyan('npx omega onboard')}  ${chalk.dim('— scaffold a brand (skip if you already have one)')}`);
  console.log(`  ${chalk.dim('2.')} ${chalk.cyan('npm install')}        ${chalk.dim('— every target gets its framework; the verbs scaffold on first run')}`);
  console.log(`  ${chalk.dim('3.')} ${chalk.cyan('npm run manage')}     ${chalk.dim('— reconcile everything; it says what it still needs')}`);
  console.log(`  ${chalk.dim('4.')} ${chalk.cyan('npm start')}          ${chalk.dim('— boot the local stack and build')}`);
  console.log('');
};

module.exports.VERBS = VERBS;
