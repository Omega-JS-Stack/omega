/**
 * The test/_init.js contract: a factory taking `{ projectRoot, ...factoryArgs }`
 * whose `setup` runs once per root, in root order, and an InitHookError naming
 * the file for every way a hook can break.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('../../src/test/define-cases.js');
const { runInitSetups, InitHookError } = require('../../src/test/init-hooks.js');
const { fixtureDir, tempPath, removeAll } = require('./_fixtures/helpers.js');

const PROJECT_ROOT = fixtureDir('init');
const root = (name) => ({ dir: fixtureDir(path.join('init', name)), label: name });
const hookFile = (name) => path.join(fixtureDir(path.join('init', name)), '_init.js');

// The rejection reason of a run, or null when it resolved.
function rejectionOf(promise) {
  return promise.then(() => null, (error) => error);
}

module.exports = defineCases({
  type: 'group',
  description: 'init hooks',
  tests: [
    {
      name: 'case-41 a root with no _init.js resolves to an empty list',
      async run(ctx) {
        const dir = tempPath('no-init');
        fs.mkdirSync(dir, { recursive: true });
        try {
          const hooks = await runInitSetups([{ dir, label: 'project' }], dir);
          ctx.expect(hooks).toEqual([]);
        } finally {
          removeAll(dir);
        }
      },
    },
    {
      name: 'case-42 a valid hook gets projectRoot plus factoryArgs, and setup runs once with the setupContext keys',
      async run(ctx) {
        const record = [];
        const hooks = await runInitSetups([root('valid')], PROJECT_ROOT, {
          factoryArgs: { record, flavor: 'vanilla' },
          setupContext: async () => ({ emulator: 'ready' }),
        });

        ctx.expect(hooks.length).toBe(1);
        ctx.expect(hooks[0].file).toBe(hookFile('valid'));
        ctx.expect(record).toEqual([
          { step: 'factory', keys: ['flavor', 'projectRoot', 'record'], projectRoot: PROJECT_ROOT, flavor: 'vanilla' },
          { step: 'setup', keys: ['emulator', 'projectRoot'], projectRoot: PROJECT_ROOT, emulator: 'ready' },
        ]);
      },
    },
    {
      name: 'case-43 an _init.js that throws on load rejects with an InitHookError naming the file',
      async run(ctx) {
        const error = await rejectionOf(runInitSetups([root('throws-on-load')], PROJECT_ROOT));

        ctx.expect(error).toBeInstanceOf(InitHookError);
        ctx.expect(error.file).toBe(hookFile('throws-on-load'));
      },
    },
    {
      name: 'case-44 a non-function export, or a factory returning undefined, rejects with an InitHookError',
      async run(ctx) {
        for (const name of ['non-function', 'returns-undefined']) {
          const error = await rejectionOf(runInitSetups([root(name)], PROJECT_ROOT));

          ctx.expect(error, name).toBeInstanceOf(InitHookError);
          ctx.expect(error.file, name).toBe(hookFile(name));
        }
      },
    },
    {
      name: 'case-45 a setup that rejects gives an InitHookError carrying the cause',
      async run(ctx) {
        const error = await rejectionOf(runInitSetups([root('setup-rejects')], PROJECT_ROOT));

        ctx.expect(error).toBeInstanceOf(InitHookError);
        ctx.expect(error.file).toBe(hookFile('setup-rejects'));
        ctx.expect(error.message).toContain(hookFile('setup-rejects'));
        ctx.expect(error.message).toContain('setup rejected boom');
      },
    },
    {
      name: 'case-46 two roots run their setups in root order',
      async run(ctx) {
        const forward = [];
        await runInitSetups([root('order-first'), root('order-second')], PROJECT_ROOT, { factoryArgs: { record: forward } });
        ctx.expect(forward).toEqual(['first', 'second']);

        const reverse = [];
        await runInitSetups([root('order-second'), root('order-first')], PROJECT_ROOT, { factoryArgs: { record: reverse } });
        ctx.expect(reverse).toEqual(['second', 'first']);
      },
    },
  ],
});
