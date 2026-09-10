/**
 * Brand-root `omega update` fan-out — real execution over a staged fixture
 * brand (deploy-command.test.js pattern): fake framework packages whose
 * `omega` bins record every invocation, so fan-out, flag forwarding,
 * filtering, and the independent-targets failure model (no bail — unlike
 * deploy) are asserted from what actually got spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const devkitUpdate = require('@omega.js/devkit/update');
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
  targets: { web: {}, backend: {} },
}
`);

  write(path.join(brand, 'targets', 'website', 'package.json'), JSON.stringify({
    name: 'website', private: true, devDependencies: { '@omega.js/web': '*' },
  }));
  write(path.join(brand, 'targets', 'website', 'config', 'omega.json5'), '{ targets: { web: {} } }\n');

  write(path.join(brand, 'targets', 'backend', 'package.json'), JSON.stringify({
    name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' },
  }));
  write(path.join(brand, 'targets', 'backend', 'config', 'omega.json5'), '{ targets: { backend: {} } }\n');

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
  process.chdir(cwd);
  try {
    await updateCommand({ _: ['update'], ...options });
    return process.exitCode;
  } finally {
    // The verb tees to <brandRoot>/logs/<verb>.log (#623) — release the writers
    // so the next case starts from an unpatched stdout.
    require('@omega.js/devkit/attach-log-file').detach();
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

// ─── Execution over the staged brand ─────────────────────────────────────────

test('bare run fans out to every target, each spawned `update` in its own cwd', async () => {
  const { brand } = stageBrand();
  const code = await runUpdateCommand(brand);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.name).sort(), ['backend', 'web']);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['update'], 'bare per-target: only the update command, no flags');
  }
  const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
  assert.equal(byName.backend.cwd, path.join(brand, 'targets', 'backend'));
  assert.equal(byName.web.cwd, path.join(brand, 'targets', 'website'));
  assert.equal(code, undefined, 'all targets green → no error exit code');
});

test('flags forward verbatim (--apply, --major, --min-age); --target= is consumed here', async () => {
  const { brand } = stageBrand();
  await runUpdateCommand(brand, { apply: true, major: true, 'min-age': 14, minAge: 14 });

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['update', '--apply', '--major', '--min-age=14'], 'camelCase yargs twin never forwards twice');
  }

  fs.rmSync(path.join(brand, 'calls.log'));
  await runUpdateCommand(brand, { target: 'web' });
  assert.deepEqual(readCalls(brand).map((c) => c.name), ['web'], '--target= picks and never forwards');
});

// The retired pickers (#780) — never ignored, never aliased
test('--only and --except are REFUSED, naming --target=; zero spawns', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runUpdateCommand(brand, { only: 'web' }),
    (error) => {
      assert.equal(error.refusal, true, 'a refusal prints its message alone (no stack)');
      assert.match(error.message, /--only is retired: pick targets with --target=/);
      return true;
    },
  );
  await assert.rejects(() => runUpdateCommand(brand, { except: 'backend' }), /--except is retired/);

  assert.deepEqual(readCalls(brand), []);
});

test('a --target= token matching nothing STOPS the run, never a matched subset', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runUpdateCommand(brand, { target: 'hosting' }),
    (error) => {
      assert.equal(error.refusal, true);
      assert.match(error.message, /Unknown --target token "hosting"/);
      return true;
    },
  );

  // A typo beside a real target never checks the matched half
  await assert.rejects(() => runUpdateCommand(brand, { target: 'web,hosting' }), /Unknown --target token "hosting"/);

  assert.deepEqual(readCalls(brand), []);
});

test('targets are INDEPENDENT: a failing target never blocks the rest, still exit 1', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
  const code = await runUpdateCommand(brand);

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name).sort(), ['backend', 'web'], 'web still checked after the backend failure');
  assert.equal(code, 1);
});

test('outside any brand: errors with exit 1', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-update-cmd-nobrand-'));
  const code = await runUpdateCommand(scratch);
  assert.equal(code, 1);
});

test('cli routes `update` (+ outdated/out aliases) through ALIASES to the command file', () => {
  const Main = require('../src/cli.js');
  assert.ok(Object.prototype.hasOwnProperty.call(Main.config.aliases, 'update'));
  assert.ok(Main.config.aliases.update.includes('outdated'));
  assert.ok(Main.config.aliases.update.includes('out'));
  assert.ok(fs.existsSync(path.join(Main.config.commandsDir, 'update.js')));
});

// ─── The brand root rides the fan-out for its own pin (#794) ────────────────

/**
 * The real devkit runUpdate, with only its documented seams replaced: a fixture
 * packument (no registry) and a recording exec (no install). What comes back is
 * the exact command npm would have run.
 */
function withOfflineUpdate(fn) {
  const original = devkitUpdate.runUpdate;
  const commands = [];

  devkitUpdate.runUpdate = (options) => original({
    ...options,
    hasNpu: false,
    now: Date.parse('2026-09-03T00:00:00Z'),
    lookup: async (name) => ({
      latest: '0.5.0',
      versions: ['0.4.0', '0.5.0'],
      times: { '0.5.0': '2026-01-01T00:00:00Z', '0.4.0': '2025-12-01T00:00:00Z' },
      name,
    }),
    execFn: (command) => commands.push(command),
  });

  return Promise.resolve(fn()).then(
    (value) => { devkitUpdate.runUpdate = original; return { value, commands }; },
    (error) => { devkitUpdate.runUpdate = original; throw error; },
  );
}

test('the brand ROOT rides the fan-out for @omega.js/manager, applied with --save-exact (#794)', async () => {
  const { brand } = stageBrand();
  write(path.join(brand, 'package.json'), JSON.stringify({
    name: 'fixture-brand', private: true, workspaces: ['targets/*'],
    devDependencies: { '@omega.js/manager': '0.4.0', 'some-brand-tool': '^1.0.0' },
  }));

  const { commands } = await withOfflineUpdate(() => runUpdateCommand(brand, { apply: true }));

  assert.deepEqual(commands, ['npm install @omega.js/manager@0.5.0 --save-dev --save-exact'],
    'the root pin moves with the family, exactly — and nothing else at the root is touched');

  // The targets still fan out exactly as before
  assert.deepEqual(readCalls(brand).map((c) => c.name).sort(), ['backend', 'web']);
});

test('a picked run leaves the brand root alone — --target= names targets', async () => {
  const { brand } = stageBrand();
  write(path.join(brand, 'package.json'), JSON.stringify({
    name: 'fixture-brand', private: true, workspaces: ['targets/*'],
    devDependencies: { '@omega.js/manager': '0.4.0' },
  }));

  const { commands } = await withOfflineUpdate(() => runUpdateCommand(brand, { apply: true, target: 'web' }));

  assert.deepEqual(commands, [], 'nothing ran for the root');
  assert.deepEqual(readCalls(brand).map((c) => c.name), ['web']);
});
