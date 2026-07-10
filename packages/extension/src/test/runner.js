// Test runner — discovers + runs suites, reports OMEGA-Extension-style.
//
// The runner CORE (discovery, suite/group/standalone execution, filtering, skip
// semantics, init hooks, reporting) is the shared @omega.js/devkit runner-core,
// vendored into dist/vendor/devkit at prepare time. This file is the extension framework's config:
// title, target alias, and the framework-specific layer glue.
//
// Layers:
//   - 'build'      runs in plain Node (runner core).
//   - 'background' spawns Chromium via runners/chromium.js, runs in the extension's service worker.
//   - 'view'       runs in a Chromium tab loading the harness extension's popup/options/sidepanel HTML.
//   - 'boot'       spawns Chromium with the consumer's actual built `dist/` loaded as unpacked.
//
// Chromium / boot runners are lazy-loaded so a missing puppeteer doesn't prevent build-layer
// tests from running. The layer callbacks below require() them only when those layers exist.

const path = require('path');
const chalk = require('chalk').default;

const { createRunner, SkipError, DISCOVERY_IGNORE } = require('@omega.js/devkit/test/runner-core');

const runner = createRunner({
  title: 'OMEGA Extension Tests',
  packageName: '@omega.js/extension',
  targetAlias: 'extension',
  suitesDir: path.join(__dirname, 'suites'),
  frameworkTestDir: path.resolve(__dirname, '../../test'),
  bootDefaultTimeout: 20000,

  middleLayers: [
    {
      // Background + view share one Chromium instance — background suites first, then view
      // suites in tabs against the harness extension.
      layers: ['background', 'view'],
      run: async ({ byLayer, wants, options, results, projectRoot }) => {
        let runChromiumTests;
        try {
          ({ runChromiumTests } = require('./runners/chromium.js'));
        } catch (e) {
          console.log(chalk.yellow(`    ○ background + view tests skipped (chromium runner not available: ${e.message})`));
          const skipCount = (wants.background ? byLayer.background.length : 0)
            + (wants.view ? byLayer.view.length : 0);
          results.skipped += skipCount;
        }
        if (runChromiumTests) {
          const counts = await runChromiumTests({
            backgroundSuiteFiles: wants.background ? byLayer.background : [],
            viewSuiteFiles:       wants.view       ? byLayer.view       : [],
            filter: options.filter,
            projectRoot,
            frameworkDistRoot: path.resolve(__dirname, '..'),
          });
          results.passed  += counts.passed;
          results.failed  += counts.failed;
          results.skipped += counts.skipped;
        }
      },
    },
  ],

  boot: {
    // Spawn Chromium with the consumer's actual built `dist/` and inspect the live
    // extension surface (the core aggregates boot tests into the flat `tests` list).
    run: async ({ tests, results, projectRoot }) => {
      let runBootTests;
      try {
        ({ runBootTests } = require('./runners/boot.js'));
      } catch (e) {
        console.log(chalk.yellow(`    ○ boot tests skipped (boot runner not available: ${e.message})`));
        results.skipped += tests.length;
        return;
      }

      console.log(chalk.cyan('    ⤷ boot tests (consumer dist/)'));

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
