/**
 * Brand-root `omega build` / `omega clean` fan-outs (#603 addendum) — the two
 * verbs a brand root had for NO target type: every other verb (start, test,
 * deploy) already fanned out, so a brand could not build or clean itself in one
 * command.
 *
 * What the contract promises, and what these tests hold it to:
 *   - every target type runs, framework and custom alike, in DEPENDENCY order
 *     (the deploy order — backend first, custom targets last);
 *   - every target, framework and custom alike, runs its own
 *     `npm run <verb>` in its dir (a framework target's script is `omega <verb>`);
 *   - a target that declares no such script steps aside LOUDLY (naming the
 *     target AND the verb) and is never counted a failure;
 *   - a failing target does not stop the rest, and the run exits 1.
 *
 * Nothing here spawns anything: both commands take their runner as a seam
 * (custom-target.test.js's pattern), over a real fixture brand on disk.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const buildCommand = require('../src/commands/build.js');
const cleanCommand = require('../src/commands/clean.js');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * A brand monorepo on disk: a web target, a backend target, an extension
 * target, and a custom `api` target whose package.json carries `scripts`. The
 * dirs are written web-first so any ordering assertion proves the ORDER
 * came from the fan-out, not the directory listing.
 */
function stageBrand({ scripts = { build: 'tsc', clean: 'rm -rf dist' }, extension = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-build-cmd-')));

  write(path.join(root, 'package.json'), { name: 'fixture-brand', private: true, workspaces: ['targets/*'] });
  write(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' }, backend: { type: 'backend' }${extension ? ", extension: { type: 'extension' }" : ''}, api: { type: 'custom' } },
}
`);

  const verbScripts = { build: 'omega build', clean: 'omega clean' };
  write(path.join(root, 'targets', 'web', 'package.json'), { name: 'web', private: true, devDependencies: { '@omega.js/web': '*' }, scripts: verbScripts });
  write(path.join(root, 'targets', 'backend', 'package.json'), { name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' }, scripts: verbScripts });
  write(path.join(root, 'targets', 'api', 'package.json'), { name: 'api', private: true, scripts });
  if (extension) {
    write(path.join(root, 'targets', 'extension', 'package.json'), {
      name: 'extension', private: true, dependencies: { '@omega.js/extension': '*' }, scripts: { build: 'gulp build' },
    });
  }

  return root;
}

/**
 * Run a fan-out command from the brand root with its runner stubbed, capturing
 * console output and the exit code (both restored afterwards).
 */
async function runFanout(command, root, options = {}, { fail = [] } = {}) {
  const calls = [];
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  const cwd0 = process.cwd();
  const restoreTee = require('@omega.js/devkit/attach-log-file').mark();

  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  process.chdir(root);

  try {
    await command(options, {
      run: async (cmd, args, cwd) => {
        calls.push({ command: cmd, args, cwd, name: path.basename(cwd) });
        return fail.includes(path.basename(cwd)) ? { success: false, error: 'exit code 1' } : { success: true };
      },
    });
    return { calls, output: lines.join('\n'), code: process.exitCode };
  } finally {
    // The fan-out tees to <brandRoot>/logs/<verb>.log (#623) — release the
    // writers before the fixture is removed, or the tee keeps this process'
    // stdout pointed at a deleted file.
    restoreTee();
    console.log = originalLog;
    console.error = originalError;
    process.chdir(cwd0);
    process.exitCode = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'build-clean-command',
  tests: [
    // ─── the build fan-out ───────────────────────────────────────────────────────

    {
      name: 'omega build: every target type builds, in dependency order, custom LAST',
      run: async (ctx) => {
        const { calls, code } = await runFanout(buildCommand, stageBrand());

        ctx.expect(calls.map((call) => call.name)).toEqual(['backend', 'web', 'api']);
        ctx.expect(code, 'all targets green → no error exit code').toBe(undefined);

        // Every target runs its own script, framework and custom alike
        for (const call of calls) {
          ctx.expect(call.command).toBe('npm');
          ctx.expect(call.args).toEqual(['run', 'build']);
        }
      },
    },

    {
      name: 'omega build: a custom target with no build script is a LOUD skip, never a failure',
      run: async (ctx) => {
        const { calls, output, code } = await runFanout(buildCommand, stageBrand({ scripts: { clean: 'rm -rf dist' } }));

        ctx.expect(calls.map((call) => call.name), 'the api target ran nothing').toEqual(['backend', 'web']);
        ctx.expect(output, 'the skip names the target').toMatch(/api/);
        ctx.expect(output, 'and the verb it had no script for').toMatch(/"build" script/);
        ctx.expect(code, 'an absent script is not an error').toBe(undefined);
      },
    },

    {
      name: 'omega build: a framework target runs the build script it declares, never a bin behind it',
      run: async (ctx) => {
        const { calls } = await runFanout(buildCommand, stageBrand({ extension: true }));

        // The fixture extension declares `gulp build`: the target's script is the verb's one lane
        const extension = calls.find((call) => call.name === 'extension');
        ctx.expect(extension.command).toBe('npm');
        ctx.expect(extension.args).toEqual(['run', 'build']);
      },
    },

    {
      name: 'omega build: a failing target never stops the rest — every one is reported, exit 1',
      run: async (ctx) => {
        const { calls, code } = await runFanout(buildCommand, stageBrand(), {}, { fail: ['backend'] });

        ctx.expect(calls.map((call) => call.name), 'the fan-out kept going').toEqual(['backend', 'web', 'api']);
        ctx.expect(code).toBe(1);
      },
    },

    {
      name: 'omega build: --target= narrows to one target, by its NAME',
      run: async (ctx) => {
        const { calls } = await runFanout(buildCommand, stageBrand(), { target: 'api' });

        ctx.expect(calls.map((call) => call.name)).toEqual(['api']);

        const byName = await runFanout(buildCommand, stageBrand(), { target: 'web' });
        ctx.expect(byName.calls.map((call) => call.name), 'the name IS the dir').toEqual(['web']);
      },
    },

    {
      name: 'omega build: a --target= token matching nothing STOPS the run, never a matched subset',
      run: async (ctx) => {
        await ctx.expect((() => runFanout(buildCommand, stageBrand(), { target: 'hosting' }))()).rejects.toThrow((error) => {
            ctx.expect(error.refusal).toBe(true);
            ctx.expect(error.message).toMatch(/Unknown --target token "hosting"/);
            ctx.expect(error.message, 'the error names what the brand actually has').toMatch(/this brand's targets are api, backend, web/);
            return true;
          });

        // A typo beside a real target never builds the matched half
        await ctx.expect((() => runFanout(buildCommand, stageBrand(), { target: 'web,hosting' }))()).rejects.toThrow(/Unknown --target token "hosting"/);
      },
    },

    // The retired pickers (#780): both verbs share the one fan-out, so one refusal
    // serves both — never ignored, never aliased
    {
      name: 'omega build/clean: --only and --except are REFUSED, naming --target=',
      run: async (ctx) => {
        for (const command of [buildCommand, cleanCommand]) {
          await ctx.expect((() => runFanout(command, stageBrand(), { only: 'api' }))()).rejects.toThrow((error) => {
              ctx.expect(error.refusal, 'a refusal prints its message alone (no stack)').toBe(true);
              ctx.expect(error.message).toMatch(/--only is retired: pick targets with --target=/);
              return true;
            });
          await ctx.expect((() => runFanout(command, stageBrand(), { except: 'api' }))()).rejects.toThrow(/--except is retired/);
        }
      },
    },

    {
      name: 'omega build --dry-run: nothing runs at all, every target prints its plan',
      run: async (ctx) => {
        const { calls, output, code } = await runFanout(buildCommand, stageBrand(), { 'dry-run': true, dryRun: true });

        ctx.expect(calls, 'a dry run executes NOTHING').toEqual([]);
        ctx.expect(output, 'every target reports its plan').toMatch(/would run npm run build in targets\/backend/);
        ctx.expect(output).toMatch(/would run npm run build in targets\/web/);
        ctx.expect(output).toMatch(/would run npm run build in targets\/api/);
        ctx.expect(code, 'a dry run is not a failure').toBe(undefined);
      },
    },

    // ─── the clean fan-out ───────────────────────────────────────────────────────

    {
      name: 'omega clean: every target type cleans, in the same order',
      run: async (ctx) => {
        const { calls, code } = await runFanout(cleanCommand, stageBrand());

        ctx.expect(calls.map((call) => call.name)).toEqual(['backend', 'web', 'api']);
        ctx.expect(calls[0].args, 'a framework target runs its own script').toEqual(['run', 'clean']);
        ctx.expect(calls[2].args, 'and so does a custom target').toEqual(['run', 'clean']);
        ctx.expect(code).toBe(undefined);
      },
    },

    {
      name: 'omega clean: a custom target with no clean script is the same loud skip',
      run: async (ctx) => {
        const { calls, output, code } = await runFanout(cleanCommand, stageBrand({ scripts: { build: 'tsc' } }));

        ctx.expect(calls.map((call) => call.name)).toEqual(['backend', 'web']);
        ctx.expect(output).toMatch(/api/);
        ctx.expect(output).toMatch(/"clean" script/);
        ctx.expect(code).toBe(undefined);
      },
    },

    // ─── reachability + the no-brand guard ───────────────────────────────────────

    {
      name: 'cli routes `build` and `clean` through ALIASES to their command files',
      run: (ctx) => {
        const Main = require('../src/cli.js');

        for (const verb of ['build', 'clean']) {
          ctx.expect(Object.prototype.hasOwnProperty.call(Main.config.aliases, verb), `${verb} is aliased like dev/test/deploy`).toBeTruthy();
          ctx.expect(fs.existsSync(path.join(Main.config.commandsDir, `${verb}.js`)), `${verb}.js dispatches`).toBeTruthy();
        }
      },
    },

    {
      name: 'outside any brand: both verbs error with exit 1 and run nothing',
      run: async (ctx) => {
        for (const command of [buildCommand, cleanCommand]) {
          const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-build-cmd-nobrand-')));
          const { calls, code } = await runFanout(command, scratch);

          ctx.expect(calls).toEqual([]);
          ctx.expect(code).toBe(1);
        }
      },
    },
  ],
});
