/**
 * The shared one-shot: the sequence `router__refresh_upstream` and
 * `omega-mcp refresh` both run to read an upstream's tool list once.
 *
 * The e2e files drive this against real fixture children over real stdio
 * (refresh-deadline, refresh-cleanup, refresh-timeout). What they cannot show
 * cheaply is the shape of each step, so this lane drives the helper with fake
 * client/transport pairs: which of the two closes on the success path (only
 * one, or a real transport would be closed twice), that either failure closes
 * the transport before rethrowing, and that the read is handed the router's
 * budget instead of the SDK's 60s default.
 *
 * The budget is shrunk through its env seam BEFORE the module is required
 * (the constant is read at load), which is also the proof that the seam
 * reaches this helper, and so both of its callers.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const BUDGET_MS = 150;
process.env.MCP_ROUTER_SPAWN_TIMEOUT_MS = String(BUDGET_MS);

const { SPAWN_TIMEOUT_MS, connectWithDeadline, readToolsOnce } = require('../src/lib/oneshot.js');

const TOOLS = [{ name: 'echo', description: 'Echo the text back.', inputSchema: { type: 'object', properties: {} } }];

/**
 * A stand-in for the SDK client/transport pair, recording what was called.
 *
 * @param {object} [behavior] - `{ connect, listTools }` overrides returning a promise
 * @returns {object} `{ client, transport, calls, readOptions }`
 */
function pair(behavior = {}) {
  const calls = [];
  const state = { calls, readOptions: null };

  state.transport = {
    close: async () => {
      calls.push('transport.close');
    },
  };
  state.client = {
    connect: (transport) => {
      calls.push('client.connect');
      assert.equal(transport, state.transport, 'the client is connected over its own transport');
      return behavior.connect ? behavior.connect() : Promise.resolve();
    },
    listTools: (params, options) => {
      calls.push('client.listTools');
      state.readOptions = options;
      return behavior.listTools ? behavior.listTools() : Promise.resolve({ tools: TOOLS });
    },
    close: async () => {
      calls.push('client.close');
    },
  };

  return state;
}

test('the env seam sets the budget this helper runs on', () => {
  assert.equal(SPAWN_TIMEOUT_MS, BUDGET_MS);
});

test('a successful read returns the tools and closes through the client alone', async () => {
  const fake = pair();

  assert.deepEqual(await readToolsOnce(fake.client, fake.transport), TOOLS);
  // Closing the transport as well would close a real one twice.
  assert.deepEqual(fake.calls, ['client.connect', 'client.listTools', 'client.close']);
});

test('the read carries the router budget as its request options', async () => {
  const fake = pair();

  await readToolsOnce(fake.client, fake.transport);
  assert.deepEqual(fake.readOptions, { timeout: BUDGET_MS });
});

test('a failed connect closes the transport and rethrows', async () => {
  const fake = pair({ connect: () => Promise.reject(new Error('spawn ENOENT')) });

  await assert.rejects(readToolsOnce(fake.client, fake.transport), /spawn ENOENT/);
  // Nothing else would terminate the child the transport already started.
  assert.deepEqual(fake.calls, ['client.connect', 'transport.close']);
});

test('a connect that never settles fails at the deadline, with the transport closed', async () => {
  const fake = pair({ connect: () => new Promise(() => {}) });
  const started = Date.now();

  await assert.rejects(
    readToolsOnce(fake.client, fake.transport),
    new RegExp(`handshake did not finish within ${BUDGET_MS}ms`),
  );
  // 10ms of slack: Node fires timers up to a few ms before Date.now agrees
  // (timer rounding vs the clock) — the rejection MESSAGE above is the proof
  // the deadline answered; this only pins that nothing answered early.
  assert.ok(Date.now() - started >= BUDGET_MS - 10, 'the deadline, not the fake, answered');
  assert.deepEqual(fake.calls, ['client.connect', 'transport.close']);
});

test('a failed read closes the transport and rethrows', async () => {
  const fake = pair({ listTools: () => Promise.reject(new Error('tools/list is unavailable')) });

  await assert.rejects(readToolsOnce(fake.client, fake.transport), /tools\/list is unavailable/);
  // The connect deadline is done with the transport by then, so this path owns
  // the cleanup; closing through the client would leave the child running.
  assert.deepEqual(fake.calls, ['client.connect', 'client.listTools', 'transport.close']);
});

test('connectWithDeadline resolves without touching the transport', async () => {
  const fake = pair();

  await connectWithDeadline(fake.client, fake.transport);
  assert.deepEqual(fake.calls, ['client.connect']);
});
