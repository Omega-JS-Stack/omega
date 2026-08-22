/**
 * Deploy record (cp196): brand-root-resolved `deploy.<target>` in
 * .omega/state.json — written by deploy verbs, read by the testing service
 * to split never-deployed (nudge) from deployed-but-down (error).
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

test('recordDeploy resolves to the brand root from a target dir; readDeployRecord sees it from anywhere', () => {
  const root = makeBrand();
  const targetDir = path.join(root, 'targets', 'website');

  assert.equal(readDeployRecord({ dir: targetDir, target: 'web' }), null);

  const written = recordDeploy({ dir: targetDir, target: 'web', detail: { method: 'dispatch' } });
  assert.ok(written.at, 'stamped');
  assert.equal(written.method, 'dispatch');

  const state = JSON.parse(fs.readFileSync(path.join(root, '.omega', 'state.json'), 'utf8'));
  assert.equal(state.deploy.web.method, 'dispatch', 'record lands at the BRAND root, not the target');

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

  const state = JSON.parse(fs.readFileSync(path.join(root, '.omega', 'state.json'), 'utf8'));
  assert.deepEqual(Object.keys(state.deploy).sort(), ['web', 'web:admin'], 'per-target records, distinct keys');

  assert.equal(readDeployRecord({ dir: root, target: 'web' }).method, 'dispatch', 'instance-less read = the primary');
  assert.equal(readDeployRecord({ dir: root, target: 'web', instance: 'admin' }).method, 'direct');
  assert.equal(readDeployRecord({ dir: root, target: 'web', instance: 'cdn' }), null, 'instance-scoped');

  fs.rmSync(root, { recursive: true, force: true });
});

test('recordDeploy preserves unrelated state and other targets', () => {
  const root = makeBrand();
  fs.mkdirSync(path.join(root, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(root, '.omega', 'state.json'), JSON.stringify({ cloud: { projectId: 'p' }, deploy: { backend: { at: 'x' } } }));

  recordDeploy({ dir: root, target: 'web' });

  const state = JSON.parse(fs.readFileSync(path.join(root, '.omega', 'state.json'), 'utf8'));
  assert.equal(state.cloud.projectId, 'p', 'unrelated service state survives');
  assert.equal(state.deploy.backend.at, 'x', 'other targets survive');
  assert.ok(state.deploy.web.at);

  fs.rmSync(root, { recursive: true, force: true });
});
