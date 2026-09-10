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
const { healPackageScripts, syncTargetScripts, DEPLOY_SCRIPT, START_SCRIPT, MANAGE_SCRIPT } = require('../src/lib/package-scripts.js');

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

// ─── Target script sync (#675 cycle break, #689 one policy) ──────────────────

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

const FRAMEWORK_SCRIPTS = { start: 'omega serve', emulator: 'omega emulator', test: 'omega test' };

// @omega.js/backend's own declaration pair: the standard keys, and the ones a
// custom-server backend owns instead (the verbs that mode refuses, #584/#689)
const BACKEND_PROJECT_SCRIPTS = {
  start: 'omega serve',
  deploy: 'omega deploy',
  emulator: 'omega emulator',
  test: "node --require ./test/_helpers/connect-trap.js --test 'test/_unit/**/*.test.js'",
  'test:static': 'npm test',
  'test:emulator': 'omega test',
};

const CUSTOM_OWNED_KEYS = ['start', 'deploy', 'emulator', 'test:emulator'];

test('syncTargetScripts: rewrites every standard key to its default, keeps every consumer-added key (#689)', () => {
  const synced = syncTargetScripts(
    { scripts: { test: 'node --test my-own', lint: 'eslint .' } },
    FRAMEWORK_SCRIPTS,
  );
  assert.deepEqual(synced.scripts, {
    test: 'omega test',
    lint: 'eslint .',
    start: 'omega serve',
    emulator: 'omega emulator',
  }, 'a standard key is FRAMEWORK-owned — the hand-edited value is rewritten to the default; a key the framework never declares is the consumer\'s own');
  assert.deepEqual(synced.changes, ["start: 'omega serve'", "emulator: 'omega emulator'", "test: 'omega test'"]);
  assert.deepEqual(synced.skipped, []);

  // Converged: a second pass rewrites nothing
  assert.deepEqual(syncTargetScripts({ scripts: synced.scripts }, FRAMEWORK_SCRIPTS).changes, []);
});

test('syncTargetScripts: brand-owned keys are never written and never scaffolded — reported as skipped (#689)', () => {
  const synced = syncTargetScripts(
    { scripts: { start: 'node server.js', test: 'node --test my-own' } },
    FRAMEWORK_SCRIPTS,
    ['start', 'emulator'],
  );
  assert.deepEqual(synced.scripts, {
    start: 'node server.js',
    test: 'omega test',
  }, "the brand's own start survives verbatim, the missing emulator is never scaffolded, and the framework-owned test is rewritten");
  assert.deepEqual(synced.changes, ["test: 'omega test'"]);
  assert.deepEqual(synced.skipped, ['start', 'emulator'], 'the walk reports per key what it left to the brand');

  // Converged: a second pass rewrites nothing
  assert.deepEqual(syncTargetScripts({ scripts: synced.scripts }, FRAMEWORK_SCRIPTS, ['start', 'emulator']).changes, []);
});

test('scripts op: a script-less scaffolded target gets its framework projectScripts — the onboard→dev cycle break', async () => {
  const root = tmpBrand({ name: 'fresh-brand', workspaces: ['targets/*'], scripts: ROOT_OK });
  plantTarget(root, 'backend',
    { name: 'fresh-brand-backend', version: '0.0.1', private: true, dependencies: { '@omega.js/backend': '*' } },
    '@omega.js/backend',
    { name: '@omega.js/backend', projectScripts: { start: 'omega serve', emulator: 'omega emulator' } });

  const result = await scriptsOp(opInput(root));
  assert.deepEqual(result.output.targetScripts, {
    backend: ["start: 'omega serve'", "emulator: 'omega emulator'"],
  });

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.emulator, 'omega emulator', 'the dev fan-out leg exists before any verb ever ran');
  assert.equal(pkg.name, 'fresh-brand-backend', 'everything else survives verbatim');

  // Second pass: converged, byte-identical
  const bytes = fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8');
  assert.equal(await scriptsOp(opInput(root)), null);
  assert.equal(fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8'), bytes);
});

test('scripts op: the walk OVERWRITES a hand-edited standard script back to the default — one policy with the verbs (#689)', async () => {
  const root = tmpBrand({ name: 'b', workspaces: ['targets/*'], scripts: ROOT_OK });
  plantTarget(root, 'website',
    { name: 'b-website', scripts: { start: 'node my-own-dev.js', lint: 'eslint .' } },
    '@omega.js/web',
    { name: '@omega.js/web', projectScripts: { start: 'omega dev', build: 'omega build' } });

  const result = await scriptsOp(opInput(root));
  assert.deepEqual(result.output.targetScripts, { website: ["start: 'omega dev'", "build: 'omega build'"] });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'targets', 'website', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'omega dev', 'the framework owns its own script keys — an edited one is rewritten, hooks are the customization seam');
  assert.equal(pkg.scripts.lint, 'eslint .', 'a key the framework never declares is the consumer\'s own');

  // Second pass: converged, byte-identical
  const bytes = fs.readFileSync(path.join(root, 'targets', 'website', 'package.json'), 'utf8');
  assert.equal(await scriptsOp(opInput(root)), null);
  assert.equal(fs.readFileSync(path.join(root, 'targets', 'website', 'package.json'), 'utf8'), bytes);
});

