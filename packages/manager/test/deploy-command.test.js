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

// ─── The delivery lane's boundary (#678) ─────────────────────────────────────
// The lane deploy runs before it fans out is manage's own runner, stubbed HERE
// (dev.test.js's pattern) so the ORDER — lane first, then the targets — is
// observable in the same call log the fake framework bins write to, and no
// service walk ever touches a fixture brand.
const managePath = require.resolve('../src/manage.js');
const manageCalls = [];
let manageReport = { hasErrors: false, results: {}, brand: {} };

require.cache[managePath] = {
  id: managePath,
  filename: managePath,
  path: path.dirname(managePath),
  loaded: true,
  exports: {
    runManage: async (startDir, options) => {
      manageCalls.push({ startDir, options });
      fs.appendFileSync(path.join(startDir, 'calls.log'), `${JSON.stringify({ name: 'delivery-lane', cwd: startDir, argv: [] })}\n`);
      return manageReport;
    },
  },
};

const deployCommand = require('../src/commands/deploy.js');
const { selectTargets, buildForwardedFlags } = deployCommand;
const { BOOT_SERVICES } = require('../src/config.js');

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

/**
 * The TARGET spawns from the brand's call log. The delivery lane records
 * itself there too — it must run before the first spawn (#678) — so
 * `{ all: true }` is how the ordering assertion sees both.
 */
function readCalls(brand, { all = false } = {}) {
  const logPath = path.join(brand, 'calls.log');
  if (!fs.existsSync(logPath)) return [];
  const entries = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return all ? entries : entries.filter((entry) => entry.name !== 'delivery-lane');
}

/** Run the command from `cwd` with parsed options, restoring cwd + exitCode. */
async function runDeployCommand(cwd, options = {}) {
  manageCalls.length = 0;
  const cwd0 = process.cwd();
  process.chdir(cwd);
  try {
    await deployCommand({ _: ['deploy'], ...options });
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

test('flags forward verbatim to every target; --target= is consumed here', async () => {
  const { brand } = stageBrand();
  // yargs shape: kebab original + camelCase twin (the twin must NOT forward twice)
  await runDeployCommand(brand, { 'dry-run': true, dryRun: true, direct: true });

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['deploy', '--dry-run', '--direct']);
  }
});

test('--target= picks by target key or target dir name; nothing else runs', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand, { target: 'web' });

  let calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['web']);
  assert.deepEqual(calls[0].argv, ['deploy'], '--target= never forwards');

  fs.rmSync(path.join(brand, 'calls.log'));
  await runDeployCommand(brand, { target: 'backend,website' }); // dir name matches too
  calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['backend', 'web'], 'order stays backend-first regardless of the flag order');
});

// The retired pickers (#780) — `--only` is firebase's own flag on the backend
// target, so accepting it at the brand root would mean two things at once
test('--only and --except are REFUSED, not ignored and not aliased — zero spawns', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runDeployCommand(brand, { only: 'web' }),
    (error) => {
      assert.equal(error.refusal, true, 'a refusal prints its message alone (no stack)');
      assert.match(error.message, /--only is retired: pick targets with --target=/);
      assert.match(error.message, /firebase's own --only hosting runs from targets\/backend/, 'the sentence names where the firebase flag DOES belong');
      return true;
    },
  );
  await assert.rejects(() => runDeployCommand(brand, { except: 'backend' }), /--except is retired/);

  assert.deepEqual(readCalls(brand, { all: true }), [], 'not even the delivery lane ran');
});

test('a --target= token matching nothing STOPS the run — never a matched subset, never deploy-everything', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runDeployCommand(brand, { target: 'hosting' }),
    (error) => {
      assert.equal(error.refusal, true);
      assert.match(error.message, /Unknown --target token "hosting"/);
      assert.match(error.message, /this brand's targets are backend, web/, 'the error names what the brand actually has');
      return true;
    },
  );

  // A typo BESIDE a real target must not quietly deploy the matched half
  await assert.rejects(() => runDeployCommand(brand, { target: 'web,hosting' }), /Unknown --target token "hosting"/);

  assert.deepEqual(readCalls(brand, { all: true }), [], 'not even the delivery lane ran');
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

// ─── The delivery lane (#678) ────────────────────────────────────────────────

test('the delivery lane runs ONCE, before the first target — brand inputs land before anything publishes', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand);

  assert.deepEqual(readCalls(brand, { all: true }).map((c) => c.name), ['delivery-lane', 'backend', 'web']);
  assert.equal(manageCalls.length, 1, 'one lane pass for the whole fan-out, not one per target');
  assert.equal(manageCalls[0].startDir, brand);
});

test('the lane deploy runs IS the boot lane — one constant, two triggers', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand);

  // The lane is asked for BY NAME, so its service list can never be a second
  // copy of BOOT_SERVICES: manage resolves 'boot' to that constant
  // (manage.test.js pins the resolution), and deploy hand-picks nothing.
  assert.equal(manageCalls[0].options.lane, 'boot');
  assert.equal(manageCalls[0].options.service, undefined);
  assert.ok(BOOT_SERVICES.includes('disperse'), 'the delivery services are the boot lane\'s');
});

test('--dry-run reaches the lane too — a planned deploy plans its delivery', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand, { 'dry-run': true, dryRun: true });

  assert.equal(manageCalls[0].options.dryRun, true);
});

test('a delivery lane with errors stops the deploy — nothing publishes on broken inputs', async () => {
  const { brand } = stageBrand();
  manageReport = { hasErrors: true, results: {}, brand: {} };

  try {
    const code = await runDeployCommand(brand);

    assert.equal(code, 1);
    assert.deepEqual(readCalls(brand), [], 'no target was spawned');
  } finally {
    manageReport = { hasErrors: false, results: {}, brand: {} };
  }
});

// ─── Units ───────────────────────────────────────────────────────────────────

test('selectTargets: full DEPLOY_ORDER — backend, web, then the rest', () => {
  const targets = [
    { name: 'desktop', target: 'desktop' },
    { name: 'website', target: 'web' },
    { name: 'extension', target: 'extension' },
    { name: 'backend', target: 'backend' },
  ];
  const { selected } = selectTargets({ targets });
  assert.deepEqual(selected.map((entry) => entry.target), ['backend', 'web', 'extension', 'desktop']);
});

test('selectTargets: an unknown token throws — a matched subset is never returned', () => {
  const targets = [{ name: 'website', target: 'web' }];

  assert.throws(
    () => selectTargets({ targets, target: 'web,hosting' }),
    (error) => {
      assert.equal(error.refusal, true);
      assert.match(error.message, /Unknown --target token "hosting": this brand's targets are web\. Nothing ran\./);
      return true;
    },
  );

  assert.deepEqual(selectTargets({ targets, target: 'web' }).selected.map((entry) => entry.name), ['website']);
});

test('buildForwardedFlags: values, booleans, --no- forms; yargs bookkeeping consumed', () => {
  const flags = buildForwardedFlags({
    _: ['deploy'],
    $0: 'omega',
    target: 'web',
    'continue-on-error': true,
    continueOnError: true,
    'dry-run': true,
    dryRun: true,
    sync: false,
    platforms: 'mac,win',
  });
  assert.deepEqual(flags, ['--dry-run', '--no-sync', '--platforms=mac,win']);
});
