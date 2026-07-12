/**
 * Run Summary — collects service results across all brands and prints a
 * summary. Ported from omega-manager's src/lib/run-summary.js: same stats,
 * per-brand breakdown, drilled-down details for update failures and testing
 * warnings, and a copy-pasteable retry command.
 *
 * Created once in runManage(), accumulates across every service (and, in the
 * future company mode, across brands). Always prints a summary at the end.
 */

const chalk = require('chalk').default;

class RunSummary {
  constructor() {
    this.entries = [];
    this.startTime = Date.now();
    this.argv = process.argv.slice(2);
  }

  /**
   * Record a service result
   *
   * @param {string} brandId - Brand ID
   * @param {string} brandName - Brand display name
   * @param {string} serviceName - Service that ran
   * @param {Object} result - Result from runService() { status, error?, output? }
   */
  add(brandId, brandName, serviceName, result) {
    this.entries.push({ brandId, brandName, serviceName, result });
  }

  /**
   * Check if any service had errors
   */
  hasErrors() {
    return this.entries.some((entry) => this._isError(entry));
  }

  /**
   * Print full summary (always)
   */
  printSummary() {
    const elapsed = this._formatDuration(Date.now() - this.startTime);
    const hasErrors = this.hasErrors();

    // Gather stats
    const brandSet = new Set();
    const serviceSet = new Set();
    let successCount = 0;
    let warnedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const entry of this.entries) {
      brandSet.add(entry.brandId);
      serviceSet.add(entry.serviceName);

      if (this._isError(entry)) {
        errorCount++;
      } else if (entry.result.status === 'skipped') {
        skippedCount++;
      } else if (entry.result.status === 'warned') {
        warnedCount++;
      } else {
        successCount++;
      }
    }

    // Header
    const hasWarnings = warnedCount > 0;
    const headerColor = hasErrors ? chalk.yellow : hasWarnings ? chalk.yellow : chalk.green;
    const headerIcon = hasErrors ? '⚠' : hasWarnings ? '⚠' : '✅';
    console.log('');
    console.log(headerColor('━'.repeat(70)));
    console.log(`  ${headerColor.bold(`${headerIcon} Summary`)}`);
    console.log(headerColor('━'.repeat(70)));

    // Stats
    console.log('');
    console.log(`  ${chalk.dim('Brands:')}    ${brandSet.size}`);
    console.log(`  ${chalk.dim('Services:')}  ${serviceSet.size}`);
    console.log(`  ${chalk.dim('Duration:')}  ${elapsed}`);
    const passedTotal = successCount + warnedCount;
    const resultParts = [
      chalk.green(`${passedTotal} passed`),
      errorCount > 0 ? chalk.red(`, ${errorCount} failed`) : chalk.dim(', 0 failed'),
    ];
    if (warnedCount > 0) {
      resultParts.push(chalk.yellow(`, ${warnedCount} warned`));
    }
    if (skippedCount > 0) {
      resultParts.push(chalk.dim(`, ${skippedCount} skipped`));
    }
    console.log(`  ${chalk.dim('Results:')}   ${resultParts.join('')}`);

    // Per-brand breakdown
    console.log('');
    for (const brandId of brandSet) {
      const brandEntries = this.entries.filter((e) => e.brandId === brandId);
      const brandName = brandEntries[0].brandName;
      const brandErrors = brandEntries.filter((e) => this._isError(e));
      const brandWarnings = brandEntries.filter((e) => e.result.status === 'warned');

      if (brandErrors.length > 0) {
        console.log(`  ${chalk.red('✗')} ${chalk.bold(brandName)}`);

        for (const entry of brandErrors) {
          const details = this._getErrorDetails(entry.serviceName, entry.result);

          for (const detail of details) {
            console.log(`      ${detail}`);
          }
        }
      } else if (brandWarnings.length > 0) {
        console.log(`  ${chalk.yellow('⚠')} ${chalk.bold(brandName)}`);

        for (const entry of brandWarnings) {
          const details = this._getWarningDetails(entry.serviceName, entry.result);

          for (const detail of details) {
            console.log(`      ${detail}`);
          }
        }
      } else {
        console.log(`  ${chalk.green('✓')} ${chalk.bold(brandName)}`);
      }
    }

    // Needs-interactive aggregate (#32): steps that stepped aside for lack
    // of a TTY say so HERE, not just in scroll-back
    const needsInteractive = this._getNeedsInteractive();
    if (needsInteractive.length > 0) {
      const multiBrand = brandSet.size > 1;
      console.log('');
      console.log(`  ${chalk.yellow('⚑')} Skipped — needs an interactive run:`);
      for (const item of needsInteractive) {
        const prefix = multiBrand ? `${item.brandName} · ` : '';
        console.log(`      ${prefix}${chalk.bold(`${item.serviceName}/${item.operation}`)}: ${item.what}`);
      }
      for (const serviceName of [...new Set(needsInteractive.map((item) => item.serviceName))]) {
        console.log(`      ${chalk.dim(`→ npm start -- --service=${serviceName}   (from the brand root)`)}`);
      }
    }

    // Missing-secrets aggregate (cp114): services that skipped for lack of
    // an env var name the exact keys HERE — and an interactive rerun asks
    // for them and saves them to the brand .env
    const missingEnv = this._getMissingEnv();
    if (missingEnv.length > 0) {
      const multiBrand = brandSet.size > 1;
      console.log('');
      console.log(`  ${chalk.yellow('🔑')} Missing secrets — add to the brand .env, or rerun interactively to paste them:`);
      for (const item of missingEnv) {
        const prefix = multiBrand ? `${item.brandName} · ` : '';
        console.log(`      ${prefix}${chalk.bold(item.serviceName)}: ${item.vars.join(', ')}`);
      }
      for (const serviceName of [...new Set(missingEnv.map((item) => item.serviceName))]) {
        console.log(`      ${chalk.dim(`→ npm start -- --service=${serviceName}   (from the brand root)`)}`);
      }
    }

