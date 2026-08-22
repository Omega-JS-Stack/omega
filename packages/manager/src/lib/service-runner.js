/**
 * Service Runner — shared library for running service operations. Ported from
 * omega-manager's src/lib/service-runner.js with the SAME strict contract so
 * services port over without semantic drift.
 *
 * All services use this same pattern:
 * 1. Operations are declared in src/config.js OPERATIONS[serviceName]
 * 2. Handlers live in ensure/, read/, transform/, write/ directories
 * 3. This runner loads and executes handlers in operation order
 *
 * @example
 * // In src/services/my-service/index.js
 * const { createServiceRunner } = require('../../lib/service-runner.js');
 * module.exports.run = createServiceRunner({ serviceDir: __dirname });
 *
 * @example
 * // With custom setup/hooks
 * module.exports.run = createServiceRunner({
 *   serviceDir: __dirname,
 *   setup: (context) => {
 *     if (!context.brandConfig.myService) {
 *       return { skip: true, reason: 'no config' };
 *     }
 *     return { api: new MyAPI() };
 *   },
 * });
 */

const fs = require('node:fs');
const { join } = require('node:path');
const chalk = require('chalk').default;

const { needsInteractiveSkip } = require('./run-gates.js');
const { CONSENT_REQUIRED } = require('./google-auth.js');

/**
 * Class a caught error (#228): a consent gate is a pending HUMAN step, not a
 * failure — it becomes the warned step-aside the run summary's ⚑ section
 * names, so the walk (and an `omega dev` boot on top of it) continues.
 * Everything else stays loud.
 *
 * @param {Error} error - The caught error.
 * @param {string} operationName - The operation's output key.
 * @returns {object|null} The needsInteractiveSkip return, or null when the
 *   error is a real failure.
 */
function pendingGate(error, operationName) {
  if (error?.code !== CONSENT_REQUIRED) {
    return null;
  }

  console.log(`      ${chalk.yellow('⚑')} Needs an interactive run${chalk.dim(`: ${error.message}`)}`);
  return needsInteractiveSkip(operationName, error.message);
}

/**
 * Load an operation handler from a service directory.
 *
 * Missing handler file → null (the runner logs and continues). A handler file
 * that EXISTS but fails to require throws loudly — omega-manager's message
 * sniffing silently swallowed broken handlers; existence-check-first doesn't.
 *
 * @param {string} serviceDir - Absolute path to service directory
 * @param {string} operationName - Name of the operation (e.g., 'targets')
 * @param {string} type - Handler type ('ensure', 'read', 'transform', 'write')
 * @returns {Function|null} - Handler function or null if not found
 */
function getOperationHandler(serviceDir, operationName, type) {
  const modulePath = join(serviceDir, type, `${operationName}.js`);

  if (!fs.existsSync(modulePath)) {
    return null;
  }

  const module = require(modulePath);
  return module.default || module || null;
}

/**
 * Split a handler return into the within-run carry vs transient output.
 *
 * STRICT contract — handler returns MUST be one of:
 *   - undefined / null                              → no-op
 *   - { state: {...} }                              → carry only (this run's serviceData, never a file)
 *   - { output: {...} }                             → transient only (lands in .omega/runs/{ts}.json)
 *   - { state, output }                             → both
 *   - { status, error?, state?, output? }           → status/error are metadata, allowed alongside state/output
 *
 * Any other top-level key throws. This prevents accidental data leakage into
 * the carry via an "everything dumps to serviceData" pattern.
 *
 * `state` is the LATER-OPERATIONS channel and nothing more (#434 retired
 * .omega/state.json): a value a following operation in the same service needs
 * (the zone id, the bundle id, the Sentry project map). A fact that must
 * OUTLIVE the run belongs in config/omega.json5 via lib/config-write.js — or
 * in the brand .env via lib/env-secret.js when it is secret-shaped. Anything
 * else (counts, success/fail flags, "what happened this run") goes to `output`.
 */
const ALLOWED_KEYS = new Set(['state', 'output', 'status', 'error']);

function splitReturn(result, operationName = 'unknown') {
  if (result === undefined || result === null) {
    return { state: null, output: null };
  }
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(
      `Handler "${operationName}" returned ${Array.isArray(result) ? 'an array' : typeof result}. `
      + `Returns must be undefined or an object with shape { state?, output?, status?, error? }.`,
    );
  }

  const keys = Object.keys(result);
  const invalidKeys = keys.filter((k) => !ALLOWED_KEYS.has(k));
  if (invalidKeys.length > 0) {
    throw new Error(
      `Handler "${operationName}" returned invalid top-level key(s): ${invalidKeys.join(', ')}. `
      + `Allowed keys: state, output, status, error. `
      + `Wrap durable IDs in { state: {...} } and transient flags/counts in { output: {...} }.`,
    );
  }

  return {
    state: 'state' in result ? result.state : null,
    output: 'output' in result ? result.output : null,
  };
}

/**
 * Run ensure operation
 */
