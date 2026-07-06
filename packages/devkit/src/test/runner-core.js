// Shared test-runner core for the OMEGA frameworks — discovery, suite/group/standalone
// execution, filtering, skip semantics, init hooks, and reporting. Extracted from UJM's
// runner (the canonical 3-layer build/page/boot model); BXM/EM/UJM differ only in title,
// package name, CLI target alias, and their special layers — all injected via config.
//
// Test-definition forms supported (see each framework's test/index.js for docs):
//   - Standalone:  module.exports = { layer, description, run, cleanup, timeout, skip };
//   - Suite:       module.exports = { type: 'suite', layer, description, tests: [...], cleanup, stopOnFailure };
//   - Group:       module.exports = { type: 'group', layer, description, tests: [...], cleanup };
//   - Array form:  module.exports = [ {name, run}, ... ];   // implicit group
//
// Suites stop on first failure (sequential, share state). Groups run all tests regardless.
//
// createRunner(config) config surface:
//   title              — heading printed at the top of a run ('Browser Extension Manager Tests')
//   packageName        — framework npm name; cwd package === this ⇒ framework self-test mode
//                        (framework boot/ suites only run in self-test mode — they assert on
//                        the framework's own fixture consumer)
//   targetAlias        — framework-specific target prefix ('ujm' | 'bxm' | 'em'); 'mgr:',
//                        'framework:' and 'project:' are universal
//   suitesDir          — the framework's built default suites dir (dist/test/suites)
//   frameworkTestDir   — the framework repo's own test/ dir (for its _init.js hook)
//   middleLayers       — ordered special layers between 'build' and 'boot':
//                        [{ layers: ['background','view'], run: async ({ byLayer, wants,
//                           options, results, projectRoot }) => void }]
//                        The callback owns runner loading, skip messaging, and results
//                        mutation — framework glue stays framework-side.
//   bootDefaultTimeout — per-test default for boot-layer inspect() (UJM/BXM 20000, EM 15000)
//   boot               — { run: async ({ tests, options, results, projectRoot }) => void }
//                        Called with the aggregated flat boot test list (never empty).
//                        Owns runner loading, skip messaging, label, and results mutation.

const path = require('path');
const glob = require('glob').globSync;
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const expect = require('./assert.js');

class SkipError extends Error {
  constructor(reason) { super(reason); this.name = 'SkipError'; }
}

// Glob ignore patterns implementing the "underscore = not a suite" convention:
// `_`-prefixed FILES (e.g. test/_init.js) and everything under a `_`-prefixed
// DIRECTORY at any depth (helpers, fixtures — e.g. test/_helpers/harness.js).
const DISCOVERY_IGNORE = ['**/_*.js', '**/_*/**'];

