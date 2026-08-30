/**
 * The manage orchestrator — omega-manager's src/manage/index.js reborn for
 * brand monorepos. Resolves the brand root from the cwd, loads the brand
 * (omega.json5 + enabled targets + target dirs), then walks SERVICE_ORDER running
 * each service's operations idempotently. Every provisioned fact a service
 * resolves lands in config/omega.json5 (secrets in .env) as it goes;
 * transient output lands in .omega/runs/{timestamp}.json; the summary
 * prints last.
 *
 * Company mode (many brands from one workspace — Ian's omega-manager case)
 * layers on top of this later: runManage() is already per-brand, so the
 * company runner is a loop + the parallel logger, both ported when that
 * mode lands.
 */

const { join } = require('node:path');
const chalk = require('chalk').default;
const { loadEnvChain } = require('@omega.js/config');

const { SERVICE_ORDER, BOOT_SERVICES, OPERATIONS } = require('./config.js');
const { resolveBrandRoot, loadBrand } = require('./lib/brand.js');
const { readCompanyMarker, loadCompanyConfig } = require('./lib/company.js');
const { writeRunOutput } = require('./lib/run-output.js');
const { formatDuration } = require('./lib/duration.js');
const { runPreflight } = require('./lib/preflight.js');
const ensureTargetsRename = require('./services/migrations/ensure/targets-rename.js');
const { CONSENT_REQUIRED } = require('./lib/google-auth.js');
const { RunSummary } = require('./lib/run-summary.js');

// Timestamp for this process run — used in .omega/runs/{RUN_TIMESTAMP}.json
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Run a single service for the brand.
 *
 * @param {string} serviceName - Service to run
 * @param {Object} brand - Loaded brand (from loadBrand)
 * @param {Object} options - Run options
 * @returns {Object} - { status, error?, state?, output? }
 */
async function runService(serviceName, brand, options = {}) {
  const operations = OPERATIONS[serviceName] || [];

  if (operations.length === 0) {
    return { status: 'skipped', reason: 'no operations' };
  }

  try {
    const serviceModule = require(`./services/${serviceName}/index.js`);

    if (!serviceModule.run) {
      console.log(`  Service ${serviceName} has no run() export`);
      return { status: 'skipped', reason: 'no run export' };
    }

    // No cross-run seed: a service reads what it needs from brandConfig (the
    // one home for provisioned facts) or re-derives it from the platform, and
    // a setup() may still seed serviceData for its own operations (#434)
    return await serviceModule.run({
      brandId: brand.id,
      brandRoot: brand.root,
      // Company workspace root when the brand carries a valid company marker
      // — company-shared resources (Apple signing material) live there
      companyRoot: brand.companyRoot || null,
      // The company config layer (already merged into brandConfig) for
      // provenance checks — null for standalone brands
      companyConfig: brand.companyConfig || null,
      brandConfig: brand.config,
      brand,
      targets: brand.targets,
      operations,
      options,
    });
  } catch (error) {
    // A consent gate thrown at setup time is a pending HUMAN step, not a
    // failure (#228) — warned keeps the walk going and lands the item in the
    // summary's ⚑ list instead of stopping the cycle (and any dev boot on it)
    if (error?.code === CONSENT_REQUIRED) {
      console.log(`  ${chalk.yellow('⚑')} ${serviceName}: ${error.message}`);
      return {
        status: 'warned',
        warned: [{ operation: 'auth', reason: 'needs an interactive run' }],
        output: { auth: { needsInteractive: error.message } },
      };
    }

    console.error(`  Error in ${serviceName}: ${error.message}`);
    return { status: 'error', error: error.message };
  }
}

/**
 * Run all services (in order) against the brand monorepo containing startDir.
 *
 * @param {string} startDir - Any directory inside the brand monorepo
 * @param {Object} options - { service?, lane? ('boot' = the local slice a dev
 *   boot needs; omitted = every service), continueOnError?, dryRun?, verbose?,
 *   strict? (preflight failures fail hard instead of skipping),
 *   migration? (true = all, string = one), execute? (the migrations write
 *   gate — without it the run only audits), limit?, ids? (migrations service),
 *   resetAssets? (true = both kinds, string = 'logos'/'templates'; assets
 *   service), force? (ignore the update service's incremental cache and
 *   rebuild every target) }
 * @returns {{ hasErrors: boolean, results: Object, brand: Object }}
 */
