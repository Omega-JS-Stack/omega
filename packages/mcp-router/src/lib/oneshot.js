/**
 * Connecting to an upstream child, under the router's spawn budget.
 *
 * Two surfaces refresh a schema (the router's `router__refresh_upstream` and
 * `omega-mcp refresh`), and both do the same thing: spawn the upstream once,
 * read its tool list, close it. They ran as two copies of that sequence and the
 * copies drifted (the cleanup, then the read budget, landed on the router side
 * only), so the sequence lives here ONCE and both callers import it.
 *
 * The connect deadline is shared wider still: the router's lazy cold spawn
 * connects through the same helper, on the same budget.
 */

// How long a connect gets to finish the MCP handshake. A child that corrupts
// the stdio wire never answers initialize, and an unbounded connect would leave
// the router's `spawning` promise pending: every later call would await that
// dead promise and die at the caller's own tool timeout, for the rest of the
// session. The deadline bounds it so the NEXT call spawns fresh. It bounds the
// one-shot refresh connect AND its tools/list read too, on the same budget.
// MCP_ROUTER_SPAWN_TIMEOUT_MS is the test seam, alongside the two in paths.js.
const SPAWN_TIMEOUT_MS = Number(process.env.MCP_ROUTER_SPAWN_TIMEOUT_MS) || 30000;

/**
 * Connect a client over its transport, bounded by SPAWN_TIMEOUT_MS.
 *
 * The deadline abandons a connect the SDK has not settled (the SDK's own
 * request timeout answers much later); Promise.race already attaches the
 * rejection handler, so the explicit catch on `connected` only documents the
 * abandonment. On ANY rejection the transport is closed — a stuck handshake,
 * or one that lands after the deadline, would otherwise leave its child
 * running for the rest of the session — then the rejection is rethrown.
 *
 * @param {object} client - Proxy client to connect
 * @param {object} transport - Transport whose child is terminated on failure
 * @returns {Promise<void>} Resolves once the handshake lands
 * @throws {Error} When the handshake does not finish within SPAWN_TIMEOUT_MS
 */
const connectWithDeadline = async (client, transport) => {
  const connected = client.connect(transport);
  connected.catch(() => {});

  let deadline;
  try {
    await Promise.race([
      connected,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error(`handshake did not finish within ${SPAWN_TIMEOUT_MS}ms`)),
          SPAWN_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (err) {
    await transport.close().catch(() => {});
    throw err;
  } finally {
    clearTimeout(deadline);
  }
};

/**
 * Connect an already-built pair, read the tool list once, and close.
 *
 * A child that finishes the handshake can still fail the tools/list read (an
 * error answer, or a stall). The read carries the router's own budget because
 * the SDK would otherwise hold the caller for its 60s default.
 * connectWithDeadline is done with the transport by then, so nothing else would
 * close it and the one-shot child would run for the rest of the session. The
 * success path closes through the client instead, so the transport is never
 * closed twice.
 *
 * @param {object} client - Client to connect and read through
 * @param {object} transport - Transport whose child is terminated on any failure
 * @returns {Promise<object[]>} The upstream's tool descriptors
 * @throws {Error} Whatever the connect or the read rejected with
 */
const readToolsOnce = async (client, transport) => {
  await connectWithDeadline(client, transport);

  let result;
  try {
    result = await client.listTools(undefined, { timeout: SPAWN_TIMEOUT_MS });
  } catch (err) {
    await transport.close().catch(() => {});
    throw err;
  }
  await client.close();
  return result.tools;
};

/**
 * Spawn an upstream once, read its tool list, and close it.
 *
 * The SDK is required HERE rather than at module load so the CLI commands that
 * never reach this path (list, help) still work when node_modules is missing.
 *
 * @param {{command: string, args: string[], env: object}} spawn - Resolved spawn shape for the child
 * @returns {Promise<object[]>} The upstream's tool descriptors
 * @throws {Error} Whatever the connect or the read rejected with
 */
const listToolsOnce = async (spawn) => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: spawn.command,
    args: spawn.args,
    env: spawn.env,
    stderr: 'inherit',
  });
  const client = new Client({ name: 'mcp-router-refresh', version: '1.0.0' }, { capabilities: {} });

  return readToolsOnce(client, transport);
};

module.exports = { SPAWN_TIMEOUT_MS, connectWithDeadline, readToolsOnce, listToolsOnce };
