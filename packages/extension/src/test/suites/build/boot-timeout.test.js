// Build-layer tests for the boot layer's timeout. A cold first-run Firebase
// service-worker init was observed at 20-30s, over the runner's 30000 default, so each
// boot suite declares `timeout: 45000` at suite level and its cases inherit it.

const fs = require('fs');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { normalizeSpec } = require('@omega.js/devkit/test/run-case');

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const VERB = path.join(__dirname, '..', '..', '..', 'commands', 'test.js');
const BOOT_SUITES = path.join(__dirname, '..', 'boot');

// Every framework boot suite, normalized as the runner normalizes it.
function bootSuites() {
  return fs.readdirSync(BOOT_SUITES)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => {
      const file = path.join(BOOT_SUITES, name);
      return { file, suite: normalizeSpec(require(file), { file }) };
    });
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'boot-layer timeout',
  tests: [
    {
      name: 'the runner default timeout is 30000 (the boot suites declare 45000, above the observed cold start)',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        ctx.expect(runnerConfig({ projectRoot: PACKAGE_ROOT, selfTest: true }).defaultTimeout).toBe(30000);
      },
    },
    {
      name: 'every framework boot suite declares timeout: 45000 at suite level',
      run: (ctx) => {
        const suites = bootSuites();
        ctx.expect(suites.length).toBeGreaterThan(0);
        for (const { file, suite } of suites) {
          ctx.expect(suite.timeout, path.basename(file)).toBe(45000);
        }
      },
    },
    {
      name: 'no framework boot case declares its own timeout, so each runs on its suite\'s',
      run: (ctx) => {
        for (const { file, suite } of bootSuites()) {
          // A standalone suite IS its one case, so its timeout is the case's too.
          const own = suite.type === 'standalone' ? suite.timeout : undefined;
          for (const caseDef of suite.cases) ctx.expect(caseDef.timeout, `${path.basename(file)}: ${caseDef.name}`).toBe(own);
        }
      },
    },
  ],
});
