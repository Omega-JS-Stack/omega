// Unit tests for src/test/runner-core.js — the shared framework test runner.
//
// Builds a real fixture "framework + consumer" tree under .temp/ and runs the core
// against it (process.cwd is temporarily pointed at the fixture consumer). No mocks —
// the fixture suites are real CommonJS modules the runner discovers and executes.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');
const { createRunner, SkipError, DISCOVERY_IGNORE, expect } = require('../src/test/runner-core');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Write a fixture tree: { 'relative/path.js': 'contents' } → root dir.
function makeTree(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

// Run fn with process.cwd() pointed at dir (runner discovery is cwd-relative).
async function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

// Silence the runner's console output during a run; return captured lines.
async function quiet(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.log = original;
  }
}

function makeConfig(root, overrides) {
  return {
    title: 'Fixture Framework Tests',
    packageName: 'fixture-framework',
    targetAlias: 'fix',
    suitesDir: path.join(root, 'framework', 'suites'),
    frameworkTestDir: path.join(root, 'framework', 'test'),
    middleLayers: [],
    boot: { run: async () => {} },
    ...overrides,
  };
}

// Every tree in this monorepo whose files a case runner discovers, with that
// runner's own discovery rule. `_`-prefixed files and directories are helpers
// and fixtures, never cases (DISCOVERY_IGNORE).
const CASE_ROOTS = [
  { label: 'backend',   dir: 'packages/backend/test',                extension: '.test.js' },
  { label: 'desktop',   dir: 'packages/desktop/src/test/suites',     extension: '.js' },
  { label: 'extension', dir: 'packages/extension/src/test/suites',   extension: '.js' },
  ...consumerCaseRoots(['backend', 'desktop', 'extension']),
];

// A consumer's own test/ under the same runner: the scaffold each framework
// copies into a new project, and every brand's copy in this monorepo.
function consumerCaseRoots(frameworks) {
  const brandsDir = path.join(__dirname, '..', '..', '..', 'brands');
  const brands = fs.existsSync(brandsDir) ? fs.readdirSync(brandsDir) : [];
  return frameworks.flatMap((framework) => [
    { label: `${framework} scaffold`, dir: `packages/${framework}/src/defaults/test`, extension: '.test.js' },
    ...brands.map((brand) => ({ label: `${brand} ${framework}`, dir: `brands/${brand}/targets/${framework}/test`, extension: '.test.js' })),
  ]);
}

function collectCaseFiles(dir, extension, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectCaseFiles(abs, extension, found);
    else if (entry.name.endsWith(extension)) found.push(abs);
  }
  return found;
}

