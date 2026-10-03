/**
 * Contract cases for scripts/convert-suites.js, the converter that rewrites a
 * plain node:test file into a defineCases group. Each case stages a fixture from
 * convert-fixtures/ in a temp dir, runs the converter as a child, and checks the
 * written file against the hand-written expectation beside the fixture.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const ROOT = path.join(__dirname, '..');
const CONVERTER = path.join(__dirname, 'convert-suites.js');
const FIXTURES = path.join(__dirname, 'convert-fixtures');
const INSPECT = path.join(FIXTURES, 'inspect-spec.js');
const CLI = path.join(ROOT, 'packages', 'devkit', 'src', 'test', 'cli.js');
const MONITORING = path.join(ROOT, 'packages', 'monitoring');
const MONITORING_COPY = path.join(ROOT, '.temp', 'convert-case-113');
const SPAWN_TIMEOUT = 60000;

// The run source's parameter list is exactly `ctx`, in arrow, function or method form.
const CTX_PARAM = /^(?:async\s*)?(?:(?:function\b[^(]*|[\w$]+\s*)?\(\s*ctx\s*\)|ctx\s*=>)/;

// A child starts clean of any inherited node:test context or extended
// mode; NODE_PATH lets a converted copy in the OS temp dir resolve @omega.js/devkit.
function childEnv(extra) {
  const env = { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules'), ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.TEST_EXTENDED_MODE;
  return env;
}

function node(args, { cwd = ROOT, env = {} } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: childEnv(env),
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  return { status: result.status, stdout, stderr, output: `${stdout}${stderr}` };
}

function convert(args) {
  return node([CONVERTER, ...args]);
}

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

// Copy a fixture to <temp>/test/<as>; the temp dir goes once the case settles.
function stage(ctx, fixture, as) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-convert-'));
  ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test', as);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, fixture), file);
  return { dir, file };
}

// Layout is the converter's own; a snippet is compared with all whitespace removed.
function squash(text) {
  return text.replace(/\s+/g, '');
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// The spec a converted file exports, read in a child so its cases never register here.
function inspect(ctx, file) {
  const result = node([INSPECT, file]);
  ctx.expect(result.status, `inspecting ${file}:\n${result.output}`).toBe(0);
  return JSON.parse(result.stdout);
}

function checkCase(ctx, got, want) {
  const label = `case "${want.name}"`;
  ctx.expect(got.nested, `${label} is a case, not a nested group`).toBe(false);
  ctx.expect(got.run, `${label} has a run function`).toBeTypeOf('string');
  ctx.expect(got.run, `${label} takes ctx`).toMatch(CTX_PARAM);
  const body = squash(got.run);
  for (const snippet of want.has || []) ctx.expect(body, label).toContain(squash(snippet));
  for (const [snippet, count] of Object.entries(want.count || {})) {
    ctx.expect(occurrences(body, squash(snippet)), `${label}: ${snippet}`).toBe(count);
  }
  for (const pattern of want.runLacks || []) ctx.expect(got.run, label).not.toMatch(new RegExp(pattern));
  if ('skip' in want) ctx.expect(got.skip, `${label} skip`).toBe(want.skip);
  if ('timeout' in want) ctx.expect(got.timeout, `${label} timeout`).toBe(want.timeout);
}

/**
 * Convert case-<id>.input.js and check it against case-<id>.expected.json: one
 * group named for the file, its cases in order, each body's snippets, its keys,
 * and the imports and asserts the file text must not hold.
 */
