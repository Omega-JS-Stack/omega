// The extension's config for the shared devkit runner-core: title, target alias, and the
// layer glue. 'build' runs in Node; 'background' and 'view' share one Chromium with the
// harness extension; 'boot' loads the project's packaged extension, and also carries the
// view suites that name a project view (`view: '<name>'`).
// The Chromium and boot runners are required lazily, so a missing puppeteer never stops
// the build layer.

const path = require('path');
const chalk = require('chalk').default;

const { createRunner, SkipError, DISCOVERY_IGNORE } = require('@omega.js/devkit/test/runner-core');
const { FRAMEWORK_IDS } = require('@omega.js/devkit/test/scope');
const { suiteTestCount } = require('./runners/helpers.js');

// Per-test default for the boot layer's inspect(). Sized for the FIRST run after
// a fresh build, where the extension's Firebase service worker initializes from
// cold — observed at 20-30s, which sat right on top of the old 20000 and made a
// consumer's boot test flake until it passed its own timeout
// ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)). A boot test that
// is genuinely stuck still fails, just later; a slow first boot passes.
const BOOT_DEFAULT_TIMEOUT = 45000;

const runner = createRunner({
  title: 'OMEGA Extension Tests',
  packageName: '@omega.js/extension',
  targetAlias: 'extension',
  frameworkAliases: FRAMEWORK_IDS['@omega.js/extension'],
  suitesDir: path.join(__dirname, 'suites'),
  frameworkTestDir: path.resolve(__dirname, '../../test'),
  bootDefaultTimeout: BOOT_DEFAULT_TIMEOUT,

  // A view suite that names a project view rides the BOOT lane instead of a harness page:
  // only that lane loads the project's built extension, and the view lives there. The
  // runner core hands such a file to boot.run whole, as `suites`.
  bootBound: (mod) => mod.layer === 'view' && typeof mod.view === 'string',

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
    // `suites` are the boot-bound view suites, run in the project's own built views.
    run: async ({ tests, suites, results, projectRoot }) => {
      let runBootTests;
      try {
        ({ runBootTests } = require('./runners/boot.js'));
      } catch (e) {
        console.log(chalk.yellow(`    ○ boot tests skipped (boot runner not available: ${e.message})`));
        results.skipped += tests.length + suites.reduce((n, s) => n + suiteTestCount(s.mod), 0);
        return;
      }

      console.log(chalk.cyan('    ⤷ boot tests (consumer dist/)'));

      const counts = await runBootTests({
        tests,
        suites,
        projectRoot,
        frameworkDistRoot: path.resolve(__dirname, '..'),
        defaultTimeout: BOOT_DEFAULT_TIMEOUT,
      });
      results.passed  += counts.passed;
      results.failed  += counts.failed;
      results.skipped += counts.skipped;
    },
  },
});

module.exports = { run: runner.run, SkipError, DISCOVERY_IGNORE, BOOT_DEFAULT_TIMEOUT };
