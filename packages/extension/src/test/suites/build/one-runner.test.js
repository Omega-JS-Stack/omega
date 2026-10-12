// Build-layer tests for the extension verb on the one runner: the runner config
// it builds, the in-page payload engine its app rows ship (devkit's run-case.js
// and expect.js with a serialized suite, no require and no eval), and the one
// JSON document a `--reporter=json` run prints.

const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { EVENT_PREFIX } = require('@omega.js/devkit/test/events');

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SUITES_DIR = path.resolve(__dirname, '..');
const VERB = path.join(__dirname, '..', '..', '..', 'commands', 'test.js');
const CHROMIUM = path.join(__dirname, '..', '..', 'runners', 'chromium.js');
const CLI = path.join(PACKAGE_ROOT, 'dist', 'cli-run.js');

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'the extension verb on the one runner',
  tests: [
    {
      name: 'case-166 the runner config: framework, default timeout, three drivers, one framework root, no project root on a self-test and <target>/test on a target',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        const config = runnerConfig({ projectRoot: PACKAGE_ROOT, selfTest: true });
        const framework = config.roots.filter((root) => root.source === 'framework');

        ctx.expect(config.framework).toBe('extension');
        ctx.expect(config.packageName).toBe('@omega.js/extension');
        ctx.expect(config.defaultTimeout).toBe(30000);
        ctx.expect(Object.keys(config.drivers).sort()).toEqual(['background', 'boot', 'view']);
        ctx.expect(framework.length).toBe(1);
        ctx.expect(path.resolve(PACKAGE_ROOT, framework[0].dir)).toBe(SUITES_DIR);
        ctx.expect(config.roots.filter((root) => root.source === 'project')).toEqual([]);

        const target = path.join(os.tmpdir(), 'extension-runner-config-target');
        const project = runnerConfig({ projectRoot: target, selfTest: false }).roots.filter((root) => root.source === 'project');
        ctx.expect(project.length).toBe(1);
        ctx.expect(path.resolve(target, project[0].dir)).toBe(path.join(target, 'test'));
      },
    },
    {
      name: 'case-167 the payload engine reports pass, fail with its stack, and skip by id over the console',
      run: async (ctx) => {
        const { normalizeSpec } = require('@omega.js/devkit/test/run-case');
        const suite = normalizeSpec({
          type: 'group',
          layer: 'view',
          description: 'payload probe',
          tests: [
            { name: 'passes', run: async (ctx) => { ctx.expect(ctx.page).toBe(window); } },
            { name: 'fails', run: async (ctx) => { ctx.expect(1).toBe(2); } },
            { name: 'skips', run: async (ctx) => { ctx.skip('not in this page'); } },
          ],
        }, { file: path.join(SUITES_DIR, 'view', 'payload-probe.test.js') });
        const { suitePayload } = require(CHROMIUM);
        const payload = suitePayload(suite, { layer: 'view' });

        const lines = [];
        const sandbox = { window: {}, setTimeout, clearTimeout, console: { log: (line) => lines.push(String(line)), warn: () => {} } };
        await vm.runInContext(payload, vm.createContext(sandbox));

        const events = lines.filter((line) => line.startsWith(EVENT_PREFIX)).map((line) => JSON.parse(line.slice(EVENT_PREFIX.length)));
        const byId = Object.fromEntries(events.map((event) => [event.id, event]));
        const [pass, fail, skip] = suite.cases.map((caseDef) => byId[caseDef.id]);

        ctx.expect(events.length).toBe(3);
        ctx.expect(pass.status).toBe('pass');
        ctx.expect(fail.status).toBe('fail');
        ctx.expect(fail.error.name).toBe('AssertionError');
        ctx.expect(fail.error.message.length).toBeGreaterThan(0);
        ctx.expect(fail.error.stack).toBeTypeOf('string');
        ctx.expect(skip.status).toBe('skip');
        ctx.expect(skip.reason).toBe('not in this page');
        ctx.expect(payload.includes('require(')).toBe(false);
        ctx.expect(payload.includes('eval(')).toBe(false);
      },
    },
    {
      name: 'case-169 --reporter=json on the bundled fixture prints one JSON document with background, view and boot entries',
      timeout: 240000,
      run: (ctx) => {
        if (process.env.OMEGA_TEST_NESTED) ctx.skip('nested run');

        // CI declines the child's log tee, so it never truncates this run's logs/test.log.
        const env = { ...process.env, OMEGA_TEST_NESTED: '1', CI: 'true' };
        delete env.OMEGA_TEST_BOOT_PROJECT;
        delete env.NODE_TEST_CONTEXT;
        const child = spawnSync(process.execPath, [CLI, 'test', '--reporter=json', '--filter=case-17'], {
          cwd: PACKAGE_ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        });

        const report = JSON.parse(child.stdout);
        const layers = new Set(report.tests.map((entry) => entry.layer));
        ctx.expect(child.stdout.includes('"event":"summary"')).toBe(false);
        ctx.expect(layers.has('background')).toBe(true);
        ctx.expect(layers.has('view')).toBe(true);
        ctx.expect(layers.has('boot')).toBe(true);
        ctx.expect(report.failed, child.stderr.slice(-2000)).toBe(0);

        // The background row's runtime skip arrives with its reason.
        const skipped = report.tests.find((entry) => entry.layer === 'background' && entry.status === 'skip');
        ctx.expect(skipped.reason).toBe('why');
      },
    },
  ],
});
