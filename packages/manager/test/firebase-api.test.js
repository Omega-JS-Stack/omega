/**
 * FirebaseAPI long-operation tests — the poller's two endings: a terminal
 * failure (the operation reported an error, or the caller has no notion of
 * "still running") and a KNOWN-PENDING state (a hosting custom-domain claim
 * runs until DNS verification lands, which is normal, #56).
 *
 * Every test drives the real class with a stubbed `request` (the one seam
 * that would touch the network).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

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

test('waitForOperation: a finished operation returns its response', async () => {
  const api = stubbedApi(() => ({ done: true, response: { name: 'built' } }));

  const result = await api.waitForOperation(OP_NAME, 'https://api.test/v1');

  assert.deepEqual(result, { name: 'built' });
});

test('waitForOperation: an operation that reports an error throws it', async () => {
  const api = stubbedApi(() => ({ done: true, error: { message: 'domain already claimed' } }));

  await assert.rejects(
    api.waitForOperation(OP_NAME, 'https://api.test/v1'),
    /Operation failed: domain already claimed/,
  );
});

test('waitForOperation: a spent poll budget is a timeout by default', async () => {
  const api = stubbedApi(() => ({ done: false }));

  await assert.rejects(
    api.waitForOperation(OP_NAME, 'https://api.test/v1', { maxAttempts: 2, delayMs: 0 }),
    /Operation timed out/,
  );
  assert.equal(api.calls.length, 2);
});

test('waitForOperation: pendingOk reports still-running instead of throwing (#56)', async () => {
  const api = stubbedApi(() => ({ done: false }));

  const result = await api.waitForOperation(OP_NAME, 'https://api.test/v1', {
    maxAttempts: 2,
    delayMs: 0,
    pendingOk: true,
  });

  assert.deepEqual(result, { pending: true, operationName: OP_NAME });
  assert.equal(api.calls.length, 2);
});

test('waitForOperation: pendingOk still throws on a terminal operation error', async () => {
  const api = stubbedApi(() => ({ done: true, error: { message: 'invalid domain' } }));

  await assert.rejects(
    api.waitForOperation(OP_NAME, 'https://api.test/v1', { pendingOk: true }),
    /Operation failed: invalid domain/,
  );
});

test('createCustomDomain: a claim pending DNS verification resolves as pending, not a timeout (#56)', async () => {
  // The claim's operation never finishes while DNS verification is outstanding.
  const api = stubbedApi((url, options) => (options.method === 'POST'
    ? { name: OP_NAME }
    : { done: false }));

  const result = await api.createCustomDomain('fixture-proj', 'fixture-proj', 'api.fixture.test');

  assert.equal(result.pending, true, 'pending-OK, so the ensure step keeps going');
  assert.ok(api.calls.length > 1, 'the operation was polled before concluding pending');
});

test('createCustomDomain: a claim that completes carries no pending flag', async () => {
  const api = stubbedApi((url, options) => (options.method === 'POST'
    ? { name: OP_NAME }
    : { done: true, response: {} }));

  const result = await api.createCustomDomain('fixture-proj', 'fixture-proj', 'api.fixture.test');

  assert.equal(result.pending, undefined);
});

test('undeleteCustomDomain: a restored claim pending verification is pending too (#56)', async () => {
  const api = stubbedApi((url, options) => (options.method === 'POST'
    ? { name: OP_NAME }
    : { done: false }));

  const result = await api.undeleteCustomDomain('fixture-proj', 'fixture-proj', 'api.fixture.test');

  assert.equal(result.pending, true);
});