test('scripts op: an uninstalled framework and a projectScripts-less one are skipped quietly', async () => {
  const root = tmpBrand({ name: 'c', workspaces: ['targets/*'], scripts: ROOT_OK });
  plantTarget(root, 'backend', { name: 'c-backend' }); // no node_modules at all
  plantTarget(root, 'website', { name: 'c-website' }, '@omega.js/web', { name: '@omega.js/web' }); // no projectScripts

  assert.equal(await scriptsOp(opInput(root)), null, 'nothing to heal from — converged');
});

test('scripts op: a custom TARGET owns every script — no framework maps to it, so it is skipped whole (#603)', async () => {
  const root = tmpBrand({ name: 'e', workspaces: ['targets/*'], scripts: ROOT_OK });
  const serverPath = plantTarget(root, 'server', { name: 'e-server', scripts: {} });
  const before = fs.readFileSync(path.join(serverPath, 'package.json'), 'utf8');

  // Hand-built entry: a custom target carries target null (#603)
  const result = await scriptsOp({
    brandRoot: root,
    targets: [{ name: 'server', dir: 'targets/server', path: serverPath, target: null, custom: true }],
  });
  assert.equal(result, null, 'skipped — converged');
  assert.equal(fs.readFileSync(path.join(serverPath, 'package.json'), 'utf8'), before);
});

