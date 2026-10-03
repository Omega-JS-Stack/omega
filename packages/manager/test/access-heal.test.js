/**
 * Access self-heal — the identity seam absorbed into `npm start` (Ian
 * 2026-07-19: no hand-run commands; self-healing, idempotent). Probe →
 * grant via a local gcloud account → re-probe; every degraded lane (no
 * gcloud, no able account, unknown identity, genuine faults) falls back to
 * the original diagnostic error from google-auth's 403 decoration.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'access-heal',
  tests: [
    {
      name: 'access-heal: accessible project probes once and heals nothing',
      run: async (ctx) => {
        const api = fakeApi();
        const exec = fakeGcloud();

        const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

        ctx.expect(result).toEqual({ healed: false, probed: true });
        ctx.expect(api.probes).toBe(1);
        ctx.expect(exec.calls.length, 'gcloud never consulted').toBe(0);
      },
    },

    {
      name: 'access-heal: denied → grant via the able local account → healed',
      run: async (ctx) => {
        const api = fakeApi({ denyCount: 1 });
        const exec = fakeGcloud({ accounts: ['Ian.Wiedenman@gmail.com', 'itw.creative.works@gmail.com'] });

        const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

        ctx.expect(result.healed).toBe(true);
        ctx.expect(result.grantor).toBe('Ian.Wiedenman@gmail.com');
        ctx.expect(result.manageEmail).toBe('itw.creative.works@gmail.com');
        ctx.expect(result.roles, 'owner lands first when the API allows it').toEqual(['roles/owner']);
        ctx.expect(exec.grants().length, 'one grant call').toBe(1);
        const grant = exec.grants()[0];
        ctx.expect(grant.includes('add-iam-policy-binding') && grant.includes('omegajs'), 'grants on the project').toBeTruthy();
        ctx.expect(grant.includes('--member=user:itw.creative.works@gmail.com'), 'grants the MANAGE identity').toBeTruthy();
        ctx.expect(grant.includes('--account=Ian.Wiedenman@gmail.com'), 'acts as the OTHER local account').toBeTruthy();
      },
    },

    {
      name: 'access-heal: owner rejected (no-org invitation rule) → editor + firebase.admin land',
      run: async (ctx) => {
        const api = fakeApi({ denyCount: 1 });
        const exec = fakeGcloud({
          accounts: ['Ian.Wiedenman@gmail.com', 'itw.creative.works@gmail.com'],
          grantFails: (args) => args.includes('--role=roles/owner'),
        });

        const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

        ctx.expect(result.healed).toBe(true);
        ctx.expect(result.roles).toEqual(['roles/editor', 'roles/firebase.admin']);
        const roles = exec.grants().map((args) => (args.find((a) => a.startsWith('--role=')) || '').replace('--role=', ''));
        ctx.expect(roles, 'owner attempted first, pair follows').toEqual(['roles/owner', 'roles/editor', 'roles/firebase.admin']);
      },
    },

    {
      name: 'access-heal: the manage identity itself is never a grantor candidate',
      run: async (ctx) => {
        const api = fakeApi({ denyCount: 1 });
        const exec = fakeGcloud({ accounts: ['itw.creative.works@gmail.com'] });

        await ctx.expect(ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 })).rejects.toThrow(/does not have permission/);
        ctx.expect(exec.grants().length, 'no self-grant attempt').toBe(0);
      },
    },

    {
      name: 'access-heal: a failing grantor falls through to the next',
      run: async (ctx) => {
        const api = fakeApi({ denyCount: 1 });
        const exec = fakeGcloud({
          accounts: ['first@x.com', 'second@x.com', 'itw.creative.works@gmail.com'],
          grantFails: ['first@x.com'],
        });

        const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

        ctx.expect(result.healed).toBe(true);
        ctx.expect(result.grantor).toBe('second@x.com');
        ctx.expect(result.roles).toEqual(['roles/owner']);
        ctx.expect(exec.grants().length, 'first tried owner + fallback, second landed owner').toBe(3);
      },
    },

    {
      name: 'access-heal: propagation lag — probe retries until the grant lands',
      run: async (ctx) => {
        const api = fakeApi({ denyCount: 3 }); // initial + 2 post-grant denials
        const exec = fakeGcloud({ accounts: ['Ian.Wiedenman@gmail.com'] });

        const result = await ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 });

        ctx.expect(result.healed).toBe(true);
        ctx.expect(api.probes, 'initial + retries through propagation').toBe(4);
      },
    },

    {
      name: 'access-heal: no able account → the original diagnostic error stands',
      run: async (ctx) => {
        const api = fakeApi({ denyCount: 99 });
        const exec = fakeGcloud({ accounts: ['cant@x.com'], grantFails: ['cant@x.com'] });

        await ctx.expect(ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 })).rejects.toThrow(/does not have permission/);
      },
    },

    {
      name: 'access-heal: no local gcloud → the original diagnostic error stands',
      run: async (ctx) => {
        const api = fakeApi({ denyCount: 1 });
        const exec = fakeGcloud({ accounts: new Error('gcloud: command not found') });

        await ctx.expect(ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 })).rejects.toThrow(/does not have permission/);
      },
    },

    {
      name: 'access-heal: unknowable manage identity → original error, gcloud untouched',
      run: async (ctx) => {
        const api = fakeApi({ denyCount: 1, email: null });
        const exec = fakeGcloud({ accounts: ['Ian.Wiedenman@gmail.com'] });

        await ctx.expect(ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 })).rejects.toThrow(/does not have permission/);
        ctx.expect(exec.calls.length).toBe(0);
      },
    },

    {
      name: 'access-heal: non-permission probe faults rethrow untouched — not the seam',
      run: async (ctx) => {
        const fault = new Error('Google API Error: backend timeout');
        fault.status = 500;
        const api = fakeApi({ probeError: fault });
        const exec = fakeGcloud({ accounts: ['Ian.Wiedenman@gmail.com'] });

        await ctx.expect(ensureProjectAccess({ firebaseApi: api, projectId: 'omegajs', exec, log: quiet, delayMs: 0 })).rejects.toThrow(/backend timeout/);
        ctx.expect(exec.calls.length).toBe(0);
      },
    },

    {
      name: 'access-heal: fakes without the probe surface skip the heal',
      run: async (ctx) => {
        const result = await ensureProjectAccess({ firebaseApi: {}, projectId: 'omegajs', exec: fakeGcloud(), log: quiet, delayMs: 0 });
        ctx.expect(result).toEqual({ healed: false, probed: false });
      },
    },
  ],
});
