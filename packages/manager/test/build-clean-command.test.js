/**
 * Brand-root `omega build` / `omega clean` fan-outs (#603 addendum) — the two
 * verbs a brand root had for NO target type: every other verb (start, test,
 * deploy) already fanned out, so a brand could not build or clean itself in one
 * command.
 *
 * What the contract promises, and what these tests hold it to:
 *   - every target type runs, framework and custom alike, in DEPENDENCY order
 *     (the deploy order — backend first, custom targets last);
 *   - a framework target dispatches its framework's own `omega <verb>`; a
 *     custom target runs `npm run <verb>` in its dir with no flags forwarded;
 *   - a target that declares no such script steps aside LOUDLY (naming the
 *     target AND the verb) and is never counted a failure;
 *   - a failing target does not stop the rest, and the run exits 1.
 *
 * Nothing here spawns anything: both commands take their runner as a seam
 * (custom-target.test.js's pattern), over a real fixture brand on disk.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
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
 * dirs are written website-first so any ordering assertion proves the ORDER
 * came from the fan-out, not the directory listing.
 */
function stageBrand({ scripts = { build: 'tsc', clean: 'rm -rf dist' }, extension = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-build-cmd-')));

  write(path.join(root, 'package.json'), { name: 'fixture-brand', private: true, workspaces: ['targets/*'] });
  write(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: {}, backend: {}${extension ? ', extension: {}' : ''}, api: { type: 'custom' } },
}
`);

  write(path.join(root, 'targets', 'website', 'package.json'), { name: 'website', private: true, devDependencies: { '@omega.js/web': '*' } });
  write(path.join(root, 'targets', 'backend', 'package.json'), { name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' } });
  write(path.join(root, 'targets', 'api', 'package.json'), { name: 'api', private: true, scripts });
  if (extension) {
    write(path.join(root, 'targets', 'extension', 'package.json'), {
      name: 'extension', private: true, dependencies: { '@omega.js/extension': '*' }, scripts: { build: 'gulp build' },
    });
  }

  for (const pkg of ['@omega.js/web', '@omega.js/backend', '@omega.js/extension']) {
    const pkgDir = path.join(root, 'node_modules', pkg);
    write(path.join(pkgDir, 'package.json'), { name: pkg, bin: { omega: './bin.js' } });
    write(path.join(pkgDir, 'bin.js'), '#!/usr/bin/env node\n');
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
    require('@omega.js/devkit/attach-log-file').detach();
    console.log = originalLog;
    console.error = originalError;
    process.chdir(cwd0);
    process.exitCode = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ─── the build fan-out ───────────────────────────────────────────────────────

test('omega build: every target type builds, in dependency order, custom LAST', async () => {
  const { calls, code } = await runFanout(buildCommand, stageBrand());

  assert.deepEqual(calls.map((call) => call.name), ['backend', 'website', 'api']);
  assert.equal(code, undefined, 'all targets green → no error exit code');

  // A framework target dispatches its OWN framework's `omega build`
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args.slice(1), ['build']);
  assert.match(calls[0].args[0], /@omega\.js\/backend/);
  assert.match(calls[1].args[0], /@omega\.js\/web/);

  // A custom target runs its own script — no framework bin, no flags
  assert.equal(calls[2].command, 'npm');
  assert.deepEqual(calls[2].args, ['run', 'build']);
});

test('omega build: a custom target with no build script is a LOUD skip, never a failure', async () => {
  const { calls, output, code } = await runFanout(buildCommand, stageBrand({ scripts: { clean: 'rm -rf dist' } }));

  assert.deepEqual(calls.map((call) => call.name), ['backend', 'website'], 'the api target ran nothing');
  assert.match(output, /api/, 'the skip names the target');
  assert.match(output, /"build" script/, 'and the verb it had no script for');
  assert.equal(code, undefined, 'an absent script is not an error');
});

test('omega build: an extension target takes the FRAMEWORK lane — its CLI serves the verb (#81)', async () => {
  const { calls } = await runFanout(buildCommand, stageBrand({ extension: true }));

  // The fixture target declares a `build` script of its own, so this also
  // proves the framework lane WINS over one: @omega.js/extension ships
  // `omega build` (the verb owns clean + the gulp build), and the script it
  // scaffolds is the thin alias of that verb.
  const extension = calls.find((call) => call.name === 'extension');
  assert.equal(extension.command, process.execPath);
  assert.deepEqual(extension.args.slice(1), ['build']);
  assert.match(extension.args[0], /@omega\.js\/extension/);
});

test('omega build: a failing target never stops the rest — every one is reported, exit 1', async () => {
  const { calls, code } = await runFanout(buildCommand, stageBrand(), {}, { fail: ['backend'] });

  assert.deepEqual(calls.map((call) => call.name), ['backend', 'website', 'api'], 'the fan-out kept going');
  assert.equal(code, 1);
});

test('omega build: --target= narrows to one target, by target key or dir name', async () => {
  const { calls } = await runFanout(buildCommand, stageBrand(), { target: 'api' });

  assert.deepEqual(calls.map((call) => call.name), ['api']);

  const byKey = await runFanout(buildCommand, stageBrand(), { target: 'web' });
  assert.deepEqual(byKey.calls.map((call) => call.name), ['website'], 'the target key names the dir');
});

test('omega build: a --target= token matching nothing STOPS the run, never a matched subset', async () => {
  await assert.rejects(
    () => runFanout(buildCommand, stageBrand(), { target: 'hosting' }),
    (error) => {
      assert.equal(error.refusal, true);
      assert.match(error.message, /Unknown --target token "hosting"/);
      assert.match(error.message, /this brand's targets are api, backend, web/, 'the error names what the brand actually has');
      return true;
    },
  );

  // A typo beside a real target never builds the matched half
  await assert.rejects(() => runFanout(buildCommand, stageBrand(), { target: 'web,hosting' }), /Unknown --target token "hosting"/);
});

// The retired pickers (#780): both verbs share the one fan-out, so one refusal
// serves both — never ignored, never aliased
test('omega build/clean: --only and --except are REFUSED, naming --target=', async () => {
  for (const command of [buildCommand, cleanCommand]) {
    await assert.rejects(
      () => runFanout(command, stageBrand(), { only: 'api' }),
      (error) => {
        assert.equal(error.refusal, true, 'a refusal prints its message alone (no stack)');
        assert.match(error.message, /--only is retired: pick targets with --target=/);
        return true;
      },
    );
    await assert.rejects(() => runFanout(command, stageBrand(), { except: 'api' }), /--except is retired/);
  }
});

test('omega build --dry-run: nothing runs at all, every target prints its plan', async () => {
  const { calls, output, code } = await runFanout(buildCommand, stageBrand(), { 'dry-run': true, dryRun: true });

  assert.deepEqual(calls, [], 'a dry run executes NOTHING — no framework bin, no package script');
  assert.match(output, /would run omega build in targets\/backend/, 'the framework lane reports the plan');
  assert.match(output, /would run omega build in targets\/website/);
  assert.match(output, /would run npm run build in targets\/api/, 'the custom lane reports its plan too');
  assert.equal(code, undefined, 'a dry run is not a failure');
});

// ─── the clean fan-out ───────────────────────────────────────────────────────

test('omega clean: every target type cleans, in the same order', async () => {
  const { calls, code } = await runFanout(cleanCommand, stageBrand());

  assert.deepEqual(calls.map((call) => call.name), ['backend', 'website', 'api']);
  assert.deepEqual(calls[0].args.slice(1), ['clean'], 'the framework lane runs `omega clean`');
  assert.deepEqual(calls[2].args, ['run', 'clean'], 'the custom lane runs its own script');
  assert.equal(code, undefined);
});

test('omega clean: a custom target with no clean script is the same loud skip', async () => {
  const { calls, output, code } = await runFanout(cleanCommand, stageBrand({ scripts: { build: 'tsc' } }));

  assert.deepEqual(calls.map((call) => call.name), ['backend', 'website']);
  assert.match(output, /api/);
  assert.match(output, /"clean" script/);
  assert.equal(code, undefined);
});

// ─── reachability + the no-brand guard ───────────────────────────────────────

test('cli routes `build` and `clean` through ALIASES to their command files', () => {
  const Main = require('../src/cli.js');

  for (const verb of ['build', 'clean']) {
    assert.ok(Object.prototype.hasOwnProperty.call(Main.config.aliases, verb), `${verb} is aliased like dev/test/deploy`);
    assert.ok(fs.existsSync(path.join(Main.config.commandsDir, `${verb}.js`)), `${verb}.js dispatches`);
  }
});

test('outside any brand: both verbs error with exit 1 and run nothing', async () => {
  for (const command of [buildCommand, cleanCommand]) {
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-build-cmd-nobrand-')));
    const { calls, code } = await runFanout(command, scratch);

    assert.deepEqual(calls, []);
    assert.equal(code, 1);
  }
});
