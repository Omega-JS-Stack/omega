/**
 * Brand-root `omega update` fan-out — real execution over a staged fixture
 * brand (deploy-command.test.js pattern): fake framework packages whose
 * `omega` bins record every invocation, so fan-out, flag forwarding,
 * filtering, and the independent-targets failure model (no bail — unlike
 * deploy) are asserted from what actually got spawned.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const devkitUpdate = require('@omega.js/devkit/update');
const { VERBS } = require('@omega.js/devkit/verbs');
const updateCommand = require('../src/commands/update.js');

// ─── Fixture staging (deploy-command.test.js pattern) ────────────────────────

/**
 * Fake framework bin: appends { name, cwd, argv } to <brand>/calls.log and
 * exits 1 when <brand>/FAIL-<name> exists.
 */
function fakeBinSource(name) {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const brandRoot = path.resolve(__dirname, '..', '..', '..');
fs.appendFileSync(path.join(brandRoot, 'calls.log'), JSON.stringify({
  name: ${JSON.stringify(name)},
  cwd: process.cwd(),
  argv: process.argv.slice(2),
}) + '\\n');
if (fs.existsSync(path.join(brandRoot, 'FAIL-' + ${JSON.stringify(name)}))) process.exit(1);
`;
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

/** Stage a brand monorepo with a web target + backend target and fake framework bins. */
function stageBrand() {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-update-cmd-')));
  const brand = path.join(scratch, 'brand');

  write(path.join(brand, 'package.json'), JSON.stringify({
    name: 'fixture-brand', private: true, workspaces: ['targets/*'],
  }));
  write(path.join(brand, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' }, backend: { type: 'backend' } },
}
`);

  write(path.join(brand, 'targets', 'web', 'package.json'), JSON.stringify({
    name: 'web', private: true, devDependencies: { '@omega.js/web': '*' },
  }));

  write(path.join(brand, 'targets', 'backend', 'package.json'), JSON.stringify({
    name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' },
  }));

  for (const [pkg, short] of [['@omega.js/web', 'web'], ['@omega.js/backend', 'backend']]) {
    const pkgDir = path.join(brand, 'node_modules', pkg);
    write(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: pkg, bin: { omega: './bin.js' },
    }));
    write(path.join(pkgDir, 'bin.js'), fakeBinSource(short));
  }

  return { scratch, brand };
}