test('scripts op: a custom-server backend is PER-KEY — the framework-owned subset syncs, its own verbs are left alone (#689)', async () => {
  const root = tmpBrand({ name: 'e2', workspaces: ['targets/*'], scripts: ROOT_OK });
  const backendPath = plantTarget(root, 'backend',
    { name: 'e2-backend', scripts: { start: 'node server.js', 'test:static': 'echo stale', render: 'render deploy' } },
    '@omega.js/backend',
    {
      name: '@omega.js/backend',
      projectScripts: BACKEND_PROJECT_SCRIPTS,
      projectScriptsCustomOwned: CUSTOM_OWNED_KEYS,
    });

  // A custom-server backend carries projectType 'custom' (#584)
  const entries = [{ name: 'backend', dir: 'targets/backend', path: backendPath, target: 'backend', projectType: 'custom' }];
  const result = await scriptsOp({ brandRoot: root, targets: entries });

  assert.deepEqual(result.output.targetScripts, {
    backend: [`test: '${BACKEND_PROJECT_SCRIPTS.test}'`, "test:static: 'npm test'"],
  }, 'only the keys whose verbs still work in custom mode are written');

  const pkg = JSON.parse(fs.readFileSync(path.join(backendPath, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node server.js', 'the brand names its own server command (#584)');
  assert.equal(pkg.scripts.deploy, undefined, 'a brand-owned key is never scaffolded — no placeholder to delete');
  assert.equal(pkg.scripts.emulator, undefined, 'there are no Cloud Functions to emulate');
  assert.equal(pkg.scripts['test:emulator'], undefined, 'the emulator test lane refuses in this mode');
  assert.equal(pkg.scripts['test:static'], 'npm test', 'a hand-edited framework-owned key is rewritten to the default');
  assert.equal(pkg.scripts.render, 'render deploy', 'a consumer-added key is untouched');

  // Second pass: converged, byte-identical
  const bytes = fs.readFileSync(path.join(backendPath, 'package.json'), 'utf8');
  assert.equal(await scriptsOp({ brandRoot: root, targets: entries }), null);
  assert.equal(fs.readFileSync(path.join(backendPath, 'package.json'), 'utf8'), bytes);
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

// ─── The retired `npx omega setup` migration (#707) ──────────────────────────

// A pre-#675 backend target verbatim: every framework script chained the
// command #675 retired, so the dev fan-out dies at `Unknown command "setup"`
const STALE_BACKEND_SCRIPTS = {
  start: 'npx omega setup && omega serve',
  deploy: 'npx omega setup && omega deploy',
  emulator: 'npx omega setup && omega emulator',
  test: "node --require ./test/_helpers/connect-trap.js --test 'test/_unit/**/*.test.js'",
  'test:static': 'npm test',
  'test:emulator': 'npx omega setup && omega test',
  setup: 'npx omega setup',
};

test('syncTargetScripts: rewrites pre-#675 `npx omega setup` residue to the manifest value, drops the retired key', () => {
  const healed = syncTargetScripts({ scripts: { ...STALE_BACKEND_SCRIPTS } }, BACKEND_PROJECT_SCRIPTS);

  assert.deepEqual(healed.scripts, BACKEND_PROJECT_SCRIPTS,
    'every stale value takes its manifest value; `setup` (no manifest entry, nothing left to run) goes');
  assert.equal(JSON.stringify(healed.scripts).includes('omega setup'), false,
    'the boot-after-walk proof: no script still names the retired command');
  assert.deepEqual(healed.changes, [
    "start: 'omega serve' (was 'npx omega setup')",
    "deploy: 'omega deploy' (was 'npx omega setup')",
    "emulator: 'omega emulator' (was 'npx omega setup')",
    "test:emulator: 'omega test' (was 'npx omega setup')",
    "setup: removed (was 'npx omega setup')",
  ]);

  // One-time: the healed shape matches nothing on a second pass
  assert.deepEqual(syncTargetScripts({ scripts: healed.scripts }, BACKEND_PROJECT_SCRIPTS).changes, []);
});

test('syncTargetScripts: a mid-chain retired leg loses just that leg when the manifest no longer names the key', () => {
  // The pre-#675 desktop/extension shape — the retired command sat between two
  // live ones, and the key can outlive the manifest declaration
  const healed = syncTargetScripts(
    { scripts: { bundle: 'omega clean && npx omega setup && npm run gulp --' } },
    { start: 'omega clean && npm run gulp --' },
  );
  assert.equal(healed.scripts.bundle, 'omega clean && npm run gulp --',
    'the consumer-named key keeps its own chain minus the retired leg');
  assert.deepEqual(healed.changes, [
    "bundle: 'omega clean && npm run gulp --' (was 'npx omega setup')",
    "start: 'omega clean && npm run gulp --'",
  ]);

  assert.deepEqual(syncTargetScripts({ scripts: healed.scripts }, { start: 'omega clean && npm run gulp --' }).changes, []);
});

test('syncTargetScripts: a value that never named the retired command is not MIGRATED — the standard keys still sync (#689)', () => {
  const healed = syncTargetScripts(
    { scripts: { start: 'node my-own-dev.js', emulator: 'npx omega emulator --only firestore', setups: 'npx omega setups' } },
    BACKEND_PROJECT_SCRIPTS,
  );
  assert.equal(healed.scripts.start, BACKEND_PROJECT_SCRIPTS.start, 'a standard key is framework-owned in every mode but custom');
  assert.equal(healed.scripts.emulator, BACKEND_PROJECT_SCRIPTS.emulator, 'a customized flag on a standard key goes too — hooks are the seam');
  assert.equal(healed.scripts.setups, 'npx omega setups', 'a different command that merely starts the same way survives');
  assert.equal(healed.changes.some((c) => c.includes("(was 'npx omega setup')")), false, 'nothing migrated');
});

test('scripts op: a pre-#675 target is healed on the walk — the boot leg lives again, idempotently', async () => {
  const root = tmpBrand({ name: 'legacy-brand', workspaces: ['targets/*'], scripts: ROOT_OK });
  plantTarget(root, 'backend',
    { name: 'legacy-brand-backend', version: '0.0.1', private: true, scripts: { ...STALE_BACKEND_SCRIPTS } },
    '@omega.js/backend',
    { name: '@omega.js/backend', projectScripts: BACKEND_PROJECT_SCRIPTS });

  const result = await scriptsOp(opInput(root));
  assert.deepEqual(result.output.targetScripts.backend, [
    "start: 'omega serve' (was 'npx omega setup')",
    "deploy: 'omega deploy' (was 'npx omega setup')",
    "emulator: 'omega emulator' (was 'npx omega setup')",
    "test:emulator: 'omega test' (was 'npx omega setup')",
    "setup: removed (was 'npx omega setup')",
  ]);

  const manifestPath = path.join(root, 'targets', 'backend', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(pkg.scripts.emulator, 'omega emulator', 'the dev fan-out leg no longer runs the retired command');
  assert.equal(JSON.stringify(pkg.scripts).includes('omega setup'), false);
  assert.equal(pkg.name, 'legacy-brand-backend', 'everything else survives verbatim');

  // Second pass: converged, byte-identical
  const bytes = fs.readFileSync(manifestPath, 'utf8');
  assert.equal(await scriptsOp(opInput(root)), null);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), bytes);
});

test('scripts op: dry run plans the target heal and writes nothing', async () => {
  const root = tmpBrand({ name: 'd', workspaces: ['targets/*'], scripts: ROOT_OK });
  const targetPath = plantTarget(root, 'backend',
    { name: 'd-backend' },
    '@omega.js/backend',
    { name: '@omega.js/backend', projectScripts: { emulator: 'omega emulator' } });
  const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');

  const result = await scriptsOp(opInput(root, { options: { dryRun: true } }));
  assert.deepEqual(result.output.targetScripts, 'planned');
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), before);
});
