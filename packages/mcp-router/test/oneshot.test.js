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

const defineCases = require('@omega.js/devkit/test/define-cases');

const BUDGET_MS = 150;
const ONESHOT = require.resolve('../src/lib/oneshot.js');

// The suites share one process: load a private copy under the shrunk seam, then
// hand back the env and the module cache so no other suite inherits the budget.
const shared = { seam: process.env.MCP_ROUTER_SPAWN_TIMEOUT_MS, module: require.cache[ONESHOT] };
process.env.MCP_ROUTER_SPAWN_TIMEOUT_MS = String(BUDGET_MS);
delete require.cache[ONESHOT];
const { SPAWN_TIMEOUT_MS, connectWithDeadline, readToolsOnce } = require(ONESHOT);
if (shared.seam === undefined) delete process.env.MCP_ROUTER_SPAWN_TIMEOUT_MS;
else process.env.MCP_ROUTER_SPAWN_TIMEOUT_MS = shared.seam;
if (shared.module) require.cache[ONESHOT] = shared.module;
else delete require.cache[ONESHOT];

const TOOLS = [{ name: 'echo', description: 'Echo the text back.', inputSchema: { type: 'object', properties: {} } }];

/**
 * A stand-in for the SDK client/transport pair, recording what was called.
 *
 * @param {Function} expect - The calling case's `ctx.expect`
 * @param {object} [behavior] - `{ connect, listTools }` overrides returning a promise
 * @returns {object} `{ client, transport, calls, readOptions }`
 */
function pair(expect, behavior = {}) {
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
      expect(transport, 'the client is connected over its own transport').toBe(state.transport);
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

module.exports = defineCases({
  type: 'group',
  description: 'oneshot',
  tests: [
    {
      name: 'the env seam sets the budget this helper runs on',
      run: (ctx) => {
        ctx.expect(SPAWN_TIMEOUT_MS).toBe(BUDGET_MS);
      },
    },

    {
      name: 'a successful read returns the tools and closes through the client alone',
      run: async (ctx) => {
        const fake = pair(ctx.expect);

        ctx.expect(await readToolsOnce(fake.client, fake.transport)).toEqual(TOOLS);
        // Closing the transport as well would close a real one twice.
        ctx.expect(fake.calls).toEqual(['client.connect', 'client.listTools', 'client.close']);
      },
    },

    {
      name: 'the read carries the router budget as its request options',
      run: async (ctx) => {
        const fake = pair(ctx.expect);

        await readToolsOnce(fake.client, fake.transport);
        ctx.expect(fake.readOptions).toEqual({ timeout: BUDGET_MS });
      },
    },

    {
      name: 'a failed connect closes the transport and rethrows',
      run: async (ctx) => {
        const fake = pair(ctx.expect, { connect: () => Promise.reject(new Error('spawn ENOENT')) });

        await ctx.expect(readToolsOnce(fake.client, fake.transport)).rejects.toThrow(/spawn ENOENT/);
        // Nothing else would terminate the child the transport already started.
        ctx.expect(fake.calls).toEqual(['client.connect', 'transport.close']);
      },
    },

    {
      name: 'a connect that never settles fails at the deadline, with the transport closed',
      run: async (ctx) => {
        const fake = pair(ctx.expect, { connect: () => new Promise(() => {}) });
        const started = Date.now();

        await ctx.expect(readToolsOnce(fake.client, fake.transport)).rejects.toThrow(new RegExp(`handshake did not finish within ${BUDGET_MS}ms`));
        // 10ms of slack: Node fires timers up to a few ms before Date.now agrees
        // (timer rounding vs the clock) — the rejection MESSAGE above is the proof
        // the deadline answered; this only pins that nothing answered early.
        ctx.expect(Date.now() - started >= BUDGET_MS - 10, 'the deadline, not the fake, answered').toBeTruthy();
        ctx.expect(fake.calls).toEqual(['client.connect', 'transport.close']);
      },
    },

    {
      name: 'a failed read closes the transport and rethrows',
      run: async (ctx) => {
        const fake = pair(ctx.expect, { listTools: () => Promise.reject(new Error('tools/list is unavailable')) });

        await ctx.expect(readToolsOnce(fake.client, fake.transport)).rejects.toThrow(/tools\/list is unavailable/);
        // The connect deadline is done with the transport by then, so this path owns
        // the cleanup; closing through the client would leave the child running.
        ctx.expect(fake.calls).toEqual(['client.connect', 'client.listTools', 'transport.close']);
      },
    },

    {
      name: 'connectWithDeadline resolves without touching the transport',
      run: async (ctx) => {
        const fake = pair(ctx.expect);

        await connectWithDeadline(fake.client, fake.transport);
        ctx.expect(fake.calls).toEqual(['client.connect']);
      },
    },
  ],
});
