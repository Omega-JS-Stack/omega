/**
 * Deploy record (cp196): brand-root-resolved `<target>` in
 * .omega/deploys.json — written by deploy verbs, read by the testing service
 * to split never-deployed (nudge) from deployed-but-down (error). A brand
 * that still carries the retired .omega/state.json's `deploy` key has it
 * adopted once, silently (#449).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { recordDeploy, readDeployRecord, deployKey } = require('../src/deploy-record.js');

function makeBrand() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-record-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"brand"}');
  fs.mkdirSync(path.join(root, 'targets', 'website'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'website', 'package.json'), '{"name":"brand-website"}');
  return root;
}

function readRecords(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.omega', 'deploys.json'), 'utf8'));
}

function writeLegacyState(root, state) {
  fs.mkdirSync(path.join(root, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(root, '.omega', 'state.json'), JSON.stringify(state));
}

test('recordDeploy resolves to the brand root from a target dir; readDeployRecord sees it from anywhere', () => {
  const root = makeBrand();
  const targetDir = path.join(root, 'targets', 'website');

  assert.equal(readDeployRecord({ dir: targetDir, target: 'web' }), null);

  const written = recordDeploy({ dir: targetDir, target: 'web', detail: { method: 'dispatch' } });
  assert.ok(written.at, 'stamped');
  assert.equal(written.method, 'dispatch');

  const records = readRecords(root);
  assert.equal(records.web.method, 'dispatch', 'record lands at the BRAND root, not the target');

  assert.equal(readDeployRecord({ dir: root, target: 'web' }).method, 'dispatch');
  assert.equal(readDeployRecord({ dir: targetDir, target: 'backend' }), null, 'target-scoped');

  fs.rmSync(root, { recursive: true, force: true });
});

test('instance keys (multi-instance targets): main stays the bare target, other instances key <target>:<id>', () => {
  const root = makeBrand();

  assert.equal(deployKey('web'), 'web');
  assert.equal(deployKey('web', 'main'), 'web', 'main IS the bare key — existing records stay valid');
  assert.equal(deployKey('web', 'admin'), 'web:admin');

  recordDeploy({ dir: root, target: 'web', instance: 'main', detail: { method: 'dispatch' } });
  recordDeploy({ dir: root, target: 'web', instance: 'admin', detail: { method: 'direct' } });

  assert.deepEqual(Object.keys(readRecords(root)).sort(), ['web', 'web:admin'], 'per-target records, distinct keys');

  assert.equal(readDeployRecord({ dir: root, target: 'web' }).method, 'dispatch', 'instance-less read = the primary');
  assert.equal(readDeployRecord({ dir: root, target: 'web', instance: 'admin' }).method, 'direct');
  assert.equal(readDeployRecord({ dir: root, target: 'web', instance: 'cdn' }), null, 'instance-scoped');

  fs.rmSync(root, { recursive: true, force: true });
});

test('recordDeploy preserves other targets', () => {
  const root = makeBrand();

  recordDeploy({ dir: root, target: 'backend' });
  recordDeploy({ dir: root, target: 'web' });

  const records = readRecords(root);
  assert.ok(records.backend.at, 'other targets survive');
  assert.ok(records.web.at);

  fs.rmSync(root, { recursive: true, force: true });
});

test('the retired state.json deploy key is adopted once, and the emptied file goes (#449)', () => {
  const root = makeBrand();
  writeLegacyState(root, { deploy: { backend: { at: '2026-07-17T00:00:00.000Z', method: 'firebase' } } });

  assert.equal(readDeployRecord({ dir: root, target: 'backend' }).method, 'firebase', 'the old record is not lost');

  assert.deepEqual(readRecords(root).backend, { at: '2026-07-17T00:00:00.000Z', method: 'firebase' }, 'adopted whole, stamps intact');
  assert.equal(fs.existsSync(path.join(root, '.omega', 'state.json')), false, 'nothing else was in it — the file goes');

  recordDeploy({ dir: root, target: 'web' });
  const records = readRecords(root);
  assert.equal(records.backend.method, 'firebase', 'the adopted record survives the next write');
  assert.ok(records.web.at);

  fs.rmSync(root, { recursive: true, force: true });
});

test('a state.json with other keys keeps its file, minus the adopted deploy key (#449)', () => {
  const root = makeBrand();
  writeLegacyState(root, { cloud: { projectId: 'p' }, deploy: { backend: { at: 'x' } } });

  recordDeploy({ dir: root, target: 'web' });

  const records = readRecords(root);
  assert.equal(records.backend.at, 'x', 'the old record is adopted');
  assert.ok(records.web.at);

  const state = JSON.parse(fs.readFileSync(path.join(root, '.omega', 'state.json'), 'utf8'));
  assert.deepEqual(state, { cloud: { projectId: 'p' } }, 'a pre-#434 brand keeps its file for the state-retirement migration, minus the deploy key');

  fs.rmSync(root, { recursive: true, force: true });
});

test('a record already in deploys.json wins over the legacy key it adopts beside', () => {
  const root = makeBrand();
  recordDeploy({ dir: root, target: 'web', detail: { method: 'direct' } });
  writeLegacyState(root, { deploy: { web: { at: '2020-01-01T00:00:00.000Z', method: 'stale' }, backend: { at: 'x' } } });

  assert.equal(readDeployRecord({ dir: root, target: 'web' }).method, 'direct', 'the newer write is the record');
  assert.equal(readDeployRecord({ dir: root, target: 'backend' }).at, 'x', 'the rest is still adopted');

  fs.rmSync(root, { recursive: true, force: true });
});
