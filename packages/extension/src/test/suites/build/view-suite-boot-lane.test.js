// Build-layer test for the view suites that name a project view, driven through
// the REAL boot runner and Chromium with the fixture consumer loaded: a suite
// naming a built view runs inside that page, and one naming a view the project
// never built fails every test instead of passing on some other page.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const BOOT_RUNNER = path.join(__dirname, '..', '..', 'runners', 'boot.js');
const FIXTURE_DIST = path.join(__dirname, '..', '..', 'fixtures', 'consumer-extension', 'dist');

module.exports = defineCases({
  layer: 'build',
  description: 'view suites naming a view ride the boot lane into the project\'s built page',
  timeout: 60000,
  run: async (ctx) => {
    const { runBootTests } = require(BOOT_RUNNER);
    const suites = [
      {
        file: 'built.test.js',
        mod: {
          type: 'group',
          layer: 'view',
          view: 'popup',
          description: 'a built view',
          tests: [{ name: 'runs in views/popup/index.html', run: async (ctx) => { ctx.expect(location.pathname).toBe('/views/popup/index.html'); } }],
        },
      },
      {
        file: 'unbuilt.test.js',
        mod: {
          type: 'group',
          layer: 'view',
          view: 'sidepanel',
          description: 'an unbuilt view',
          tests: [
            { name: 'never runs (1)', run: async () => {} },
            { name: 'never runs (2)', run: async () => {} },
          ],
        },
      },
    ];

    const previous = process.env.OMEGA_TEST_BOOT_DIR;
    process.env.OMEGA_TEST_BOOT_DIR = FIXTURE_DIST;
    try {
      const counts = await runBootTests({ tests: [], suites, projectRoot: FIXTURE_DIST, defaultTimeout: 30000 });
      ctx.expect(counts).toEqual({ passed: 1, failed: 2, skipped: 0 });
    } finally {
      if (previous === undefined) delete process.env.OMEGA_TEST_BOOT_DIR;
      else process.env.OMEGA_TEST_BOOT_DIR = previous;
    }
  },
});