function convertAndCheck(ctx, id) {
  const expected = JSON.parse(readFixture(`case-${id}.expected.json`));
  const { dir, file } = stage(ctx, `case-${id}.input.js`, `case-${id}.test.js`);
  const result = convert([file]);
  ctx.expect(result.status, `converter output:\n${result.output}`).toBe(0);

  const text = fs.readFileSync(file, 'utf8');
  ctx.expect(text).toMatch(/\bdefineCases\(/);
  for (const pattern of expected.fileLacks || []) ctx.expect(text, 'file text').not.toMatch(new RegExp(pattern));
  for (const snippet of expected.fileHas || []) ctx.expect(squash(text), 'file text').toContain(squash(snippet));

  const spec = inspect(ctx, file);
  ctx.expect(spec.type).toBe('group');
  ctx.expect(spec.description).toBe(expected.description);
  ctx.expect(spec.tests.map((t) => t.name)).toEqual(expected.tests.map((t) => t.name));
  expected.tests.forEach((want, index) => checkCase(ctx, spec.tests[index], want));
  if (expected.setup) ctx.expect(spec.setup, 'setup').toBeTypeOf('string');
  if (expected.cleanup) ctx.expect(spec.cleanup, 'cleanup').toBeTypeOf('string');
  return { dir, file, expected };
}

// The counts a `node --test` tap run prints in its closing comment block.
function tapCounts(output) {
  const read = (key) => {
    const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  return { tests: read('tests'), pass: read('pass'), skipped: read('skipped') };
}

function testFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort().map((name) => path.join(dir, name));
}

module.exports = defineCases({
  type: 'group',
  description: 'convert-suites: plain node:test to defineCases',
  tests: [
    {
      name: 'case-103 one strictEqual test becomes a defineCases group with one ctx.expect case',
      run: (ctx) => {
        convertAndCheck(ctx, '103');
      },
    },

    {
      name: 'case-104 every assertion-map method converts, single and multi-line, the message riding on expect',
      run: (ctx) => {
        convertAndCheck(ctx, '104');
      },
    },

    {
      name: 'case-105 throws, rejects and doesNotThrow keep their matcher on toThrow',
      run: (ctx) => {
        convertAndCheck(ctx, '105');
      },
    },

    {
      name: 'case-106 the case parameter becomes ctx, t.after becomes ctx.after, every t reference renamed',
      run: (ctx) => {
        convertAndCheck(ctx, '106');
      },
    },

    {
      name: 'case-107 before/after become setup/cleanup and beforeEach/afterEach wrap every case',
      timeout: 60000,
      run: (ctx) => {
        const { dir, expected } = convertAndCheck(ctx, '107');
        const eventsFile = path.join(dir, 'events.json');
        const result = node([CLI, '--reporter=json', `--log=${path.join(dir, 'test.log')}`], {
          cwd: dir,
          env: { CONVERT_EVENTS_FILE: eventsFile },
        });
        ctx.expect(result.status, `runner output:\n${result.output}`).toBe(0);
        const report = JSON.parse(result.stdout);
        ctx.expect(report.passed).toBe(2);
        ctx.expect(report.failed).toBe(0);
        ctx.expect(JSON.parse(fs.readFileSync(eventsFile, 'utf8'))).toEqual(expected.events);
      },
    },

    {
      name: 'case-108 nested describe blocks flatten into one group, names joined with " > "',
      run: (ctx) => {
        convertAndCheck(ctx, '108');
      },
    },

    {
      name: 'case-109 skip and timeout options become case keys',
      run: (ctx) => {
        convertAndCheck(ctx, '109');
      },
    },

    {
      name: 'case-110 a t.mock file is refused by name and left unchanged',
      run: (ctx) => {
        const { file } = stage(ctx, 'case-110.input.js', 'case-110.test.js');
        const result = convert([file]);
        ctx.expect(result.status, `converter output:\n${result.output}`).not.toBe(0);
        ctx.expect(result.output).toContain('case-110.test.js');
        ctx.expect(result.output).toContain('t.mock');
        ctx.expect(fs.readFileSync(file, 'utf8')).toBe(readFixture('case-110.input.js'));
      },
    },

    {
      name: 'case-111 a converted file is left byte-identical and --check names only an unconverted one',
      run: (ctx) => {
        const converted = stage(ctx, 'case-111.input.js', 'case-111.test.js').file;
        const again = convert([converted]);
        ctx.expect(again.status, `converter output:\n${again.output}`).toBe(0);
        ctx.expect(fs.readFileSync(converted, 'utf8')).toBe(readFixture('case-111.input.js'));
        const checkConverted = convert(['--check', converted]);
        ctx.expect(checkConverted.status, `--check output:\n${checkConverted.output}`).toBe(0);

        const plain = stage(ctx, 'case-111-plain.input.js', 'case-111-plain.test.js').file;
        const checkPlain = convert(['--check', plain]);
        ctx.expect(checkPlain.status, `--check output:\n${checkPlain.output}`).toBe(1);
        ctx.expect(checkPlain.output).toContain('case-111-plain.test.js');
        ctx.expect(fs.readFileSync(plain, 'utf8')).toBe(readFixture('case-111-plain.input.js'));

        ctx.expect(convert([plain]).status).toBe(0);
        const first = fs.readFileSync(plain, 'utf8');
        ctx.expect(first).not.toBe(readFixture('case-111-plain.input.js'));
        const second = convert([plain]);
        ctx.expect(second.status, `converter output:\n${second.output}`).toBe(0);
        ctx.expect(fs.readFileSync(plain, 'utf8')).toBe(first);
        ctx.expect(convert(['--check', plain]).status).toBe(0);
      },
    },

    {
      name: 'case-112 bare assert(x, m) and a loose assert.equal map to toBeTruthy and toBe',
      run: (ctx) => {
        convertAndCheck(ctx, '112');
      },
    },

    {
      name: 'case-113 the converted monitoring suites run green under cli.js with the node --test count',
      timeout: 180000,
      run: (ctx) => {
        fs.rmSync(MONITORING_COPY, { recursive: true, force: true });
        ctx.after(() => fs.rmSync(MONITORING_COPY, { recursive: true, force: true }));
        // The suites require ../src, so the source is copied beside them.
        for (const part of ['src', 'test']) {
          fs.cpSync(path.join(MONITORING, part), path.join(MONITORING_COPY, part), { recursive: true });
        }
        const copyTests = path.join(MONITORING_COPY, 'test');

        const converted = convert(testFiles(copyTests));
        ctx.expect(converted.status, `converter output:\n${converted.output}`).toBe(0);

        const runner = node([CLI, `--root=${copyTests}`, '--reporter=json', `--log=${path.join(MONITORING_COPY, 'test.log')}`], {
          cwd: MONITORING_COPY,
        });
        ctx.expect(runner.status, `runner output:\n${runner.output}`).toBe(0);
        const report = JSON.parse(runner.stdout);

        const original = node([
          '--require', '@omega.js/devkit/test/stdout-guard',
          '--test', '--test-reporter=tap',
          ...testFiles(path.join(MONITORING, 'test')),
        ], { cwd: MONITORING });
        const counts = tapCounts(original.stdout);
        ctx.expect(counts.tests, `node --test output:\n${original.output}`).toBeGreaterThan(0);

        ctx.expect(report.failed).toBe(0);
        ctx.expect(report.tests.length).toBe(counts.tests);
        ctx.expect(report.skipped).toBe(counts.skipped);
      },
    },
  ],
});
