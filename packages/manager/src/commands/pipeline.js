/**
 * `omega-manager pipeline` — the brand's full-pipeline LIVE test (Ian:
 * "automate running the manager CLI as the test — the playground exists
 * to shit-test the full pipeline").
 *
 * Spawns the REAL manage cycle with stdin detached, so no prompt can ever
 * fire (isInteractive() reads stdin's TTY) — every answer must already be
 * seeded in its non-interactive home: omega.json5 (choices), the brand
 * .env (secrets), the Google token cache (scopes), state (latches). Then
 * asserts the machine-readable run record (.omega/runs/{ts}.json):
 *
 *  - Any service at status "error" fails the pipeline.
 *  - CORE services (workspace, github, cloudflare, domain, firebase,
 *    testing) must RUN green (success/warned) — a core skip means a
 *    broken seed (missing token, unconfigured section) and fails.
 *  - Everything else may succeed, warn, or skip; skips are listed with
 *    reasons for visibility, not failure.
 *  - `--require=a,b` promotes more services into the core set (tighten as
 *    seeds land: --require=sendgrid,account,recaptcha).
 *  - `--service=<name>` narrows the child run to one service; the
 *    core-presence check only applies to full runs.
 *  - `--dry-run` forwards to the child (plan-only pass, still asserted).
 *  - `--deploy=web,backend` runs the DEPLOY legs after the service cycle
 *    (web = `omega deploy --direct` gh-pages push; backend = the target's
 *    own `omega deploy` — a REAL functions deploy). Off by default; each
 *    leg lands in the scorecard as `deploy:<target>` and an exit-nonzero
 *    leg fails the pipeline.
 *
 * This spends real API calls and reconciles real infrastructure — run it
 * on demand, SPARINGLY. It is deliberately NOT part of `npm test` or CI.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const chalk = require('chalk').default;

const { resolveBrandRoot, discoverApps } = require('../lib/brand.js');

// deploy target → the command run in that target's app dir
const DEPLOY_LEGS = {
  web: ['npm', 'run', 'deploy', '--', '--direct'],
  backend: ['npm', 'run', 'deploy'],
};

// Services that must RUN green on a full pipeline pass — these are the
// provisioning spine; a skip here means a seed is missing, not a choice.
const CORE_SERVICES = ['workspace', 'github', 'cloudflare', 'domain', 'firebase', 'testing'];

const STATUS_ICONS = { success: chalk.green('✓'), warned: chalk.yellow('⚠'), skipped: chalk.dim('⊘'), error: chalk.red('✗') };

/**
 * Judge one run record against the pipeline policy.
 *
 * @param {object} runRecord - Parsed .omega/runs/{ts}.json ({ services: [{ service, status, reason?, error? }] }).
 * @param {object} [options] - { require: string[] (extra core services), scoped: boolean (single-service child run) }.
 * @returns {{ pass: boolean, failures: string[], skips: string[], rows: object[] }}
 */
function evaluatePipeline(runRecord, options = {}) {
  const services = runRecord?.services || [];
  const core = new Set([...CORE_SERVICES, ...(options.require || [])]);
  const failures = [];
  const skips = [];
  const rows = [];

  const byName = new Map(services.map((entry) => [entry.service, entry]));

  for (const entry of services) {
    rows.push(entry);

    if (entry.status === 'error') {
      failures.push(`${entry.service}: error${entry.error ? ` — ${entry.error}` : ''}`);
    } else if (entry.status === 'skipped') {
      if (core.has(entry.service)) {
        failures.push(`${entry.service}: CORE service skipped${entry.reason ? ` — ${entry.reason}` : ''} (seed missing)`);
      } else {
        skips.push(`${entry.service}${entry.reason ? ` — ${entry.reason}` : ''}`);
      }
    }
  }

  // Full runs must actually contain every core service
  if (!options.scoped) {
    for (const name of core) {
      if (!byName.has(name)) {
        failures.push(`${name}: CORE service missing from the run record`);
      }
    }
  }

  return { pass: failures.length === 0, failures, skips, rows };
}

/**
 * Newest run record written at/after `since` for the brand.
 *
 * @param {string} brandRoot - Brand root directory.
 * @param {number} since - ms timestamp; records older than this are ignored.
 * @returns {{ file: string, record: object }|null}
 */
