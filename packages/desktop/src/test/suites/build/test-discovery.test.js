// Build-layer tests for the test verb's runner config and the discovery devkit
// runs over it: the roots, the drivers, the `_` convention, and the framework
// boot/ suites joining a self-test only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

// This file runs from <pkg>/dist/test/suites/build: the suites folder is its parent.
const SUITES = path.join(__dirname, '..');
const PKG = path.join(__dirname, '..', '..', '..', '..');
const VERB = path.join(__dirname, '..', '..', '..', 'commands', 'test.js');

// A consumer directory: a package.json that is not the framework's, plus test files.
function makeConsumer(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-discovery-test-')));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'discovery-fixture' }));
  for (const rel of files) {
    const file = path.join(dir, 'test', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'module.exports = {};\n');
  }
  return dir;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'test verb runner config and discovery',
  tests: [
    {
      name: 'case-158 the verb runner config: desktop, 30s, three drivers, the suites folder, no project root on a self-test and <target>/test on a target',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        const config = runnerConfig({ projectRoot: PKG, selfTest: true });

        ctx.expect(config.framework).toBe('desktop');
        ctx.expect(config.defaultTimeout).toBe(30000);
        ctx.expect(Object.keys(config.drivers).sort()).toEqual(['boot', 'main', 'renderer']);
        for (const driver of Object.values(config.drivers)) ctx.expect(typeof driver.start).toBe('function');

        const framework = config.roots.filter((root) => root.source === 'framework');
        ctx.expect(framework.length).toBe(1);
        ctx.expect(path.resolve(PKG, framework[0].dir)).toBe(SUITES);
        ctx.expect(config.roots.filter((root) => root.source === 'project')).toEqual([]);

        const dir = makeConsumer([]);
        try {
          const project = runnerConfig({ projectRoot: dir, selfTest: false }).roots.filter((root) => root.source === 'project');
          ctx.expect(project.length).toBe(1);
          ctx.expect(path.resolve(dir, project[0].dir)).toBe(path.join(dir, 'test'));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'discovery over the verb config skips _ files and _ dirs at any depth',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        const { discoverSuites } = require('@omega.js/devkit/test/discovery');
        const dir = makeConsumer([
          'build/config.test.js',
          'main/runner.test.js',
          'boot/nested/deep.test.js',
          '_init.test.js',
          'main/_helper.test.js',
          '_fixtures/runner-stack.test.js',
          '_fixtures/packages/runner/mod/index.test.js',
          'boot/_private/util.test.js',
        ]);

        try {
          const { files } = discoverSuites(runnerConfig({ projectRoot: dir, selfTest: false }), { targets: ['project:'] });
          ctx.expect(files.map((entry) => entry.rel.split(path.sep).join('/'))).toEqual([
            'boot/nested/deep.test.js',
            'build/config.test.js',
            'main/runner.test.js',
          ]);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the framework boot/ suites join a self-test only; a consumer keeps its own boot/',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        const { discoverSuites } = require('@omega.js/devkit/test/discovery');
        const frameworkBoot = (files) => files.filter((entry) => entry.source === 'framework' && entry.rel.startsWith(`boot${path.sep}`));

        const self = discoverSuites(runnerConfig({ projectRoot: PKG, selfTest: true }), {});
        ctx.expect(frameworkBoot(self.files).length).toBeGreaterThan(0);

        const dir = makeConsumer(['boot/app.test.js']);
        try {
          const consumer = discoverSuites(runnerConfig({ projectRoot: dir, selfTest: false }), { targets: ['full:'] });
          ctx.expect(frameworkBoot(consumer.files)).toEqual([]);
          ctx.expect(consumer.files.some((entry) => entry.source === 'framework')).toBe(true);
          ctx.expect(consumer.files.filter((entry) => entry.source === 'project').map((entry) => entry.rel)).toEqual([path.join('boot', 'app.test.js')]);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
});
