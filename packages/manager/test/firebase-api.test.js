/**
 * FirebaseAPI long-operation tests — the poller's two endings: a terminal
 * failure (the operation reported an error, or the caller has no notion of
 * "still running") and a KNOWN-PENDING state (a hosting custom-domain claim
 * runs until DNS verification lands, which is normal, #56).
 *
 * Every test drives the real class with a stubbed `request` (the one seam
 * that would touch the network).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { FirebaseAPI } = require('../src/services/cloud/lib/firebase-api.js');

const OP_NAME = 'projects/fixture-proj/sites/fixture-proj/operations/op-1';

/** A client whose every request is answered from `responses` (a queue or fn). */
function stubbedApi(responder) {
  const api = new FirebaseAPI({ clientId: 'x', clientSecret: 'y' });
  api.calls = [];
  api.request = async (url, options = {}) => {
    api.calls.push({ url, method: options.method || 'GET' });
    return responder(url, options);
  };
  return api;
}

module.exports = defineCases({
  type: 'group',
  description: 'firebase-api',
  tests: [
    {
      name: 'waitForOperation: a finished operation returns its response',
      run: async (ctx) => {
        const api = stubbedApi(() => ({ done: true, response: { name: 'built' } }));

        const result = await api.waitForOperation(OP_NAME, 'https://api.test/v1');

        ctx.expect(result).toEqual({ name: 'built' });
      },
    },

    {
      name: 'waitForOperation: an operation that reports an error throws it',
      run: async (ctx) => {
        const api = stubbedApi(() => ({ done: true, error: { message: 'domain already claimed' } }));

        await ctx.expect(api.waitForOperation(OP_NAME, 'https://api.test/v1')).rejects.toThrow(/Operation failed: domain already claimed/);
      },
    },

    {
      name: 'waitForOperation: a spent poll budget is a timeout by default',
      run: async (ctx) => {
        const api = stubbedApi(() => ({ done: false }));

        await ctx.expect(api.waitForOperation(OP_NAME, 'https://api.test/v1', { maxAttempts: 2, delayMs: 0 })).rejects.toThrow(/Operation timed out/);
        ctx.expect(api.calls.length).toBe(2);
      },
    },

    {
      name: 'waitForOperation: pendingOk reports still-running instead of throwing (#56)',
      run: async (ctx) => {
        const api = stubbedApi(() => ({ done: false }));

        const result = await api.waitForOperation(OP_NAME, 'https://api.test/v1', {
          maxAttempts: 2,
          delayMs: 0,
          pendingOk: true,
        });

        ctx.expect(result).toEqual({ pending: true, operationName: OP_NAME });
        ctx.expect(api.calls.length).toBe(2);
      },
    },

    {
      name: 'waitForOperation: pendingOk still throws on a terminal operation error',
      run: async (ctx) => {
        const api = stubbedApi(() => ({ done: true, error: { message: 'invalid domain' } }));

        await ctx.expect(api.waitForOperation(OP_NAME, 'https://api.test/v1', { pendingOk: true })).rejects.toThrow(/Operation failed: invalid domain/);
      },
    },

    {
      name: 'createCustomDomain: a claim pending DNS verification resolves as pending, not a timeout (#56)',
      run: async (ctx) => {
        // The claim's operation never finishes while DNS verification is outstanding.
        const api = stubbedApi((url, options) => (options.method === 'POST'
          ? { name: OP_NAME }
          : { done: false }));

        const result = await api.createCustomDomain('fixture-proj', 'fixture-proj', 'api.fixture.test');

        ctx.expect(result.pending, 'pending-OK, so the ensure step keeps going').toBe(true);
        ctx.expect(api.calls.length > 1, 'the operation was polled before concluding pending').toBeTruthy();
      },
    },

    {
      name: 'createCustomDomain: a claim that completes carries no pending flag',
      run: async (ctx) => {
        const api = stubbedApi((url, options) => (options.method === 'POST'
          ? { name: OP_NAME }
          : { done: true, response: {} }));

        const result = await api.createCustomDomain('fixture-proj', 'fixture-proj', 'api.fixture.test');

        ctx.expect(result.pending).toBe(undefined);
      },
    },

    {
      name: 'undeleteCustomDomain: a restored claim pending verification is pending too (#56)',
      run: async (ctx) => {
        const api = stubbedApi((url, options) => (options.method === 'POST'
          ? { name: OP_NAME }
          : { done: false }));

        const result = await api.undeleteCustomDomain('fixture-proj', 'fixture-proj', 'api.fixture.test');

        ctx.expect(result.pending).toBe(true);
      },
    },

    {
      name: 'enableFirestorePITR: a done-on-arrival operation is never polled (#164)',
      run: async (ctx) => {
        // Recorded live (2026-08-03, omegajs-playground): the PITR PATCH answers
        // with a FINISHED operation (done: true, the updated Database embedded) and
        // Firestore purges the operation record immediately — a GET on its name
        // 404s "Operation does not exist" from the very first poll, both for real
        // state changes and no-op updates.
        const api = stubbedApi((url, options) => {
          if (options.method === 'PATCH') {
            return {
              name: 'projects/fixture-proj/databases/(default)/operations/BhADso3t2BAG08XIuQgMChAa',
              metadata: { '@type': 'type.googleapis.com/google.firestore.admin.v1.UpdateDatabaseMetadata' },
              done: true,
              response: { '@type': 'type.googleapis.com/google.firestore.admin.v1.Database', name: 'projects/fixture-proj/databases/(default)' },
            };
          }
          const error = new Error('Google API Error: Operation does not exist');
          error.status = 'NOT_FOUND';
          throw error;
        });

        const result = await api.enableFirestorePITR('fixture-proj');

        ctx.expect(result.done).toBe(true);
        ctx.expect(api.calls.length, 'the PATCH is the only request — nothing polls a purged operation').toBe(1);
      },
    },

    {
      name: 'enableFirestorePITR: a done-on-arrival operation carrying an error still throws it',
      run: async (ctx) => {
        const api = stubbedApi(() => ({
          name: 'projects/fixture-proj/databases/(default)/operations/BhADso3t2BAG08XIuQgMChAa',
          done: true,
          error: { message: 'update rejected' },
        }));

        await ctx.expect(api.enableFirestorePITR('fixture-proj')).rejects.toThrow(/Operation failed: update rejected/);
        ctx.expect(api.calls.length, 'the failure comes from the PATCH response itself, never a poll').toBe(1);
      },
    },
  ],
});