async function runEnsure(serviceDir, operation, context, accumulators) {
  const handler = getOperationHandler(serviceDir, operation.name, 'ensure');

  if (!handler) {
    console.log(`      ${chalk.yellow('⚠')} No ensure handler for ${chalk.bold(operation.name)}`);
    return { status: 'continue' };
  }

  try {
    // serviceData passed to handler = merged state + output (so handlers can read previous handler state)
    const result = await handler({ ...context, serviceData: { ...accumulators.state, ...accumulators.output } });

    const { state, output } = splitReturn(result, operation.name);
    if (state) Object.assign(accumulators.state, state);
    if (output) Object.assign(accumulators.output, output);

    // Status check on the raw handler return
    if (result?.status === 'error') return { status: 'error', error: result.error };
    if (result?.status === 'warned') return { status: 'warned' };

    return { status: 'continue' };
  } catch (error) {
    const pending = pendingGate(error, operation.name);
    if (pending) {
      Object.assign(accumulators.output, pending.output);
      return { status: 'warned' };
    }

    console.error(`      ${chalk.red('❌')} Ensure failed${chalk.dim(`: ${error.message}`)}`);
    return { status: 'error', error: error.message };
  }
}

/**
 * Run read operation
 */
async function runRead(serviceDir, operation, context, serviceData) {
  const handler = getOperationHandler(serviceDir, operation.name, 'read');

  if (!handler) {
    return { data: null, status: 'continue' };
  }

  try {
    const result = await handler({ ...context, serviceData });

    if (result?.count !== undefined) {
      console.log(`      ${chalk.green('✓')} Read ${chalk.dim(`(${result.count} items)`)}`);
    } else {
      console.log(`      ${chalk.green('✓')} Read`);
    }

    return { data: result, status: 'continue' };
  } catch (error) {
    const pending = pendingGate(error, operation.name);
    if (pending) {
      // No accumulators here — the caller merges the marker
      return { data: null, status: 'warned', output: pending.output };
    }

    console.error(`      ${chalk.red('❌')} Read failed${chalk.dim(`: ${error.message}`)}`);
    return { data: null, status: 'error' };
  }
}

/**
 * Run transform operation
 */
async function runTransform(serviceDir, operation, context, serviceData, readData) {
  const handler = getOperationHandler(serviceDir, operation.name, 'transform');

  if (!handler) {
    return { data: readData, status: 'continue' };
  }

  try {
    const result = await handler({ ...context, serviceData, readData });

    if (!result) {
      console.log(`      ${chalk.dim('⊘ No changes needed')}`);
      return { data: null, status: 'skip' };
    }

    console.log(`      ${chalk.green('✓')} Transform`);
    return { data: result, status: 'continue' };
  } catch (error) {
    const pending = pendingGate(error, operation.name);
    if (pending) {
      return { data: null, status: 'warned', output: pending.output };
    }

    console.error(`      ${chalk.red('❌')} Transform failed${chalk.dim(`: ${error.message}`)}`);
    return { data: null, status: 'error' };
  }
}

/**
 * Run write operation
 */
async function runWrite(serviceDir, operation, context, accumulators, data) {
  const handler = getOperationHandler(serviceDir, operation.name, 'write');

  if (!handler) {
    console.log(`      ${chalk.yellow('⚠')} No write handler for ${chalk.bold(operation.name)}`);
    return { status: 'continue' };
  }

  try {
    const result = await handler({
      ...context,
      serviceData: { ...accumulators.state, ...accumulators.output },
      data,
    });

    console.log(`      ${chalk.green('✓')} Write`);

    const { state, output } = splitReturn(result, operation.name);
    if (state) Object.assign(accumulators.state, state);
    if (output) Object.assign(accumulators.output, output);

    if (result?.status === 'error') return { status: 'error', error: result.error };
    if (result?.status === 'warned') return { status: 'warned' };

    return { status: 'continue' };
  } catch (error) {
    const pending = pendingGate(error, operation.name);
    if (pending) {
      Object.assign(accumulators.output, pending.output);
      return { status: 'warned' };
    }

    console.error(`      ${chalk.red('❌')} Write failed${chalk.dim(`: ${error.message}`)}`);
    return { status: 'error', error: error.message };
  }
}

/**
 * Create a service runner function
 *
 * @param {Object} options - Configuration options
 * @param {string} options.serviceDir - Absolute path to the service's directory
 *   (handlers load from its ensure/read/transform/write subdirs). Services pass
 *   __dirname; context.serviceDir is the fallback for tests/embedding.
 * @param {Function} options.setup - Optional setup function called before operations
 *   - Receives: (context) => { skip?, reason?, ...additionalContext }
 *   - Return { skip: true, reason: 'message' } to skip the service
 *   - Return additional properties to merge into context (e.g., { api: new API() })
 * @param {boolean} options.logOperations - Whether to log each operation (default: true)
 * @param {boolean} options.stopOnError - Whether to stop on first error (default: true)
 * @returns {Function} - Service runner function
 */
