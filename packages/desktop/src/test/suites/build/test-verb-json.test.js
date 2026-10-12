// Build-layer tests for the test verb end to end: `node dist/cli-run.js test
// --reporter=json` on the bundled fixture prints one JSON document holding every
// row, and the boot driver's partition sends a view suite to its view. A nested
// run skips the spawn, so a run of this file inside the spawned one never recurses.

const path = require('path');
const { spawn } = require('child_process');
const defineCases = require('@omega.js/devkit/test/define-cases');

const PKG = path.join(__dirname, '..', '..', '..', '..');
const NESTED = 'OMEGA_TEST_NESTED';

// Run the verb from the package root and collect both streams whole.
function runVerb(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: PKG, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'the test verb under --reporter=json on the bundled fixture',
  tests: [
    {
      name: 'case-160 a standalone boot spec without run is refused, naming the file',
      run: (ctx) => {
        const { normalizeSpec } = require('@omega.js/devkit/test/run-case');
        const spec = { layer: 'boot', description: 'an old boot case', inspect: async () => {} };

        ctx.expect(() => normalizeSpec(spec, { file: 'boot/old-form.test.js' })).toThrow('boot/old-form.test.js');
      },
    },
    {
      name: 'case-160 a boot case in a tests list without run is refused, naming the file',
      run: (ctx) => {
        const { normalizeSpec } = require('@omega.js/devkit/test/run-case');
        const spec = { type: 'group', layer: 'boot', tests: [{ description: 'an old boot case', inspect: async () => {} }] };

        ctx.expect(() => normalizeSpec(spec, { file: 'boot/old-form.test.js' })).toThrow('boot/old-form.test.js');
      },
    },
    {
      name: 'case-162 --reporter=json prints one JSON document holding a main, a renderer and a boot entry, and no summary line',
      timeout: 240000,
      run: async (ctx) => {
        if (process.env[NESTED]) ctx.skip('a nested run never spawns the verb again');

        // CI declines the child's log tee, so it never truncates this run's logs/test.log.
        const env = { ...process.env, [NESTED]: '1', CI: 'true' };
        delete env.OMEGA_TEST_BOOT_PROJECT;
        delete env.NODE_TEST_CONTEXT;

        // case-16 reaches one case of every app row: 163 on main, 164 on renderer, 165 on boot.
        const { code, stdout, stderr } = await runVerb([path.join('dist', 'cli-run.js'), 'test', '--reporter=json', '--filter=case-16'], env);
        let report;
        try {
          report = JSON.parse(stdout);
        } catch (e) {
          throw new Error(`stdout is not one JSON document (exit ${code}): ${e.message}\nstdout head: ${stdout.slice(0, 600)}\nstderr tail: ${stderr.slice(-600)}`);
        }

        ctx.expect(stdout.includes('"summary"')).toBe(false);
        ctx.expect(Array.isArray(report.tests)).toBe(true);
        const layers = new Set(report.tests.map((entry) => entry.layer));
        for (const layer of ['main', 'renderer', 'boot']) ctx.expect(layers.has(layer), `a ${layer} entry`).toBe(true);
      },
    },
    {
      name: 'case-160 the boot partition puts a view suite and a standalone view spec in the view set, a plain boot suite in the main set',
      run: (ctx) => {
        const { normalizeSpec } = require('@omega.js/devkit/test/run-case');
        const { partitionBootSuites } = require('../../runners/boot.js');
        const viewSuite = normalizeSpec({
          type: 'group',
          layer: 'boot',
          view: 'main',
          tests: [{ name: 'reads the view', run: (ctx) => ctx.expect(ctx.page).toBe(window) }],
        }, { file: 'boot/view-suite.test.js' });
        const standalone = normalizeSpec({
          layer: 'boot',
          view: 'main',
          description: 'a standalone view spec',
          run: (ctx) => ctx.expect(ctx.page).toBe(window),
        }, { file: 'boot/view-standalone.test.js' });
        const plain = normalizeSpec({
          type: 'group',
          layer: 'boot',
          tests: [{ name: 'reads the app', run: (ctx) => ctx.expect(ctx.omega).toBeDefined() }],
        }, { file: 'boot/plain.test.js' });

        const { mainSuites, viewSuites } = partitionBootSuites([viewSuite, standalone, plain]);
        ctx.expect(viewSuites.map((suite) => suite.file)).toEqual(['boot/view-suite.test.js', 'boot/view-standalone.test.js']);
        ctx.expect(mainSuites.map((suite) => suite.file)).toEqual(['boot/plain.test.js']);
      },
    },
  ],
});
