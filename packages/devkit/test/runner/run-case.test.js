// Contract cases for src/test/run-case.js: spec normalization, the one ctx, and the
// case and suite run loop every layer shares.
//
// Each case builds its own small spec, normalizes it against this file's path, and runs
// it with the real expect, collecting the reported events.

const jetpack = require('fs-jetpack');
const path = require('node:path');
const vm = require('node:vm');
const defineCases = require('../../src/test/define-cases.js');
const expect = require('../../src/test/expect.js');
const { normalizeSpec, createContext, runSuite, waitFor, SkipError } = require('../../src/test/run-case.js');
const { createCaseSession } = require('../../src/test/register-suite.js');

const FILE = __filename;
const SOURCE_DIR = path.join(__dirname, '..', '..', 'src', 'test');

// Normalize a spec as this file, run it, and resolve to the reported events.
async function runSpec(spec) {
  const events = [];
  await runSuite(normalizeSpec(spec, { file: FILE }), {
    expect,
    extras: {},
    defaultTimeout: 5000,
    report: (event) => events.push(event),
  });
  return events;
}

function fail() {
  throw new Error('this case fails');
}

module.exports = defineCases({
  type: 'group',
  description: 'run-case: normalize, context and the run loop',
  tests: [
    {
      name: 'case-23 normalizeSpec gives the four spec forms the same case fields',
      run: (ctx) => {
        const first = () => {};
        const second = () => {};
        const tests = [{ name: 'first', run: first }, { name: 'second', run: second }];
        const forms = {
          suite: { type: 'suite', description: 'a suite', tests },
          group: { type: 'group', description: 'a group', tests },
          array: tests,
        };

        for (const [form, spec] of Object.entries(forms)) {
          const normalized = normalizeSpec(spec, { file: FILE });
          ctx.expect(normalized.file, form).toBe(FILE);
          ctx.expect(normalized.layer, form).toBeUndefined();
          ctx.expect(normalized.cases.map((c) => c.id), form).toEqual([`${FILE}#0`, `${FILE}#1`]);
          ctx.expect(normalized.cases.map((c) => c.index), form).toEqual([0, 1]);
          ctx.expect(normalized.cases.map((c) => c.name), form).toEqual(['first', 'second']);
          ctx.expect(normalized.cases[0].run, form).toBe(first);
          ctx.expect(normalized.cases[1].run, form).toBe(second);
        }

        const standalone = normalizeSpec({ description: 'standalone', run: first }, { file: FILE });
        ctx.expect(standalone.file).toBe(FILE);
        ctx.expect(standalone.layer).toBeUndefined();
        ctx.expect(standalone.cases.length).toBe(1);
        ctx.expect(standalone.cases[0].id).toBe(`${FILE}#0`);
        ctx.expect(standalone.cases[0].index).toBe(0);
        ctx.expect(standalone.cases[0].name).toBe('standalone');
        ctx.expect(standalone.cases[0].run).toBe(first);
      },
    },

    {
      name: 'case-23 normalizeSpec names an unnamed case step-<index + 1>',
      run: (ctx) => {
        const normalized = normalizeSpec([{ run: () => {} }, { run: () => {} }], { file: FILE });
        ctx.expect(normalized.cases.map((c) => c.name)).toEqual(['step-1', 'step-2']);
      },
    },

    {
      name: 'case-24 a suite reports every case after the first failure as skipped',
      run: async (ctx) => {
        const events = await runSpec({
          type: 'suite',
          description: 'stops',
          tests: [{ name: 'a', run: () => {} }, { name: 'b', run: fail }, { name: 'c', run: () => {} }],
        });
        ctx.expect(events.map((e) => e.status)).toEqual(['pass', 'fail', 'skip']);
        ctx.expect(events[2].reason).toBe('suite stopped');
      },
    },

    {
      name: 'case-25 a group runs and reports every case past a failure',
      run: async (ctx) => {
        const ran = [];
        const events = await runSpec({
          type: 'group',
          description: 'keeps going',
          tests: [
            { name: 'a', run: () => ran.push('a') },
            { name: 'b', run: () => { ran.push('b'); fail(); } },
            { name: 'c', run: () => ran.push('c') },
          ],
        });
        ctx.expect(ran).toEqual(['a', 'b', 'c']);
        ctx.expect(events.map((e) => e.status)).toEqual(['pass', 'fail', 'pass']);
      },
    },

    {
      name: 'case-26 ctx.state carries from one case to the next',
      run: async (ctx) => {
        let seen;
        const events = await runSpec({
          type: 'suite',
          description: 'shared state',
          tests: [
            { name: 'write', run: (inner) => { inner.state.x = 42; } },
            { name: 'read', run: (inner) => { seen = inner.state.x; } },
          ],
        });
        ctx.expect(events.map((e) => e.status)).toEqual(['pass', 'pass']);
        ctx.expect(seen).toBe(42);
      },
    },

    {
      name: 'case-27 ctx.skip reports the case skipped with its reason',
      run: async (ctx) => {
        const events = await runSpec([{ name: 'skips', run: (inner) => inner.skip('why') }]);
        ctx.expect(events.length).toBe(1);
        ctx.expect(events[0].status).toBe('skip');
        ctx.expect(events[0].reason).toBe('why');
      },
    },

    {
      name: 'case-27 a ctx.skip in a suite skips every later case with its reason; a group runs on',
      run: async (ctx) => {
        const ran = [];
        const tests = () => [
          { name: 'a', run: (inner) => inner.skip('no paid product') },
          { name: 'b', run: () => ran.push('b') },
          { name: 'c', run: () => ran.push('c') },
        ];

        const suiteEvents = await runSpec({ type: 'suite', description: 'stops on skip', tests: tests() });
        ctx.expect(suiteEvents.map((e) => e.status)).toEqual(['skip', 'skip', 'skip']);
        ctx.expect(suiteEvents.map((e) => e.reason)).toEqual(['no paid product', 'no paid product', 'no paid product']);
        ctx.expect(ran).toEqual([]);

        const groupEvents = await runSpec({ type: 'group', description: 'keeps going', tests: tests() });
        ctx.expect(groupEvents.map((e) => e.status)).toEqual(['skip', 'pass', 'pass']);
        ctx.expect(ran).toEqual(['b', 'c']);
      },
    },

    {
      name: 'case-28 a case with skip never runs its body',
      run: async (ctx) => {
        let ran = false;
        const events = await runSpec([{ name: 'later', skip: 'later', run: () => { ran = true; } }]);
        ctx.expect(ran).toBe(false);
        ctx.expect(events.length).toBe(1);
        ctx.expect(events[0].status).toBe('skip');
      },
    },

    {
      name: 'case-29 a case slower than its timeout fails with Test timeout',
      run: async (ctx) => {
        const events = await runSpec([{
          name: 'slow',
          timeout: 30,
          run: () => new Promise((resolve) => setTimeout(resolve, 300)),
        }]);
        ctx.expect(events[0].status).toBe('fail');
        ctx.expect(events[0].error.message).toContain('Test timeout');
      },
    },

    {
      name: 'case-30 a failing case event carries a stack naming the suite file',
      run: async (ctx) => {
        const events = await runSpec([{ name: 'fails', run: fail }]);
        ctx.expect(events[0].status).toBe('fail');
        ctx.expect(events[0].error.stack).toContain(FILE);
      },
    },

    {
      name: 'case-31 a throwing case cleanup leaves the case passing',
      run: async (ctx) => {
        const events = await runSpec([{
          name: 'messy',
          run: () => {},
          cleanup: () => {
            throw new Error('cleanup broke');
          },
        }]);
        ctx.expect(events.length).toBe(1);
        ctx.expect(events[0].status).toBe('pass');
      },
    },

    {
      name: 'case-32 waitFor resolves with the first truthy value',
      run: async (ctx) => {
        let calls = 0;
        const value = await waitFor(() => {
          calls += 1;
          return calls === 3 ? 'ready' : false;
        }, 1000, 5);
        ctx.expect(value).toBe('ready');
        ctx.expect(calls).toBe(3);
      },
    },

    {
      name: 'case-32 waitFor rejects with the timeout message',
      run: async (ctx) => {
        let reason = null;
        try {
          await waitFor(() => false, 50, 5);
        } catch (error) {
          reason = error;
        }
        if (!reason) throw new Error('expected waitFor to reject, and it resolved');
        ctx.expect(reason.message).toBe('waitFor timed out after 50ms');
      },
    },

    {
      name: 'case-33 createContext builds the one ctx with every extra',
      run: (ctx) => {
        const state = {};
        const page = { kind: 'page' };
        const built = createContext({ expect, state, layer: 'view', extras: { page, http: 'h' } });

        ctx.expect(built.expect).toBe(expect);
        ctx.expect(built.waitFor).toBeTypeOf('function');
        ctx.expect(built.state).toBe(state);
        ctx.expect(built.layer).toBe('view');
        ctx.expect(built.skip).toBeTypeOf('function');
        ctx.expect(built.page).toBe(page);
        ctx.expect(built.http).toBe('h');

        let thrown = null;
        try {
          built.skip('why');
        } catch (error) {
          thrown = error;
        }
        ctx.expect(thrown).toBeInstanceOf(SkipError);
      },
    },

    {
      name: 'case-79 expect.js and run-case.js run inlined in a context with no module system',
      run: async (ctx) => {
        const source = ['expect.js', 'run-case.js']
          .map((name) => jetpack.read(path.join(SOURCE_DIR, name)))
          .join('\n');
        const context = vm.createContext({ setTimeout, clearTimeout, setInterval, clearInterval, console });
        vm.runInContext(source, context);
        const inlined = vm.runInContext('({ expect, runSuite, normalizeSpec, waitFor })', context);

        for (const [name, value] of Object.entries(inlined)) {
          ctx.expect(typeof value, name).toBe('function');
        }

        const events = [];
        const suite = inlined.normalizeSpec([{ name: 'inlined', run: (inner) => inner.expect(1).toBe(1) }], { file: FILE });
        await inlined.runSuite(suite, {
          expect: inlined.expect,
          extras: {},
          defaultTimeout: 5000,
          report: (event) => events.push(event),
        });
        ctx.expect(events.length).toBe(1);
        ctx.expect(events[0].status).toBe('pass');
      },
    },

    {
      name: 'case-80 skip: true reports the reason skipped, on a suite and on a case',
      run: async (ctx) => {
        let ran = false;
        const body = () => { ran = true; };

        const suiteEvents = await runSpec({
          type: 'suite',
          description: 'skipped suite',
          skip: true,
          tests: [{ name: 'a', run: body }, { name: 'b', run: body }],
        });
        ctx.expect(suiteEvents.map((e) => e.status)).toEqual(['skip', 'skip']);
        ctx.expect(suiteEvents.map((e) => e.reason)).toEqual(['skipped', 'skipped']);

        const caseEvents = await runSpec([{ name: 'a', skip: true, run: body }]);
        ctx.expect(caseEvents.length).toBe(1);
        ctx.expect(caseEvents[0].status).toBe('skip');
        ctx.expect(caseEvents[0].reason).toBe('skipped');
        ctx.expect(ran).toBe(false);
      },
    },

    {
      name: 'case-81 waitFor takes the default timeout for 0 or null',
      run: async (ctx) => {
        for (const timeoutMs of [0, null]) {
          let calls = 0;
          const value = await waitFor(() => {
            calls += 1;
            return calls === 2 ? 'ready' : false;
          }, timeoutMs);
          ctx.expect(value, String(timeoutMs)).toBe('ready');
        }
      },
    },

    {
      name: 'case-85 normalizeSpec throws naming the file on a standalone with no run',
      run: (ctx) => {
        let thrown = null;
        try {
          normalizeSpec({ notASpec: true }, { file: FILE });
        } catch (error) {
          thrown = error;
        }
        if (!thrown) throw new Error('expected normalizeSpec to throw, and it returned');
        ctx.expect(thrown.message).toContain(FILE);

        const standalone = normalizeSpec({ description: 'has a run', run: () => {} }, { file: FILE });
        ctx.expect(standalone.cases.length).toBe(1);
      },
    },

    {
      name: 'case-85 normalizeSpec throws naming the file and the case on a listed case with no run',
      run: (ctx) => {
        const spec = { type: 'group', tests: [{ name: 'fine', run: () => {} }, { name: 'old inspect form', inspect: () => {} }] };
        ctx.expect(() => normalizeSpec(spec, { file: FILE })).toThrow(`${FILE}: case 1 (old inspect form) has no \`run\` function`);
      },
    },

    {
      name: 'normalizeSpec refuses a view on any layer but boot, naming the file, and keeps it on boot',
      run: (ctx) => {
        const rule = `${FILE}: \`view\` applies only to \`layer: 'boot'\``;
        const run = () => {};
        const stale = {
          'a suite on the view layer': { layer: 'view', view: 'popup', tests: [{ name: 'a', run }] },
          'a standalone on the renderer layer': { layer: 'renderer', view: 'main', description: 'standalone', run },
          'a suite with no layer': { view: 'main', tests: [{ name: 'a', run }] },
        };
        for (const [form, spec] of Object.entries(stale)) {
          ctx.expect(() => normalizeSpec(spec, { file: FILE }), form).toThrow(rule);
        }

        ctx.expect(normalizeSpec({ layer: 'boot', view: 'main', tests: [{ name: 'a', run }] }, { file: FILE }).view).toBe('main');
        ctx.expect(normalizeSpec({ layer: 'boot', view: 'main', description: 'standalone', run }, { file: FILE }).cases[0].view).toBe('main');
      },
    },

    {
      name: 'case-116 a suite keeps its own keys, and an extras function sees them on info.suite',
      run: async (ctx) => {
        const spec = { type: 'suite', description: 'admin suite', auth: 'admin', tests: [{ name: 'only', run: () => {} }] };
        const normalized = normalizeSpec(spec, { file: FILE });
        ctx.expect(normalized.auth).toBe('admin');

        const seen = [];
        const events = [];
        await runSuite(normalized, {
          expect,
          extras: (info) => {
            if (info.name) seen.push(info.suite.auth);
            return {};
          },
          defaultTimeout: 5000,
          report: (event) => events.push(event),
        });
        ctx.expect(events.map((e) => e.status)).toEqual(['pass']);
        ctx.expect(seen).toEqual(['admin']);
      },
    },

    {
      name: 'case-157 a driver reporting one case twice throws naming the case id, and the other events stand as sent',
      run: async (ctx) => {
        const first = { id: 'app.test.js#0', name: 'first', status: 'pass', durationMs: 3 };
        const second = { id: 'app.test.js#1', name: 'second', status: 'skip', durationMs: 0, reason: 'driver skip' };
        let twice = null;

        const session = createCaseSession({
          cases: [{ id: first.id, name: first.name }, { id: second.id, name: second.name }],
          endedMessage: 'the boot layer ended before this case reported',
          start: async (report) => {
            report({ ...first });
            try {
              report({ id: first.id, name: first.name, status: 'fail', durationMs: 1, error: { name: 'Error', message: 'late' } });
            } catch (e) {
              twice = e;
            }
            report({ ...second });
          },
        });

        ctx.expect(await session.wait(first.id)).toEqual({ id: 'app.test.js#0', name: 'first', status: 'pass', durationMs: 3 });
        ctx.expect(await session.wait(second.id)).toEqual({ id: 'app.test.js#1', name: 'second', status: 'skip', durationMs: 0, reason: 'driver skip' });
        await session.finished();
        ctx.expect(twice, 'the second report threw').toBeInstanceOf(Error);
        ctx.expect(twice.message).toContain('Case app.test.js#0 reported twice');
      },
    },

    {
      name: 'case-157 with a fail sink, a duplicate reported after every case settled lands as its own failing entry',
      run: async (ctx) => {
        const first = { id: 'app.test.js#0', name: 'first', status: 'pass', durationMs: 3 };
        const second = { id: 'app.test.js#1', name: 'second', status: 'pass', durationMs: 2 };
        const failures = [];

        const session = createCaseSession({
          cases: [{ id: first.id, name: first.name }, { id: second.id, name: second.name }],
          endedMessage: 'the boot layer ended before this case reported',
          fail: (fields) => failures.push(fields),
          start: async (report) => {
            report({ ...first });
            report({ ...second });
            report({ ...first });
          },
        });

        ctx.expect(await session.wait(first.id)).toEqual(first);
        ctx.expect(await session.wait(second.id)).toEqual(second);
        await session.finished();
        ctx.expect(failures.length).toBe(1);
        ctx.expect(failures[0].id).toBe('app.test.js#0#twice');
        ctx.expect(failures[0].name).toBe('first');
        ctx.expect(failures[0].error.message).toBe('Case app.test.js#0 reported twice');
      },
    },
  ],
});
