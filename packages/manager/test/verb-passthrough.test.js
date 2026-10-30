/**
 * The brand root's pass-through: a framework verb the manager keeps no command
 * for. A fan-out verb (`fanout: 'each'`) runs each target's own
 * `npm run <verb>`, custom targets included, the args after `--`; a
 * single-target command (`fanout: 'none'`) runs the picked target's framework
 * CLI with the argv as typed. A real fixture brand on disk; only
 * child_process.spawn is replaced (before run-command.js binds it), so nothing
 * real starts.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

const spawned = [];
childProcess.spawn = (command, args, options) => {
  spawned.push({ command, args, cwd: options.cwd, env: options.env });
  const child = new EventEmitter();
  process.nextTick(() => child.emit('close', 0));
  return child;
};

// The manager's own clean fan-out, stubbed before cli.js resolves it, so which
// door a clean spelling took is observable.
const cleanCommandCalls = [];
const cleanCommandPath = require.resolve('../src/commands/clean.js');
require.cache[cleanCommandPath] = {
  id: cleanCommandPath,
  filename: cleanCommandPath,
  path: path.dirname(cleanCommandPath),
  loaded: true,
  exports: async (options) => { cleanCommandCalls.push(options); },
};

const { parseArgv } = require('@omega.js/devkit/argv');
const { VERBS } = require('@omega.js/devkit/verbs');
const Main = require('../src/cli.js');
const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
const { passThroughRow, runPassThrough } = require('../src/lib/verb-passthrough.js');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * A brand with two web targets (web, admin), a backend, a desktop and a custom
 * api, each framework target carrying the verb scripts its scaffold writes.
 * @returns {string} the brand root
 */
function stageBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-passthrough-')));
  write(path.join(root, 'package.json'), { name: 'fixture-brand', private: true, workspaces: ['targets/*'] });
  write(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' }, admin: { type: 'web' }, backend: { type: 'backend' }, desktop: { type: 'desktop' }, api: { type: 'custom' } },
}
`);
  const web = { translate: 'omega translate' };
  write(path.join(root, 'targets', 'web', 'package.json'), { name: 'web', private: true, dependencies: { '@omega.js/web': '*' }, scripts: web });
  write(path.join(root, 'targets', 'admin', 'package.json'), { name: 'admin', private: true, dependencies: { '@omega.js/web': '*' }, scripts: web });
  write(path.join(root, 'targets', 'backend', 'package.json'), { name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' } });
  write(path.join(root, 'targets', 'desktop', 'package.json'), { name: 'desktop', private: true, dependencies: { '@omega.js/desktop': '*' } });
  write(path.join(root, 'targets', 'api', 'package.json'), { name: 'api', private: true, scripts: { translate: 'echo api' } });
  for (const pkg of ['@omega.js/web', '@omega.js/backend', '@omega.js/desktop']) {
    write(path.join(root, 'node_modules', pkg, 'package.json'), { name: pkg, bin: { omega: './bin.js' } });
    write(path.join(root, 'node_modules', pkg, 'bin.js'), '#!/usr/bin/env node\n');
  }
  return root;
}

const binOf = (root, pkg) => path.join(root, 'node_modules', '@omega.js', pkg, 'bin.js');

/** Run fn from the brand root, output captured and everything restored. */
async function atRoot(root, fn) {
  spawned.length = 0;
  const cwd0 = process.cwd();
  const log0 = console.log;
  const error0 = console.error;
  const exitCode0 = process.exitCode;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  process.chdir(root);
  try {
    await fn();
    return { lines: lines.join('\n'), exitCode: process.exitCode };
  } finally {
    process.chdir(cwd0);
    console.log = log0;
    console.error = error0;
    process.exitCode = exitCode0;
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'verb-passthrough',
  tests: [
    {
      name: 'translate --target=web at the brand root runs web\'s own `npm run translate`, the args after --',
      run: async (ctx) => {
        const root = stageBrand();
        const argv0 = process.argv;
        const args = ['translate', '--target=web', '--lang', 'de', 'framework:'];
        process.argv = [process.execPath, 'omega', ...args];
        try {
          await atRoot(root, () => new Main().process(parseArgv(args, { booleans: BOOLEAN_FLAGS })));
        } finally {
          process.argv = argv0;
        }

        ctx.expect(spawned.length).toBe(1);
        ctx.expect(spawned[0].command).toBe('npm');
        ctx.expect(spawned[0].args).toEqual(['run', 'translate', '--', '--lang', 'de', 'framework:']);
        ctx.expect(spawned[0].cwd).toBe(path.join(root, 'targets', 'web'));
        ctx.expect(spawned[0].env.OMEGA_ROOT_DISPATCH, 'the child needs no marker inside the target').toBe(undefined);
      },
    },

    {
      name: 'translate with no picker runs every web target and every custom target, and no other framework',
      run: async (ctx) => {
        const root = stageBrand();
        await atRoot(root, () => runPassThrough('translate', ['translate']));

        ctx.expect(spawned.map((call) => path.basename(call.cwd)).sort(), 'a fan-out verb is each target\'s own script, custom included').toEqual(['admin', 'api', 'web']);
        ctx.expect(spawned.every((call) => call.command === 'npm' && call.args.join(' ') === 'run translate')).toBeTruthy();
      },
    },

    {
      name: 'a single-target command passes through to the framework CLI with the alias as typed, never an npm script',
      run: async (ctx) => {
        const root = stageBrand();
        await atRoot(root, () => runPassThrough('firestore:set', ['firestore:set', '--target=backend', 'users/abc', '{"a":1}']));

        ctx.expect(spawned.length).toBe(1);
        ctx.expect(spawned[0].command).toBe(process.execPath);
        ctx.expect(spawned[0].args).toEqual([binOf(root, 'backend'), 'firestore:set', 'users/abc', '{"a":1}']);
        ctx.expect(spawned[0].cwd).toBe(path.join(root, 'targets', 'backend'));
      },
    },

    {
      name: 'a single-target command on a custom target steps aside loudly, and nothing fails',
      run: async (ctx) => {
        const root = stageBrand();
        const { lines, exitCode } = await atRoot(root, () => runPassThrough('emulators', ['emulators', '--target=api']));

        ctx.expect(spawned.length).toBe(0);
        ctx.expect(lines).toMatch(/emulators is a @omega\.js\/backend command; api is custom/);
        ctx.expect(exitCode).toBe(undefined);
      },
    },

    {
      name: 'launch with no picker refuses, naming the desktop targets; with one it runs there',
      run: async (ctx) => {
        const root = stageBrand();
        await atRoot(root, () => ctx.expect(runPassThrough('launch', ['launch'])).rejects.toThrow((error) => {
          ctx.expect(error.refusal).toBe(true);
          ctx.expect(error.message).toMatch(/"launch" runs on one target: npx omega launch --target=<name>, the name one of desktop\. Nothing ran\./);
          return true;
        }));
        ctx.expect(spawned.length).toBe(0);

        await atRoot(root, () => runPassThrough('launch', ['launch', '--target', 'desktop']));
        ctx.expect(spawned.map((call) => call.args)).toEqual([[binOf(root, 'desktop'), 'launch']]);
      },
    },

    {
      name: '--dry-run on a fan-out verb reaches the walk: a brand-owned script plans, the framework\'s own hears the flag',
      run: async (ctx) => {
        const root = stageBrand();
        const { lines } = await atRoot(root, () => runPassThrough('translate', ['translate', '--dry-run']));

        ctx.expect(spawned.map((call) => path.basename(call.cwd)).sort(), 'only the framework scripts ran').toEqual(['admin', 'web']);
        ctx.expect(spawned.every((call) => call.args.join(' ') === 'run translate -- --dry-run')).toBeTruthy();
        ctx.expect(lines, 'the custom target stopped at its plan').toMatch(/api: dry run .*would run npm run translate in targets\/api/);
      },
    },

    {
      name: '--dry-run on a single-target command prints the plan and spawns nothing',
      run: async (ctx) => {
        const root = stageBrand();
        const { lines, exitCode } = await atRoot(root, () => runPassThrough('firestore:set', ['firestore:set', '--target=backend', 'users/abc', '--dry-run']));

        ctx.expect(spawned.length).toBe(0);
        ctx.expect(lines).toMatch(/would run @omega\.js\/backend firestore:set users\/abc --dry-run in targets\/backend/);
        ctx.expect(exitCode).toBe(undefined);
      },
    },

    {
      name: 'audit --target=backend refuses by name: the backend does not own audit',
      run: async (ctx) => {
        const root = stageBrand();
        await atRoot(root, () => ctx.expect(runPassThrough('audit', ['audit', '--target=backend'])).rejects.toThrow((error) => {
          ctx.expect(error.refusal).toBe(true);
          ctx.expect(error.message).toMatch(/"audit" is @omega\.js\/web's verb, and backend \(@omega\.js\/backend\) cannot run it\. Nothing ran\./);
          return true;
        }));
        ctx.expect(spawned.length).toBe(0);
      },
    },

    {
      name: 'the manager\'s ALIASES are the registry\'s, and clean:npm stays the backend\'s pass-through, never the clean fan-out',
      run: async (ctx) => {
        const aliases = Main.config.aliases;
        const registryAliases = (row) => row.aliases.filter((alias) => !(row.passThrough || []).includes(alias));
        for (const row of VERBS.filter((entry) => entry.owners.includes('@omega.js/manager'))) {
          ctx.expect(aliases[row.name] || [], `${row.name}'s aliases are its registry row's`).toEqual(registryAliases(row));
        }
        for (const [verb, list] of Object.entries(aliases)) {
          const row = VERBS.find((entry) => entry.name === verb);
          ctx.expect(row, `ALIASES carries "${verb}", which has no registry row`).toBeTruthy();
          ctx.expect(list, `${verb}'s aliases are its registry row's`).toEqual(registryAliases(row));
        }

        const root = stageBrand();
        write(path.join(root, 'targets', 'backend', 'package.json'), { name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' }, scripts: { clean: 'omega clean' } });
        cleanCommandCalls.length = 0;
        const argv0 = process.argv;
        const args = ['clean:npm', '--target=backend'];
        process.argv = [process.execPath, 'omega', ...args];
        try {
          await atRoot(root, () => new Main().process(parseArgv(args, { booleans: BOOLEAN_FLAGS })));
        } finally {
          process.argv = argv0;
        }

        ctx.expect(cleanCommandCalls.length, 'clean:npm never reaches the manager\'s clean fan-out').toBe(0);
        ctx.expect(spawned.map((call) => [path.basename(call.cwd), call.command, ...call.args])).toEqual([['backend', 'npm', 'run', 'clean']]);
      },
    },

    {
      name: 'a verb no row knows gets the manager\'s unknown-verb answer',
      run: async (ctx) => {
        const root = stageBrand();
        ctx.expect(passThroughRow('notaverb')).toBe(null);
        ctx.expect(passThroughRow('dev'), 'a root row is the manager\'s own command, never passed through').toBe(null);

        const { lines, exitCode } = await atRoot(root, () => new Main().process(parseArgv(['notaverb'], { booleans: BOOLEAN_FLAGS })));
        ctx.expect(lines).toMatch(/Unknown command "notaverb"\. Available: /);
        ctx.expect(exitCode).toBe(1);
        ctx.expect(spawned.length).toBe(0);
      },
    },
  ],
});
