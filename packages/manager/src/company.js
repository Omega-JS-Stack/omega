/**
 * The company orchestrator — omega-manager's many-brands loop for the new
 * hierarchy (Task M3): discover the brands under brands.roots, stamp each
 * with `.omega/company.json`, then run THE SAME per-brand manage as a child
 * process per brand (cwd = brand root), aggregating every service result
 * into one RunSummary.
 *
 * Child processes — not in-process loops — because brands own their secrets:
 * each child builds its own env chain (shell > brand .env > company .env via
 * the stamp), so one brand's STRIPE_SECRET_KEY can never bleed into the
 * next. They also give per-brand log files from plain pipe tees (no console
 * patching) and contain crashes.
 *
 *   sequential (default) — children stream live to the terminal, teed to
 *     .omega/logs/{brandId}.log at the company root (ANSI-stripped)
 *   --parallel           — up to --concurrency (default: CPU count) children
 *     at once; output buffers per brand and flushes as each finishes, with a
 *     live progress block on TTYs
 *
 * Results come from each brand's own `.omega/runs/{ts}.json` (the child
 * always writes it); a child that dies before writing one gets a synthetic
 * error entry so the aggregate never under-reports.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { readRawConfig, discoverBrands, stampCompanyMarker } = require('./lib/company.js');
const { ensureOmegaIgnored } = require('./lib/gitignore.js');
const { RunSummary } = require('./lib/run-summary.js');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'omega-manager');

/**
 * Strip ANSI escape codes (for the log-file tee).
 */
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Run async fn over items with a concurrency cap.
 */
async function parallelMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Spawn one brand's manage child. Returns { code, output } — output is the
 * combined stdout+stderr, streamed live when `stream` is true, always teed
 * (ANSI-stripped) to the brand's log file.
 */
function runBrandChild(brand, childArgs, { stream, logPath }) {
  return new Promise((resolve) => {
    jetpack.dir(path.dirname(logPath));
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });

    const child = spawn(process.execPath, [BIN_PATH, ...childArgs], {
      cwd: brand.root,
      // Children pipe their output — keep chalk colors when the parent's
      // terminal has them (the log tee strips ANSI either way)
      env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : process.env.FORCE_COLOR || '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffered = '';

    const onChunk = (chunk) => {
      const text = String(chunk);
      logStream.write(stripAnsi(text));
      if (stream) {
        process.stdout.write(text);
      } else {
        buffered += text;
      }
    };

    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);

    child.on('close', (code) => {
      logStream.end();
      resolve({ code, output: buffered });
    });

    child.on('error', (error) => {
      logStream.end();
      resolve({ code: -1, output: buffered + `\nFailed to spawn manage for ${brand.id}: ${error.message}\n` });
    });
  });
}

/**
 * Feed one finished child's results into the aggregate summary from the
 * brand's newest run file (written during this run). A child that died
 * before writing one gets a synthetic error entry.
 */
function collectChildResult(brand, spawnTime, exitCode, summary) {
  const runsDir = path.join(brand.root, '.omega', 'runs');

  let newest = null;
  if (fs.existsSync(runsDir)) {
    newest = fs.readdirSync(runsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ name, path: path.join(runsDir, name), mtime: fs.statSync(path.join(runsDir, name)).mtimeMs }))
      .filter((file) => file.mtime >= spawnTime)
      .sort((a, b) => b.mtime - a.mtime)[0] || null;
  }

  if (!newest) {
    if (exitCode !== 0) {
      summary.add(brand.id, brand.name, 'manage', {
        status: 'error',
        error: `manage exited with code ${exitCode} before writing run output (see .omega/logs/${brand.id}.log)`,
      });
    }
    return;
  }

  const run = jetpack.read(newest.path, 'json');
  for (const service of run?.services || []) {
    summary.add(brand.id, brand.name, service.service, {
      status: service.status,
      output: service.output,
      error: service.error,
    });
  }
}

/**
 * Run manage for every brand the company workspace manages.
 *
 * @param {string} companyRoot - Absolute company root (config has `brands`)
 * @param {Object} options - { brand?, parallel?, concurrency? } — everything
 *   else forwards to the children via childArgs
 * @param {string[]} childArgs - argv to forward to each brand's manage child
 *   (already stripped of company-only flags — see filterChildArgs)
 * @param {Object} [deps] - { summary? } test seam for the aggregate summary
 * @returns {{ hasErrors: boolean, brands: Array }}
 */
