/**
 * Brand-root `omega update` fan-out — real execution over a staged fixture
 * brand (deploy-command.test.js pattern): fake framework packages whose
 * `omega` bins record every invocation, so fan-out, flag forwarding,
 * filtering, and the independent-apps failure model (no bail — unlike
 * deploy) are asserted from what actually got spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

/** Stage a brand monorepo with a web app + backend app and fake framework bins. */
function stageBrand() {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-update-cmd-')));
  const brand = path.join(scratch, 'brand');

  write(path.join(brand, 'package.json'), JSON.stringify({
    name: 'fixture-brand', private: true, workspaces: ['apps/*'],
  }));
  write(path.join(brand, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: {}, backend: {} },
}
`);

  write(path.join(brand, 'apps', 'website', 'package.json'), JSON.stringify({
    name: 'website', private: true, devDependencies: { '@omega.js/web': '*' },
  }));
  write(path.join(brand, 'apps', 'website', 'config', 'omega.json5'), '{ targets: { web: {} } }\n');

  write(path.join(brand, 'apps', 'backend', 'package.json'), JSON.stringify({
    name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' },
  }));
  write(path.join(brand, 'apps', 'backend', 'config', 'omega.json5'), '{ targets: { backend: {} } }\n');

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
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

// ─── Execution over the staged brand ─────────────────────────────────────────

test('bare run fans out to every app, each spawned `update` in its own cwd', async () => {
  const { brand } = stageBrand();
  const code = await runUpdateCommand(brand);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.name).sort(), ['backend', 'web']);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['update'], 'bare per-app: only the update command, no flags');
  }
  const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
  assert.equal(byName.backend.cwd, path.join(brand, 'apps', 'backend'));
  assert.equal(byName.web.cwd, path.join(brand, 'apps', 'website'));
  assert.equal(code, undefined, 'all apps green → no error exit code');
});

test('flags forward verbatim (--apply, --major, --min-age); --only is consumed here', async () => {
  const { brand } = stageBrand();
  await runUpdateCommand(brand, { apply: true, major: true, 'min-age': 14, minAge: 14 });

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['update', '--apply', '--major', '--min-age=14'], 'camelCase yargs twin never forwards twice');
  }

  fs.rmSync(path.join(brand, 'calls.log'));
  await runUpdateCommand(brand, { only: 'web' });
  assert.deepEqual(readCalls(brand).map((c) => c.name), ['web'], '--only filters and never forwards');
});

test('a filter matching nothing errors with zero spawns', async () => {
  const { brand } = stageBrand();
  const code = await runUpdateCommand(brand, { only: 'hosting' });

  assert.deepEqual(readCalls(brand), []);
  assert.equal(code, 1);
});

test('apps are INDEPENDENT: a failing app never blocks the rest, still exit 1', async () => {
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
