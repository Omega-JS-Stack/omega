/**
 * Workspace `scripts` ensure op + the package-scripts heal lib — a `deploy`
 * script is guaranteed and the legacy `start: 'omega'` shape migrates to the
 * dev-stack convention (`start: 'omega dev'` + `manage: 'omega'`), nothing
 * else is ever touched (the retired `omega-manager` bin name is not rewritten:
 * brands edit it by hand), and a converged file rewrites nothing (idempotence
 * proven by bytes).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scriptsOp = require('../src/services/workspace/ensure/scripts.js');
const { healPackageScripts, healTargetScripts, DEPLOY_SCRIPT, START_SCRIPT, MANAGE_SCRIPT } = require('../src/lib/package-scripts.js');

function tmpBrand(pkg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-ws-scripts-'));
  if (pkg !== undefined) {
    fs.writeFileSync(path.join(root, 'package.json'), typeof pkg === 'string' ? pkg : `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return root;
}

function readPkg(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

// ─── The heal lib (pure) ─────────────────────────────────────────────────────

test('healPackageScripts: adds deploy when absent, keeps an existing deploy, never rewrites an unrelated value', () => {
  const healed = healPackageScripts({ scripts: { start: 'omega-manager', build: 'echo hi' } });
  assert.deepEqual(healed.scripts, { start: 'omega-manager', build: 'echo hi', manage: MANAGE_SCRIPT, deploy: DEPLOY_SCRIPT },
    'the retired bin name is left verbatim — it is not the legacy shape this migration knows; manage is minted beside it');
  assert.deepEqual(healed.changes, [`manage: '${MANAGE_SCRIPT}'`, `deploy: '${DEPLOY_SCRIPT}'`]);

  const kept = healPackageScripts({ scripts: { start: START_SCRIPT, manage: MANAGE_SCRIPT, deploy: 'my-own-deploy' } });
  assert.equal(kept.scripts.deploy, 'my-own-deploy', 'an existing deploy script is never overwritten');
  assert.deepEqual(kept.changes, []);
});

test('healPackageScripts: migrates the legacy `start: omega` shape to the dev stack + a manage script', () => {
  const migrated = healPackageScripts({
    scripts: { start: 'omega', dev: 'omega dev', deploy: DEPLOY_SCRIPT, pipeline: 'omega pipeline' },
  });
  assert.deepEqual(migrated.scripts, {
    start: START_SCRIPT,
    dev: 'omega dev',
    deploy: DEPLOY_SCRIPT,
    pipeline: 'omega pipeline',
    manage: MANAGE_SCRIPT,
  }, 'npm start boots the dev stack; the bare manage cycle moves to `manage`; every other script survives');
  assert.deepEqual(migrated.changes, [`start: '${START_SCRIPT}'`, `manage: '${MANAGE_SCRIPT}'`]);

  // Second pass over the migrated shape: nothing left to do
  assert.deepEqual(healPackageScripts({ scripts: migrated.scripts }).changes, []);

  // An existing manage script is never overwritten
  const ownManage = healPackageScripts({ scripts: { start: 'omega', manage: 'my-own-manage', deploy: DEPLOY_SCRIPT } });
  assert.equal(ownManage.scripts.manage, 'my-own-manage');
  assert.deepEqual(ownManage.changes, [`start: '${START_SCRIPT}'`]);
});

test('healPackageScripts: migrates the legacy `manage: omega` to the named verb (#229), idempotently', () => {
  const migrated = healPackageScripts({
    scripts: { start: START_SCRIPT, manage: 'omega', deploy: DEPLOY_SCRIPT },
  });

  assert.equal(MANAGE_SCRIPT, 'omega manage', 'a bare `omega` prints help now — the script must name the verb');
  assert.equal(migrated.scripts.manage, MANAGE_SCRIPT);
  assert.deepEqual(migrated.changes, [`manage: '${MANAGE_SCRIPT}'`]);

  // Second pass over the migrated shape: nothing left to do
  assert.deepEqual(healPackageScripts({ scripts: migrated.scripts }).changes, []);

  // A brand that customized its manage script keeps it
  const own = healPackageScripts({ scripts: { start: START_SCRIPT, manage: 'node tools/manage.js', deploy: DEPLOY_SCRIPT } });
  assert.equal(own.scripts.manage, 'node tools/manage.js');
  assert.deepEqual(own.changes, []);
});

test('healPackageScripts: a customized start value is left alone; manage is still minted so the retry hints answer', () => {
  const custom = healPackageScripts({ scripts: { start: 'node server.js', deploy: DEPLOY_SCRIPT } });
  assert.deepEqual(custom.scripts, { start: 'node server.js', deploy: DEPLOY_SCRIPT, manage: MANAGE_SCRIPT },
    'the customized start survives verbatim; the new manage key overwrites nothing');
  assert.deepEqual(custom.changes, [`manage: '${MANAGE_SCRIPT}'`]);

  // Second pass: converged
  assert.deepEqual(healPackageScripts({ scripts: custom.scripts }).changes, []);
});

// ─── The ensure op ───────────────────────────────────────────────────────────

test('scripts op: heals a legacy brand root (deploy + the start/manage migration), leaves every other value verbatim', async () => {
  const root = tmpBrand({
    name: 'omegajs.dev',
    private: true,
    workspaces: ['targets/*'],
    scripts: {
      start: 'omega',
      dev: 'omega dev',
      pipeline: 'omega pipeline --require=analytics,disperse,update,bookmark',
    },
    devDependencies: { '@omega.js/manager': '*' },
  });

  const result = await scriptsOp({ brandRoot: root });
  assert.deepEqual(result.output.scripts, {
    changed: [`start: '${START_SCRIPT}'`, `manage: '${MANAGE_SCRIPT}'`, `deploy: '${DEPLOY_SCRIPT}'`],
  });

  const pkg = readPkg(root);
  assert.deepEqual(pkg.scripts, {
    start: START_SCRIPT,
    dev: 'omega dev',
    pipeline: 'omega pipeline --require=analytics,disperse,update,bookmark',
    manage: MANAGE_SCRIPT,
    deploy: DEPLOY_SCRIPT,
  });
  // Everything else survives verbatim
  assert.equal(pkg.name, 'omegajs.dev');
  assert.deepEqual(pkg.workspaces, ['targets/*']);
  assert.deepEqual(pkg.devDependencies, { '@omega.js/manager': '*' });
});

test('scripts op: converged file is a no-op — null return, byte-identical bytes', async () => {
  const root = tmpBrand({ name: 'x', scripts: { start: START_SCRIPT, manage: MANAGE_SCRIPT, deploy: DEPLOY_SCRIPT } });

  const first = await scriptsOp({ brandRoot: root });
  assert.equal(first, null);
  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

  // Heal then rerun — the second pass changes nothing (idempotence)
  const healRoot = tmpBrand({ name: 'y', scripts: { start: 'omega' } });
  await scriptsOp({ brandRoot: healRoot });
  const healedBytes = fs.readFileSync(path.join(healRoot, 'package.json'), 'utf8');
  assert.equal(await scriptsOp({ brandRoot: healRoot }), null);
  assert.equal(fs.readFileSync(path.join(healRoot, 'package.json'), 'utf8'), healedBytes);

  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
});

test('scripts op: dry run plans and writes nothing', async () => {
  const root = tmpBrand({ name: 'x', scripts: { start: 'omega' } });
  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

  const result = await scriptsOp({ brandRoot: root, options: { dryRun: true } });
  assert.deepEqual(result.output, { scripts: 'planned' });
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
});

test('scripts op: missing package.json is a note (structure scaffolds it), unparseable warns', async () => {
  const missing = await scriptsOp({ brandRoot: tmpBrand() });
  assert.deepEqual(missing.output, { scripts: 'missing' });

  const broken = tmpBrand('{ not json');
  const warned = await scriptsOp({ brandRoot: broken });
  assert.equal(warned.status, 'warned');
  assert.deepEqual(warned.output, { scripts: 'unparseable' });
  assert.equal(fs.readFileSync(path.join(broken, 'package.json'), 'utf8'), '{ not json', 'never touched');
});

test('scripts op is registered in the workspace OPERATIONS', () => {
  const { OPERATIONS } = require('../src/config.js');
  assert.ok(OPERATIONS.workspace.some((op) => op.name === 'scripts' && op.ensure === true));
});

// ─── Target script healing (#675 cycle break) ────────────────────────────────

const { discoverTargets } = require('../src/lib/brand.js');

function plantTarget(root, dir, targetPkg, frameworkName, frameworkPkg) {
  const targetPath = path.join(root, 'targets', dir);
  fs.mkdirSync(targetPath, { recursive: true });
  if (targetPkg !== undefined) {
    fs.writeFileSync(path.join(targetPath, 'package.json'), typeof targetPkg === 'string' ? targetPkg : `${JSON.stringify(targetPkg, null, 2)}\n`);
  }
  if (frameworkName) {
    const fwDir = path.join(targetPath, 'node_modules', ...frameworkName.split('/'));
    fs.mkdirSync(fwDir, { recursive: true });
    fs.writeFileSync(path.join(fwDir, 'package.json'), `${JSON.stringify(frameworkPkg, null, 2)}\n`);
  }
  return targetPath;
}

// The op takes the runner's targets context (manage.js hands brand.targets to
// every workspace op) — the tests hand it the same discovery the runner uses.
const opInput = (root, extra) => ({ brandRoot: root, targets: discoverTargets(root), ...extra });

const ROOT_OK = { start: START_SCRIPT, manage: MANAGE_SCRIPT, deploy: DEPLOY_SCRIPT };

test('healTargetScripts: fills missing framework scripts, keeps every consumer value, reports the fills', () => {
  const healed = healTargetScripts(
    { scripts: { test: 'node --test my-own' } },
    { start: 'npx omega serve', emulator: 'npx omega emulator', test: 'npx omega test' },
  );
  assert.deepEqual(healed.scripts, {
    test: 'node --test my-own',
    start: 'npx omega serve',
    emulator: 'npx omega emulator',
  }, 'missing keys fill from the framework declaration; the consumer test value is never overwritten');
  assert.deepEqual(healed.changes, ["start: 'npx omega serve'", "emulator: 'npx omega emulator'"]);

  // Converged: the healed shape has every key (test is the consumer's own)
  assert.deepEqual(healTargetScripts({ scripts: healed.scripts },
    { start: 'npx omega serve', emulator: 'npx omega emulator', test: 'npx omega test' }).changes,
  [], 'a second pass fills nothing');
});

test('scripts op: a script-less scaffolded target gets its framework projectScripts — the onboard→dev cycle break', async () => {
  const root = tmpBrand({ name: 'fresh-brand', workspaces: ['targets/*'], scripts: ROOT_OK });
  plantTarget(root, 'backend',
    { name: 'fresh-brand-backend', version: '0.0.1', private: true, dependencies: { '@omega.js/backend': '*' } },
    '@omega.js/backend',
    { name: '@omega.js/backend', projectScripts: { start: 'npx omega serve', emulator: 'npx omega emulator' } });

  const result = await scriptsOp(opInput(root));
  assert.deepEqual(result.output.targetScripts, {
    backend: ["start: 'npx omega serve'", "emulator: 'npx omega emulator'"],
  });

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.emulator, 'npx omega emulator', 'the dev fan-out leg exists before any verb ever ran');
  assert.equal(pkg.name, 'fresh-brand-backend', 'everything else survives verbatim');

  // Second pass: converged, byte-identical
  const bytes = fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8');
  assert.equal(await scriptsOp(opInput(root)), null);
  assert.equal(fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8'), bytes);
});

test('scripts op: the walk only FILLS a target — a consumer value survives it (the framework verb sync wins later)', async () => {
  const root = tmpBrand({ name: 'b', workspaces: ['targets/*'], scripts: ROOT_OK });
  plantTarget(root, 'website',
    { name: 'b-website', scripts: { start: 'node my-own-dev.js' } },
    '@omega.js/web',
    { name: '@omega.js/web', projectScripts: { start: 'omega dev', build: 'omega build' } });

  const result = await scriptsOp(opInput(root));
  assert.deepEqual(result.output.targetScripts, { website: ["build: 'omega build'"] });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'targets', 'website', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node my-own-dev.js', 'the walk never overwrites');
});

test('scripts op: an uninstalled framework and a projectScripts-less one are skipped quietly', async () => {
  const root = tmpBrand({ name: 'c', workspaces: ['targets/*'], scripts: ROOT_OK });
  plantTarget(root, 'backend', { name: 'c-backend' }); // no node_modules at all
  plantTarget(root, 'website', { name: 'c-website' }, '@omega.js/web', { name: '@omega.js/web' }); // no projectScripts

  assert.equal(await scriptsOp(opInput(root)), null, 'nothing to heal from — converged');
});

test('scripts op: a custom target and a custom-server backend own their scripts — never touched', async () => {
  const root = tmpBrand({ name: 'e', workspaces: ['targets/*'], scripts: ROOT_OK });
  const serverPath = plantTarget(root, 'server', { name: 'e-server', scripts: {} });
  const backendPath = plantTarget(root, 'backend',
    { name: 'e-backend' },
    '@omega.js/backend',
    { name: '@omega.js/backend', projectScripts: { start: 'npx omega serve' } });
  const before = {
    server: fs.readFileSync(path.join(serverPath, 'package.json'), 'utf8'),
    backend: fs.readFileSync(path.join(backendPath, 'package.json'), 'utf8'),
  };

  // Hand-built entries: a custom target carries target null (#603); a
  // custom-server backend carries projectType 'custom' (#584)
  const result = await scriptsOp({
    brandRoot: root,
    targets: [
      { name: 'server', dir: 'targets/server', path: serverPath, target: null, custom: true },
      { name: 'backend', dir: 'targets/backend', path: backendPath, target: 'backend', projectType: 'custom' },
    ],
  });
  assert.equal(result, null, 'both skipped — converged');
  assert.equal(fs.readFileSync(path.join(serverPath, 'package.json'), 'utf8'), before.server);
  assert.equal(fs.readFileSync(path.join(backendPath, 'package.json'), 'utf8'), before.backend);
});

test('scripts op: an unparseable target manifest WARNS the run instead of reporting converged', async () => {
  const root = tmpBrand({ name: 'f', workspaces: ['targets/*'], scripts: ROOT_OK });
  const targetPath = plantTarget(root, 'website', '{ not json',
    '@omega.js/web',
    { name: '@omega.js/web', projectScripts: { start: 'omega dev' } });

  const result = await scriptsOp(opInput(root));
  assert.equal(result.status, 'warned');
  assert.match(result.reason, /targets\/website\/package\.json doesn't parse/);
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), '{ not json', 'never touched');
});

test('scripts op: dry run plans the target heal and writes nothing', async () => {
  const root = tmpBrand({ name: 'd', workspaces: ['targets/*'], scripts: ROOT_OK });
  const targetPath = plantTarget(root, 'backend',
    { name: 'd-backend' },
    '@omega.js/backend',
    { name: '@omega.js/backend', projectScripts: { emulator: 'npx omega emulator' } });
  const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');

  const result = await scriptsOp(opInput(root, { options: { dryRun: true } }));
  assert.deepEqual(result.output.targetScripts, 'planned');
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), before);
});
