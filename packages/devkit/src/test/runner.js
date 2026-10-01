/**
 * The one OMEGA test runner. Every suite is a `defineCases` file; the runner
 * discovers them under its roots, runs the `_init.js` hooks once, then runs
 * every case on node:test in THIS process (`run()` with `isolation: 'none'`),
 * layer row by layer row (src/test/layers.js). A `host` row runs its suites
 * here through run-case.js; an `app` row's driver runs them inside the app and
 * reports each case back by id.
 *
 *   createRunner(config).run({ targets, filter, layer, lane, extended, reporter })
 *     → { passed, failed, skipped, noMatch, durationMs, tests }
 */

const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const os = require('os');
const path = require('path');

const expect = require('./expect.js');
const { normalizeSpec, errorOf } = require('./run-case.js');
const { layersFor, defaultLayer, needsDriver } = require('./layers.js');
const { discoverSuites } = require('./discovery.js');
const { runInitSetups, InitHookError } = require('./init-hooks.js');
const { markRunnerActive } = require('./define-cases.js');
const { noMatchMessage } = require('./scope.js');
const { makeExtendedModeWarning } = require('./extended-mode-warning.js');
const { createReporter } = require('./reporter.js');
const { createCaseSession, hostSession, registerSuite } = require('./register-suite.js');
const { guardStdout } = require('./guard-stdout.js');
const attachLogFile = require('../attach-log-file.js');

// Registrations waiting for their bootstrap file to load inside node:test's run().
const plans = new Map();
let planCount = 0;

/**
 * Called by a run's bootstrap file, inside node:test's run(): registers the
 * plan's rows, suites and cases.
 * @param {string} id - The plan id.
 * @returns {void}
 */
function registerPlan(id) {
  const { describe, after } = require('node:test');
  const plan = plans.get(id);
  describe(plan.rootName, () => {
    for (const layer of plan.layers) {
      describe(layer.row.name, () => {
        after(() => layer.stop());
        for (const entry of layer.entries) {
          registerSuite(entry.suite, {
            label: entry.label,
            session: entry.session,
            onEvent: (event, caseDef) => plan.onEvent(event, caseDef, entry, layer.row),
          });
        }
      });
    }
  });
}

// Each host case runs in its own async scope, so an error nobody awaited (a
// timer that throws, a promise nobody handles) is traced to the case that raised it.
const caseScope = new AsyncLocalStorage();

/**
 * Watch for errors no case awaited. One raised by a case while it runs fails
 * that case; any other is kept as `loose`, for the run to report on its own.
 * @returns {{loose: Array, watch: Function, settled: Function, stop: Function}} The watch.
 */
function watchStrayErrors() {
  const loose = [];
  const running = new Map();
  const onError = (error) => {
    const failCase = running.get(caseScope.getStore());
    if (failCase) failCase(error);
    else loose.push(error);
  };
  process.on('uncaughtException', onError);
  process.on('unhandledRejection', onError);

  // The case's own settle waits one turn of the event loop, so a rejection it
  // raised in its last tick surfaces while it still counts as running.
  const watch = (caseDef) => (typeof caseDef.run !== 'function' ? caseDef : {
    ...caseDef,
    run: (ctx) => new Promise((resolve, reject) => {
      running.set(caseDef.id, reject);
      const later = (settle) => (value) => setImmediate(() => settle(value));
      caseScope.run(caseDef.id, () => {
        new Promise((done) => done(caseDef.run(ctx))).then(later(resolve), later(reject));
      });
    }).finally(() => running.delete(caseDef.id)),
  });

  return {
    loose,
    watch,
    settled: (id) => running.delete(id),
    stop() {
      process.off('uncaughtException', onError);
      process.off('unhandledRejection', onError);
    },
  };
}

/**
 * Build a runner for one framework's suites.
 * @param {object} config - See the file header; `framework` is a LAYERS key.
 * @returns {{run: Function}} The runner.
 */
