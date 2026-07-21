/**
 * Workspace `scripts` ensure op + the package-scripts heal lib — the retired
 * `omega-manager` bin name heals to `omega` inside root script VALUES (args
 * preserved), a `deploy` script is guaranteed, nothing else is ever touched,
 * and a converged file rewrites nothing (idempotence proven by bytes).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scriptsOp = require('../src/services/workspace/ensure/scripts.js');
const { healScriptValue, healPackageScripts, DEPLOY_SCRIPT } = require('../src/lib/package-scripts.js');

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

test('healScriptValue: only the LEADING bin token heals — plain, npx, args preserved', () => {
  assert.equal(healScriptValue('omega-manager'), 'omega');
  assert.equal(healScriptValue('omega-manager dev'), 'omega dev');
  assert.equal(healScriptValue('npx omega-manager'), 'npx omega');
  assert.equal(healScriptValue('omega-manager pipeline --require=analytics,disperse,update,bookmark'),
    'omega pipeline --require=analytics,disperse,update,bookmark');
  // NOT the bin token: mid-command mentions and longer names stay verbatim
  assert.equal(healScriptValue('echo omega-manager done'), 'echo omega-manager done');
  assert.equal(healScriptValue('omega-managerx build'), 'omega-managerx build');
});

test('healPackageScripts: renames legacy values, adds deploy when absent, keeps an existing deploy', () => {
  const healed = healPackageScripts({ scripts: { start: 'omega-manager', build: 'echo hi' } });
  assert.deepEqual(healed.scripts, { start: 'omega', build: 'echo hi', deploy: DEPLOY_SCRIPT });
  assert.deepEqual(healed.renamed, ['start']);
  assert.equal(healed.added, true);
  assert.equal(healed.changed, true);

  const kept = healPackageScripts({ scripts: { start: 'omega', deploy: 'my-own-deploy' } });
  assert.equal(kept.scripts.deploy, 'my-own-deploy', 'an existing deploy script is never overwritten');
  assert.equal(kept.changed, false);
});

// ─── The ensure op ───────────────────────────────────────────────────────────

test('scripts op: heals the Ian-reported shape — three renames + deploy added, other keys untouched', async () => {
  const root = tmpBrand({
    name: 'omegajs.dev',
    private: true,
    workspaces: ['apps/*'],
    scripts: {
      start: 'omega-manager',
      dev: 'omega-manager dev',
      pipeline: 'omega-manager pipeline --require=analytics,disperse,update,bookmark',
    },
    devDependencies: { '@omega.js/manager': '*' },
  });

  const result = await scriptsOp({ brandRoot: root });
  assert.deepEqual(result.output.scripts, { renamed: ['start', 'dev', 'pipeline'], added: true });

  const pkg = readPkg(root);
  assert.deepEqual(pkg.scripts, {
    start: 'omega',
    dev: 'omega dev',
    pipeline: 'omega pipeline --require=analytics,disperse,update,bookmark',
    deploy: DEPLOY_SCRIPT,
  });
  // Everything else survives verbatim
  assert.equal(pkg.name, 'omegajs.dev');
  assert.deepEqual(pkg.workspaces, ['apps/*']);
  assert.deepEqual(pkg.devDependencies, { '@omega.js/manager': '*' });
});

test('scripts op: converged file is a no-op — null return, byte-identical bytes', async () => {
  const root = tmpBrand({ name: 'x', scripts: { start: 'omega', deploy: 'omega deploy' } });

  const first = await scriptsOp({ brandRoot: root });
  assert.equal(first, null);
  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

  // Heal then rerun — the second pass changes nothing (idempotence)
  const healRoot = tmpBrand({ name: 'y', scripts: { start: 'omega-manager' } });
  await scriptsOp({ brandRoot: healRoot });
  const healedBytes = fs.readFileSync(path.join(healRoot, 'package.json'), 'utf8');
  assert.equal(await scriptsOp({ brandRoot: healRoot }), null);
  assert.equal(fs.readFileSync(path.join(healRoot, 'package.json'), 'utf8'), healedBytes);

  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
});

test('scripts op: dry run plans and writes nothing', async () => {
  const root = tmpBrand({ name: 'x', scripts: { start: 'omega-manager' } });
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