function findRunRecord(brandRoot, since) {
  const runsDir = path.join(brandRoot, '.omega', 'runs');
  if (!fs.existsSync(runsDir)) {
    return null;
  }

  const candidates = fs.readdirSync(runsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(runsDir, name)).mtimeMs }))
    .filter((entry) => entry.mtime >= since)
    .sort((a, b) => b.mtime - a.mtime);

  if (candidates.length === 0) {
    return null;
  }

  const file = path.join(runsDir, candidates[0].name);
  return { file, record: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

module.exports = async (argv = {}) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand (no config/omega.json5 found walking up)'));
    process.exitCode = 1;
    return;
  }

  const requireExtra = String(argv.require || '').split(',').map((s) => s.trim()).filter(Boolean);
  const childArgs = ['--continue-on-error'];
  if (argv.service) {
    childArgs.push(`--service=${argv.service}`);
  }
  if (argv.dryRun || argv['dry-run']) {
    childArgs.push('--dry-run');
  }

  console.log(chalk.bold('\n🧪 Pipeline — live full-cycle test (non-interactive by construction)\n'));
  console.log(`  Brand:   ${chalk.cyan(brandRoot)}`);
  console.log(`  Child:   omega-manager ${childArgs.join(' ')}`);
  console.log(`  Core:    ${[...CORE_SERVICES, ...requireExtra].join(', ')}\n`);

  const started = Date.now();
  const bin = path.join(__dirname, '..', '..', 'bin', 'omega-manager');

  // Non-interactive by construction: stdin detached AND the explicit env
  // switch (google-auth counts stdout-TTY as a watching human — the env
  // beats it, so consent flows fail fast instead of opening browsers).
  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...childArgs], {
      cwd: brandRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, OMEGA_NON_INTERACTIVE: '1' },
    });
    child.on('close', (code) => resolve(code ?? 1));
  });

  const found = findRunRecord(brandRoot, started);
  if (!found) {
    console.error(chalk.red(`\n✗ PIPELINE FAIL — no run record appeared in .omega/runs/ (child exit ${exitCode})`));
    process.exitCode = 1;
    return;
  }

  // Deploy legs — spawned in the owning app's dir, same non-interactive
  // construction; results join the record as deploy:<target> rows so the
  // evaluator's any-error rule covers them
  const deployTargets = String(argv.deploy || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const target of deployTargets) {
    const leg = DEPLOY_LEGS[target];
    const app = discoverApps(brandRoot).find((a) => a.target === target);

    if (!leg || !app) {
      found.record.services.push({
        service: `deploy:${target}`,
        status: 'error',
        output: null,
        error: leg ? `no ${target} app in this brand` : `unknown deploy target (${Object.keys(DEPLOY_LEGS).join(', ')})`,
      });
      continue;
    }

    console.log(chalk.bold(`\n🧪 Deploy leg: ${target} ${chalk.dim(`(${leg.join(' ')} in ${app.dir})`)}`));
    const legExit = await new Promise((resolve) => {
      const child = spawn(leg[0], leg.slice(1), {
        cwd: app.path,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, OMEGA_NON_INTERACTIVE: '1' },
      });
      child.on('close', (code) => resolve(code ?? 1));
    });

    found.record.services.push({
      service: `deploy:${target}`,
      status: legExit === 0 ? 'success' : 'error',
      output: null,
      error: legExit === 0 ? null : `exit ${legExit}`,
    });
  }

  const verdict = evaluatePipeline(found.record, { require: requireExtra, scoped: Boolean(argv.service) });

  console.log(chalk.bold('\n🧪 Pipeline scorecard'));
  console.log(`  ${chalk.dim(`record: ${path.basename(found.file)}`)}`);
  for (const row of verdict.rows) {
    const icon = STATUS_ICONS[row.status] || chalk.dim('·');
    console.log(`  ${icon} ${row.service}${row.status === 'skipped' && row.reason ? chalk.dim(` — ${row.reason}`) : ''}`);
  }

  if (verdict.skips.length > 0) {
    console.log(`\n  ${chalk.dim(`⊘ acceptable skips: ${verdict.skips.length} (listed above)`)}`);
  }

  if (verdict.pass) {
    console.log(chalk.green.bold('\n✅ PIPELINE PASS\n'));
    return;
  }

  console.log(chalk.red.bold('\n❌ PIPELINE FAIL'));
  for (const failure of verdict.failures) {
    console.log(`  ${chalk.red('✗')} ${failure}`);
  }
  console.log('');
  process.exitCode = 1;
};

module.exports.evaluatePipeline = evaluatePipeline;
module.exports.findRunRecord = findRunRecord;
module.exports.CORE_SERVICES = CORE_SERVICES;