function createRunner(config) {
  const middleLayers = config.middleLayers || [];
  const layerNames = ['build', ...middleLayers.flatMap((m) => m.layers), 'boot'];
  const bootDefaultTimeout = config.bootDefaultTimeout || 20000;

  async function run(options = {}) {
    options.layer    = options.layer    || 'all';
    options.target   = options.target   || null;
    options.filter   = options.filter   || null;
    options.reporter = options.reporter || 'pretty';

    const startTime = Date.now();

    const sources = discoverTestFiles(options.target);

    console.log('');
    console.log(chalk.bold(`  ${config.title}`));

    // Run the optional test/_init.js setup() hooks (framework + consumer) ONCE,
    // before any suite. There is no cleanup hook — tests clean up after themselves.
    await runInitSetups();

    const results = { passed: 0, failed: 0, skipped: 0, tests: [] };

    if (sources.framework.length > 0) {
      console.log('');
      console.log(chalk.bold('  Framework Tests'));
      await runSource(sources.framework, 'framework', options, results);
    }

    if (sources.project.length > 0) {
      console.log('');
      console.log(chalk.bold('  Project Tests'));
      await runSource(sources.project, 'project', options, results);
    }

    if (sources.framework.length === 0 && sources.project.length === 0) {
      console.log(chalk.gray('  No test files found.'));
    }

    reportResults(results, Date.now() - startTime);

    return results;
  }

  async function runSource(files, source, options, results) {
    // Partition by layer (peek at module.exports without invoking run functions).
    const byLayer = {};
    layerNames.forEach((name) => { byLayer[name] = []; });
    for (const file of files) {
      const layer = peekLayer(file) || 'build';
      if (byLayer[layer]) byLayer[layer].push(file);
    }

    // Build layer — run inline.
    if ((options.layer === 'all' || options.layer === 'build') && byLayer.build.length > 0) {
      for (const file of byLayer.build) {
        await runBuildFile(file, source, options, results);
      }
    }

    // Special layers (framework glue owns runner loading + results mutation).
    for (const middle of middleLayers) {
      const wants = {};
      let any = false;
      for (const name of middle.layers) {
        wants[name] = (options.layer === 'all' || options.layer === name) && byLayer[name].length > 0;
        any = any || wants[name];
      }
      if (any) {
        await middle.run({ byLayer, wants, options, results, projectRoot: process.cwd() });
      }
    }

    // Boot layer — aggregate then hand to framework glue.
    if ((options.layer === 'all' || options.layer === 'boot') && byLayer.boot.length > 0) {
      await runBootLayer(byLayer.boot, source, options, results);
    }
  }

  async function runBootLayer(files, source, options, results) {
    // Aggregate every boot test (whether standalone or inside a suite) into one flat list.
    // The boot harness runs them sequentially in a single process to keep startup cost
    // amortized. State doesn't carry across boot tests.
    const tests = [];

    for (const file of files) {
      let mod;
      try {
        delete require.cache[require.resolve(file)];
        mod = require(file);
      } catch (e) {
        const rel = relativizePath(file, source);
        console.log(chalk.red(`    ✗ ${rel}`));
        console.log(chalk.red(`      Failed to load: ${e.message}`));
        results.failed += 1;
        continue;
      }

      if (Array.isArray(mod))                      mod = { type: 'group', tests: mod };
      if (Array.isArray(mod.tests))                {/* multi-test */ }
      else if (typeof mod.inspect === 'function')  mod = { tests: [mod] };

      const baseDescription = mod.description || relativizePath(file, source);

      for (const t of (mod.tests || [])) {
        if (typeof t.inspect !== 'function') continue;
        if (options.filter && !(t.description || baseDescription).includes(options.filter)) continue;
        tests.push({
          description: t.description || baseDescription,
          timeout:     t.timeout || mod.timeout || bootDefaultTimeout,
          inspect:     t.inspect,
        });
      }
    }

    if (tests.length === 0) return;

    await config.boot.run({ tests, options, results, projectRoot: process.cwd() });
  }

  function peekLayer(file) {
    try {
      delete require.cache[require.resolve(file)];
      const mod = require(file);
      if (Array.isArray(mod)) return 'build';
      return mod.layer || 'build';
    } catch (e) {
      return null;
    }
  }

  async function runBuildFile(file, source, options, results) {
    let mod;
    try {
      delete require.cache[require.resolve(file)];
      mod = require(file);
    } catch (e) {
      const rel = relativizePath(file, source);
      console.log(chalk.red(`    ✗ ${rel}`));
      console.log(chalk.red(`      Failed to load: ${e.message}`));
      results.failed += 1;
      return;
    }

    if (Array.isArray(mod)) {
      mod = { type: 'group', tests: mod };
    }

    const rel = relativizePath(file, source);

    if (mod.skip) {
      const reason = typeof mod.skip === 'string' ? mod.skip : '';
      console.log(chalk.yellow(`    ○ ${mod.description || rel}`) + chalk.gray(` (skipped${reason ? ': ' + reason : ''})`));
      const count = Array.isArray(mod.tests) ? mod.tests.length : 1;
      results.skipped += count;
      return;
    }

    if (mod.type === 'suite' || mod.type === 'group' || Array.isArray(mod.tests)) {
      await runSuite(mod, rel, options, results);
    } else {
      await runStandalone(mod, rel, options, results);
    }
  }

  async function runSuite(suite, rel, options, results) {
    const description = suite.description || rel;
    const isGroup = suite.type === 'group';
    const stopOnFailure = !isGroup && suite.stopOnFailure !== false;
    const tests = suite.tests || [];

    console.log(chalk.cyan(`    ⤷ ${description}`));

    const state = {};

    for (let i = 0; i < tests.length; i += 1) {
      const t = tests[i];
      const name = t.name || `step-${i + 1}`;

      if (options.filter && !name.includes(options.filter) && !description.includes(options.filter)) continue;

      if (t.skip) {
        const reason = typeof t.skip === 'string' ? t.skip : '';
        console.log(chalk.yellow(`      ○ ${name}`) + chalk.gray(` (skipped${reason ? ': ' + reason : ''})`));
        results.skipped += 1;
        continue;
      }

      const ctx = createContext({ state, layer: suite.layer || 'build' });
      const timeout = t.timeout || suite.timeout || 30000;

      const start = Date.now();
      try {
        await Promise.race([
          Promise.resolve(t.run(ctx)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), timeout)),
        ]);
        const duration = Date.now() - start;
        console.log(chalk.green(`      ✓ ${name}`) + chalk.gray(` (${duration}ms)`));
        results.passed += 1;

        if (t.cleanup) {
          try { await t.cleanup(ctx); } catch (e) {
            console.log(chalk.yellow(`        ⚠ Cleanup failed: ${e.message}`));
          }
        }
      } catch (e) {
        const duration = Date.now() - start;
        if (e.name === 'SkipError') {
          console.log(chalk.yellow(`      ○ ${name}`) + chalk.gray(` (skipped: ${e.message})`));
          results.skipped += 1;
          continue;
        }
        console.log(chalk.red(`      ✗ ${name}`) + chalk.gray(` (${duration}ms)`));
        console.log(chalk.red(`        ${e.message || e}`));
        results.failed += 1;

        if (stopOnFailure) {
          const remaining = tests.length - i - 1;
          if (remaining > 0) {
            console.log(chalk.yellow(`        Skipping ${remaining} remaining test(s) in suite`));
            results.skipped += remaining;
          }
          break;
        }
      }
    }

    if (suite.cleanup) {
      try {
        const ctx = createContext({ state, layer: suite.layer || 'build' });
        await suite.cleanup(ctx);
      } catch (e) {
        console.log(chalk.yellow(`      ⚠ Suite cleanup failed: ${e.message}`));
      }
    }
  }

  async function runStandalone(mod, rel, options, results) {
    const description = mod.description || rel;
    if (options.filter && !description.includes(options.filter)) return;

    const ctx = createContext({ state: {}, layer: mod.layer || 'build' });
    const timeout = mod.timeout || 30000;

    const start = Date.now();
    try {
      await Promise.race([
        Promise.resolve(mod.run(ctx)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), timeout)),
      ]);
      const duration = Date.now() - start;
      console.log(chalk.green(`    ✓ ${description}`) + chalk.gray(` (${duration}ms)`));
      results.passed += 1;

      if (mod.cleanup) {
        try { await mod.cleanup(ctx); } catch (e) {
          console.log(chalk.yellow(`      ⚠ Cleanup failed: ${e.message}`));
        }
      }
    } catch (e) {
      const duration = Date.now() - start;
      if (e.name === 'SkipError') {
        console.log(chalk.yellow(`    ○ ${description}`) + chalk.gray(` (skipped: ${e.message})`));
        results.skipped += 1;
        return;
      }
      console.log(chalk.red(`    ✗ ${description}`) + chalk.gray(` (${duration}ms)`));
      console.log(chalk.red(`      ${e.message || e}`));
      results.failed += 1;
    }
  }

  function createContext({ state, layer }) {
    return {
      expect,
      state,
      layer,
      skip(reason) { throw new SkipError(reason || 'skipped at runtime'); },
    };
  }

  function reportResults(results, durationMs) {
    const total = results.passed + results.failed + results.skipped;
    console.log('');
    console.log('  ' + chalk.bold('Results'));
    console.log(`    ${chalk.green(`${results.passed} passing`)}`);
    if (results.failed > 0)  console.log(`    ${chalk.red(`${results.failed} failing`)}`);
    if (results.skipped > 0) console.log(`    ${chalk.yellow(`${results.skipped} skipped`)}`);
    console.log(chalk.gray(`\n    Total: ${total} tests in ${durationMs}ms\n`));
  }

  // Parse a positional test target into a source filter + path part.
  // Source prefixes (standardized across all OMEGA frameworks):
  //   'mgr:' / '<targetAlias>:' / 'framework:' → framework tests  ('mgr:' is the universal alias)
  //   'project:'                               → project tests
  //   no prefix                                → both sources, matched by path
  function parseTarget(target) {
    if (!target) {
      return { source: null, pathPart: null };
    }

    const m = String(target).match(new RegExp(`^(project|mgr|${config.targetAlias}|framework):(.*)$`));
    if (m) {
      const source = m[1] === 'project' ? 'project' : 'framework';
      return { source, pathPart: m[2] || null };
    }

    return { source: null, pathPart: target };
  }

  // Narrow a source's file list by the parsed target. A source-prefixed target
  // excludes the other source entirely; the path part (if any) matches by
  // relative path prefix.
  function filterBySource(source, files, sourceFilter, pathPart) {
    if (sourceFilter && sourceFilter !== source) {
      return [];
    }
    if (!pathPart) {
      return files;
    }

    return files.filter((file) => {
      const rel = relativizePath(file, source);
      const relNoExt = rel.replace(/\.js$/, '').replace(/\.test$/, '');
      const partNoExt = pathPart.replace(/\.js$/, '').replace(/\.test$/, '');
      return rel.startsWith(pathPart)
        || relNoExt === partNoExt
        || relNoExt.startsWith(partNoExt + '/')
        || rel.includes(pathPart);
    });
  }

  function discoverTestFiles(target) {
    const { source: sourceFilter, pathPart } = parseTarget(target);

    const framework = [];
    const project = [];

    // Detect whether we're running the framework's own self-tests, vs a consumer
    // who installed it and is running their own tests. Used below to filter the
    // boot/ layer of framework suites — those target the framework's internal
    // fixture consumer, so they only make sense when the framework tests itself.
    const isFrameworkSelfTest = (() => {
      try {
        const cwdPkg = require(path.join(process.cwd(), 'package.json'));
        return cwdPkg.name === config.packageName;
      } catch (_) { return false; }
    })();

    // Framework default suites. For consumers, we exclude boot/ — those suites
    // assert on the framework's own fixture consumer and would fail noisily when
    // run against a real consumer's build. Consumers write their own boot tests
    // under <cwd>/test/boot/.
    if (jetpack.exists(config.suitesDir)) {
      const ignore = [...DISCOVERY_IGNORE];
      if (!isFrameworkSelfTest) ignore.push('boot/**');
      glob('**/*.js', { cwd: config.suitesDir, ignore }).sort().forEach((rel) => {
        framework.push(path.join(config.suitesDir, rel));
      });
    }

    // Consumer project suites — CWD/test/**/*.js. Skip when running from inside the
    // framework's own dist tree (where consumer-tests-dir === framework-tests-parent).
    // Excludes `_`-prefixed files and directories (see DISCOVERY_IGNORE).
    const projectTestsDir = path.join(process.cwd(), 'test');
    if (jetpack.exists(projectTestsDir) && projectTestsDir !== path.dirname(config.suitesDir)) {
      glob('**/*.js', { cwd: projectTestsDir, ignore: [...DISCOVERY_IGNORE] }).sort().forEach((rel) => {
        project.push(path.join(projectTestsDir, rel));
      });
    }

    return {
      framework: filterBySource('framework', framework, sourceFilter, pathPart),
      project:   filterBySource('project',   project,   sourceFilter, pathPart),
    };
  }

  function relativizePath(file, source) {
    if (source === 'framework') {
      return path.relative(config.suitesDir, file);
    }
    return path.relative(path.join(process.cwd(), 'test'), file);
  }

  // ---------------------------------------------------------------------------
  // test/_init.js — pre-test lifecycle hook (setup only)
  //
  // Mirrors the backend framework's hook so all frameworks share one shape.
  // A project may add `<cwd>/test/_init.js` exporting a FUNCTION —
  // `module.exports = (ctx) => ({ setup })` — called with `{ projectRoot }` and
  // returning an object with an async `setup({ projectRoot })` that runs ONCE
  // before any suite (e.g. to scaffold a fixture file the boot layer needs).
  // There is no `cleanup` hook: tests clean up after themselves.
  // ---------------------------------------------------------------------------

  function loadInit(testDir, label) {
    const initPath = path.join(testDir, '_init.js');

    if (!jetpack.exists(initPath)) {
      return {};
    }

    try {
      const fn = require(initPath);

      if (typeof fn !== 'function') {
        console.log(chalk.red(`  ✗ ${label} test/_init.js must export a function: module.exports = (ctx) => ({ ... })`));
        return {};
      }

      const mod = fn({ projectRoot: process.cwd() });
      return mod && typeof mod === 'object' ? mod : {};
    } catch (e) {
      console.log(chalk.red(`  ✗ Failed to load ${label} test/_init.js: ${e.message}`));
      return {};
    }
  }

  async function runInitSetups() {
    const projectTestsDir = path.join(process.cwd(), 'test');

    const hooks = [
      loadInit(config.frameworkTestDir, 'framework'),
      loadInit(projectTestsDir, 'project'),
    ];

    const setups = hooks.filter((h) => typeof h.setup === 'function').map((h) => h.setup);

    for (const setup of setups) {
      process.stdout.write(chalk.gray('  Running test/_init.js setup... '));
      try {
        await setup({ projectRoot: process.cwd() });
        console.log(chalk.green('✓'));
      } catch (e) {
        console.log(chalk.red(`✗ (${e.message})`));
      }
    }
  }

  return { run, relativizePath };
}

module.exports = { createRunner, SkipError, DISCOVERY_IGNORE, expect };
