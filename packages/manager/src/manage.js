/**
 * The manage orchestrator — omega-manager's src/manage/index.js reborn for
 * brand monorepos. Resolves the brand root from the cwd, loads the brand
 * (omega.json5 + enabled targets + apps), then walks SERVICE_ORDER running
 * each service's operations idempotently. Durable state persists to
 * .omega/state.json after every service; transient output lands in
 * .omega/runs/{timestamp}.json; the summary prints last.
 *
 * Company mode (many brands from one workspace — Ian's omega-manager case)
 * layers on top of this later: runManage() is already per-brand, so the
 * company runner is a loop + the parallel logger, both ported when that
 * mode lands.
 */

const { join } = require('node:path');
const chalk = require('chalk').default;

const { SERVICE_ORDER, OPERATIONS } = require('./config.js');
const { resolveBrandRoot, loadBrand } = require('./lib/brand.js');
const { readState, writeState, writeRunOutput } = require('./lib/state.js');
const { RunSummary } = require('./lib/run-summary.js');

// Timestamp for this process run — used in .omega/runs/{RUN_TIMESTAMP}.json
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Run a single service for the brand.
 *
 * @param {string} serviceName - Service to run
 * @param {Object} brand - Loaded brand (from loadBrand)
 * @param {Object} brandState - Durable state (per-service keyed)
 * @param {Object} options - Run options
 * @returns {Object} - { status, error?, state?, output? }
 */
async function runService(serviceName, brand, brandState, options = {}) {
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

    // Pass service-specific state as initial serviceData; full brandState for
    // cross-service access (e.g. analytics checking firebase.sdkConfig)
    return await serviceModule.run({
      brandId: brand.id,
      brandRoot: brand.root,
      brandConfig: brand.config,
      brand,
      brandState,
      apps: brand.apps,
      operations,
      options,
      serviceData: brandState[serviceName] || {},
    });
  } catch (error) {
    console.error(`  Error in ${serviceName}: ${error.message}`);
    return { status: 'error', error: error.message };
  }
}

/**
 * Run all services (in order) against the brand monorepo containing startDir.
 *
 * @param {string} startDir - Any directory inside the brand monorepo
 * @param {Object} options - { service?, continueOnError?, dryRun?, verbose? }
 * @returns {{ hasErrors: boolean, results: Object, brand: Object }}
 */
async function runManage(startDir, options = {}) {
  const brandRoot = resolveBrandRoot(startDir);

  if (!brandRoot) {
    throw new Error(
      `No brand monorepo found at or above ${startDir} — `
      + `expected a config/omega.json5 at the brand root (see docs/config.md).`,
    );
  }

  // Brand-root .env is the secrets home (loaded before any service touches an API)
  require('dotenv').config({ path: join(brandRoot, '.env'), quiet: true });

  const brand = loadBrand(brandRoot);

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

  // Determine which services to run
  const servicesToRun = options.service ? [options.service] : SERVICE_ORDER;

  if (options.service && !SERVICE_ORDER.includes(options.service)) {
    throw new Error(`Unknown service: ${options.service}. Available: ${SERVICE_ORDER.join(', ')}`);
  }

  console.log(chalk.cyan('━'.repeat(70)));
  console.log(`  ${chalk.bold.white(brand.config.brand?.name || brand.id)} ${chalk.cyan(brand.config.brand?.url || '')} ${chalk.dim('@ ' + new Date().toLocaleTimeString())}`);
  console.log(chalk.cyan('━'.repeat(70)));
  console.log(`  ${chalk.dim('Root:')}     ${brand.root}`);
  console.log(`  ${chalk.dim('Targets:')}  ${brand.targets.join(', ') || chalk.yellow('none enabled')}`);
  console.log(`  ${chalk.dim('Apps:')}     ${brand.apps.map((a) => `${a.name}${a.target ? chalk.dim(`→${a.target}`) : chalk.yellow('→?')}`).join(', ') || chalk.yellow('none')}`);
  console.log(`  ${chalk.dim('Services:')} ${options.service || servicesToRun.join(chalk.dim(' → '))}`);

  // Load durable state (derived/runtime data)
  const brandState = readState(brandRoot);
  const summary = new RunSummary();
  const results = {};

  // Run each service in order
  for (const serviceName of servicesToRun) {
    console.log('');
    console.log(`  ${chalk.bold.magenta(`[${serviceName.toUpperCase()}]`)}`);

    const result = await runService(serviceName, brand, brandState, options);
    results[serviceName] = result;

    summary.add(brand.id, brand.config.brand?.name || brand.id, serviceName, result);

    // Persist durable state if the service returned any. Services split their
    // return into result.state (durable IDs → state.json) and result.output
    // (transient counts/errors → runs/{ts}.json). See lib/service-runner.js.
    if (result.state) {
      brandState[serviceName] = result.state;
      writeState(brandRoot, brandState);
    }

    if (result.status === 'error' && !options.continueOnError) {
      console.log(`  ${chalk.red(`Stopping due to error in ${serviceName}`)} ${chalk.dim('(--continue-on-error to keep going)')}`);
      break;
    }
  }

  // Persist run output — transient stuff that does NOT belong in state.json
  writeRunOutput(brandRoot, RUN_TIMESTAMP, brand.id, Object.entries(results).map(([service, result]) => ({
    service,
    status: result.status,
    output: result.output ?? null,
    error: result.error ?? null,
  })));

  summary.printSummary();

  return { hasErrors: summary.hasErrors(), results, brand };
}

module.exports = { runManage, runService, RUN_TIMESTAMP };
