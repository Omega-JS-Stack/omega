/**
 * `omega help` — and what a bare `omega` prints (#229). The manager's own
 * help, not devkit's generated listing: a brand root is where a stranger
 * lands, so the three verbs that matter come first, in the order a brand
 * actually needs them, and every line says what the verb DOES.
 */
const chalk = require('chalk').default;
const { TEMPLATE_URL } = require('../lib/template-marker.js');

// verb → what it does. Order is the story: reconcile, run, publish, then the
// rest of the surface.
const VERBS = [
  ['omega manage', 'reconcile every service to config/omega.json5 — safe to rerun (`npm run manage`)'],
  ['omega dev', 'boot the local stack: website + backend emulator (`npm start`)'],
  ['omega deploy', 'publish each target, backend first — deliberate, never automatic (`npm run deploy`)'],
  ['omega onboard', 'create a NEW brand monorepo from scratch (the wizard)'],
  ['omega status', 'what this folder is, what it lacks, and the next command; writes nothing (`--json`)'],
  ['omega company', '`init` creates the shared company/ tree in the company brand (company: { id: "self" })'],
  ['omega test', "run every target's test suites"],
  ['omega build', 'build every target, backend first'],
  ['omega clean', "wipe every target's build output"],
  ['omega update', 'dependency-freshness fan-out over the targets'],
  ['omega bump', "the brand's one version: `patch|minor|major` moves the root and every target"],
  ['omega install', '`i local` links every @omega.js dep to the local monorepo, `i live` restores the registry, brand-wide'],
  ['omega migrate', 'report what converts a legacy brand: the config, then every target (`--execute` converts)'],
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
  console.log(`  ${chalk.dim('1.')} ${chalk.cyan('Use this template')}  ${chalk.dim(`on ${TEMPLATE_URL}: it makes your own repo`)}`);
  console.log(`  ${chalk.dim('2.')} ${chalk.cyan('git clone')}          ${chalk.dim('your new repo, then cd into it')}`);
  console.log(`  ${chalk.dim('3.')} ${chalk.cyan('npm start')}          ${chalk.dim('installs, asks a few questions (Enter takes every default), boots your site')}`);
  console.log(`  ${chalk.dim('Not from the template?')} ${chalk.cyan('npx omega onboard')} ${chalk.dim('writes a brand into the current folder')}`);
  console.log('');
};

module.exports.VERBS = VERBS;