function createServiceRunner(options = {}) {
  const {
    serviceDir: ownServiceDir = null,
    setup = null,
    logOperations = true,
    stopOnError = true,
  } = options;

  return async function run(context) {
    // Run setup if provided
    let setupResult = {};
    if (setup) {
      setupResult = await setup(context);

      if (setupResult?.skip) {
        console.log(`    ${chalk.dim(`⊘ Skipped (${setupResult.reason || 'setup returned skip'})`)}`);
        return {
          status: 'skipped',
          reason: setupResult.reason,
          // Machine-readable missing-secret list (cp114) — the run summary
          // aggregates these into the 🔑 section
          ...(setupResult.missingEnv ? { missingEnv: setupResult.missingEnv } : {}),
        };
      }
    }

    // Use operations from setup result if provided, otherwise from context
    const operations = setupResult.operations || context.operations || [];

    // Merge setup result into context
    const enrichedContext = { ...context, ...setupResult };

    const serviceDir = ownServiceDir || enrichedContext.serviceDir;
    if (!serviceDir) {
      throw new Error('serviceDir must be provided via createServiceRunner options or context');
    }

    // Accumulators: the within-run carry (→ each later operation's
    // serviceData) vs transient output (→ .omega/runs/{ts}.json). Setup's
    // serviceData seeds the carry — that's how a service hands its
    // operations something it resolved once (the Stripe account id).
    const accumulators = {
      state: {
        ...context.serviceData,
        ...(setupResult.serviceData || {}),
      },
      output: {},
    };
    let overallStatus = 'success';
    let firstError = null;

    // Process operations in order
    for (const operation of operations) {
      if (logOperations) {
        console.log(`    ${chalk.dim('→')} ${operation.name}`);
      }

      // Handle ensure operations
      if (operation.ensure) {
        const result = await runEnsure(serviceDir, operation, enrichedContext, accumulators);

        if (result.status === 'error') {
          overallStatus = 'error';
          firstError = firstError || result.error || `${operation.name} failed`;
          if (stopOnError) break;
        } else if (result.status === 'warned' && overallStatus !== 'error') {
          overallStatus = 'warned';
        }

        continue;
      }

      // Handle read/write operations
      if (operation.read || operation.write) {
        let readData = null;
        const mergedView = { ...accumulators.state, ...accumulators.output };

        // Read phase
        if (operation.read) {
          const readResult = await runRead(serviceDir, operation, enrichedContext, mergedView);
          readData = readResult.data;

          if (readResult.status === 'error') {
            overallStatus = 'error';
            firstError = firstError || `${operation.name} read failed`;
            if (stopOnError) break;
          }

          // A pending gate (#228): carry its marker and move on — there is
          // nothing to transform or write on top of an operation that never
          // read
          if (readResult.status === 'warned') {
            Object.assign(accumulators.output, readResult.output);
            if (overallStatus !== 'error') overallStatus = 'warned';
            continue;
          }

          // Call onRead hook if provided (e.g., to save read data to disk)
          if (readData && enrichedContext.onRead) {
            await enrichedContext.onRead(operation.name, readData);
          }
        }

        // Write phase (with optional transform)
        if (operation.write && readData) {
          // Transform phase
          const transformResult = await runTransform(
            serviceDir, operation, enrichedContext, mergedView, readData,
          );

          if (transformResult.status === 'error') {
            overallStatus = 'error';
            firstError = firstError || `${operation.name} transform failed`;
            if (stopOnError) break;
          }

          if (transformResult.status === 'warned') {
            Object.assign(accumulators.output, transformResult.output);
            if (overallStatus !== 'error') overallStatus = 'warned';
            continue;
          }

          if (transformResult.status === 'skip') {
            continue;
          }

          const writeResult = await runWrite(
            serviceDir, operation, enrichedContext, accumulators, transformResult.data,
          );

          if (writeResult.status === 'error') {
            overallStatus = 'error';
            firstError = firstError || writeResult.error || `${operation.name} write failed`;
            if (stopOnError) break;
          } else if (writeResult.status === 'warned' && overallStatus !== 'error') {
            overallStatus = 'warned';
          }
        } else if (operation.write && !operation.read) {
          // Write-only operation (no read phase)
          const writeResult = await runWrite(
            serviceDir, operation, enrichedContext, accumulators, null,
          );

          if (writeResult.status === 'error') {
            overallStatus = 'error';
            firstError = firstError || writeResult.error || `${operation.name} write failed`;
            if (stopOnError) break;
          } else if (writeResult.status === 'warned' && overallStatus !== 'error') {
            overallStatus = 'warned';
          }
        }
      }
    }

    return {
      status: overallStatus,
      error: firstError,
      state: Object.keys(accumulators.state).length > 0 ? accumulators.state : null,
      output: Object.keys(accumulators.output).length > 0 ? accumulators.output : null,
    };
  };
}

module.exports = { createServiceRunner, getOperationHandler, splitReturn };