function readCalls(brand) {
  const logPath = path.join(brand, 'calls.log');
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** Run the command from `cwd` with parsed options, restoring cwd + exitCode. */
async function runUpdateCommand(cwd, options = {}) {
  const cwd0 = process.cwd();
  const restoreTee = require('@omega.js/devkit/attach-log-file').mark();
  process.chdir(cwd);
  try {
    await updateCommand({ _: ['update'], ...options });
    return process.exitCode;
  } finally {
    // The verb tees to <brandRoot>/logs/<verb>.log (#623) — release the writers
    // so the next case starts from an unpatched stdout.
    restoreTee();
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

// ─── The brand root rides the fan-out for its own pin (#794) ────────────────

/**
 * The real devkit runUpdate, with only its documented seams replaced: a fixture
 * packument (no registry) and a recording exec (no install). What comes back is
 * the exact command npm would have run.
 */
function withOfflineUpdate(fn, {
  now = '2026-09-03T00:00:00Z',
  packument = {
    latest: '0.5.0',
    versions: ['0.4.0', '0.5.0'],
    times: { '0.5.0': '2026-01-01T00:00:00Z', '0.4.0': '2025-12-01T00:00:00Z' },
  },
} = {}) {
  const original = devkitUpdate.runUpdate;
  const commands = [];

  devkitUpdate.runUpdate = (options) => original({
    ...options,
    hasNpu: false,
    now: Date.parse(now),
    lookup: async (name) => ({ ...packument, name }),
    execFn: (command) => commands.push(command),
  });

  return Promise.resolve(fn()).then(
    (value) => { devkitUpdate.runUpdate = original; return { value, commands }; },
    (error) => { devkitUpdate.runUpdate = original; throw error; },
  );
}

// ─── The by-hand steps the manager move crossed ─────────────────────────────

const REGISTER = `# Breaking changes

## 2026-10-01: the update quarantine exempts the family ([#1046](https://github.com/Omega-JS-Stack/omega/issues/1046))

Nothing to do.

## 2026-09-30: the backend and the router have exports maps ([#1009](https://github.com/Omega-JS-Stack/omega/issues/1009))

Load \`defineCases\` from \`@omega.js/backend/test\`.

## 2026-09-20: an older shape

An older step.

## ultimate-jekyll-manager → @omega.js/web

The legacy section.
`;

// 0.54.1 published 2026-09-30, 0.55.0 the next day, both long aged by `now`
const MANAGER_PACKUMENT = {
  latest: '0.55.0',
  versions: ['0.54.1', '0.55.0'],
  time: { '0.54.1': '2026-09-30T12:00:00.000Z', '0.55.0': '2026-10-01T09:00:00.000Z' },
};
const REGISTRY_NOW = '2026-10-20T00:00:00Z';

/** The staged brand with its root pinned to `pin` and the installed manager carrying `register`. */
function stageManagerBrand({ pin = '0.54.1', register = REGISTER } = {}) {
  const { brand } = stageBrand();
  write(path.join(brand, 'package.json'), JSON.stringify({
    name: 'fixture-brand', private: true, workspaces: ['targets/*'],
    devDependencies: { '@omega.js/manager': pin },
  }));
  const manager = path.join(brand, 'node_modules', '@omega.js', 'manager');
  write(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager', version: pin }));
  const file = path.join(manager, 'docs', 'shared', 'breaking-changes.md');
  write(file, register);
  return { brand, file };
}

/** Every console line printed while `fn` runs, ANSI stripped. */
async function captureLines(fn) {
  const lines = [];
  const originals = {};
  for (const method of ['log', 'info', 'warn', 'error']) {
    originals[method] = console[method];
    console[method] = (...args) => lines.push(args.map(String).join(' ').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''));
  }
  try {
    await fn();
  } finally {
    Object.assign(console, originals);
  }
  return lines.join('\n').split('\n');
}

/** The lines printed after the "Update summary" heading. */
function afterSummary(expect, lines) {
  const start = lines.findIndex((line) => line.includes('Update summary'));
  expect(start >= 0, `the run prints its summary:\n${lines.join('\n')}`).toBeTruthy();
  return lines.slice(start + 1);
}

module.exports = defineCases({
  type: 'group',
  description: 'update-command',
  tests: [
    // ─── Execution over the staged brand ─────────────────────────────────────────

    {
      name: 'bare run fans out to every target, each spawned `update` in its own cwd',
      run: async (ctx) => {
        const { brand } = stageBrand();
        const code = await runUpdateCommand(brand);

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        ctx.expect(calls.map((c) => c.name).sort()).toEqual(['backend', 'web']);
        for (const call of calls) {
          ctx.expect(call.argv, 'bare per-target: only the update command, no flags').toEqual(['update']);
        }
        const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
        ctx.expect(byName.backend.cwd).toBe(path.join(brand, 'targets', 'backend'));
        ctx.expect(byName.web.cwd).toBe(path.join(brand, 'targets', 'web'));
        ctx.expect(code, 'all targets green → no error exit code').toBe(undefined);
      },
    },

    {
      name: 'flags forward verbatim (--dry-run, --major, --min-age); --target= is consumed here',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runUpdateCommand(brand, { 'dry-run': true, dryRun: true, major: true, 'min-age': 14, minAge: 14 });

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        for (const call of calls) {
          ctx.expect(call.argv, 'the camelCase twin never forwards twice').toEqual(['update', '--dry-run', '--major', '--min-age=14']);
        }

        fs.rmSync(path.join(brand, 'calls.log'));
        await runUpdateCommand(brand, { target: 'web' });
        ctx.expect(readCalls(brand).map((c) => c.name), '--target= picks and never forwards').toEqual(['web']);
      },
    },

    // The retired pickers (#780) — never ignored, never aliased
    {
      name: '--only and --except are REFUSED, naming --target=; zero spawns',
      run: async (ctx) => {
        const { brand } = stageBrand();

        await ctx.expect((() => runUpdateCommand(brand, { only: 'web' }))()).rejects.toThrow((error) => {
            ctx.expect(error.refusal, 'a refusal prints its message alone (no stack)').toBe(true);
            ctx.expect(error.message).toMatch(/--only is retired: pick targets with --target=/);
            return true;
          });
        await ctx.expect((() => runUpdateCommand(brand, { except: 'backend' }))()).rejects.toThrow(/--except is retired/);

        ctx.expect(readCalls(brand)).toEqual([]);
      },
    },

    {
      name: 'a --target= token matching nothing STOPS the run, never a matched subset',
      run: async (ctx) => {
        const { brand } = stageBrand();

        await ctx.expect((() => runUpdateCommand(brand, { target: 'hosting' }))()).rejects.toThrow((error) => {
            ctx.expect(error.refusal).toBe(true);
            ctx.expect(error.message).toMatch(/Unknown --target token "hosting"/);
            return true;
          });

        // A typo beside a real target never checks the matched half
        await ctx.expect((() => runUpdateCommand(brand, { target: 'web,hosting' }))()).rejects.toThrow(/Unknown --target token "hosting"/);

        ctx.expect(readCalls(brand)).toEqual([]);
      },
    },

    {
      name: 'targets are INDEPENDENT: a failing target never blocks the rest, still exit 1',
      run: async (ctx) => {
        const { brand } = stageBrand();
        fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
        const code = await runUpdateCommand(brand);

        const calls = readCalls(brand);
        ctx.expect(calls.map((c) => c.name).sort(), 'web still checked after the backend failure').toEqual(['backend', 'web']);
        ctx.expect(code).toBe(1);
      },
    },

    {
      name: 'outside any brand: errors with exit 1',
      run: async (ctx) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-update-cmd-nobrand-'));
        const code = await runUpdateCommand(scratch);
        ctx.expect(code).toBe(1);
      },
    },

    {
      name: 'cli routes `update` through ALIASES to the command file',
      run: (ctx) => {
        const Main = require('../src/cli.js');
        ctx.expect(Object.prototype.hasOwnProperty.call(Main.config.aliases, 'update')).toBeTruthy();
        const registryAliases = VERBS.find((verb) => verb.name === 'update').aliases;
        ctx.expect(Main.config.aliases.update, 'the aliases are the registry row\'s').toEqual(registryAliases);
        ctx.expect(registryAliases.some((alias) => alias === 'outdated' || alias === 'out'), 'the report-era outdated/out aliases are gone').toBe(false);
        ctx.expect(fs.existsSync(path.join(Main.config.commandsDir, 'update.js'))).toBeTruthy();
      },
    },

    {
      name: 'the brand ROOT rides the fan-out for @omega.js/manager, applied with --save-exact (#794)',
      run: async (ctx) => {
        const { brand } = stageBrand();
        write(path.join(brand, 'package.json'), JSON.stringify({
          name: 'fixture-brand', private: true, workspaces: ['targets/*'],
          devDependencies: { '@omega.js/manager': '0.4.0', 'some-brand-tool': '^1.0.0' },
        }));

        const { commands } = await withOfflineUpdate(() => runUpdateCommand(brand));

        ctx.expect(commands, 'the root pin moves with the family, exactly — and nothing else at the root is touched').toEqual(['npm install @omega.js/manager@0.5.0 --save-dev --save-exact']);

        // The targets still fan out exactly as before
        ctx.expect(readCalls(brand).map((c) => c.name).sort()).toEqual(['backend', 'web']);
      },
    },

    {
      name: '--dry-run at the brand root installs nothing for the root pin, and forwards to every target',
      run: async (ctx) => {
        const { brand } = stageBrand();
        write(path.join(brand, 'package.json'), JSON.stringify({
          name: 'fixture-brand', private: true, workspaces: ['targets/*'],
          devDependencies: { '@omega.js/manager': '0.4.0' },
        }));

        const { commands } = await withOfflineUpdate(() => runUpdateCommand(brand, { 'dry-run': true, dryRun: true }));

        ctx.expect(commands, 'the root leg only reports').toEqual([]);
        const calls = readCalls(brand);
        ctx.expect(calls.length, 'both targets were spawned').toBe(2);
        for (const call of calls) ctx.expect(call.argv).toEqual(['update', '--dry-run']);
      },
    },

    {
      name: 'a picked run leaves the brand root alone — --target= names targets',
      run: async (ctx) => {
        const { brand } = stageBrand();
        write(path.join(brand, 'package.json'), JSON.stringify({
          name: 'fixture-brand', private: true, workspaces: ['targets/*'],
          devDependencies: { '@omega.js/manager': '0.4.0' },
        }));

        const { commands } = await withOfflineUpdate(() => runUpdateCommand(brand, { target: 'web' }));

        ctx.expect(commands, 'nothing ran for the root').toEqual([]);
        ctx.expect(readCalls(brand).map((c) => c.name)).toEqual(['web']);
      },
    },

    {
      name: 'a root leg that moved the manager pin ends on the by-hand steps since the old version',
      run: async (ctx) => {
        const { brand, file } = stageManagerBrand();

        let commands;
        const lines = await captureLines(async () => {
          ({ commands } = await withOfflineUpdate(() => runUpdateCommand(brand), { now: REGISTRY_NOW, packument: MANAGER_PACKUMENT }));
        });
        ctx.expect(commands, 'the pin moved').toEqual(['npm install @omega.js/manager@0.55.0 --save-dev --save-exact']);

        const tail = afterSummary(ctx.expect, lines);
        const at = (text) => tail.findIndex((line) => line.includes(text));
        const header = at('By-hand steps since 0.54.1 (2):');
        const newest = at('  2026-10-01: the update quarantine exempts the family');
        const older = at('  2026-09-30: the backend and the router have exports maps');
        const register = at(`Each entry's step is in: ${file}`);

        ctx.expect(header >= 0, `the block opens after the summary:\n${lines.join('\n')}`).toBeTruthy();
        ctx.expect(header < newest && newest < older && older < register, `entries newest first, then the register path:\n${tail.join('\n')}`).toBeTruthy();
        ctx.expect(at('2026-09-20'), 'an entry older than the publish day is not due').toBe(-1);
        ctx.expect(!tail.some((line) => line.includes('ultimate-jekyll-manager')), 'an undated section is never an entry').toBeTruthy();
      },
    },

    {
      name: 'a moved pin with no publish time for the old version prints the one line naming the register',
      run: async (ctx) => {
        const { brand, file } = stageManagerBrand();
        const packument = { ...MANAGER_PACKUMENT, time: { '0.55.0': '2026-10-01T09:00:00.000Z' } };

        const lines = await captureLines(() => withOfflineUpdate(() => runUpdateCommand(brand), { now: REGISTRY_NOW, packument }));

        const tail = afterSummary(ctx.expect, lines);
        ctx.expect(tail.some((line) => line.includes(`By-hand steps for every shape OMEGA changed since 0.54.1: ${file}`)), tail.join('\n')).toBeTruthy();
        ctx.expect(!tail.some((line) => line.includes('By-hand steps since')), 'no counted header').toBeTruthy();
        ctx.expect(!tail.some((line) => /\s{2}2026-\d\d-\d\d: /.test(line)), 'no entry line').toBeTruthy();
      },
    },

    {
      name: '--dry-run prints no by-hand block',
      run: async (ctx) => {
        const { brand } = stageManagerBrand();

        const lines = await captureLines(() => withOfflineUpdate(
          () => runUpdateCommand(brand, { 'dry-run': true, dryRun: true }),
          { now: REGISTRY_NOW, packument: MANAGER_PACKUMENT },
        ));

        ctx.expect(!lines.some((line) => line.includes('By-hand steps')), lines.join('\n')).toBeTruthy();
        ctx.expect(!lines.some((line) => line.includes('Each entry\'s step is in')), lines.join('\n')).toBeTruthy();
      },
    },

    {
      name: 'a run that did not move the manager pin prints no by-hand block',
      run: async (ctx) => {
        const { brand } = stageManagerBrand({ pin: '0.55.0' });

        let commands;
        const lines = await captureLines(async () => {
          ({ commands } = await withOfflineUpdate(() => runUpdateCommand(brand), { now: REGISTRY_NOW, packument: MANAGER_PACKUMENT }));
        });

        ctx.expect(commands, 'the pin is already current').toEqual([]);
        ctx.expect(!lines.some((line) => line.includes('By-hand steps')), lines.join('\n')).toBeTruthy();
      },
    },

    {
      name: 'a moved pin with no due entry in the register prints no by-hand block',
      run: async (ctx) => {
        const register = '# Breaking changes\n\n## 2026-09-20: an older shape\n\nAn older step.\n\n## ultimate-jekyll-manager → @omega.js/web\n\nThe legacy section.\n';
        const { brand } = stageManagerBrand({ register });

        let commands;
        const lines = await captureLines(async () => {
          ({ commands } = await withOfflineUpdate(() => runUpdateCommand(brand), { now: REGISTRY_NOW, packument: MANAGER_PACKUMENT }));
        });

        ctx.expect(commands, 'the pin moved').toEqual(['npm install @omega.js/manager@0.55.0 --save-dev --save-exact']);
        ctx.expect(!lines.some((line) => line.includes('By-hand steps')), lines.join('\n')).toBeTruthy();
        ctx.expect(!lines.some((line) => line.includes('Each entry\'s step is in')), lines.join('\n')).toBeTruthy();
      },
    },
  ],
});
