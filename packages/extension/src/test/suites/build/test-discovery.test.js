// Build-layer tests for what the test verb discovers. The rule lives in devkit
// (`@omega.js/devkit/test/discovery`); these pin the verb's runner config roots
// and run that discovery over the config: `_` files and dirs never load, and
// the framework's boot/ suites, every boot-layer suite among them, join only on a self-test.

const fs = require('fs');
const os = require('os');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SUITES_DIR = path.resolve(__dirname, '..');
const VERB = path.join(__dirname, '..', '..', '..', 'commands', 'test.js');

const posix = (rel) => rel.split(path.sep).join('/');

// A consumer directory with a package.json and the given files under test/.
function makeConsumer(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-discovery-test-'));
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
  description: 'test discovery: the verb\'s roots and the devkit rule',
  tests: [
    {
      name: 'the runner config has one framework root at the suites folder and one project root at <project>/test',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        const dir = makeConsumer([]);

        try {
          const config = runnerConfig({ projectRoot: dir, selfTest: false });
          const framework = config.roots.filter((root) => root.source === 'framework');
          const project = config.roots.filter((root) => root.source === 'project');

          ctx.expect(config.roots.length).toBe(2);
          ctx.expect(framework.length).toBe(1);
          ctx.expect(path.resolve(dir, framework[0].dir)).toBe(SUITES_DIR);
          ctx.expect(project.length).toBe(1);
          ctx.expect(path.resolve(dir, project[0].dir)).toBe(path.join(dir, 'test'));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'discovery over the config skips _ files and _ dirs at any depth',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        const { discoverSuites } = require('@omega.js/devkit/test/discovery');
        const dir = makeConsumer([
          'build/config.test.js',
          'page/runner.test.js',
          'boot/nested/deep.test.js',
          '_init.js',
          'page/_helper.test.js',
          '_helpers/harness.test.js',
          '_fixtures/packages/runner/mod/index.test.js',
          'boot/_private/util.test.js',
        ]);

        try {
          const { files } = discoverSuites(runnerConfig({ projectRoot: dir, selfTest: false }), { targets: ['project:'] });
          ctx.expect(files.map((file) => posix(file.rel))).toEqual([
            'boot/nested/deep.test.js',
            'build/config.test.js',
            'page/runner.test.js',
          ]);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the framework boot/ suites join only on a self-test',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        const { discoverSuites } = require('@omega.js/devkit/test/discovery');
        const bootRels = (config) => discoverSuites(config, { targets: ['framework:'] }).files
          .filter((file) => file.source === 'framework')
          .map((file) => posix(file.rel))
          .filter((rel) => rel.startsWith('boot/'));
        const dir = makeConsumer([]);

        try {
          ctx.expect(bootRels(runnerConfig({ projectRoot: PACKAGE_ROOT, selfTest: true }))).toContain('boot/extension-loads.test.js');
          ctx.expect(bootRels(runnerConfig({ projectRoot: dir, selfTest: false }))).toEqual([]);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      // The self-test-only rule is a folder rule, so a built-view suite outside boot/ reaches a consumer's build.
      name: 'a consumer framework: run discovers no framework suite on the boot layer',
      run: (ctx) => {
        const { runnerConfig } = require(VERB);
        const { discoverSuites } = require('@omega.js/devkit/test/discovery');
        const { normalizeSpec } = require('@omega.js/devkit/test/run-case');
        const dir = makeConsumer([]);

        try {
          const onBoot = discoverSuites(runnerConfig({ projectRoot: dir, selfTest: false }), { targets: ['framework:'] }).files
            .filter((file) => normalizeSpec(require(file.file), { file: file.file }).layer === 'boot')
            .map((file) => posix(file.rel));
          ctx.expect(onBoot).toEqual([]);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
});