function createRunner(config) {
  const rows = layersFor(config.framework);

  function record(results, reporter, test) {
    results.tests.push(test);
    if (test.status === 'pass') results.passed += 1;
    else if (test.status === 'skip') results.skipped += 1;
    else results.failed += 1;
    reporter.result(test);
  }

  function recordFailure(results, reporter, fields) {
    record(results, reporter, {
      id: fields.id || fields.name,
      source: fields.source || null,
      file: fields.file || null,
      suite: null,
      name: fields.name,
      layer: fields.layer || null,
      status: 'fail',
      durationMs: 0,
      error: errorOf(fields.error),
    });
  }

  // Require and normalize one discovered file; a file that is no spec fails the run.
  function loadSuite(entry, results, reporter, filter) {
    let suite;
    try {
      delete require.cache[require.resolve(entry.file)];
      suite = normalizeSpec(require(entry.file), { file: entry.file });
    } catch (e) {
      recordFailure(results, reporter, { id: entry.file, source: entry.source, file: entry.file, name: entry.rel, error: e });
      return null;
    }

    const layer = suite.layer || defaultLayer(config.framework);
    if (!rows.some((row) => row.name === layer)) {
      const known = rows.map((row) => row.name).join(', ');
      const error = new Error(`${entry.file} names the layer "${layer}", which ${config.framework} does not have (layers: ${known})`);
      recordFailure(results, reporter, { id: entry.file, source: entry.source, file: entry.file, name: entry.rel, layer, error });
      return null;
    }

    const label = suite.description || entry.rel.split(path.sep).join('/');
    const cases = suite.cases.filter((caseDef) => !filter || caseDef.name.includes(filter) || label.includes(filter));
    return { ...entry, label, suite: { ...suite, layer, cases } };
  }

  // One row's driver, started once, by the row's first case.
  function rowDriver(row, driver, context) {
    let started = null;
    return {
      start(report) {
        if (!started) {
          started = Promise.resolve(driver.start({
            projectRoot: config.projectRoot,
            options: context.options,
            suites: context.suites,
            hooks: context.hooks,
            ...(row.kind === 'app' ? { report } : {}),
          }));
        }
        return started;
      },
      async stop() {
        if (!started) return;
        const handle = await started.catch(() => null);
        if (handle) await handle.stop();
      },
    };
  }

  function layerPlan(row, driver, entries, context) {
    const control = driver ? rowDriver(row, driver, { ...context, suites: entries.map((entry) => entry.suite) }) : null;
    const endedMessage = `the ${row.name} layer ended before this case reported`;

    if (row.kind === 'app') {
      const session = createCaseSession({
        cases: entries.flatMap((entry) => entry.suite.cases),
        endedMessage,
        start: async (report) => {
          const handle = await control.start(report);
          await handle.finished;
        },
      });
      entries.forEach((entry) => { entry.session = session; });
    } else {
      for (const entry of entries) {
        entry.session = hostSession({ ...entry.suite, cases: entry.suite.cases.map(context.stray.watch) }, {
          expect,
          defaultTimeout: config.defaultTimeout,
          extrasFrom: control ? async () => {
            const handle = await control.start();
            return (info) => handle.extras(info);
          } : undefined,
        });
      }
    }

    return { row, entries, stop: async () => {
      if (!control) return;
      try {
        await control.stop();
      } catch (e) {
        context.recordFailure({ id: `${row.name}#stop`, name: `${row.name} layer stop`, layer: row.name, error: e });
      }
    } };
  }

  // Register the layers with node:test and resolve once the plan's root suite ends.
  async function runOnNodeTest(layers, onEvent, recordFail) {
    const { run } = require('node:test');
    const id = `${process.pid}-${planCount += 1}`;
    const rootName = `omega-runner-${id}`;
    // A fresh file per run: node:test imports each file once per process.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-'));
    const bootstrap = path.join(dir, 'register.cjs');
    fs.writeFileSync(bootstrap, `require(${JSON.stringify(__filename)}).registerPlan(${JSON.stringify(id)});\n`);
    plans.set(id, { rootName, layers, onEvent });

    try {
      await new Promise((resolve) => {
        const stream = run({ files: [bootstrap], isolation: 'none' });
        // The stream itself ends only when the event loop drains; the root suite's
        // own event is the end of the run.
        const finish = (event) => {
          if (event.nesting !== 0) return;
          if (event.name !== rootName) {
            recordFail({ id: event.name, name: event.name, error: event.details.error || new Error('node:test failed outside the run') });
          }
          resolve();
        };
        stream.on('test:pass', finish);
        stream.on('test:fail', finish);
        stream.resume();
      });
    } finally {
      plans.delete(id);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async function execute(options, reporter, results, stray) {
    const fail = (fields) => recordFailure(results, reporter, fields);

    reporter.start();
    // defineCases only lets a spec through once a real runner is loading it.
    markRunnerActive();

    if (process.env.TEST_EXTENDED_MODE) {
      makeExtendedModeWarning(['Suites call REAL external services instead of skipping them.']).forEach((line) => reporter.note(line));
    }

    let wanted = rows;
    if (options.layer) {
      wanted = rows.filter((row) => row.name === options.layer);
      if (wanted.length === 0) {
        const known = rows.map((row) => row.name).join(', ');
        fail({ name: `--layer=${options.layer}`, error: new Error(`Unknown layer "${options.layer}" for ${config.framework} (layers: ${known})`) });
        return;
      }
    }

    const lanes = config.lanes || [];
    if (options.lane && !lanes.includes(options.lane)) {
      fail({ name: `--lane=${options.lane}`, error: new Error(`Unknown lane "${options.lane}" (lanes: ${lanes.join(', ') || 'none declared'})`) });
      return;
    }

    const { files, noMatch, invalid } = discoverSuites(config, options);
    invalid.forEach((bad) => reporter.note(`⚠ Unknown test scope prefix ignored: ${bad}`));
    if (noMatch) {
      results.noMatch = noMatch;
      reporter.note(noMatchMessage(noMatch));
    }
    if (files.length === 0) {
      if (!noMatch) reporter.note('No test files found.');
      return;
    }

    let hooks;
    try {
      const initRoots = config.roots.map((root) => ({ dir: path.resolve(config.projectRoot, root.dir), label: root.source }));
      hooks = await runInitSetups(initRoots, config.projectRoot, config.init || {});
    } catch (e) {
      if (!(e instanceof InitHookError)) throw e;
      fail({ id: e.file, file: e.file, name: path.relative(config.projectRoot, e.file), error: e });
      return;
    }

    const byLayer = new Map(rows.map((row) => [row.name, []]));
    for (const entry of files) {
      const loaded = loadSuite(entry, results, reporter, options.filter);
      if (loaded && loaded.suite.cases.length > 0) byLayer.get(loaded.suite.layer).push(loaded);
    }

    const context = { options, hooks, stray, recordFailure: fail };
    const layers = [];
    for (const row of wanted) {
      const entries = byLayer.get(row.name);
      if (entries.length === 0) continue;
      const driver = config.drivers && config.drivers[row.name];
      if (!driver && needsDriver(row)) {
        fail({ name: `${row.name} layer`, layer: row.name, error: new Error(`The ${row.name} layer needs a driver to run its suites, and this runner has none`) });
        continue;
      }
      layers.push(layerPlan(row, driver, entries, context));
    }
    if (layers.length === 0) return;

    const headed = new Set();
    const onEvent = (event, caseDef, entry, row) => {
      stray.settled(event.id);
      if (!headed.has(entry)) {
        headed.add(entry);
        reporter.suite(entry.label);
      }
      record(results, reporter, {
        id: event.id,
        source: entry.source,
        file: entry.file,
        suite: entry.label,
        name: event.name || caseDef.name,
        layer: row.name,
        status: event.status,
        durationMs: event.durationMs,
        ...(event.status === 'skip' && event.reason ? { reason: event.reason } : {}),
        ...(event.error ? { error: event.error } : {}),
      });
    };

    await runOnNodeTest(layers, onEvent, fail);
  }

  /**
   * Run the suites once.
   * @param {{targets?: string[], filter?: string, layer?: string, lane?: string, extended?: boolean, reporter?: string}} [options]
   * @returns {Promise<{passed: number, failed: number, skipped: number, noMatch: string|null, durationMs: number, tests: object[]}>}
   */
  async function run(options = {}) {
    const reporter = createReporter(options.reporter || 'pretty', { title: config.title });
    const restoreTee = attachLogFile.mark();
    if (config.log) attachLogFile(config.log);
    // In json mode stdout carries the one document; everything else goes to stderr.
    const restoreStdout = options.reporter === 'json' ? guardStdout({ strict: true }) : () => {};
    const stray = watchStrayErrors();

    const priorExtended = process.env.TEST_EXTENDED_MODE;
    if (options.extended) process.env.TEST_EXTENDED_MODE = 'true';

    const results = { passed: 0, failed: 0, skipped: 0, noMatch: null, durationMs: 0, tests: [] };
    const startTime = Date.now();
    try {
      await execute(options, reporter, results, stray);
    } finally {
      stray.stop();
      stray.loose.forEach((error, index) => recordFailure(results, reporter, {
        id: `uncaught#${index + 1}`,
        name: 'an error raised outside any running case (a timer or promise a case left behind)',
        error,
      }));
      results.durationMs = Date.now() - startTime;
      if (priorExtended === undefined) delete process.env.TEST_EXTENDED_MODE;
      else process.env.TEST_EXTENDED_MODE = priorExtended;
      restoreStdout();
      reporter.finish(results);
      restoreTee();
    }
    return results;
  }

  return { run };
}

module.exports = { createRunner, registerPlan };
