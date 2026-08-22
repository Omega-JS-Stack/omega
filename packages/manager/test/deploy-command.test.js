/**
 * Brand-root `omega deploy` fan-out (D13 brand layer) — real execution over a
 * staged fixture brand: fake framework packages whose `omega` bins record
 * every invocation (cwd + argv) to a log, so ordering (backend FIRST), flag
 * forwarding, filtering, and the stop-on-failure bail are asserted from what
 * actually got spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const deployCommand = require('../src/commands/deploy.js');
const { selectDeployTargets, buildForwardedFlags } = deployCommand;

// ─── Fixture staging (test-command.test.js pattern) ──────────────────────────

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
 * Stage a brand monorepo with a web app and a backend app (LISTED so the
 * website dir sorts before backend — proving the order comes from
 * DEPLOY_ORDER, not the directory listing), plus fake framework packages.
 */
function stageBrand() {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-deploy-cmd-')));
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
async function runDeployCommand(cwd, options = {}) {
  const cwd0 = process.cwd();
  process.chdir(cwd);
  try {
    await deployCommand({ _: ['deploy'], ...options });
    return process.exitCode;
  } finally {
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

// ─── Execution over the staged brand ─────────────────────────────────────────

test('bare run fans out to every target, BACKEND FIRST, each spawned `deploy` in its own cwd', async () => {
  const { brand } = stageBrand();
  const code = await runDeployCommand(brand);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  // Order is DEPLOY_ORDER (backend → web), not the directory listing
  assert.deepEqual(calls.map((c) => c.name), ['backend', 'web']);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['deploy'], 'bare per-target: only the deploy command, no flags');
  }
  assert.equal(calls[0].cwd, path.join(brand, 'targets', 'backend'));
  assert.equal(calls[1].cwd, path.join(brand, 'targets', 'website'));
  assert.equal(code, undefined, 'all targets green → no error exit code');
});

test('flags forward verbatim to every target; --only/--except are consumed here', async () => {
  const { brand } = stageBrand();
  // yargs shape: kebab original + camelCase twin (the twin must NOT forward twice)
  await runDeployCommand(brand, { 'dry-run': true, dryRun: true, direct: true });

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['deploy', '--dry-run', '--direct']);
  }
});

test('--only filters by target or target dir name; nothing else runs', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand, { only: 'web' });

  let calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['web']);
  assert.deepEqual(calls[0].argv, ['deploy'], '--only never forwards');

  fs.rmSync(path.join(brand, 'calls.log'));
  await runDeployCommand(brand, { only: 'backend,website' }); // dir name matches too
  calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['backend', 'web'], 'order stays backend-first regardless of the flag order');
});

test('--except subtracts from the set', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand, { except: 'backend' });

  assert.deepEqual(readCalls(brand).map((c) => c.name), ['web']);
});

test('a filter matching nothing NEVER falls back to deploy-everything — error, zero spawns', async () => {
  const { brand } = stageBrand();
  const code = await runDeployCommand(brand, { only: 'hosting' });

  assert.deepEqual(readCalls(brand), []);
  assert.equal(code, 1);
});

test('a failing backend STOPS the run before web (later targets depend on it) — exit 1', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
  const code = await runDeployCommand(brand);

  assert.deepEqual(readCalls(brand).map((c) => c.name), ['backend'], 'web never deployed after the backend failure');
  assert.equal(code, 1);
});

test('--continue-on-error keeps going past the failure, still exit 1', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
  const code = await runDeployCommand(brand, { 'continue-on-error': true, continueOnError: true });

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['backend', 'web']);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['deploy'], 'the brand-level bail switch never forwards');
  }
  assert.equal(code, 1);
});

test('outside any brand: errors with exit 1', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-deploy-cmd-nobrand-'));
  const code = await runDeployCommand(scratch);
  assert.equal(code, 1);
});

test('cli routes `deploy` through ALIASES to the command file', () => {
  const Main = require('../src/cli.js');
  assert.ok(Object.prototype.hasOwnProperty.call(Main.config.aliases, 'deploy'));
  assert.ok(fs.existsSync(path.join(Main.config.commandsDir, 'deploy.js')));
});

// ─── Units ───────────────────────────────────────────────────────────────────

test('selectDeployTargets: full DEPLOY_ORDER — backend, web, then the rest', () => {
  const targets = [
    { name: 'desktop', target: 'desktop' },
    { name: 'website', target: 'web' },
    { name: 'extension', target: 'extension' },
    { name: 'backend', target: 'backend' },
  ];
  const { selected, unknown } = selectDeployTargets({ targets });
  assert.deepEqual(selected.map((entry) => entry.target), ['backend', 'web', 'extension', 'desktop']);
  assert.deepEqual(unknown, []);
});

test('selectDeployTargets: unknown tokens are reported, matched ones still select', () => {
  const targets = [{ name: 'website', target: 'web' }];
  const { selected, unknown } = selectDeployTargets({ targets, only: 'web,hosting' });
  assert.deepEqual(selected.map((entry) => entry.name), ['website']);
  assert.deepEqual(unknown, ['hosting']);
});

test('buildForwardedFlags: values, booleans, --no- forms; yargs bookkeeping consumed', () => {
  const flags = buildForwardedFlags({
    _: ['deploy'],
    $0: 'omega',
    only: 'web',
    except: 'backend',
    'continue-on-error': true,
    continueOnError: true,
    'dry-run': true,
    dryRun: true,
    sync: false,
    platforms: 'mac,win',
  });
  assert.deepEqual(flags, ['--dry-run', '--no-sync', '--platforms=mac,win']);
});
