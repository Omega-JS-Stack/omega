/**
 * Ensure a translating web app declares the Claude translation SDK (#168).
 *
 * `@omega.js/web` is the only framework that leaves `@anthropic-ai/claude-agent-sdk`
 * to the consumer (#37: translation is opt-in and the SDK is heavy, so web
 * declares it as an OPTIONAL PEER; backend and extension declare it as a real
 * dependency). Every brand ends up translating (Ian 2026-08-03), so the manage
 * cycle owns that install instead of a human typing it per brand: a web app
 * whose resolved config turns translation on with the `claude` provider gets
 * the dep written into its package.json and installed.
 *
 * Converge-to-config, same as every other workspace op: declared already =
 * zero-mutation no-op (a consumer-chosen spec is never overwritten), dry run
 * plans without writing, translation off or provider `chatgpt` = untouched.
 * Disabling translation never REMOVES the dep (#168: uninstalling on a config
 * flip is riskier than leaving it), and devkit's loud missing-SDK error stays
 * the backstop for hand-managed brands.
 */
const path = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { loadConfig } = require('@omega.js/config');
const { resolveTranslationSettings } = require('@omega.js/devkit/translate');
const { runCommand } = require('../../../lib/run-command.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

const SDK = '@anthropic-ai/claude-agent-sdk';

// Bootstrap range for a brand whose @omega.js/web isn't installed yet (a fresh
// clone's first manage). The authoritative copy is web's own optional peer
// (packages/web/package.json `peerDependencies`), read off the INSTALLED web
// package whenever it resolves, so the range always matches that version.
const FALLBACK_RANGE = '>=0.2';

/**
 * The SDK range `@omega.js/web` declares as its optional peer, read from the
 * app's installed copy via the node_modules climb (a manual walk, not
 * require.resolve, because web's exports map doesn't expose its package.json).
 *
 * @param {string} appPath - Absolute app root
 * @returns {string} The declared peer range, or FALLBACK_RANGE when web isn't installed
 */
function sdkRange(appPath) {
  let dir = path.resolve(appPath);

  while (true) {
    const pkg = jetpack.read(path.join(dir, 'node_modules', '@omega.js', 'web', 'package.json'), 'json');
    const range = pkg?.peerDependencies?.[SDK];
    if (range) return range;

    const parent = path.dirname(dir);
    if (parent === dir) return FALLBACK_RANGE;
    dir = parent;
  }
}

/**
 * Does this app's resolved config ask for the claude translation provider?
 * devkit's resolver is the SSOT for the section's defaults (absent `enabled`
 * is on, absent `provider` is claude, no languages is off).
 *
 * @param {object} app - Discovered app ({ path, target, ... })
 * @returns {boolean}
 */
function wantsClaudeTranslation(app) {
  const { config } = loadConfig(app.path, app.target);
  const settings = resolveTranslationSettings(config);

  return settings.enabled && settings.provider === 'claude';
}

module.exports = async ({ brandRoot, apps, options = {}, runCommand: run = runCommand }) => {
  const drifted = [];
  const findings = [];

  for (const app of apps.filter((a) => a.target === 'web')) {
    let wanted;
    try {
      wanted = wantsClaudeTranslation(app);
    } catch (error) {
      // An unreadable translation section (an unknown language code, say) is an
      // APP-level finding, so it warns and leaves that app alone rather than
      // halting the whole manage walk (the sibling convention stated in
      // ensure/config.js). The web app's own translate run is the hard gate.
      const finding = `${app.name}: ${error.message}`;
      console.log(`      ${chalk.yellow('⚠')} ${finding}`);
      findings.push(finding);
      continue;
    }

    if (!wanted) continue;

    const pkgPath = path.join(app.path, 'package.json');
    const pkg = jetpack.read(pkgPath, 'json');
    if (!pkg) {
      console.log(`      ${chalk.dim(`⊘ ${app.name}: no package.json yet`)}`);
      continue;
    }

    if (pkg.dependencies?.[SDK] || pkg.devDependencies?.[SDK]) continue;

    drifted.push({ app, pkgPath, pkg, range: sdkRange(app.path) });
  }

  // Any finding warns the operation, whatever the drift work on the readable
  // apps returned
  const withFindings = (result) => (findings.length === 0
    ? result
    : { ...result, status: 'warned', output: { ...result?.output, findings } });

  if (drifted.length === 0) {
    if (findings.length === 0) console.log(`      ${chalk.green('✓')} Translation SDK converged`);
    return withFindings(null);
  }

  const summary = drifted.map(({ app, range }) => `${app.name}: ${SDK}@${range}`).join(', ');

  if (options.dryRun) {
    return withFindings(dryRunPlan(
      `add the translation SDK (${summary}) and run npm install`,
      { output: { translationSdk: 'planned' } },
    ));
  }

  for (const { app, pkgPath, pkg, range } of drifted) {
    pkg.dependencies = { ...pkg.dependencies, [SDK]: range };
    jetpack.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`      ${chalk.green('✓')} ${app.name}: added ${SDK}@${range} (translation.provider claude)`);
  }

  // One install at the brand root, since npm workspaces cover every app (the
  // same shape the update service's install phase uses)
  console.log(`      ${chalk.dim('→')} npm install ${chalk.dim(`(${SDK})`)}`);
  const result = await run('npm', ['install', '--no-audit', '--no-fund'], brandRoot);

  const added = drifted.map(({ app }) => app.name);

  if (!result.success) {
    console.log(`      ${chalk.yellow('⚠')} npm install failed (${result.error}); the dep is declared, so install it by hand`);
    return withFindings({ status: 'warned', output: { translationSdk: { added, installed: false, error: result.error } } });
  }

  return withFindings({ output: { translationSdk: { added, installed: true } } });
};

// Exported for the drift-pin test: the bootstrap range must track web's peer
module.exports.FALLBACK_RANGE = FALLBACK_RANGE;