async function runManage(startDir, options = {}) {
  const brandRoot = resolveBrandRoot(startDir);

  if (!brandRoot) {
    throw new Error(
      `No brand monorepo found at or above ${startDir} — `
      + `expected a config/omega.json5 at the brand root (see docs/shared/config.md).`,
    );
  }

  // One vocabulary (#443): the apps/ → targets/ rename is a ONE-TIME
  // migration, never healing inside a run. The brand it fixes cannot be
  // walked — discovery fails loud on the old shape and every service below
  // reads targets/ — so this ONE migration runs ALONE, ahead of the load that
  // would throw on it, and stops there. It is registered like every other
  // migration too (config.js OPERATIONS.migrations), so a bare `--migration`
  // walk re-checks it on a converged brand.
  if (options.migration === ensureTargetsRename.MIGRATION_NAME) {
    console.log('');
    console.log(chalk.bold.cyan(`🚀 Omega Manager ${chalk.dim(`— migration: ${ensureTargetsRename.MIGRATION_NAME}`)}`));
    console.log(`  ${chalk.dim('Root:')}     ${brandRoot}`);

    const result = await ensureTargetsRename({ brandRoot, options });

    return { hasErrors: false, results: { migrations: result }, brand: null };
  }

  // Company layer: a company-managed brand carries a .omega/company.json
  // stamp (written idempotently by company runs) pointing at its company
  // root — its config becomes the layer between manager DEFAULTS and the
  // brand file, and its .env fills the gaps under the brand .env.
  const marker = readCompanyMarker(brandRoot);
  let companyConfig = null;

  if (marker?.stale) {
    console.log(chalk.yellow(`⚠ .omega/company.json points at ${marker.companyRoot}, which is no longer a company workspace — running standalone (delete the file to silence this)`));
  } else if (marker) {
    companyConfig = loadCompanyConfig(marker.companyRoot);
  }

  // Secrets chain: shell env > brand .env > company .env — the shared
  // cascade (files load strongest-first, never overriding what's set)
  loadEnvChain([
    join(brandRoot, '.env'),
    companyConfig ? join(marker.companyRoot, '.env') : null,
  ]);

  // The company layer itself is folded by @omega.js/config off the same stamp
  // (#83) — loadBrand takes no company argument; what we resolved here is
  // provenance and the .env chain.
  const brand = loadBrand(brandRoot);

  // Company-shared resources (Apple signing material) live at the company
  // workspace root — services resolve it via context.companyRoot
  brand.companyRoot = companyConfig ? marker.companyRoot : null;

  // The inheritable company layer itself rides along for provenance: its
  // values are already merged into brand.config, but flows that want to say
  // "this came from the company" (e.g. the GA account default) compare
  // against it via context.companyConfig
  brand.companyConfig = companyConfig;

  console.log('');
  console.log(chalk.bold.cyan('🚀 Omega Manager'));
  console.log('');

  // Skip disabled brands
  if (brand.config.enabled === false) {
    console.log(chalk.dim('━'.repeat(70)));
    console.log(`  ${chalk.bold(brand.config.brand?.name || brand.id)} ${chalk.yellow('DISABLED')}`);
    console.log(chalk.dim('━'.repeat(70)));
    return { hasErrors: false, results: {}, brand, skipped: true };
  }

  // Determine which services to run. --service is the most specific ask and
  // wins outright; a lane narrows the walk to its slice (#228) — 'boot' is the
  // local one `omega dev` runs before its legs, in SERVICE_ORDER order.
  if (options.lane && options.lane !== 'boot') {
    throw new Error(`Unknown lane: ${options.lane}. Available: boot`);
  }

  const servicesToRun = options.service
    ? [options.service]
    : (options.lane === 'boot'
      ? SERVICE_ORDER.filter((serviceName) => BOOT_SERVICES.includes(serviceName))
      : SERVICE_ORDER);

  if (options.service && !SERVICE_ORDER.includes(options.service)) {
    throw new Error(`Unknown service: ${options.service}. Available: ${SERVICE_ORDER.join(', ')}`);
  }

  console.log(chalk.cyan('━'.repeat(70)));
  console.log(`  ${chalk.bold.white(brand.config.brand?.name || brand.id)} ${chalk.cyan(brand.config.brand?.url || '')} ${chalk.dim(`@ ${new Date().toLocaleTimeString()}`)}`);
  console.log(chalk.cyan('━'.repeat(70)));
  console.log(`  ${chalk.dim('Root:')}     ${brand.root}`);
  if (companyConfig) {
    console.log(`  ${chalk.dim('Company:')}  ${marker.companyRoot}`);
  }
  console.log(`  ${chalk.dim('Enabled:')}  ${brand.enabledTargets.join(', ') || chalk.yellow('none enabled')}`);
  console.log(`  ${chalk.dim('Targets:')}  ${brand.targets.map((entry) => `${entry.name}${entry.target ? chalk.dim(`→${entry.target}`) : chalk.yellow('→?')}`).join(', ') || chalk.yellow('none')}`);
  console.log(`  ${chalk.dim('Services:')} ${options.service || servicesToRun.join(chalk.dim(' → '))}`);

  // Preflight (the REQUIRES registry): check the enabled services' declared
  // env vars + Google scopes up front — ONE consolidated fix walkthrough
  // instead of N mid-run skips. Failing services skip (the cycle continues —
  // absorb, never crash) unless the run can collect the fix itself
  // (interactive paste/consent flows) or --strict makes them fail hard.
  // A lane narrows the WALK, never the preflight (#228): preflight is local
  // (env presence + token-store read, zero network), and its walkthrough is
  // how a boot names what the full setup still owes. Gates are only consulted
  // for the services this run actually walks, so an unwalked finding records
  // nothing and fails nothing.
  const preflight = runPreflight({
    services: options.service ? [options.service] : SERVICE_ORDER,
    brandConfig: brand.config,
    brandRoot,
    options,
  });

  const summary = new RunSummary();
  const results = {};

  // Run each service in order
  for (const serviceName of servicesToRun) {
    console.log('');
    console.log(`  ${chalk.bold.magenta(`[${serviceName.toUpperCase()}]`)}`);

    // Preflight verdicts: 'skip' steps the service aside with the printed
    // walkthrough (missingEnv rides along for the 🔑 aggregate); 'error' is
    // the --strict hard failure; 'run' (or no gate) proceeds normally
    const gate = preflight.gates[serviceName];
    let result;
    if (gate?.action === 'error') {
      console.log(`  ${chalk.red(`✗ Preflight failed (${gate.reason})`)}`);
      result = {
        status: 'error',
        error: gate.reason,
        ...(gate.missingEnv.length > 0 ? { missingEnv: gate.missingEnv } : {}),
      };
    } else if (gate?.action === 'skip') {
      console.log(`    ${chalk.dim(`⊘ Skipped (${gate.reason})`)}`);
      result = {
        status: 'skipped',
        reason: gate.reason,
        ...(gate.missingEnv.length > 0 ? { missingEnv: gate.missingEnv } : {}),
        // A consent/scope gap is a pending HUMAN step: it rides the ⚑
        // aggregate with its rerun hint (#228), not just the walkthrough
        // scroll-back a dev boot's leg output buries
        ...(gate.needsInteractive ? { output: { preflight: { needsInteractive: gate.needsInteractive } } } : {}),
      };
    } else {
      const startedAt = Date.now();
      result = await runService(serviceName, brand, options);
      // Wall time for the services that actually ran — the gated branches
      // above step aside instantly, so timing them is noise
      result.durationMs = Date.now() - startedAt;
      // Printed only for the services that did work — a service that stepped
      // aside already said so on its own line, and 20 `⏱ 0ms` lines under a
      // mostly-skipping walk is noise (the run record keeps every number)
      if (result.status !== 'skipped') {
        console.log(`    ${chalk.dim(`⏱ ${formatDuration(result.durationMs)}`)}`);
      }
    }
    results[serviceName] = result;

    summary.add(brand.id, brand.config.brand?.name || brand.id, serviceName, result);

    if (result.status === 'error' && !options.continueOnError) {
      console.log(`  ${chalk.red(`Stopping due to error in ${serviceName}`)} ${chalk.dim('(--continue-on-error to keep going)')}`);
      break;
    }
  }

  // Persist run output — this run's transients, for post-mortem debugging
  writeRunOutput(brandRoot, RUN_TIMESTAMP, brand.id, Object.entries(results).map(([service, result]) => ({
    service,
    status: result.status,
    // Absent for services the preflight gated aside — they never ran
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    output: result.output ?? null,
    error: result.error ?? null,
    // Machine-readable WHY for skips — the pipeline command asserts on it
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.missingEnv ? { missingEnv: result.missingEnv } : {}),
  })));

  summary.printSummary();

  return { hasErrors: summary.hasErrors(), results, brand };
}

module.exports = { runManage, runService, RUN_TIMESTAMP };
