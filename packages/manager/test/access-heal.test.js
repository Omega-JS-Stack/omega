/**
 * Access self-heal — the identity seam absorbed into `npm start` (Ian
 * 2026-07-19: no hand-run commands; self-healing, idempotent). Probe →
 * grant via a local gcloud account → re-probe; every degraded lane (no
 * gcloud, no able account, unknown identity, genuine faults) falls back to
 * the original diagnostic error from google-auth's 403 decoration.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureProjectAccess } = require('../src/services/cloud/lib/access-heal.js');

function deniedError() {
  const error = new Error('Google API Error: The caller does not have permission');
  error.status = 'PERMISSION_DENIED';
  return error;
}

/**
 * Fake gcloud: records argv arrays. `grantFails` is an account list (every
 * grant by that account throws) or a predicate over the argv array (e.g.
 * reject only --role=roles/owner, modeling the no-org invitation rule).
 */
function fakeGcloud({ accounts = [], grantFails = [] } = {}) {
  const failFn = Array.isArray(grantFails)
    ? (args) => grantFails.some((account) => args.includes(`--account=${account}`))
    : grantFails;
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[0] === 'auth') {
      if (accounts instanceof Error) throw accounts;
      return JSON.stringify(accounts.map((account) => ({ account })));
    }
    if (failFn(args)) {
      const error = new Error('gcloud grant failed');
      error.stderr = Buffer.from('ERROR: (gcloud.projects.add-iam-policy-binding) cannot grant');
      throw error;
    }
    return '';
  };
  exec.calls = calls;
  exec.grants = () => calls.filter((args) => args[0] === 'projects');
  return exec;
}

/** Fake api whose probe denies `denyCount` times, then succeeds. */
function fakeApi({ denyCount = 0, email = 'itw.creative.works@gmail.com', probeError } = {}) {
  let denies = denyCount;
  return {
    probes: 0,
    async probeProjectAccess() {
      this.probes += 1;
      if (probeError) throw probeError;
      if (denies > 0) {
        denies -= 1;
        throw deniedError();
      }
      return {};
    },
    auth: { async getAccountEmail() { return email; } },
  };
}

const quiet = () => {};

test('access-heal: accessible project probes once and heals nothing', async () => {
  const api = fakeApi();
  const exec = fakeGcloud();

  const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

  assert.deepEqual(result, { healed: false, probed: true });
  assert.equal(api.probes, 1);
  assert.equal(exec.calls.length, 0, 'gcloud never consulted');
});

test('access-heal: denied → grant via the able local account → healed', async () => {
  const api = fakeApi({ denyCount: 1 });
  const exec = fakeGcloud({ accounts: ['Ian.Wiedenman@gmail.com', 'itw.creative.works@gmail.com'] });

  const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

  assert.equal(result.healed, true);
  assert.equal(result.grantor, 'Ian.Wiedenman@gmail.com');
  assert.equal(result.manageEmail, 'itw.creative.works@gmail.com');
  assert.deepEqual(result.roles, ['roles/owner'], 'owner lands first when the API allows it');
  assert.equal(exec.grants().length, 1, 'one grant call');
  const grant = exec.grants()[0];
  assert.ok(grant.includes('add-iam-policy-binding') && grant.includes('omegajs'), 'grants on the project');
  assert.ok(grant.includes('--member=user:itw.creative.works@gmail.com'), 'grants the MANAGE identity');
  assert.ok(grant.includes('--account=Ian.Wiedenman@gmail.com'), 'acts as the OTHER local account');
});

test('access-heal: owner rejected (no-org invitation rule) → editor + firebase.admin land', async () => {
  const api = fakeApi({ denyCount: 1 });
  const exec = fakeGcloud({
    accounts: ['Ian.Wiedenman@gmail.com', 'itw.creative.works@gmail.com'],
    grantFails: (args) => args.includes('--role=roles/owner'),
  });

  const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

  assert.equal(result.healed, true);
  assert.deepEqual(result.roles, ['roles/editor', 'roles/firebase.admin']);
  const roles = exec.grants().map((args) => (args.find((a) => a.startsWith('--role=')) || '').replace('--role=', ''));
  assert.deepEqual(roles, ['roles/owner', 'roles/editor', 'roles/firebase.admin'], 'owner attempted first, pair follows');
});

test('access-heal: the manage identity itself is never a grantor candidate', async () => {
  const api = fakeApi({ denyCount: 1 });
  const exec = fakeGcloud({ accounts: ['itw.creative.works@gmail.com'] });

  await assert.rejects(
    ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 }),
    /does not have permission/,
  );
  assert.equal(exec.grants().length, 0, 'no self-grant attempt');
});

test('access-heal: a failing grantor falls through to the next', async () => {
  const api = fakeApi({ denyCount: 1 });
  const exec = fakeGcloud({
    accounts: ['first@x.com', 'second@x.com', 'itw.creative.works@gmail.com'],
    grantFails: ['first@x.com'],
  });

  const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

  assert.equal(result.healed, true);
  assert.equal(result.grantor, 'second@x.com');
  assert.deepEqual(result.roles, ['roles/owner']);
  assert.equal(exec.grants().length, 3, 'first tried owner + fallback, second landed owner');
});

test('access-heal: propagation lag — probe retries until the grant lands', async () => {
  const api = fakeApi({ denyCount: 3 }); // initial + 2 post-grant denials
  const exec = fakeGcloud({ accounts: ['Ian.Wiedenman@gmail.com'] });

  const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

  assert.equal(result.healed, true);
  assert.equal(api.probes, 4, 'initial + retries through propagation');
});

test('access-heal: no able account → the original diagnostic error stands', async () => {
  const api = fakeApi({ denyCount: 99 });
  const exec = fakeGcloud({ accounts: ['cant@x.com'], grantFails: ['cant@x.com'] });

  await assert.rejects(
    ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 }),
    /does not have permission/,
  );
});

test('access-heal: no local gcloud → the original diagnostic error stands', async () => {
  const api = fakeApi({ denyCount: 1 });
  const exec = fakeGcloud({ accounts: new Error('gcloud: command not found') });

  await assert.rejects(
    ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 }),
    /does not have permission/,
  );
});

test('access-heal: unknowable manage identity → original error, gcloud untouched', async () => {
  const api = fakeApi({ denyCount: 1, email: null });
  const exec = fakeGcloud({ accounts: ['Ian.Wiedenman@gmail.com'] });

  await assert.rejects(
    ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 }),
    /does not have permission/,
  );
  assert.equal(exec.calls.length, 0);
});

test('access-heal: non-permission probe faults rethrow untouched — not the seam', async () => {
  const fault = new Error('Google API Error: backend timeout');
  fault.status = 500;
  const api = fakeApi({ probeError: fault });
  const exec = fakeGcloud({ accounts: ['Ian.Wiedenman@gmail.com'] });

  await assert.rejects(
    ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 }),
    /backend timeout/,
  );
  assert.equal(exec.calls.length, 0);
});

test('access-heal: fakes without the probe surface skip the heal', async () => {
  const result = await ensureProjectAccess({ firebaseApi: {}, projectId: 'omegajs', exec: fakeGcloud(), log: quiet, delayMs: 0 });
  assert.deepEqual(result, { healed: false, probed: false });
});