    // Retry command
    if (hasErrors) {
      console.log('');
      console.log(`  ${chalk.red('✗')} Retry:`);
      console.log(`  ${chalk.dim(this._buildRetryCommand())}`);
    }

    console.log('');
    console.log(headerColor('━'.repeat(70)));
  }

  /**
   * Build a retry command from the original argv. `npm start` is the blessed
   * form — npx can be rerouted by shell wrappers (npu) that pipe stdio and
   * kill interactivity.
   */
  _buildRetryCommand() {
    const args = this.argv.join(' ').trim();
    return args ? `npm start -- ${args}` : 'npm start';
  }

  /**
   * Collect missing-secret skips (cp114): service results carry
   * `missingEnv: ['CLOUDFLARE_TOKEN', …]` when setup skipped for absent
   * env vars (ensureEnvSecrets).
   */
  _getMissingEnv() {
    const items = [];

    for (const entry of this.entries) {
      const vars = entry.result?.missingEnv;
      if (Array.isArray(vars) && vars.length > 0) {
        items.push({
          brandId: entry.brandId,
          brandName: entry.brandName,
          serviceName: entry.serviceName,
          vars,
        });
      }
    }

    return items;
  }

  /**
   * Collect needs-interactive markers (#32): any handler output sub-object
   * may carry `needsInteractive: '<what an interactive run would do>'` —
   * the convention for steps that step aside without a TTY.
   */
  _getNeedsInteractive() {
    const items = [];

    for (const entry of this.entries) {
      const output = entry.result?.output;
      if (!output || typeof output !== 'object') {
        continue;
      }

      for (const [operation, data] of Object.entries(output)) {
        if (data && typeof data === 'object' && typeof data.needsInteractive === 'string') {
          items.push({
            brandId: entry.brandId,
            brandName: entry.brandName,
            serviceName: entry.serviceName,
            operation,
            what: data.needsInteractive,
          });
        }
      }
    }

    return items;
  }

  /**
   * Format milliseconds into a human-readable duration
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
      return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  }

  /**
   * Check if an entry represents an error
   */
  _isError(entry) {
    const { result, serviceName } = entry;

    // Explicit error status
    if (result.status === 'error') {
      return true;
    }

    // Update service: check for failed targets even when status is 'success'
    if (serviceName === 'update' && result.output?.results) {
      return this._hasFailedTargets(result.output.results);
    }

    return false;
  }

  /**
   * Check if update results contain failed targets
   */
  _hasFailedTargets(results) {
    for (const target of Object.keys(results)) {
      const steps = results[target].steps || [];

      if (steps.some((s) => s.success === false)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get human-readable error details for a service result
   */
  _getErrorDetails(serviceName, result) {
    const details = [];

    // Update service: show per-target, per-phase failures
    if (serviceName === 'update' && result.output?.results) {
      const failedTargets = this._getFailedTargets(result.output.results);

      if (failedTargets.length > 0) {
        details.push(`${chalk.red(serviceName)}:`);

        for (const { target, phase, error } of failedTargets) {
          const errorMsg = error ? chalk.dim(`: ${error}`) : '';
          details.push(`  ${chalk.bold(target)} → ${chalk.red(`${phase} failed`)}${errorMsg}`);
        }
      }

      // Also show top-level error if present
      if (result.status === 'error' && result.error && failedTargets.length === 0) {
        details.push(`${chalk.red(serviceName)}: ${result.error}`);
      }

      return details;
    }

    // Testing service: show per-check failures
    if (result.output?.results?.failed?.length) {
      details.push(`${chalk.red(serviceName)}:`);
      for (const { name, error } of result.output.results.failed) {
        const msg = error ? chalk.dim(`: ${error}`) : '';
        details.push(`  ${chalk.bold(name)}${msg}`);
      }

      return details;
    }

    // Generic service error
    details.push(`${chalk.red(serviceName)}: ${result.error || 'failed'}`);
    return details;
  }

  /**
   * Get human-readable warning details for a service result
   */
  _getWarningDetails(serviceName, result) {
    const details = [];

    // Testing service: show per-test warnings from output.results.warned
    if (result.output?.results?.warned?.length) {
      details.push(`${chalk.yellow(serviceName)}:`);
      for (const { name, warning } of result.output.results.warned) {
        const msg = warning ? chalk.dim(`: ${warning}`) : '';
        details.push(`  ${chalk.bold(name)}${msg}`);
      }

      return details;
    }

    // Workspace service: show config/structure findings
    if (result.output?.findings?.length) {
      details.push(`${chalk.yellow(serviceName)}:`);
      for (const finding of result.output.findings) {
        details.push(`  ${finding}`);
      }

      return details;
    }

    details.push(`${chalk.yellow(serviceName)}: some operations had issues`);
    return details;
  }

  /**
   * Extract failed targets from update results
   */
  _getFailedTargets(results) {
    const failed = [];

    for (const [target, targetResult] of Object.entries(results)) {
      const steps = targetResult.steps || [];

      for (const step of steps) {
        if (step.success === false) {
          failed.push({
            target,
            phase: step.phase || 'unknown',
            error: step.error || null,
          });
        }
      }
    }

    return failed;
  }
}

module.exports = { RunSummary };
