// Test runner — discovers + runs suites, reports framework-style.
//
// The runner CORE (discovery, suite/group/standalone execution, filtering, skip
// semantics, init hooks, reporting) is the shared @omegajs/devkit runner-core,
// vendored into dist/vendor/devkit at prepare time. This file is @omegajs/desktop's config:
// title, target alias, and the framework-specific layer glue.
//
// Layers:
//   - 'build'    runs in plain Node (runner core).
//   - 'main'     spawns Electron via runners/electron.js, runs in the main process.
//   - 'renderer' runs in a hidden BrowserWindow in the same spawned Electron process.
//   - 'boot'     spawns the consumer's actual built bundle and inspects the live manager.
//
// Electron / boot runners are lazy-loaded so a missing electron doesn't prevent build-layer
// tests from running. The layer callbacks below require() them only when those layers exist.

const path = require('path');
const chalk = require('chalk').default;

const { createRunner, SkipError, DISCOVERY_IGNORE } = require('@omegajs/devkit/test/runner-core');

const runner = createRunner({
  title: 'OMEGA Desktop Tests',
  packageName: '@omegajs/desktop',
  targetAlias: 'desktop',
  suitesDir: path.join(__dirname, 'suites'),
  frameworkTestDir: path.resolve(__dirname, '../../test'),
  bootDefaultTimeout: 15000,

  middleLayers: [
    {
      // Main + renderer share one spawned Electron process — main suites first, then a
      // hidden BrowserWindow takes over for renderer suites. This keeps a single
      // electron boot per `npx mgr test` invocation.
      layers: ['main', 'renderer'],
      run: async ({ byLayer, wants, options, results, projectRoot }) => {
        let runElectronTests;
        try {
          ({ runElectronTests } = require('./runners/electron.js'));
        } catch (e) {
          console.log(chalk.yellow(`    ○ main + renderer tests skipped (electron runner not available: ${e.message})`));
          const skipCount = (wants.main ? byLayer.main.length : 0)
            + (wants.renderer ? byLayer.renderer.length : 0);
          results.skipped += skipCount;
        }
        if (runElectronTests) {
          const counts = await runElectronTests({
            harnessEntry: path.join(__dirname, 'harness', 'main-entry.js'),
            suiteFiles:         wants.main     ? byLayer.main     : [],
            rendererSuiteFiles: wants.renderer ? byLayer.renderer : [],
            filter: options.filter,
            projectRoot,
          });
          results.passed  += counts.passed;
          results.failed  += counts.failed;
          results.skipped += counts.skipped;
        }
      },
    },
  ],

  boot: {
    // Spawn the consumer's actual built bundle and inspect the live manager (the core
    // aggregates boot tests into the flat `tests` list).
    run: async ({ tests, results, projectRoot }) => {
      let runBootTests;
      try {
        ({ runBootTests } = require('./runners/boot.js'));
      } catch (e) {
        console.log(chalk.yellow(`    ○ boot tests skipped (boot runner not available: ${e.message})`));
        results.skipped += tests.length;
        return;
      }

      console.log(chalk.cyan('    ⤷ boot tests (consumer bundle)'));

      const counts = await runBootTests({
        tests,
        projectRoot,
        frameworkDistRoot: path.resolve(__dirname, '..'),
      });
      results.passed  += counts.passed;
      results.failed  += counts.failed;
      results.skipped += counts.skipped;
    },
  },
});

module.exports = { run: runner.run, SkipError, DISCOVERY_IGNORE };
