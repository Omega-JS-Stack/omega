// Build-layer test for the boot suites that name a project view, driven through
// the verb's REAL boot driver and Chromium with the fixture consumer loaded: a suite
// naming a built view runs inside that page, and one naming a view the project
// never built fails every case naming the view instead of passing on some other page.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { normalizeSpec } = require('@omega.js/devkit/test/run-case');

const VERB = path.join(__dirname, '..', '..', '..', 'commands', 'test.js');
const FIXTURE_ROOT = path.join(__dirname, '..', '..', 'fixtures', 'consumer-extension');
const FIXTURE_DIST = path.join(FIXTURE_ROOT, 'dist');

const BUILT = {
  type: 'group',
  layer: 'boot',
  view: 'popup',
  description: 'a built view',
  tests: [{ name: 'runs in views/popup/index.html', run: async (ctx) => { ctx.expect(ctx.page.location.pathname).toBe('/views/popup/index.html'); } }],
};

const UNBUILT = {
  type: 'group',
  layer: 'boot',
  view: 'sidepanel',
  description: 'an unbuilt view',
  tests: [
    { name: 'never runs (1)', run: async (ctx) => { ctx.expect(true).toBe(true); } },
    { name: 'never runs (2)', run: async (ctx) => { ctx.expect(true).toBe(true); } },
  ],
};

module.exports = defineCases({
  layer: 'build',
  description: 'boot suites naming a view run in the project\'s built page',
  timeout: 60000,
  run: async (ctx) => {
    const { runnerConfig } = require(VERB);
    const driver = runnerConfig({ projectRoot: FIXTURE_ROOT, selfTest: false }).drivers.boot;
    const suites = [
      normalizeSpec(BUILT, { file: path.join(FIXTURE_ROOT, 'built.test.js') }),
      normalizeSpec(UNBUILT, { file: path.join(FIXTURE_ROOT, 'unbuilt.test.js') }),
    ];
    const events = [];

    const previous = { dir: process.env.OMEGA_TEST_BOOT_DIR, project: process.env.OMEGA_TEST_BOOT_PROJECT };
    process.env.OMEGA_TEST_BOOT_DIR = FIXTURE_DIST;
    process.env.OMEGA_TEST_BOOT_PROJECT = FIXTURE_ROOT;
    try {
      const handle = await driver.start({ projectRoot: FIXTURE_ROOT, options: {}, suites, hooks: [], report: (event) => { events.push(event); } });
      try {
        await handle.finished;
      } finally {
        await handle.stop();
      }
    } finally {
      for (const [key, value] of [['OMEGA_TEST_BOOT_DIR', previous.dir], ['OMEGA_TEST_BOOT_PROJECT', previous.project]]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    const byId = Object.fromEntries(events.map((event) => [event.id, event]));
    ctx.expect(events.length).toBe(3);
    ctx.expect(byId[suites[0].cases[0].id].status).toBe('pass');
    for (const caseDef of suites[1].cases) {
      ctx.expect(byId[caseDef.id].status).toBe('fail');
      ctx.expect(byId[caseDef.id].error.message).toContain('sidepanel');
    }
  },
});
