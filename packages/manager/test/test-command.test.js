/**
 * Brand-root `omega test` fan-out (C5 brand layer) — real execution over a
 * staged fixture brand: fake framework packages whose `omega` bins record
 * every invocation (cwd + argv) to a log, so routing, forwarding, and exit
 * aggregation are asserted from what actually got spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testCommand = require('../src/commands/test.js');

// ─── Fixture staging ─────────────────────────────────────────────────────────

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

/**
 * Stage a brand monorepo with a web app (dep in its own package.json) and a
 * backend app (functions/ layout), plus fake @omega.js/web + @omega.js/backend
 * packages hoisted to the brand root.
 */
function stageBrand() {
  // realpath: macOS tmpdir is a symlink (/var → /private/var) and spawned
  // children report the real cwd
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-test-cmd-')));
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

  // App-root manifest (src/dist pillar): the backend's framework dep is a
  // RUNTIME dependency on the ONE app package.json — no functions/ manifest.
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
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

/** Run the command from `cwd` with positional targets, restoring cwd + exitCode. */
async function runTestCommand(cwd, targets) {
  const cwd0 = process.cwd();
  process.chdir(cwd);
  try {
    await testCommand({ _: ['test', ...targets] });
    return process.exitCode;
  } finally {
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('bare run fans out to every app: each spawned bare, in its own cwd', async () => {
  const { brand } = stageBrand();
  const code = await runTestCommand(brand, []);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls.map((c) => c.name)), new Set(['web', 'backend']));
  for (const call of calls) {
    assert.deepEqual(call.argv, ['test'], 'bare per-app: only the test command, no targets');
  }
  const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
  assert.equal(byName.web.cwd, path.join(brand, 'apps', 'website'));
  assert.equal(byName.backend.cwd, path.join(brand, 'apps', 'backend'));
  assert.equal(code, undefined, 'all apps green → no error exit code');
});

test('per-framework id routes ONLY to the owning app, target forwarded verbatim', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['web:pages/']);

  const calls = readCalls(brand);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'web');
  assert.deepEqual(calls[0].argv, ['test', 'web:pages/']);
});

test('universal framework: forwards to every app', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['framework:']);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['test', 'framework:']);
  }
});

test('mixed targets: shared paths to every app, id-scoped only to its owner', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['backend:routes/x', 'checkout']);

  const byName = Object.fromEntries(readCalls(brand).map((c) => [c.name, c]));
  assert.deepEqual(byName.backend.argv, ['test', 'checkout', 'backend:routes/x']);
  assert.deepEqual(byName.web.argv, ['test', 'checkout']);
});

test('id with no matching app: warns, runs nothing, exits clean (app-level filter parity)', async () => {
  const { brand } = stageBrand();
  const code = await runTestCommand(brand, ['desktop:']);

  assert.deepEqual(readCalls(brand), []);
  assert.equal(code, undefined);
});

test('only-invalid targets fall back to bare-everywhere (scope.js parity)', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['framwork:oops']);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['test']);
  }
});

test('a failing app fails the run, but every app still runs (sequential, no bail)', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
  const code = await runTestCommand(brand, []);

  assert.equal(readCalls(brand).length, 2, 'web still ran after the backend failure');
  assert.equal(code, 1);
});

test('outside any brand: errors with exit 1', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-test-cmd-nobrand-'));
  const code = await runTestCommand(scratch, []);
  assert.equal(code, 1);
});

test('cli routes `test` through ALIASES to the command file', () => {
  const Main = require('../src/cli.js');
  assert.ok(Object.prototype.hasOwnProperty.call(Main.config.aliases, 'test'));
  assert.ok(fs.existsSync(path.join(Main.config.commandsDir, 'test.js')));
});
