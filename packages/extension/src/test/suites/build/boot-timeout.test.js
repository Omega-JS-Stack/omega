// Build-layer tests for the boot layer's per-test timeout default (#262).
//
// A boot test drives the consumer's REAL extension, and the first run after a
// fresh build pays the cold Firebase service-worker init — observed at 20-30s,
// right on top of the old 20000ms default, so a consumer's boot test only
// passed once they declared a timeout of their own. The default is the fix; a
// consumer-side override is not.
//
// The cost is a Chromium cold start, so this asserts the CONTRACT (the number
// and the wiring that carries it) rather than re-running the boot layer.

const path = require('path');

const RUNNER = path.join(__dirname, '..', '..', 'runner.js');
const BOOT_SUITES = path.join(__dirname, '..', 'boot');

// The observed worst case the default has to clear (#262).
const OBSERVED_FIRST_RUN_SW_INIT_MS = 30000;

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'boot-layer timeout default',
  tests: [
    {
      name: 'the default clears a cold first-run Firebase SW init with room to spare',
      run: (ctx) => {
        const { BOOT_DEFAULT_TIMEOUT } = require(RUNNER);
        ctx.expect(BOOT_DEFAULT_TIMEOUT).toBe(45000);
        ctx.expect(BOOT_DEFAULT_TIMEOUT > OBSERVED_FIRST_RUN_SW_INIT_MS).toBe(true);
      },
    },
    {
      name: 'a boot test that declares no timeout is handed the default, through the real runner core',
      run: async (ctx) => {
        const fs = require('fs');
        const os = require('os');
        const { createRunner } = require('@omega.js/devkit/test/runner-core');
        const { BOOT_DEFAULT_TIMEOUT } = require(RUNNER);

        // A real suites dir with one real boot test, run through the real core:
        // the boot glue is where a test's timeout is resolved, and this is the
        // number a fresh-build run actually races against.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-boot-timeout-'));
        fs.mkdirSync(path.join(tmp, 'suites', 'boot'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'suites', 'boot', 'no-timeout.test.js'),
          `module.exports = { layer: 'boot', description: 'no timeout declared', inspect: async () => {} };\n`);

        let handed = null;
        const runner = createRunner({
          title: 'boot timeout probe',
          packageName: '@omega.js/extension',
          targetAlias: 'extension',
          suitesDir: path.join(tmp, 'suites'),
          frameworkTestDir: path.join(tmp, 'framework-tests'),
          bootDefaultTimeout: BOOT_DEFAULT_TIMEOUT,
          boot: { run: async ({ tests }) => { handed = tests; } },
        });

        // The probe runner reports like any run — its report is not THIS run's,
        // so it stays out of the output.
        const realLog = console.log;
        console.log = () => {};

        try {
          await runner.run({ layer: 'boot' });
          ctx.expect(handed.length).toBe(1);
          ctx.expect(handed[0].timeout).toBe(BOOT_DEFAULT_TIMEOUT);
        } finally {
          console.log = realLog;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'no framework boot test declares a timeout — a fresh build runs on the default',
      run: (ctx) => {
        const fs = require('fs');

        // The point of raising the default: a boot suite needs no timeout of
        // its own to survive a cold first run.
        for (const file of fs.readdirSync(BOOT_SUITES).filter((name) => name.endsWith('.test.js'))) {
          const mod = require(path.join(BOOT_SUITES, file));
          const tests = Array.isArray(mod) ? mod : (mod.tests || [mod]);
          ctx.expect(mod.timeout).toBe(undefined);
          tests.forEach((t) => ctx.expect(t.timeout).toBe(undefined));
        }
      },
    },
  ],
};