module.exports = defineCases({
  type: 'group',
  description: 'runner-core',
  tests: [
    {
      name: 'runs standalone, suite, group, and array-form build tests with correct counts',
      run: async (ctx) => {
        const root = makeTree('runner-basic', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/standalone.js': `module.exports = { description: 'standalone passes', run: (ctx) => ctx.expect(1).toBe(1) };`,
          'consumer/test/suite.js': `module.exports = { type: 'suite', description: 'a suite', tests: [
      { name: 'one', run: (ctx) => ctx.expect(true).toBeTruthy() },
      { name: 'two', run: (ctx) => { ctx.state.x = 5; } },
      { name: 'three', run: (ctx) => ctx.expect(ctx.state.x).toBe(5) },   // state carries across suite
    ]};`,
          'consumer/test/group.js': `module.exports = [
      { name: 'g1', run: () => {} },
      { name: 'g2', run: () => { throw new Error('g2 fails'); } },
      { name: 'g3', run: () => {} },                                      // groups keep going after failure
    ];`,
          'consumer/test/_helper.js': `throw new Error('underscore files must not be discovered');`,
          'consumer/test/_fixtures/nested.js': `throw new Error('underscore dirs must not be discovered');`,
        });

        const runner = createRunner(makeConfig(root));
        const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

        ctx.expect(result.passed).toBe(6);  // standalone + 3 suite + g1 + g3
        ctx.expect(result.failed).toBe(1);  // g2
        ctx.expect(result.skipped).toBe(0);
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'suites stop on first failure and skip the remainder; groups do not',
      run: async (ctx) => {
        const root = makeTree('runner-stop', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/suite.js': `module.exports = { type: 'suite', description: 'stops', tests: [
      { name: 'ok', run: () => {} },
      { name: 'boom', run: () => { throw new Error('boom'); } },
      { name: 'never-a', run: () => {} },
      { name: 'never-b', run: () => {} },
    ]};`,
        });

        const runner = createRunner(makeConfig(root));
        const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

        ctx.expect(result.passed).toBe(1);
        ctx.expect(result.failed).toBe(1);
        ctx.expect(result.skipped).toBe(2); // never-a, never-b
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'skip: static flags, runtime ctx.skip(), and SkipError all count as skipped',
      run: async (ctx) => {
        const root = makeTree('runner-skip', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/skips.js': `module.exports = { type: 'group', description: 'skips', tests: [
      { name: 'static', skip: 'not today', run: () => { throw new Error('must not run'); } },
      { name: 'runtime', run: (ctx) => ctx.skip('runtime reason') },
      { name: 'passes', run: () => {} },
    ]};`,
          'consumer/test/whole-file-skip.js': `module.exports = { description: 'whole file', skip: true, run: () => { throw new Error('no'); } };`,
        });

        const runner = createRunner(makeConfig(root));
        const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

        ctx.expect(result.passed).toBe(1);
        ctx.expect(result.failed).toBe(0);
        ctx.expect(result.skipped).toBe(3); // static + runtime + whole-file
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'filter narrows by test/suite name',
      run: async (ctx) => {
        const root = makeTree('runner-filter', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/mixed.js': `module.exports = { type: 'group', description: 'mixed', tests: [
      { name: 'alpha-match', run: () => {} },
      { name: 'beta-other', run: () => { throw new Error('should be filtered out'); } },
    ]};`,
        });

        const runner = createRunner(makeConfig(root));
        const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ filter: 'alpha' })));

        ctx.expect(result.passed).toBe(1);
        ctx.expect(result.failed).toBe(0);
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'middle layers dispatch with byLayer/wants; boot aggregates flat test list',
      run: async (ctx) => {
        const root = makeTree('runner-layers', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/a-page.js': `module.exports = { layer: 'page', description: 'page suite', tests: [ { name: 'p1', run: () => {} } ] };`,
          'consumer/test/b-boot.js': `module.exports = { layer: 'boot', description: 'boot suite', timeout: 12345, tests: [
      { description: 'boots', inspect: async () => {} },
      { description: 'boots deeper', timeout: 777, inspect: async () => {} },
    ]};`,
          'consumer/test/c-build.js': `module.exports = { description: 'plain build', run: () => {} };`,
        });

        const seen = { middle: null, boot: null };
        const runner = createRunner(makeConfig(root, {
          bootDefaultTimeout: 15000,
          middleLayers: [{
            layers: ['page'],
            run: async ({ byLayer, wants, results }) => {
              seen.middle = { files: byLayer.page.length, wants: { ...wants } };
              results.passed += 1; // simulate the framework runner reporting one pass
            },
          }],
          boot: {
            run: async ({ tests, results }) => {
              seen.boot = tests.map((t) => ({ description: t.description, timeout: t.timeout }));
              results.passed += tests.length;
            },
          },
        }));

        const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

        ctx.expect(seen.middle).toEqual({ files: 1, wants: { page: true } });
        ctx.expect(seen.boot).toEqual([
          { description: 'boots', timeout: 12345 },          // suite-level timeout inherited
          { description: 'boots deeper', timeout: 777 },     // test-level timeout wins
        ]);
        ctx.expect(result.passed).toBe(1 + 1 + 2); // build + middle + boot
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'bootBound moves a file to the boot lane and hands it to boot.run whole',
      run: async (ctx) => {
        const root = makeTree('runner-bootbound', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/bound.js': `module.exports = { type: 'group', layer: 'page', view: 'main', description: 'view suite', tests: [
      { name: 'v1', run: () => {} },
      { name: 'v2', run: () => {} },
    ]};`,
          'consumer/test/plain.js': `module.exports = { layer: 'page', description: 'page suite', tests: [ { name: 'p1', run: () => {} } ] };`,
        });

        const seen = { middle: null, boot: null };
        const runner = createRunner(makeConfig(root, {
          bootBound: (mod) => mod.layer === 'page' && typeof mod.view === 'string',
          middleLayers: [{
            layers: ['page'],
            run: async ({ byLayer }) => { seen.middle = byLayer.page.map((file) => path.basename(file)); },
          }],
          boot: {
            run: async ({ tests, suites }) => {
              seen.boot = {
                tests:  tests.map((t) => t.description),
                suites: suites.map(({ file, mod }) => ({
                  file:  path.basename(file),
                  view:  mod.view,
                  names: mod.tests.map((t) => t.name),
                })),
              };
            },
          },
        }));

        await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

        // The bound file left the middle layer entirely...
        ctx.expect(seen.middle).toEqual(['plain.js']);
        // ...and reached boot.run WHOLE, never flattened into the inspect list.
        ctx.expect(seen.boot).toEqual({
          tests:  [],
          suites: [{ file: 'bound.js', view: 'main', names: ['v1', 'v2'] }],
        });

        // --layer=page must not reach it (the suite needs the boot lane's built app);
        // --layer=boot must.
        seen.middle = null; seen.boot = null;
        await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ layer: 'page' })));
        ctx.expect(seen.middle).toEqual(['plain.js']);
        ctx.expect(seen.boot).toBe(null);

        seen.middle = null; seen.boot = null;
        await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ layer: 'boot' })));
        ctx.expect(seen.middle).toBe(null);
        ctx.expect(seen.boot.suites).toEqual([{ file: 'bound.js', view: 'main', names: ['v1', 'v2'] }]);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'the filter narrows a boot-bound suite by test name, and drops it when nothing survives',
      run: async (ctx) => {
        const root = makeTree('runner-bootbound-filter', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/bound.js': `module.exports = { type: 'group', layer: 'page', view: 'main', description: 'view suite', tests: [
      { name: 'renders the heading', run: () => {} },
      { name: 'wires the button',    run: () => {} },
    ]};`,
        });

        let boot = null;
        const runner = createRunner(makeConfig(root, {
          bootBound: (mod) => mod.layer === 'page' && typeof mod.view === 'string',
          boot: { run: async ({ suites }) => { boot = suites.map(({ mod }) => mod.tests.map((t) => t.name)); } },
        }));

        await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ filter: 'heading' })));
        ctx.expect(boot).toEqual([['renders the heading']]);

        // Nothing matches: the suite is dropped, and with no inspect tests either
        // boot.run is never called (no build, no Electron boot for an empty run).
        boot = null;
        await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ filter: 'nothing-matches-this' })));
        ctx.expect(boot).toBe(null);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'a standalone boot-bound file reaches boot.run as one test named for its description, filter or not',
      run: async (ctx) => {
        const root = makeTree('runner-bootbound-standalone', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/bound.js': `module.exports = { layer: 'page', view: 'main', description: 'standalone view', run: () => {} };`,
        });

        let boot = null;
        const runner = createRunner(makeConfig(root, {
          bootBound: (mod) => mod.layer === 'page' && typeof mod.view === 'string',
          boot: { run: async ({ suites }) => { boot = suites.map(({ mod }) => mod.tests.map((t) => t.name)); } },
        }));

        await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));
        ctx.expect(boot).toEqual([['standalone view']]);

        boot = null;
        await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ filter: 'standalone' })));
        ctx.expect(boot).toEqual([['standalone view']]);

        boot = null;
        await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ filter: 'nothing-matches-this' })));
        ctx.expect(boot).toBe(null);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'C5 scoping: bare = project only; framework:/alias:/full: select sources',
      run: async (ctx) => {
        const root = makeTree('runner-target', {
          'framework/suites/fw.js': `module.exports = { description: 'framework test', run: () => {} };`,
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/proj.js': `module.exports = { description: 'project test', run: () => {} };`,
        });

        const runner = createRunner(makeConfig(root));

        // Bare consumer run = PROJECT tests only (never drags the framework suite in).
        const bare = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));
        ctx.expect(bare.result.passed).toBe(1);

        const projectOnly = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target: 'project:' })));
        ctx.expect(projectOnly.result.passed).toBe(1);

        // 'brand:' is the explicit project alias.
        const brandAlias = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target: 'brand:' })));
        ctx.expect(brandAlias.result.passed).toBe(1);

        // The framework suite is an explicit choice: targetAlias ('fix:'), 'framework:', 'omega:'.
        for (const target of ['fix:', 'framework:', 'omega:']) {
          const frameworkOnly = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target })));
          ctx.expect(frameworkOnly.result.passed, target).toBe(1);
        }

        // 'full:' = both sources.
        const both = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target: 'full:' })));
        ctx.expect(both.result.passed).toBe(2);
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'framework boot/ suites are excluded for consumers but run in self-test mode',
      run: async (ctx) => {
        const root = makeTree('runner-selftest', {
          'framework/suites/build/ok.js': `module.exports = { description: 'fw build', run: () => {} };`,
          'framework/suites/boot/fixture.js': `module.exports = { layer: 'boot', description: 'fw boot', inspect: async () => {} };`,
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'selftest/package.json': JSON.stringify({ name: 'fixture-framework' }),
        });

        let bootCalls = 0;
        const config = makeConfig(root, {
          boot: { run: async ({ tests, results }) => { bootCalls += 1; results.passed += tests.length; } },
        });

        // Consumer running the framework suite explicitly (C5: bare no longer
        // reaches it): boot/ stays excluded from discovery entirely.
        const consumer = await quiet(() => withCwd(path.join(root, 'consumer'), () => createRunner(config).run({ target: 'framework:' })));
        ctx.expect(consumer.result.passed).toBe(1);
        ctx.expect(bootCalls).toBe(0);

        // Self-test (cwd package name === config.packageName): boot/ suite runs.
        const selftest = await quiet(() => withCwd(path.join(root, 'selftest'), () => createRunner(config).run()));
        ctx.expect(selftest.result.passed).toBe(2);
        ctx.expect(bootCalls).toBe(1);

        // A consumer asking for the boot layer explicitly is told WHY nothing ran
        // instead of getting silence (#56 item 17b's residual friction).
        const bootAsk = await quiet(() => withCwd(path.join(root, 'consumer'), () => createRunner(config).run({ target: 'framework:', layer: 'boot' })));
        ctx.expect(bootAsk.result.passed).toBe(0);
        ctx.expect(bootAsk.lines.some((line) => line.includes('self-test only')), 'the boot-layer silence carries its explanation').toBeTruthy();
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'every case file in the monorepo exports through defineCases (#630)',
      run: (ctx) => {
        const monorepoRoot = path.join(__dirname, '..', '..', '..');
        const unwrapped = [];
        let checked = 0;

        for (const root of CASE_ROOTS) {
          const dir = path.join(monorepoRoot, root.dir);
          if (!fs.existsSync(dir)) continue;   // vendored/partial checkout — nothing to guard
          for (const file of collectCaseFiles(dir, root.extension)) {
            checked += 1;
            const source = fs.readFileSync(file, 'utf8');
            if (!/module\.exports\s*=\s*defineCases\(/.test(source)) {
              unwrapped.push(path.relative(monorepoRoot, file));
            }
          }
        }

        ctx.expect(checked > 0, 'the guard must actually walk case files').toBeTruthy();
        ctx.expect(unwrapped, `case files that would report a hollow pass under \`node --test\` — wrap them:\n  module.exports = defineCases({ ... });\n${unwrapped.join('\n')}`).toEqual([]);
      },
    },

    {
      name: 'exports SkipError, DISCOVERY_IGNORE, and the shared expect',
      run: (ctx) => {
        ctx.expect(typeof SkipError).toBe('function');
        ctx.expect(Array.isArray(DISCOVERY_IGNORE)).toBeTruthy();
        ctx.expect(typeof expect).toBe('function');
        ctx.expect(expect).toBe(require('../src/test/expect.js'));
      },
    },

    {
      name: 'a scoped target matches nested suites in slash form on every platform (#337)',
      run: async (ctx) => {
        // path.relative answers with the OS separator, so on Windows a framework
        // suite at build\runner.test.js never matched `desktop:build/runner` and
        // the run reported "No test files found". The grammar is slash-spelled
        // everywhere; a backslash-spelled target from a Windows shell matches too.
        const root = makeTree('runner-scoped-sep', {
          'framework/suites/build/runner.test.js': `module.exports = { description: 'fw runner', run: () => {} };`,
          'framework/suites/build/other.test.js':  `module.exports = { description: 'fw other', run: () => {} };`,
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
        });
        const runner = createRunner(makeConfig(root));

        for (const target of ['fix:build/runner', 'fix:build\\runner', 'fix:build/runner.test.js']) {
          const scoped = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target })));
          ctx.expect(scoped.result.passed, target).toBe(1);
          ctx.expect(!scoped.lines.some((line) => line.includes('No test files found')), target).toBeTruthy();
        }

        const dir = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target: 'fix:build/' })));
        ctx.expect(dir.result.passed).toBe(2);
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'a named target that matches no file is a no-match run, not a green zero (#814)',
      run: async (ctx) => {
        // `omega test renderer/typo` used to print "No test files found.", "0 passing"
        // and exit 0 — a typo'd path, or a renamed suite, ran silently green.
        const root = makeTree('runner-no-match', {
          'framework/suites/build/fw.js': `module.exports = { description: 'framework test', run: () => {} };`,
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
          'consumer/test/build/proj.js': `module.exports = { description: 'project test', run: () => {} };`,
        });
        const runner = createRunner(makeConfig(root));
        const at = (options) => quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run(options)));

        // Every spelling of a path target: bare, project-scoped, framework-scoped, both.
        for (const target of ['build/typo', 'project:build/typo', 'fix:build/typo', 'full:build/typo']) {
          const { result, lines } = await at({ target });
          ctx.expect(result.noMatch, target).toBe(target);
          ctx.expect(result.passed, target).toBe(0);
          ctx.expect(!lines.some((line) => line.includes('No test files found')), target).toBeTruthy();
        }

        // A target that selects a file is untouched...
        const hit = await at({ target: 'build/proj' });
        ctx.expect(hit.result.noMatch).toBe(null);
        ctx.expect(hit.result.passed).toBe(1);

        // ...and so is a partial hit: `full:` reaching ONE source is a real selection.
        const partial = await at({ target: 'full:build/proj' });
        ctx.expect(partial.result.noMatch).toBe(null);
        ctx.expect(partial.result.passed).toBe(1);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'a run that named no file stays green with nothing to run (#814)',
      run: async (ctx) => {
        // The other half of the rule: nothing was asked for BY NAME, so an empty
        // project (or a bare source prefix) is still an exit-0 run.
        const root = makeTree('runner-no-tests', {
          'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
        });
        const runner = createRunner(makeConfig(root));
        const at = (options) => quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run(options)));

        const bare = await at({});
        ctx.expect(bare.result.noMatch).toBe(null);
        ctx.expect(bare.result.passed + bare.result.failed).toBe(0);
        ctx.expect(bare.lines.some((line) => line.includes('No test files found'))).toBeTruthy();

        for (const target of ['project:', 'fix:', 'full:']) {
          const prefix = await at({ target });
          ctx.expect(prefix.result.noMatch, target).toBe(null);
        }

        fs.rmSync(root, { recursive: true, force: true });
      },
    },
  ],
});
