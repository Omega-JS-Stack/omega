/**
 * Per-target health checks, grouped by app — omega-manager's target-checks
 * for brand monorepos. Local checks always run; live checks (homepage, API
 * health, npm latest, GitHub Actions) are skipped in dry-run with a "would"
 * line, so a dry run never touches the network.
 *
 * Checks by app target:
 *   web      → package.json, dist/index.html, installed framework vs npm
 *              latest, homepage fetch
 *   backend  → package.json, firebase.json, staged dist/ (build output),
 *              installed framework vs npm latest, API health + deployed
 *              version (skipped for shared Firebase projects)
 *   (all)    → package.json, framework version when declared
 *
 * Repo-level (once): working tree clean, latest GitHub Actions run (only
 * with repo.providers.github.org configured).
 *
 * The output shape matches omega-manager's testing service so RunSummary's
 * drill-down works unchanged. Data problems roll up honestly: any failed
 * check → error, any warning → warned.
 *
 * omega-manager deltas: build.json check stays behind (a UJM artifact —
 * @omega.js/web has no build manifest); the stash check stays behind (nothing
 * stashes in the new update service); GitHub Actions is repo-level (one repo
 * per brand, not one per target).
 */
const chalk = require('chalk').default;

const {
  createRecorder,
  defaultExec,
  checkAppFiles,
  checkFrameworkVersion,
  checkWorkingTree,
  checkHomepage,
  checkApiHealth,
  checkGitHubActions,
} = require('../lib/checks.js');

module.exports = async (context) => {
  const { brandId, brandRoot, brandConfig, apps, options } = context;

  // Tests inject fetch/exec/retryDelayMs via options (they ride runManage
  // options so full-loop tests stay network-free); production uses the reals
  const ctx = {
    brandId,
    brandRoot,
    brandConfig,
    dryRun: options?.dryRun || false,
    fetchImpl: options?.fetch || globalThis.fetch,
    exec: options?.exec || defaultExec,
    retryDelayMs: options?.retryDelayMs ?? 1000,
    versionCache: {},
  };

  const recorder = createRecorder();

  for (const app of apps.filter((a) => a.target)) {
    console.log(`      ${chalk.cyan('┌')} ${chalk.cyan.bold(app.name)} ${chalk.dim(`→ ${app.target}`)}`);

    checkAppFiles(recorder, app);
    checkFrameworkVersion(recorder, app, ctx);

    if (app.target === 'web') {
      await checkHomepage(recorder, app, ctx);
    }

    if (app.target === 'backend') {
      await checkApiHealth(recorder, app, ctx);
    }

    console.log(`      ${chalk.cyan('└')}`);
  }

  console.log(`      ${chalk.cyan('┌')} ${chalk.cyan.bold('repo')}`);
  checkWorkingTree(recorder, ctx);
  checkGitHubActions(recorder, ctx);
  console.log(`      ${chalk.cyan('└')}`);

  const { passed, warned, failed } = recorder.results();
  const status = failed.length > 0 ? 'error' : warned.length > 0 ? 'warned' : 'success';

  return {
    status,
    ...(failed.length > 0 ? { error: failed.map((f) => f.name).join(', ') } : {}),
    output: {
      results: { passed, warned, failed },
      counts: recorder.counts(),
    },
  };
};
