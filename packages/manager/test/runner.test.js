/**
 * Service-runner contract tests — the ported omega-manager semantics pinned:
 * strict { state, output, status, error } handler returns, state/output
 * accumulation across handlers, setup skip, stop-on-error.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServiceRunner, splitReturn } = require('../src/lib/service-runner.js');
const { CONSENT_REQUIRED } = require('../src/lib/google-auth.js');

// A handler that hits the Google consent gate headlessly (#228): the throw is
// CODED, so the runner steps the operation aside instead of failing the walk.
const CONSENT_THROW = `module.exports = async () => {
  const error = new Error('Google consent required (scopes: webmasters) — run the service once interactively to grant it');
  error.code = ${JSON.stringify(CONSENT_REQUIRED)};
  throw error;
};`;

// ─── Runner behavior over a staged service dir ───────────────────────────────

function stageService(handlers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-svc-'));
  for (const [relative, source] of Object.entries(handlers)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return dir;
}

module.exports = defineCases({
  type: 'group',
  description: 'runner',
  tests: [
    // ─── splitReturn contract ────────────────────────────────────────────────────

    {
      name: 'splitReturn: null/undefined are no-ops',
      run: (ctx) => {
        ctx.expect(splitReturn(null)).toEqual({ state: null, output: null });
        ctx.expect(splitReturn(undefined)).toEqual({ state: null, output: null });
      },
    },

    {
      name: 'splitReturn: routes state and output',
      run: (ctx) => {
        const { state, output } = splitReturn({ state: { id: 1 }, output: { count: 2 } }, 'op');
        ctx.expect(state).toEqual({ id: 1 });
        ctx.expect(output).toEqual({ count: 2 });
      },
    },

    {
      name: 'splitReturn: status/error are allowed metadata',
      run: (ctx) => {
        const { state, output } = splitReturn({ status: 'warned', error: 'x', output: { a: 1 } }, 'op');
        ctx.expect(state).toBe(null);
        ctx.expect(output).toEqual({ a: 1 });
      },
    },

    {
      name: 'splitReturn: unknown top-level keys throw',
      run: (ctx) => {
        ctx.expect(() => splitReturn({ projectId: 'leak' }, 'op')).toThrow(/invalid top-level key/);
      },
    },

    {
      name: 'splitReturn: arrays and scalars throw',
      run: (ctx) => {
        ctx.expect(() => splitReturn([1], 'op')).toThrow(/returned an array/);
        ctx.expect(() => splitReturn('nope', 'op')).toThrow(/returned string/);
      },
    },

    {
      name: 'runner: accumulates state + output across ensure handlers, later handlers see earlier state',
      run: async (ctx) => {
        const serviceDir = stageService({
          'ensure/alpha.js': `module.exports = async () => ({ state: { a: 1 }, output: { ranA: true } });`,
          'ensure/beta.js': `module.exports = async ({ serviceData }) => ({ output: { sawA: serviceData.a } });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'alpha', ensure: true }, { name: 'beta', ensure: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.state).toEqual({ a: 1 });
        ctx.expect(result.output).toEqual({ ranA: true, sawA: 1 });
      },
    },

    {
      name: 'runner: pre-loaded serviceData is initial state (cross-service reads)',
      run: async (ctx) => {
        const serviceDir = stageService({
          'ensure/reads.js': `module.exports = async ({ serviceData }) => ({ output: { existing: serviceData.fromDisk } });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'reads', ensure: true }],
          serviceData: { fromDisk: 'persisted-id' },
        });

        ctx.expect(result.output.existing).toBe('persisted-id');
        // Initial serviceData rides the state accumulator (it came FROM state.json)
        ctx.expect(result.state.fromDisk).toBe('persisted-id');
      },
    },

    {
      name: 'runner: stops on first error, later operations never run',
      run: async (ctx) => {
        const serviceDir = stageService({
          'ensure/boom.js': `module.exports = async () => { throw new Error('kaput'); };`,
          'ensure/after.js': `module.exports = async () => ({ output: { ran: true } });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'boom', ensure: true }, { name: 'after', ensure: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/kaput/);
        ctx.expect(result.output).toBe(null);
      },
    },

    {
      name: 'runner: contract violation in a handler surfaces as operation error',
      run: async (ctx) => {
        const serviceDir = stageService({
          'ensure/leaky.js': `module.exports = async () => ({ projectId: 'leaked-to-top-level' });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'leaky', ensure: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/invalid top-level key/);
      },
    },

    {
      name: 'runner: warned status is sticky but never downgrades an error',
      run: async (ctx) => {
        const serviceDir = stageService({
          'ensure/warns.js': `module.exports = async () => ({ status: 'warned', output: { findings: ['x'] } });`,
          'ensure/fine.js': `module.exports = async () => ({ output: { ok: true } });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'warns', ensure: true }, { name: 'fine', ensure: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output).toEqual({ findings: ['x'], ok: true });
      },
    },

    // ─── Consent gates are pending, not failures (#228) ──────────────────────────

    {
      name: 'runner: a consent-required ensure throw warns with the ⚑ marker and the walk continues',
      run: async (ctx) => {
        const serviceDir = stageService({
          'ensure/consent.js': CONSENT_THROW,
          'ensure/after.js': `module.exports = async () => ({ output: { ran: true } });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'consent', ensure: true }, { name: 'after', ensure: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.error).toBe(null);
        ctx.expect(result.output.consent.needsInteractive).toMatch(/Google consent required/);
        ctx.expect(result.output.ran, 'the operations after a pending gate still run').toBe(true);
      },
    },

    {
      name: 'runner: a consent-required read throw warns, and nothing writes on top of the gate',
      run: async (ctx) => {
        const serviceDir = stageService({
          'read/list.js': CONSENT_THROW,
          'write/list.js': `module.exports = async () => ({ output: { wrote: true } });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'list', read: true, write: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.list.needsInteractive).toMatch(/Google consent required/);
        ctx.expect(result.output.wrote).toBe(undefined);
      },
    },

    {
      name: 'runner: a consent-required transform throw warns instead of failing the service',
      run: async (ctx) => {
        const serviceDir = stageService({
          'read/list.js': `module.exports = async () => ({ count: 1 });`,
          'transform/list.js': CONSENT_THROW,
          'write/list.js': `module.exports = async () => ({ output: { wrote: true } });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'list', read: true, write: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.list.needsInteractive).toMatch(/Google consent required/);
        ctx.expect(result.output.wrote).toBe(undefined);
      },
    },

    {
      name: 'runner: a consent-required write throw warns instead of failing the service',
      run: async (ctx) => {
        const serviceDir = stageService({
          'write/push.js': CONSENT_THROW,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'push', write: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.error).toBe(null);
        ctx.expect(result.output.push.needsInteractive).toMatch(/Google consent required/);
      },
    },

    {
      name: 'runner: setup can skip the whole service',
      run: async (ctx) => {
        const serviceDir = stageService({});

        const run = createServiceRunner({
          serviceDir,
          logOperations: false,
          setup: () => ({ skip: true, reason: 'not configured' }),
        });
        const result = await run({ operations: [{ name: 'anything', ensure: true }], serviceData: {} });

        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toBe('not configured');
      },
    },

    {
      name: 'runner: write-only operation routes through the write handler',
      run: async (ctx) => {
        const serviceDir = stageService({
          'write/push.js': `module.exports = async () => ({ state: { pushedId: 'w-1' } });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'push', write: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.state.pushedId).toBe('w-1');
      },
    },

    // ─── Warned/failed operations are named, with their reason (#643) ────────────

    {
      name: 'runner: records each warned operation with the reason it returned',
      run: async (ctx) => {
        const serviceDir = stageService({
          'ensure/zone.js': `module.exports = async () => ({ status: 'warned', reason: 'no zone available' });`,
          'ensure/bare.js': `module.exports = async () => ({ status: 'warned' });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'zone', ensure: true }, { name: 'bare', ensure: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.warned).toEqual([
          { operation: 'zone', reason: 'no zone available' },
          { operation: 'bare', reason: null },
        ]);
      },
    },

    {
      name: 'runner: records the failed operation with its error as the reason',
      run: async (ctx) => {
        const serviceDir = stageService({
          'ensure/boom.js': `module.exports = async () => { throw new Error('kaput'); };`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'boom', ensure: true }],
          serviceData: {},
        });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.failed).toEqual([{ operation: 'boom', reason: 'kaput' }]);
      },
    },

    {
      name: 'runner: a warned write operation is recorded under its operation name',
      run: async (ctx) => {
        const serviceDir = stageService({
          'write/push.js': `module.exports = async () => ({ status: 'warned', reason: 'API declined the update' });`,
        });

        const run = createServiceRunner({ serviceDir, logOperations: false });
        const result = await run({
          operations: [{ name: 'push', write: true }],
          serviceData: {},
        });

        ctx.expect(result.warned).toEqual([{ operation: 'push', reason: 'API declined the update' }]);
      },
    },
  ],
});