async function runCompany(companyRoot, options = {}, childArgs = [], deps = {}) {
  const raw = readRawConfig(companyRoot) || {};
  const { brands: discovered, skipped } = discoverBrands(companyRoot);

  if (discovered.length === 0) {
    throw new Error(
      `No brands found under ${companyRoot} — brands.roots ${JSON.stringify(raw.brands?.roots || ['./brands'])} `
      + `contains no directories with a config/omega.json5.`,
    );
  }

  // --brand filter (comma-separated ids or dir names)
  let brands = discovered;
  if (options.brand) {
    const requested = String(options.brand).split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = requested.filter((r) => !discovered.some((b) => b.id === r || b.dirName === r));
    if (unknown.length > 0) {
      throw new Error(`Unknown brand(s): ${unknown.join(', ')}. Available: ${discovered.map((b) => b.id).join(', ')}`);
    }
    brands = discovered.filter((b) => requested.includes(b.id) || requested.includes(b.dirName));
  }

  const useParallel = options.parallel && brands.length > 1;
  const concurrency = useParallel ? Math.min(options.concurrency || os.cpus().length, brands.length) : 1;

  console.log('');
  console.log(chalk.bold.cyan('🏢 Omega Manager — company workspace'));
  console.log('');
  console.log(chalk.cyan('━'.repeat(70)));
  console.log(`  ${chalk.bold.white(raw.brand?.name || path.basename(companyRoot))} ${chalk.dim('@ ' + new Date().toLocaleTimeString())}`);
  console.log(chalk.cyan('━'.repeat(70)));
  console.log(`  ${chalk.dim('Root:')}     ${companyRoot}`);
  console.log(`  ${chalk.dim('Brands:')}   ${discovered.map((b) => b.enabled ? b.id : chalk.yellow(`${b.id} (disabled)`)).join(', ')}`);
  if (options.brand) {
    console.log(`  ${chalk.dim('Filter:')}   ${brands.map((b) => b.id).join(', ')}`);
  }
  console.log(`  ${chalk.dim('Forward:')}  ${childArgs.join(' ') || chalk.dim('(all services)')}`);
  if (useParallel) {
    console.log(`  ${chalk.dim('Parallel:')} ${chalk.cyan(`${concurrency} concurrent`)} ${chalk.dim(`(${os.cpus().length} CPUs)`)}`);
  }
  for (const { dir, reason } of skipped) {
    console.log(`  ${chalk.dim(`⊘ ${dir}: ${reason}`)}`);
  }

  // Company-root .omega/ (logs live there) never gets committed
  if (ensureOmegaIgnored(companyRoot) === 'added') {
    console.log(`  ${chalk.dim('Added .omega/ to the company .gitignore')}`);
  }

  // Stamp every discovered brand (manager bookkeeping in gitignored .omega —
  // exempt from --dry-run like run files) so brand-local runs layer company
  // defaults from here on
  for (const brand of discovered) {
    stampCompanyMarker(brand.root, companyRoot);
  }

  const runnable = brands.filter((b) => b.enabled);
  for (const brand of brands) {
    if (!brand.enabled) {
      console.log(`  ${chalk.dim(`⊘ ${brand.id}: DISABLED (enabled: false)`)}`);
    }
  }

  const summary = deps.summary || new RunSummary();

  // Live progress block for parallel TTY runs
  const progress = { running: [], done: 0, total: runnable.length };
  let progressLines = 0;
  const renderProgress = () => {
    if (!useParallel || !process.stdout.isTTY) return;
    if (progressLines > 0) process.stdout.write(`\x1B[${progressLines}A`);
    const lines = [
      `${chalk.cyan(`[${progress.done}/${progress.total}]`)} ${chalk.yellow(`${progress.running.length} running`)}${progress.running.length ? ':' : ''}`,
      ...progress.running.map((id) => `  ${chalk.dim('→')} ${id}`),
    ];
    for (const line of lines) process.stdout.write(`\x1B[2K${line}\n`);
    for (let i = lines.length; i < progressLines; i++) process.stdout.write('\x1B[2K\n');
    const extra = progressLines - lines.length;
    if (extra > 0) process.stdout.write(`\x1B[${extra}A`);
    progressLines = lines.length;
  };
  const clearProgress = () => {
    if (progressLines === 0) return;
    process.stdout.write(`\x1B[${progressLines}A`);
    for (let i = 0; i < progressLines; i++) process.stdout.write('\x1B[2K\n');
    process.stdout.write(`\x1B[${progressLines}A`);
    progressLines = 0;
  };

  await parallelMap(runnable, concurrency, async (brand) => {
    progress.running.push(brand.id);
    renderProgress();

    const spawnTime = Date.now();
    const logPath = path.join(companyRoot, '.omega', 'logs', `${brand.id}.log`);
    const { code, output } = await runBrandChild(brand, childArgs, {
      stream: !useParallel,
      logPath,
    });

    progress.running = progress.running.filter((id) => id !== brand.id);
    progress.done++;

    if (useParallel) {
      clearProgress();
      process.stdout.write(output);
      renderProgress();
    }

    collectChildResult(brand, spawnTime, code, summary);
  });

  clearProgress();
  summary.printSummary();

  return { hasErrors: summary.hasErrors(), brands: runnable };
}

module.exports = { runCompany, collectChildResult };
